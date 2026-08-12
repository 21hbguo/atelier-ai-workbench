"""URL 抓取服务：从用户消息中提取链接并抓取网页正文，供聊天功能使用。

对外接口（严格契约，其他模块按此调用）：
- ``extract_urls(text: str) -> list[str]``：从文本中提取所有 http/https URL，
  去重并保持出现顺序。
- ``fetch_url(url: str, max_chars: int = 12000, timeout: float = 10.0) -> dict``：
  抓取网页并提取正文。成功返回
  ``{"ok": True, "url": <最终URL>, "title": <标题或"">, "text": <正文>}``，
  失败返回 ``{"ok": False, "error": <中文错误原因>}``。
  函数内部捕获一切异常并转为 ``ok=False``，绝不向上抛出。

安全设计（SSRF 防护）：
1. 仅允许 http/https scheme，其余直接拒绝。
2. 每次请求前用 ``socket.getaddrinfo`` 解析目标域名，检查全部解析出的 IP：
   拒绝 IPv4 环回 127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、
   169.254.0.0/16（link-local）、0.0.0.0，以及 IPv6 ::1、fc00::/7（ULA）、
   fe80::/10（link-local）；IPv4-mapped IPv6（如 ::ffff:127.0.0.1）按内嵌
   IPv4 判定。
3. 重定向：``follow_redirects=False`` 手动跟随，最多 5 跳；每一跳的目标 URL
   都重新做 DNS 解析 + IP 校验（防 DNS rebinding / 重定向到内网）。
4. 响应体上限 5MB（流式读取截断）；请求超时由 ``httpx.Timeout`` 控制；
   使用浏览器 User-Agent。

正文提取：优先用 trafilatura（``include_comments=False, include_tables=True``，
同步库经 ``asyncio.to_thread`` 包装）；trafilatura 不可用或提取为空时降级为
正则去标签。标题用 ``trafilatura.extract_metadata``，失败则用 <title> 正则。
"""
from __future__ import annotations

import asyncio
import html
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

try:  # trafilatura 为同步库；缺失时走降级提取，模块仍可用
    import trafilatura
    _TRAFILATURA_OK = True
except Exception:  # noqa: BLE001 - 依赖缺失时的兜底
    trafilatura = None
    _TRAFILATURA_OK = False

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DEFAULT_HEADERS = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

MAX_BODY_BYTES = 5 * 1024 * 1024  # 响应体大小上限 5MB
MAX_REDIRECTS = 5  # 最多跟随的重定向跳数

# SSRF 黑名单网段（契约要求）
_PRIVATE_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),    # IPv4 环回
    ipaddress.ip_network("10.0.0.0/8"),     # 私有
    ipaddress.ip_network("172.16.0.0/12"),  # 私有
    ipaddress.ip_network("192.168.0.0/16"),  # 私有
    ipaddress.ip_network("169.254.0.0/16"),  # link-local
    ipaddress.ip_network("0.0.0.0/32"),     # 未指定
    ipaddress.ip_network("::1/128"),        # IPv6 环回
    ipaddress.ip_network("::/128"),         # IPv6 未指定（相当于 0.0.0.0）
    ipaddress.ip_network("fc00::/7"),       # IPv6 ULA
    ipaddress.ip_network("fe80::/10"),      # IPv6 link-local
    ipaddress.ip_network("64:ff9b::/96"),   # NAT64/DNS64：内嵌 IPv4（如 64:ff9b::7f00:1 = 127.0.0.1）
    ipaddress.ip_network("2002::/16"),      # 6to4：内嵌 IPv4
    ipaddress.ip_network("2001::/32"),      # Teredo：内嵌 IPv4
]

# 提取 URL 的正则：http/https + 非空白、非 <> 引号、非中文标点
# 中文标点（，。；：、！？（）【】《》「」『』…）在中文语境中几乎必然是 URL 的
# 终止符（如「https://a.com/1，再看」），必须排除，否则会把后续中文吞进 URL；
# 中文汉字仍保留（URL 路径可能含中文，如 https://example.com/报道）。
_CJK_PUNCT = "，。；：、！？（）【】《》「」『』…—·"
_URL_RE = re.compile(rf"https?://[^\s<>\"'{re.escape(_CJK_PUNCT)}]+", re.IGNORECASE)
# URL 尾部常见的 ASCII 闭合/标点字符，提取后剥离
_TRAILING_PUNCT = ".,;:!?)]}\"'"
# 中文标点中的「右侧型」字符也参与尾部剥离（兜底：正则漏网时）
_TRAILING_PUNCT_CJK = "。，；：、！？）」》」』…"


# ---------------------------------------------------------------- URL 提取

def extract_urls(text: str) -> list[str]:
    """从文本中提取所有 http/https URL，去重并保持出现顺序。"""
    if not text:
        return []
    urls: list[str] = []
    for match in _URL_RE.findall(text):
        url = match.rstrip(_TRAILING_PUNCT + _TRAILING_PUNCT_CJK)
        if url and url not in urls:
            urls.append(url)
    return urls


# ---------------------------------------------------------------- SSRF 防护

# NAT64/DNS64 前缀：内嵌 IPv4 按 IPv4 判定（公网 IPv4 的 NAT64 形式应放行，
# 如 64:ff9b::8.8.8.8；内网 IPv4 的 NAT64 形式仍拒绝，如 64:ff9b::7f00:1）
_NAT64_NETWORK = ipaddress.ip_network("64:ff9b::/96")


def _is_private_ip(ip_str: str) -> bool:
    """判断 IP 是否命中 SSRF 黑名单网段。"""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    # IPv4-mapped IPv6（如 ::ffff:127.0.0.1）按内嵌的 IPv4 地址判定，防止绕过
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    # NAT64/DNS64（64:ff9b::/96）：内嵌 IPv4 同样按 IPv4 判定
    elif isinstance(ip, ipaddress.IPv6Address) and ip in _NAT64_NETWORK:
        ip = ipaddress.ip_address(ip.packed[12:16])
    return any(ip in net for net in _PRIVATE_NETWORKS)


def _resolve_host(host: str, port: int):
    """解析域名（同步、阻塞，调用方用 asyncio.to_thread 包装）。"""
    return socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)


def _resolve_safe_ip(host: str, port: int) -> tuple[str | None, str | None]:
    """解析 host 并校验全部 IP；返回 (首个安全 IP, 错误信息)。

    所有解析出的 IP 都必须不在 SSRF 黑名单内（任一命中即拒绝），
    否则返回 (None, 中文错误)。DNS rebinding 防护的关键：调用方必须
    使用返回的 IP 发起连接（见 _pin_host），而不是让 httpx 自行二次解析。
    """
    try:
        infos = _resolve_host(host, port)
    except socket.gaierror:
        return None, f"无法解析域名：{host}"
    except OSError as e:  # noqa: BLE001 - DNS 系统错误转可读信息
        return None, f"域名解析失败：{e}"
    if not infos:
        return None, f"无法解析域名：{host}"
    for info in infos:
        ip_str = info[4][0]
        if _is_private_ip(ip_str):
            return None, "不允许访问内网地址"
    return infos[0][4][0], None


def _check_host_safety(host: str, port: int) -> str | None:
    """解析 host 并校验全部 IP；安全返回 None，否则返回中文错误信息。

    薄封装（兼容既有调用/测试），内部复用 _resolve_safe_ip。
    """
    _, err = _resolve_safe_ip(host, port)
    return err


def _pin_host(url: str, ip: str) -> str:
    """把 URL 的 host 替换为已校验的 IP，保留 scheme/端口/路径/查询。

    IPv6 地址用方括号包裹（如 [2001:db8::1]）。替换后 httpx 直接连接 IP，
    不再二次解析域名，从而消除 DNS rebinding TOCTOU 窗口。
    """
    parsed = urlsplit(url)
    port = parsed.port
    netloc = f"[{ip}]" if ":" in ip else ip
    if port is not None:
        netloc += f":{port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


# ---------------------------------------------------------------- 正文提取

def _extract_title_regex(html_bytes: bytes) -> str:
    """正则 <title> 提取标题的兜底实现。"""
    try:
        raw = html_bytes.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return ""
    match = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
    if not match:
        return ""
    return match.group(1).strip()


def _extract_title(html_bytes: bytes) -> str:
    """提取页面标题：优先 <title> 正则（页面标题最直观），失败用 trafilatura metadata。"""
    title = _extract_title_regex(html_bytes)
    if title:
        return title
    if _TRAFILATURA_OK:
        try:
            meta = trafilatura.extract_metadata(html_bytes)
            if meta is not None and getattr(meta, "title", None):
                return str(meta.title).strip()
        except Exception:  # noqa: BLE001 - 元数据提取失败不致命
            pass
    return ""


def _fallback_extract_text(html_bytes: bytes) -> str:
    """trafilatura 不可用或提取为空时的降级提取：去 script/style 与标签。"""
    try:
        text = html_bytes.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return ""
    text = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def _extract_text(html_bytes: bytes) -> str:
    """提取正文：trafilatura（include_comments=False, include_tables=True）。"""
    if _TRAFILATURA_OK:
        try:
            extracted = trafilatura.extract(
                html_bytes, include_comments=False, include_tables=True
            )
            if extracted:
                return extracted.strip()
        except Exception:  # noqa: BLE001 - 提取失败降级
            pass
    return _fallback_extract_text(html_bytes)


# ---------------------------------------------------------------- 抓取主流程

async def fetch_url(url: str, max_chars: int = 12000, timeout: float = 10.0) -> dict:
    """抓取网页并提取正文。

    成功：{"ok": True, "url": <最终URL>, "title": <标题或"">, "text": <正文>}
    失败：{"ok": False, "error": <中文错误原因>}
    任何异常都会被捕获并转为 ok=False，绝不抛出。
    """
    try:
        return await _fetch_url_inner(url, max_chars, timeout)
    except Exception as e:  # noqa: BLE001 - 契约要求：绝不向上抛出
        return {"ok": False, "error": f"抓取失败：{e}"}


async def _fetch_url_inner(url: str, max_chars: int, timeout: float) -> dict:
    url = (url or "").strip()
    if not url:
        return {"ok": False, "error": "链接为空"}

    parsed = urlsplit(url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        return {"ok": False, "error": "仅支持 http/https 链接"}
    if not parsed.hostname:
        return {"ok": False, "error": "链接格式无效"}

    current_url = url
    body = b""
    final_url = ""
    truncated = False

    async with httpx.AsyncClient(
        follow_redirects=False, timeout=httpx.Timeout(timeout)
    ) as client:
        # 第 1 次为初始请求，之后每跳 1 次重定向；超过 MAX_REDIRECTS 跳则报错
        for _hop in range(MAX_REDIRECTS + 1):
            parsed = urlsplit(current_url)
            scheme = (parsed.scheme or "").lower()
            host = parsed.hostname
            if scheme not in ("http", "https") or not host:
                return {"ok": False, "error": "链接格式无效"}
            try:
                port = parsed.port or (443 if scheme == "https" else 80)
            except ValueError:
                return {"ok": False, "error": "链接端口无效"}

            # 每一跳都重新解析 + IP 校验（防 DNS rebinding / 重定向到内网）
            ip, err = await asyncio.to_thread(_resolve_safe_ip, host, port)
            if err:
                return {"ok": False, "error": err}

            # pin 连接：把 URL host 替换为已校验 IP 再请求，杜绝「校验后 httpx
            # 自行二次解析域名」的 DNS rebinding TOCTOU 窗口。原始域名通过
            # Host 头（http）与 TLS SNI（https）保留，保证证书校验与虚拟主机正确。
            pinned_url = _pin_host(current_url, ip)
            headers = dict(DEFAULT_HEADERS)
            # Host 头用原始域名；IPv6 字面量必须带方括号（RFC 7230）
            host_header = f"[{host}]" if ":" in host else host
            if port != (443 if scheme == "https" else 80):
                host_header += f":{port}"
            headers["Host"] = host_header
            extensions = {"sni_hostname": host} if scheme == "https" else None

            try:
                async with client.stream(
                    "GET", pinned_url, headers=headers, extensions=extensions
                ) as resp:
                    if resp.status_code >= 400:
                        return {"ok": False, "error": f"请求失败：HTTP {resp.status_code}"}
                    if resp.status_code in (301, 302, 303, 307, 308):
                        location = resp.headers.get("location")
                        if not location:
                            return {"ok": False, "error": "重定向响应缺少 Location 头"}
                        # 相对解析基于原始域名形态的 current_url（而非 pin 后的 IP），
                        # 保证重定向目标仍是域名形态，Host/SNI 与证书校验不丢失
                        current_url = urljoin(current_url, location)
                        continue  # 跟随重定向，进入下一跳（重新做安全校验）

                    # 正常响应：流式读取并截断至 MAX_BODY_BYTES
                    chunks = []
                    size = 0
                    async for chunk in resp.aiter_bytes():
                        chunks.append(chunk)
                        size += len(chunk)
                        if size >= MAX_BODY_BYTES:
                            truncated = True
                            break
                    body = b"".join(chunks)
                    final_url = current_url  # 返回域名形态的最终 URL（相对重定向已还原）
                    break
            except httpx.TimeoutException:
                return {"ok": False, "error": f"请求超时：{current_url}"}
            except httpx.ConnectError as e:
                return {"ok": False, "error": f"无法连接服务器：{e}"}
            except httpx.InvalidURL:
                return {"ok": False, "error": "链接格式无效"}
            except httpx.RequestError as e:
                return {"ok": False, "error": f"请求失败：{e}"}
        else:
            return {"ok": False, "error": f"重定向次数过多（超过 {MAX_REDIRECTS} 次）"}

    if truncated:
        body = body[:MAX_BODY_BYTES]

    title = ""
    text = ""
    if body:
        title = await asyncio.to_thread(_extract_title, body)
        text = await asyncio.to_thread(_extract_text, body)

    if not text:
        return {"ok": False, "error": "无法从该链接提取正文内容（可能不是网页或内容为空）"}

    if len(text) > max_chars:
        text = text[:max_chars] + "\n…[内容过长，已截断]"

    return {"ok": True, "url": final_url, "title": title, "text": text}

"""URL 抓取服务：从用户消息中提取链接并抓取网页正文，供聊天功能使用。

对外接口（严格契约，其他模块按此调用）：
- ``extract_urls(text: str) -> list[str]``：从文本中提取所有 http/https URL，
  去重并保持出现顺序。
- ``fetch_url(url: str, max_chars: int = 12000, timeout: float = 10.0) -> dict``：
  抓取网页并提取正文。成功返回
  ``{"ok": True, "url": <最终URL>, "title": <标题或"">, "text": <正文>,
  "links": <页面链接列表，最多10条>}``，
  失败返回 ``{"ok": False, "error": <中文错误原因>, "links": []}``。
  函数内部捕获一切异常并转为 ``ok=False``，绝不向上抛出。
- ``extract_links_from_html(html_bytes, base_url, max_links=30) -> list[str]``：
  从 HTML 中提取页面链接（纯函数、同步、不抛异常），供聊天 agent 做
  「页面链接扩散（BFS）」自主搜索：标准库 html.parser 解析 <a href>，
  相对链接经 ``urljoin`` 转绝对 URL，仅保留 http/https（大小写不敏感），
  过滤资源文件扩展名（图片/视频/音频/样式/脚本/文档/归档/程序等，
  忽略查询串后判断），去重保序，站外（与 base_url 不同域名）链接优先
  （各自保持出现顺序），返回最多 max_links 条；解析失败返回 []。

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
5. 文件链接（PDF/Office/图片）分支：URL 路径扩展名命中文件类型
   （pdf/doc/docx/ppt/pptx/xls/xlsx + png/jpg/jpeg/jp2/webp/gif/bmp），
   或响应 Content-Type 命中（application/pdf、openxmlformats-*、image/* 等）
   时，按文件下载（体积上限 ``MAX_FILE_BYTES`` 50MB，可被环境变量
   ``MINERU_MAX_FILE_BYTES`` 覆盖，同样逐跳 SSRF 校验）；下载完成后本地
   ``document_parser.parse_file`` 解析优先（fast path），失败时降级 MinerU
   云端（``mineru_client.parse_file``，is_ocr=True；图片无本地解析直接走
   MinerU）；返回 ``title`` 为文件名。临时文件用后即删。

正文提取：优先用 trafilatura（``include_comments=False, include_tables=True``，
同步库经 ``asyncio.to_thread`` 包装）；trafilatura 不可用或提取为空时降级为
正则去标签。标题用 ``trafilatura.extract_metadata``，失败则用 <title> 正则。
"""
from __future__ import annotations

import asyncio
import html
import ipaddress
import os
import re
import socket
import tempfile
from html.parser import HTMLParser  # 标准库，不引入第三方依赖
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

import httpx

# 本地文件解析（txt/md/pdf/docx/xlsx/pptx 等），fast path 优先于 MinerU 云端
from backend.services.document_parser import parse_file  # noqa: E402

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
MAX_FILE_BYTES = 50 * 1024 * 1024  # 文件下载体积上限 50MB
try:  # 可被环境变量 MINERU_MAX_FILE_BYTES 覆盖（单位：字节）
    MAX_FILE_BYTES = int(os.environ.get("MINERU_MAX_FILE_BYTES", str(MAX_FILE_BYTES)))
except (TypeError, ValueError):  # noqa: S112 - 非法环境变量值回退默认
    pass

# PDF 每页平均字符密度阈值：低于此值判定为图片型/扫描型页面（本地提取质量差，
# 如整页图片/手写/拍照文档），升级 MinerU 云端解析（is_ocr=True）。
# 正常文本页通常 500+ 字符/页，扫描页仅剩页眉页脚等零星文本（<50）。
MINERU_MIN_CHARS_PER_PAGE = 150
try:  # 可被环境变量 MINERU_MIN_CHARS_PER_PAGE 覆盖
    MINERU_MIN_CHARS_PER_PAGE = int(
        os.environ.get("MINERU_MIN_CHARS_PER_PAGE", str(MINERU_MIN_CHARS_PER_PAGE))
    )
except (TypeError, ValueError):  # noqa: S112 - 非法环境变量值回退默认
    pass

# 文件分支识别的扩展名集合（URL 路径扩展名命中即走文件下载分支）
_FILE_EXTS = {
    "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
    "png", "jpg", "jpeg", "jp2", "webp", "gif", "bmp",
}
# 图片扩展名：本地 document_parser 不支持，直接走 MinerU（is_ocr=True）
_IMAGE_EXTS = {"png", "jpg", "jpeg", "jp2", "webp", "gif", "bmp"}
# Content-Type → 扩展名（防「无扩展名但实际是文件」的链接，如 /download?id=1）
_MIME_EXT = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.ms-excel": "xls",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
}
# 简化 Content-Type（部分服务器省略前缀）的关键字兜底
_MIME_KEYWORD_EXT = {
    "wordprocessingml": "docx",
    "spreadsheetml": "xlsx",
    "presentationml": "pptx",
}

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


# ---------------------------------------------------------------- 链接提取

# 资源文件扩展名：链接指向这类文件时过滤（忽略查询串后按路径最后一段判断）。
# 覆盖图片/视频/音频/样式/脚本/文档/归档/程序等，BFS 只扩散可读网页。
_RESOURCE_EXTS = {
    # 图片
    "jpg", "jpeg", "png", "gif", "webp", "svg", "ico", "bmp", "avif", "jfif",
    # 视频
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "3gp",
    # 音频
    "mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "wma", "opus",
    # 样式 / 脚本
    "css", "js", "mjs", "map",
    # 文档 / 数据
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "odt", "ods", "odp", "txt", "csv",
    # 归档 / 程序
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
    "exe", "dmg", "apk", "msi",
}


class _LinkParser(HTMLParser):
    """HTMLParser 子类：收集所有 <a href> 的原始 href 值（含大写属性名）。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a":
            return
        for key, value in attrs:
            if key.lower() == "href" and value:
                self.hrefs.append(value)


def _ext_from_path(path: str) -> str:
    """取路径最后一段的扩展名（小写）；无扩展名返回空串。"""
    if not path:
        return ""
    last = path.rstrip("/").rsplit("/", 1)[-1]
    if "." not in last:
        return ""
    return last.rsplit(".", 1)[-1].lower()


def extract_links_from_html(
    html_bytes: bytes, base_url: str, max_links: int = 30
) -> list[str]:
    """从 HTML 中提取页面链接（供聊天 agent 页面链接扩散 BFS 搜索）。

    - 标准库 html.parser 解析 <a href>；相对链接经 urljoin(base_url, href)
      转为绝对 URL，仅保留 http/https scheme（大小写不敏感）；
    - 过滤资源文件扩展名（图片/视频/音频/样式/脚本/文档等，忽略查询串）；
    - 去重保序；站外（与 base_url 不同域名）链接优先，各自保持出现顺序；
    - 返回最多 max_links 条；解析失败返回 []。
    纯函数、同步、不抛异常。
    """
    if not html_bytes or not base_url:
        return []
    try:
        parser = _LinkParser()
        parser.feed(html_bytes.decode("utf-8", errors="replace"))
        parser.close()
    except Exception:  # noqa: BLE001 - 解析失败返回空
        return []

    base_host = (urlsplit(base_url).hostname or "").lower()
    seen: set[str] = set()
    external: list[str] = []  # 站外（与 base_url 不同域名）
    internal: list[str] = []  # 站内
    for href in parser.hrefs:
        try:
            href = html.unescape(href.strip())
            if not href:
                continue
            absolute = urljoin(base_url, href)
            parsed = urlsplit(absolute)
            if parsed.scheme.lower() not in ("http", "https"):
                continue
            if _ext_from_path(parsed.path) in _RESOURCE_EXTS:
                continue
            # 去重按去掉 fragment 后的 URL（fragment 不参与网络请求）
            normalized = urlunsplit(
                (parsed.scheme.lower(), parsed.netloc, parsed.path, parsed.query, "")
            )
            if normalized in seen:
                continue
            seen.add(normalized)
            host = (parsed.hostname or "").lower()
            (external if host != base_host else internal).append(normalized)
        except Exception:  # noqa: BLE001 - 单条链接解析失败跳过
            continue
    return (external + internal)[:max_links]


# ---------------------------------------------------------------- 文件分支

def _file_ext_from_url(url: str) -> str | None:
    """URL 路径扩展名是否命中文件类型；命中返回小写扩展名，否则 None。

    只取路径最后一段（文件名）的扩展名，目录名含点不误判。
    """
    path = urlsplit(url).path
    if not path:
        return None
    last = path.rstrip("/").rsplit("/", 1)[-1]
    if not last or "." not in last:
        return None
    ext = last.rsplit(".", 1)[-1].lower()
    return ext if ext in _FILE_EXTS else None


def _file_ext_from_content_type(content_type: str) -> str | None:
    """Content-Type 是否命中文件类型；命中返回扩展名，否则 None。

    覆盖 application/pdf、application/vnd.openxmlformats-*（docx/xlsx/pptx）、
    application/msword、application/vnd.ms-excel/powerpoint、image/*。
    """
    ct = (content_type or "").split(";")[0].strip().lower()
    if not ct:
        return None
    if ct in _MIME_EXT:
        return _MIME_EXT[ct]
    for keyword, ext in _MIME_KEYWORD_EXT.items():
        if keyword in ct:
            return ext
    if ct.startswith("image/"):
        sub = ct.split("/", 1)[1]
        return sub if sub in _IMAGE_EXTS else None
    return None


def _is_html_content_type(content_type: str) -> bool:
    """Content-Type 是否明确是 HTML 页面（用于「扩展名像文件但实际是网页」回退）。"""
    ct = (content_type or "").split(";")[0].strip().lower()
    return ct in ("text/html", "application/xhtml+xml")


def _filename_from_url(url: str, ext: str) -> str:
    """从最终 URL 提取文件名（作为 title）；提取不到时用 document.<ext>。"""
    path = urlsplit(url).path
    name = unquote(path.rstrip("/").rsplit("/", 1)[-1]) if path else ""
    if not name or "." not in name:
        name = f"document.{ext}"
    return name


def _truncate_text(text: str, max_chars: int) -> str:
    """统一截断逻辑：超过 max_chars 时截断并追加中文省略标记。"""
    if len(text) > max_chars:
        return text[:max_chars] + "\n…[内容过长，已截断]"
    return text


def _get_mineru_client():
    """惰性加载 mineru_client 模块（并行开发中，模块可能尚未就绪）。

    契约（见 mineru_client.py）：``is_configured() -> bool``、
    ``async parse_file(path, filename, *, is_ocr=True, language="ch")`` 返回
    ``{"ok": True, "text": <markdown 全文>}`` 或 ``{"ok": False, "error": 中文}``。
    模块未就绪时返回 None，调用方跳过 MinerU 降级。
    """
    try:
        from backend.services import mineru_client  # noqa: PLC0415 - 函数内导入防模块未就绪
        return mineru_client
    except Exception:  # noqa: BLE001 - 模块缺失/导入失败一律视为未配置
        return None


def _mineru_configured(mineru) -> bool:
    """安全调用 is_configured()，异常视为未配置。"""
    try:
        return bool(mineru.is_configured())
    except Exception:  # noqa: BLE001
        return False


def _page_density_too_low(path: str, text: str) -> bool:
    """PDF 平均每页字符密度过低 → 判定为图片型/扫描型页面，值得升级 MinerU。

    正常文本页通常 500+ 字符/页；扫描/图片页可能只剩页眉页脚等零星文本。
    阈值保守取 MINERU_MIN_CHARS_PER_PAGE（默认 150）。fitz 不可用或
    读取异常时保守返回 False（不误升级，保持现状行为）。
    """
    try:
        import fitz  # PyMuPDF（document_parser 既有依赖）

        doc = fitz.open(path)
        try:
            page_count = doc.page_count
        finally:
            doc.close()
        if page_count <= 0:
            return False
        avg_chars = len(text or "") / page_count
        return avg_chars < MINERU_MIN_CHARS_PER_PAGE
    except Exception:  # noqa: BLE001 - 密度检测失败不阻断，保持现状
        return False


async def _parse_file_content(
    body: bytes, ext: str, final_url: str, max_chars: int, truncated: bool
) -> dict:
    """文件分支：本地 document_parser 优先，MinerU 云端兜底。

    - 文本型文件（pdf/docx/xlsx/pptx 等）：本地 parse_file 成功即返回；
      失败（损坏/扫描件/老格式 doc/xls/ppt 不支持）时若 MinerU 已配置则降级云端。
    - 图片：本地不支持，直接走 MinerU（is_ocr=True）。
    临时文件用后即删（try/finally unlink）。
    """
    if truncated:
        size_mb = MAX_FILE_BYTES / (1024 * 1024)
        label = f"{int(size_mb)}MB" if size_mb >= 1 else f"{MAX_FILE_BYTES // 1024}KB"
        return {
            "ok": False,
            "error": f"文件超过大小上限（{label}），无法下载解析",
        }
    if not body:
        return {"ok": False, "error": "文件内容为空"}
    filename = _filename_from_url(final_url, ext)
    is_image = ext in _IMAGE_EXTS

    fd, path = tempfile.mkstemp(prefix="urlfetch_", suffix=f".{ext}")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(body)

        # 本地 fast path（图片跳过：document_parser 不支持）
        text = ""
        if not is_image:
            try:
                text = await asyncio.to_thread(parse_file, path, ext)
            except Exception:  # noqa: BLE001 - 本地失败走 MinerU 降级
                text = ""
        if text:
            # 密度启发式：PDF 能提取文本但每页字符密度过低（图片型/扫描型页面，
            # 如整页图片/手写/拍照文档）→ 本地文本不可用，升级 MinerU 云端解析
            if ext == "pdf" and _page_density_too_low(path, text):
                text = ""
            else:
                return {"ok": True, "url": final_url, "title": filename,
                        "text": _truncate_text(text, max_chars), "links": []}

        # MinerU 云端兜底
        mineru = _get_mineru_client()
        if mineru is None or not _mineru_configured(mineru):
            if is_image:
                return {"ok": False, "error": "图片解析需要配置 MinerU 服务"}
            return {"ok": False, "error": "文件解析失败：本地解析未能提取文本，且 MinerU 服务未配置"}
        try:
            result = await mineru.parse_file(path, filename, is_ocr=True, language="ch")
        except Exception as e:  # noqa: BLE001 - MinerU 调用异常转为可读错误
            return {"ok": False, "error": f"文件解析失败：{e}"}
        if not result or not result.get("ok"):
            err = (result or {}).get("error") or "未知错误"
            return {"ok": False, "error": f"文件解析失败：{err}"}
        return {"ok": True, "url": final_url, "title": filename,
                "text": _truncate_text(result.get("text") or "", max_chars),
                "links": []}
    finally:
        try:
            os.unlink(path)
        except OSError:  # noqa: S110 - 清理失败不致命
            pass


# ---------------------------------------------------------------- 抓取主流程

async def fetch_url(url: str, max_chars: int = 12000, timeout: float = 10.0) -> dict:
    """抓取网页并提取正文。

    成功：{"ok": True, "url": <最终URL>, "title": <标题或"">, "text": <正文>,
           "links": <页面链接列表（最多10条，供 BFS 扩散）>}
    失败：{"ok": False, "error": <中文错误原因>, "links": []}
    任何异常都会被捕获并转为 ok=False，绝不抛出。
    """
    try:
        result = await _fetch_url_inner(url, max_chars, timeout)
    except Exception as e:  # noqa: BLE001 - 契约要求：绝不向上抛出
        result = {"ok": False, "error": f"抓取失败：{e}"}
    # 向后兼容：所有失败路径统一补 links 字段；成功路径已在内部填充
    result.setdefault("links", [])
    return result


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
    file_ext: str | None = None  # 非 None 表示文件分支（URL 扩展名或 Content-Type 命中）

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

            # 文件分支预检：URL 路径扩展名命中文件类型（pdf/docx/图片等）→ 该跳
            # 按文件下载（体积上限 MAX_FILE_BYTES）。重定向链上任何一跳命中即生效。
            file_ext = _file_ext_from_url(current_url)

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

                    # Content-Type 兜底：无扩展名但实际是文件（如 /download?id=1
                    # 直接返回 application/pdf）；URL 看着像文件但服务器明确返回
                    # HTML 时回退为网页处理（防误伤伪文件链接）
                    content_type = resp.headers.get("content-type", "")
                    ct_ext = _file_ext_from_content_type(content_type)
                    if ct_ext is not None:
                        file_ext = ct_ext
                    elif file_ext is not None and _is_html_content_type(content_type):
                        file_ext = None

                    # 正常响应：流式读取；文件分支上限 MAX_FILE_BYTES，网页 MAX_BODY_BYTES
                    limit = MAX_FILE_BYTES if file_ext is not None else MAX_BODY_BYTES
                    chunks = []
                    size = 0
                    async for chunk in resp.aiter_bytes():
                        chunks.append(chunk)
                        size += len(chunk)
                        if size >= limit:
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
        body = body[: (MAX_FILE_BYTES if file_ext is not None else MAX_BODY_BYTES)]

    # 文件分支：本地解析优先，MinerU 云端兜底
    if file_ext is not None:
        return await _parse_file_content(body, file_ext, final_url, max_chars, truncated)

    title = ""
    text = ""
    if body:
        title = await asyncio.to_thread(_extract_title, body)
        text = await asyncio.to_thread(_extract_text, body)

    if not text:
        return {"ok": False, "error": "无法从该链接提取正文内容（可能不是网页或内容为空）"}

    return {
        "ok": True,
        "url": final_url,
        "title": title,
        "text": _truncate_text(text, max_chars),
        # 从流式读取拿到的原始 HTML 提取链接（以最终重定向 URL 为 base），
        # 最多 10 条，供聊天 agent 做页面链接扩散（BFS）自主搜索
        "links": extract_links_from_html(body, final_url, max_links=10),
    }

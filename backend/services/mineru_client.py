"""MinerU 云 API 客户端：把 PDF/Office/图片等难解析文件转成 markdown 文本。

实现基于 MinerU **Agent 轻量解析 API（v1）** 的本地文件上传模式
（官方文档 https://mineru.net/apiManage/docs，2026-08 实测全链路可用）：

1. ``POST /api/v1/agent/parse/file``（body: file_name/language/is_ocr/...）
   → 返回 ``data.task_id`` + ``data.file_url``（OSS 签名上传 URL）
2. 客户端用 **PUT 裸传**（不带任何 Content-Type 头！OSS 签名计算含
   Content-Type 空值，显式带头会 SignatureDoesNotMatch 403）上传文件字节
3. ``GET /api/v1/agent/parse/{task_id}`` 轮询（state: waiting-file/
   uploading/pending/running/done/failed），done 时返回 ``data.markdown_url``
4. 下载 markdown_url 得到全文

限制：单文件 ≤10MB、≤20 页（官方 v1 轻量接口限制）；免 token（IP 限频），
但本项目仍以环境变量 MINERU_API_KEY 作为功能开关（未配置则不走云解析）。

对外接口（契约，url_fetcher 文件分支按此调用）：
- ``is_configured() -> bool``
- ``async parse_file(path, filename, *, is_ocr=True, language="ch",
  timeout=300.0, interval=3.0) -> dict``
  成功 → {"ok": True, "text": <markdown 全文>}（不截断，截断由调用方做）
  失败 → {"ok": False, "error": 中文可读错误}（任何异常都转 error，绝不抛出）

网络调用拆成可单测 patch 的小函数：``_request_file_token`` / ``_upload_file`` /
``_poll_task`` / ``_download_markdown``。
"""
from __future__ import annotations

import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://mineru.net"
FILE_TOKEN_URL = f"{BASE_URL}/api/v1/agent/parse/file"  # 申请签名上传地址 + 创建任务
TASK_URL = f"{BASE_URL}/api/v1/agent/parse/"             # 查询任务状态，task_id 拼在末尾

REQUEST_TIMEOUT = 30.0   # 提交/上传/查询 单次请求超时
DOWNLOAD_TIMEOUT = 60.0  # markdown 下载超时

# v1 轻量接口限制（官方文档）
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10MB
MAX_PAGES = 20                     # 20 页（页数校验依赖调用方，此处仅文件大小）

# 轮询终态
_DONE = "done"
_FAILED = "failed"
# 轮询中间态（继续等待）
_WAITING_STATES = frozenset({"waiting-file", "uploading", "pending", "running", "converting"})


def is_configured() -> bool:
    """MINERU_API_KEY 非空即视为已配置（功能开关；v1 接口本身免 token）。"""
    return bool((os.getenv("MINERU_API_KEY") or "").strip())


# ---------------------------------------------------------------- 网络调用（可 patch 的小函数）

async def _request_file_token(client: httpx.AsyncClient, filename: str,
                              is_ocr: bool, language: str) -> tuple[str, str]:
    """POST /api/v1/agent/parse/file 创建任务并申请签名上传 URL。

    返回 (task_id, file_url)；业务失败（code != 0）抛 RuntimeError。
    """
    payload = {
        "file_name": filename,
        "language": language,
        "enable_table": True,
        "is_ocr": is_ocr,
        "enable_formula": True,
    }
    resp = await client.post(FILE_TOKEN_URL, json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"MinerU 创建任务失败：HTTP {resp.status_code}")
    body = resp.json()
    if not isinstance(body, dict) or body.get("code") not in (0, "0"):
        msg = (body or {}).get("msg") or (body or {}).get("message") or "未知错误"
        raise RuntimeError(f"MinerU 创建任务失败：{msg}")
    data = body.get("data") or {}
    task_id = _find_task_id(data)
    file_url = _find_url(data)
    if not task_id or not file_url:
        raise RuntimeError("MinerU 响应中没有 task_id 或签名上传 URL")
    return task_id, file_url


async def _upload_file(client: httpx.AsyncClient, file_url: str, path: str) -> None:
    """把本地文件字节 PUT 直传 OSS。

    注意：官方文档明确「上传文件时，无须设置 Content-Type 请求头」——
    OSS 签名 URL 的签名计算包含 Content-Type（空值），显式带任何
    Content-Type 都会导致 SignatureDoesNotMatch（HTTP 403）。
    httpx 对 bytes body 不会自动添加 Content-Type，直接裸 PUT 即可。
    """
    content = await asyncio.to_thread(_read_file_bytes, path)
    resp = await client.put(file_url, content=content)
    if resp.status_code >= 400:
        raise RuntimeError(f"文件上传失败：HTTP {resp.status_code}")


async def _poll_task(client: httpx.AsyncClient, task_id: str,
                     timeout: float, interval: float) -> dict:
    """轮询任务直到终态（done/failed）或超时。

    返回任务 data dict（含 state/markdown_url/err_msg）；超时抛 _ParseTimeout。
    """
    import time
    start = time.monotonic()
    while True:
        elapsed = time.monotonic() - start
        if elapsed >= timeout:
            raise _ParseTimeout(f"MinerU 解析超时（超过 {int(timeout)} 秒），可稍后重试")
        resp = await client.get(f"{TASK_URL}{task_id}")
        if resp.status_code >= 400:
            raise RuntimeError(f"MinerU 查询任务失败：HTTP {resp.status_code}")
        body = resp.json()
        if not isinstance(body, dict) or body.get("code") not in (0, "0"):
            msg = (body or {}).get("msg") or (body or {}).get("message") or "未知错误"
            raise RuntimeError(f"MinerU 查询任务失败：{msg}")
        data = body.get("data") or {}
        state = str(data.get("state") or "")
        if state == _DONE:
            return data
        if state == _FAILED:
            raise RuntimeError(str(data.get("err_msg") or "MinerU 解析失败"))
        if state not in _WAITING_STATES:
            # 未知状态防御，避免死循环
            raise RuntimeError(f"MinerU 任务状态异常：{state or '(空)'}")
        await asyncio.sleep(interval)


async def _download_markdown(client: httpx.AsyncClient, markdown_url: str) -> str:
    """下载 markdown 结果全文。"""
    resp = await client.get(markdown_url, timeout=DOWNLOAD_TIMEOUT)
    if resp.status_code >= 400:
        raise RuntimeError(f"MinerU 结果下载失败：HTTP {resp.status_code}")
    return resp.text


# ---------------------------------------------------------------- 防御性响应解析

_URL_KEYS = frozenset(
    {"url", "file_url", "upload_url", "download_url", "cdn_url",
     "fileUrl", "uploadUrl", "downloadUrl", "cdnUrl"}
)
_TASK_ID_KEYS = frozenset({"task_id", "taskId", "id"})


def _find_string_value(obj, keys, starts_with_http: bool = False):
    """递归在 dict/list 里找指定键名的字符串值（支持嵌套）。"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys and isinstance(v, str) and v:
                if (not starts_with_http) or v.startswith("http"):
                    return v
            hit = _find_string_value(v, keys, starts_with_http)
            if hit is not None:
                return hit
    elif isinstance(obj, list):
        for item in obj:
            hit = _find_string_value(item, keys, starts_with_http)
            if hit is not None:
                return hit
    return None


def _find_http_string(obj):
    """兜底：递归找任意以 http 开头的字符串值（版本差异最大的兜底）。

    未命中返回 None（与 _find_string_value 语义一致，避免空串被上层误判为命中）。
    """
    if isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, str) and v.startswith("http"):
                return v
            hit = _find_http_string(v)
            if hit is not None:
                return hit
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, str) and item.startswith("http"):
                return item
            hit = _find_http_string(item)
            if hit is not None:
                return hit
    return None


def _find_url(obj) -> str:
    """递归在响应 JSON 里找签名/下载 URL：优先已知键名，兜底任意 http 字符串。"""
    found = _find_string_value(obj, _URL_KEYS, starts_with_http=True)
    if found is None:
        found = _find_http_string(obj)
    return found or ""


def _find_task_id(obj) -> str:
    """递归找 task_id：键名 task_id/taskId/id，取字符串值。"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in _TASK_ID_KEYS and v is not None and str(v).strip():
                return str(v).strip()
            hit = _find_task_id(v)
            if hit:
                return hit
    elif isinstance(obj, list):
        for item in obj:
            hit = _find_task_id(item)
            if hit:
                return hit
    return ""


# ---------------------------------------------------------------- 主流程

class _ParseTimeout(Exception):
    """轮询超时（内部用，统一转 ok=False）。"""


def _read_file_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


async def _parse_file_inner(path: str, filename: str,
                            is_ocr: bool, language: str,
                            timeout: float, interval: float) -> dict:
    size = os.path.getsize(path)
    if size > MAX_FILE_BYTES:
        return {"ok": False,
                "error": f"文件超过 MinerU 轻量接口 {MAX_FILE_BYTES // 1024 // 1024}MB 上限"
                         f"（当前 {size // 1024 // 1024}MB），请压缩后重试"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(REQUEST_TIMEOUT)) as client:
        task_id, file_url = await _request_file_token(client, filename, is_ocr, language)
        try:
            await _upload_file(client, file_url, path)
        except Exception:
            # 上传失败时尝试取消任务（尽力而为，失败不影响主错误返回）
            try:
                await client.post(f"{TASK_URL}{task_id}/cancel", json={})
            except Exception:  # noqa: BLE001
                pass
            raise
        data = await _poll_task(client, task_id, timeout, interval)
        markdown_url = _find_url(data)
        if not markdown_url:
            raise RuntimeError("MinerU 任务完成但响应中没有结果下载地址")
        text = await _download_markdown(client, markdown_url)
    return {"ok": True, "text": text}


async def parse_file(path: str, filename: str, *, is_ocr: bool = True,
                     language: str = "ch", timeout: float = 300.0,
                     interval: float = 3.0) -> dict:
    """解析本地文件（PDF/Office/图片）为 markdown 文本。

    成功 → {"ok": True, "text": <全文>}；失败 → {"ok": False, "error": 中文}。
    任何异常都转为 ok=False，绝不抛出；MINERU_API_KEY 未配置时不发网络请求。
    """
    if not is_configured():
        return {"ok": False, "error": "MinerU 未配置"}
    if not path or not os.path.exists(path):
        return {"ok": False, "error": "文件不存在"}
    try:
        return await _parse_file_inner(path, filename, is_ocr, language, timeout, interval)
    except _ParseTimeout as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001 - 契约要求：绝不抛出
        logger.warning("[mineru_client] 解析失败: %s", e)
        return {"ok": False, "error": f"MinerU 解析失败：{e}"}

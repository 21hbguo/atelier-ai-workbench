"""MinerU 云 API 客户端：把 PDF/Office/图片等难解析文件转成 markdown 文本。

实现基于 MinerU **精准解析 API（v4）** 的批量上传模式
（官方文档 https://mineru.net/apiManage/docs，2026-08 实测全链路可用）：

1. ``POST /api/v4/file-urls/batch``（body: files[{name,data_id}], model_version）
   → 返回 ``data.batch_id`` + ``data.file_urls``（OSS 签名上传 URL 列表）
2. 客户端用 **PUT 裸传**（不带任何 Content-Type 头！OSS 签名计算含
   Content-Type 空值，显式带头会 SignatureDoesNotMatch 403）上传文件字节
3. 系统自动提交解析任务，轮询 **``GET /api/v4/extract-results/batch/{batch_id}``**
   （注意：不是 /extract/task/{batch_id}——batch_id 与 task_id 相互独立，
   官方文档未写该批量查询接口，官方 SDK opendatalab/MinerU-Ecosystem 实证）
   → ``data.extract_result[]`` 每项含 state/full_zip_url/err_msg
4. state=done 后下载 full_zip_url（zip，内含 full.md 等）解出全文

限制：单文件 ≤200MB、≤200 页；每天 1000 页优先额度（超出降优先级）。
鉴权：``Authorization: Bearer <token>``，token 从环境变量 MINERU_API_KEY 读，
未配置则不走云解析（功能开关）。

对外接口（契约，url_fetcher 文件分支按此调用）：
- ``is_configured() -> bool``
- ``async parse_file(path, filename, *, is_ocr=True, language="ch",
  timeout=300.0, interval=3.0) -> dict``
  成功 → {"ok": True, "text": <markdown 全文>}（不截断，截断由调用方做）
  失败 → {"ok": False, "error": 中文可读错误}（任何异常都转 error，绝不抛出）

网络调用拆成可单测 patch 的小函数：``_request_batch`` / ``_upload_file`` /
``_poll_batch`` / ``_download_full_zip``。
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import zipfile

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://mineru.net"
BATCH_URL = f"{BASE_URL}/api/v4/file-urls/batch"            # 申请签名上传地址
RESULT_URL = f"{BASE_URL}/api/v4/extract-results/batch/"     # 批量结果查询，batch_id 拼在末尾

REQUEST_TIMEOUT = 30.0   # batch/上传/查询 单次请求超时
DOWNLOAD_TIMEOUT = 60.0  # zip 下载超时

# v4 精准接口限制（官方文档）
MAX_FILE_BYTES = 200 * 1024 * 1024  # 200MB
MAX_PAGES = 200                     # 200 页（页数校验依赖调用方，此处仅文件大小）

# 轮询终态
_DONE = "done"
_FAILED = "failed"
# 轮询中间态（继续等待）
_WAITING_STATES = frozenset({"waiting-file", "pending", "running", "converting", ""})


def is_configured() -> bool:
    """MINERU_API_KEY 非空即视为已配置（功能开关）。"""
    return bool((os.getenv("MINERU_API_KEY") or "").strip())


# ---------------------------------------------------------------- 网络调用（可 patch 的小函数）

async def _request_batch(client: httpx.AsyncClient, filename: str,
                         is_ocr: bool, language: str, token: str) -> tuple[str, str]:
    """POST /api/v4/file-urls/batch 申请签名上传 URL。

    返回 (batch_id, file_url)；业务失败（code != 0）抛 RuntimeError。
    """
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "files": [{"name": filename, "data_id": "chat-doc"}],
        "model_version": "pipeline",
        "is_ocr": is_ocr,
        "language": language,
    }
    resp = await client.post(BATCH_URL, json=payload, headers=headers)
    if resp.status_code >= 400:
        raise RuntimeError(f"MinerU 申请上传地址失败：HTTP {resp.status_code}")
    body = resp.json()
    if not isinstance(body, dict) or body.get("code") not in (0, "0"):
        msg = (body or {}).get("msg") or (body or {}).get("message") or "未知错误"
        raise RuntimeError(f"MinerU 申请上传地址失败：{msg}")
    data = body.get("data") or {}
    batch_id = str(data.get("batch_id") or "").strip()
    urls = data.get("file_urls") or []
    if not batch_id or not urls:
        raise RuntimeError("MinerU 响应中没有 batch_id 或签名上传 URL")
    return batch_id, str(urls[0])


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


async def _poll_batch(client: httpx.AsyncClient, batch_id: str, token: str,
                      timeout: float, interval: float) -> dict:
    """轮询批量结果直到终态（done/failed）或超时。

    返回 data.extract_result 第一项 dict（含 state/full_zip_url/err_msg）；
    超时抛 _ParseTimeout。
    """
    import time
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    start = time.monotonic()
    while True:
        elapsed = time.monotonic() - start
        if elapsed >= timeout:
            raise _ParseTimeout(f"MinerU 解析超时（超过 {int(timeout)} 秒），可稍后重试")
        resp = await client.get(f"{RESULT_URL}{batch_id}", headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(f"MinerU 查询任务失败：HTTP {resp.status_code}")
        body = resp.json()
        if not isinstance(body, dict) or body.get("code") not in (0, "0"):
            msg = (body or {}).get("msg") or (body or {}).get("message") or "未知错误"
            raise RuntimeError(f"MinerU 查询任务失败：{msg}")
        results = (body.get("data") or {}).get("extract_result") or []
        if not results:
            await asyncio.sleep(interval)
            continue
        item = results[0]
        state = str(item.get("state") or "")
        if state == _DONE:
            return item
        if state == _FAILED:
            raise RuntimeError(str(item.get("err_msg") or "MinerU 解析失败"))
        if state not in _WAITING_STATES:
            # 未知状态防御，避免死循环
            raise RuntimeError(f"MinerU 任务状态异常：{state or '(空)'}")
        await asyncio.sleep(interval)


async def _download_full_zip(client: httpx.AsyncClient, zip_url: str) -> str:
    """下载结果 zip 并解出 full.md（兼容 zip 内目录前缀）。"""
    resp = await client.get(zip_url, timeout=DOWNLOAD_TIMEOUT)
    if resp.status_code >= 400:
        raise RuntimeError(f"MinerU 结果下载失败：HTTP {resp.status_code}")
    try:
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        md_name = next((n for n in zf.namelist() if n.split("/")[-1] == "full.md"), None)
        if not md_name:
            raise RuntimeError("结果压缩包中没有 full.md")
        return zf.read(md_name).decode("utf-8", errors="replace")
    except zipfile.BadZipFile:
        raise RuntimeError("结果压缩包损坏，无法解压")


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
                "error": f"文件超过 MinerU 接口 {MAX_FILE_BYTES // 1024 // 1024}MB 上限"
                         f"（当前 {size // 1024 // 1024}MB），请压缩后重试"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(REQUEST_TIMEOUT)) as client:
        token = os.getenv("MINERU_API_KEY") or ""
        batch_id, file_url = await _request_batch(client, filename, is_ocr, language, token)
        await _upload_file(client, file_url, path)
        item = await _poll_batch(client, batch_id, token, timeout, interval)
        zip_url = str(item.get("full_zip_url") or "").strip()
        if not zip_url:
            raise RuntimeError("MinerU 任务完成但响应中没有结果下载地址")
        text = await _download_full_zip(client, zip_url)
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

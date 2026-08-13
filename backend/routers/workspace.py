"""工作区相关接口：send_file 工具产出的下载链接指向这里。

GET /api/workspace/files/download?path=相对路径：校验用户与路径（必须落在
该用户工作区内）后以附件形式返回文件（filename 只传 basename，防服务器
绝对路径泄露）。
"""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from backend.auth import get_current_user
from backend.services.agent.workspace import resolve_workspace_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


@router.get("/files/download")
async def download_workspace_file(
    path: str = Query(..., description="相对工作区根目录的文件路径"),
    user=Depends(get_current_user),
):
    """下载工作区内文件（send_file 工具产出的下载 URL 指向此端点）。"""
    user_id = user["user_id"]
    try:
        file_path = resolve_workspace_path(user_id, path)
    except ValueError as exc:
        logger.warning("[workspace/download] 路径无效: %s", exc)
        raise HTTPException(status_code=404, detail="文件不存在")
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    # filename 只传 basename：FileResponse 的 Content-Disposition 不得携带服务器路径
    return FileResponse(str(file_path), filename=file_path.name)

import json
import csv
import io
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query, Depends
from fastapi.responses import Response

from backend.services.prompt_service import PromptService
from backend.auth import get_current_user, require_admin
from backend.models.schemas import (
    PromptItem,
    PromptCreateRequest,
    PromptUpdateRequest,
    BatchDeleteRequest,
)

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


def _check_ownership(prompt_id: int, user: dict):
    p = PromptService.get_by_id(prompt_id)
    if not p:
        raise HTTPException(status_code=404, detail="提示词不存在")
    if p.get("user_id") is not None and p["user_id"] != user["user_id"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="无权操作此提示词")
    return p


@router.get("")
async def get_prompts(
    query: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    scope: str = Query("private"),
    user=Depends(get_current_user),
):
    try:
        tag_list = [t.strip() for t in tags.split(",")] if tags else None
        uid = user["user_id"]
        if query or tag_list:
            results = PromptService.search(query=query or "", tags=tag_list, scope=scope, user_id=uid)
        else:
            results = PromptService.get_all(scope=scope, user_id=uid)
        return {"prompts": results, "total": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取提示词列表失败: {str(e)}")


@router.post("", response_model=PromptItem)
async def create_prompt(request: PromptCreateRequest, user=Depends(get_current_user)):
    try:
        return PromptService.create(
            name=request.name,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            tags=request.tags,
            user_id=user["user_id"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建提示词失败: {str(e)}")


@router.post("/public", response_model=PromptItem)
async def create_public_prompt(request: PromptCreateRequest, admin=Depends(require_admin)):
    try:
        return PromptService.create(
            name=request.name,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            tags=request.tags,
            user_id=None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建提示词失败: {str(e)}")


@router.put("/{prompt_id}", response_model=PromptItem)
async def update_prompt(prompt_id: str, request: PromptUpdateRequest, user=Depends(get_current_user)):
    _check_ownership(prompt_id, user)
    result = PromptService.update(
        prompt_id,
        name=request.name,
        prompt=request.prompt,
        negative_prompt=request.negative_prompt,
        tags=request.tags,
    )
    if not result:
        raise HTTPException(status_code=404, detail="提示词不存在")
    return result


@router.delete("/{prompt_id}")
async def delete_prompt(prompt_id: str, user=Depends(get_current_user)):
    _check_ownership(prompt_id, user)
    success = PromptService.delete(prompt_id)
    if not success:
        raise HTTPException(status_code=404, detail="提示词不存在")
    return {"id": prompt_id, "message": "提示词已删除"}


@router.post("/batch-delete")
async def batch_delete(request: BatchDeleteRequest, user=Depends(get_current_user)):
    for pid in request.ids:
        _check_ownership(pid, user)
    try:
        count = PromptService.batch_delete(request.ids)
        return {"deleted": count, "message": f"已删除 {count} 条提示词"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量删除失败: {str(e)}")


@router.post("/import")
async def import_prompts(file: UploadFile = File(...), user=Depends(get_current_user)):
    try:
        content = await file.read()
        filename = file.filename or ""
        data = _parse_import_file(content, filename)
        result = PromptService.import_prompts(data, user_id=user["user_id"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


@router.post("/import/public")
async def import_public_prompts(file: UploadFile = File(...), admin=Depends(require_admin)):
    try:
        content = await file.read()
        filename = file.filename or ""
        data = _parse_import_file(content, filename)
        result = PromptService.import_prompts(data, user_id=None)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


def _parse_import_file(content: bytes, filename: str) -> list:
    if filename.endswith(".json"):
        data = json.loads(content.decode("utf-8"))
        if isinstance(data, dict):
            data = data.get("prompts", [data])
        return data
    elif filename.endswith(".csv"):
        text = content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(text))
        data = []
        for row in reader:
            if "tags" in row and isinstance(row["tags"], str):
                row["tags"] = [t.strip() for t in row["tags"].split(",") if t.strip()]
            data.append(row)
        return data
    else:
        raise HTTPException(status_code=400, detail="仅支持 JSON 或 CSV 格式")


@router.get("/export")
async def export_prompts(
    ids: Optional[str] = Query(None),
    format: str = Query("json", regex="^(json|csv)$"),
    user=Depends(get_current_user),
):
    try:
        id_list = [i.strip() for i in ids.split(",")] if ids else None
        data = PromptService.export_prompts(ids=id_list, format=format)

        if format == "csv":
            return Response(
                content=data,
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=prompts.csv"},
            )
        else:
            return Response(
                content=data,
                media_type="application/json",
                headers={"Content-Disposition": "attachment; filename=prompts.json"},
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")

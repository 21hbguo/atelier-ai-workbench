import json
import csv
import io
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import Response

from backend.services.prompt_service import PromptService
from backend.models.schemas import (
    PromptItem,
    PromptCreateRequest,
    PromptUpdateRequest,
    BatchDeleteRequest,
)

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


@router.get("")
async def get_prompts(
    query: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
):
    try:
        tag_list = [t.strip() for t in tags.split(",")] if tags else None
        if query or tag_list:
            results = PromptService.search(query=query or "", tags=tag_list)
        else:
            results = PromptService.get_all()
        return {"prompts": results, "total": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取提示词列表失败: {str(e)}")


@router.post("", response_model=PromptItem)
async def create_prompt(request: PromptCreateRequest):
    try:
        return PromptService.create(
            name=request.name,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            tags=request.tags,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建提示词失败: {str(e)}")


@router.put("/{prompt_id}", response_model=PromptItem)
async def update_prompt(prompt_id: str, request: PromptUpdateRequest):
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
async def delete_prompt(prompt_id: str):
    success = PromptService.delete(prompt_id)
    if not success:
        raise HTTPException(status_code=404, detail="提示词不存在")
    return {"id": prompt_id, "message": "提示词已删除"}


@router.post("/batch-delete")
async def batch_delete(request: BatchDeleteRequest):
    try:
        count = PromptService.batch_delete(request.ids)
        return {"deleted": count, "message": f"已删除 {count} 条提示词"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量删除失败: {str(e)}")


@router.post("/import")
async def import_prompts(file: UploadFile = File(...)):
    try:
        content = await file.read()
        filename = file.filename or ""
        data = []

        if filename.endswith(".json"):
            data = json.loads(content.decode("utf-8"))
            if isinstance(data, dict):
                data = data.get("prompts", [data])
        elif filename.endswith(".csv"):
            text = content.decode("utf-8")
            reader = csv.DictReader(io.StringIO(text))
            for row in reader:
                if "tags" in row and isinstance(row["tags"], str):
                    row["tags"] = [t.strip() for t in row["tags"].split(",") if t.strip()]
                data.append(row)
        else:
            raise HTTPException(status_code=400, detail="仅支持 JSON 或 CSV 格式")

        result = PromptService.import_prompts(data)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


@router.get("/export")
async def export_prompts(
    ids: Optional[str] = Query(None),
    format: str = Query("json", regex="^(json|csv)$"),
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

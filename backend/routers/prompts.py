import json
import csv
import io
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query, Depends
from fastapi.responses import Response

from backend.services.prompt_service import PromptService
from backend.services.category_service import CategoryService
from backend.database import get_db
from backend.auth import get_current_user, require_admin, get_optional_user
from backend.models.schemas import (
    PromptItem,
    PromptCreateRequest,
    PromptUpdateRequest,
    BatchDeleteRequest,
    CategoryItem,
    CategoryCreateRequest,
    CategoryUpdateRequest,
)

logger = logging.getLogger(__name__)
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
    sort: str = Query("likes", regex="^(likes|time)$"),
    category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    try:
        tag_list = [t.strip() for t in tags.split(",")] if tags else None
        # 管理员看全部，普通用户只看自己的
        uid = user["user_id"]
        if user.get("is_admin") and scope == "private":
            scope = "all"
        if query or tag_list:
            result = PromptService.search(query=query or "", tags=tag_list, scope=scope,
                                          user_id=uid, sort=sort, category=category, page=page, size=size)
        else:
            result = PromptService.get_all(scope=scope, user_id=uid, sort=sort,
                                          category=category, page=page, size=size)
        return result
    except Exception as e:
        logger.exception("获取提示词列表失败")
        raise HTTPException(status_code=500, detail="获取提示词列表失败")


@router.get("/public")
async def get_public_prompts(
    query: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    sort: str = Query("likes", regex="^(likes|time)$"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    user=Depends(get_optional_user),
):
    try:
        tag_list = [t.strip() for t in tags.split(",")] if tags else None
        uid = user["user_id"] if user else None
        if query or tag_list:
            result = PromptService.search(query=query or "", tags=tag_list, scope="community",
                                          user_id=uid, sort=sort, category=category, page=page, size=size)
        else:
            result = PromptService.get_all(scope="community", user_id=uid, sort=sort,
                                          category=category, page=page, size=size)
        return result
    except Exception as e:
        logger.exception("获取公开提示词列表失败")
        raise HTTPException(status_code=500, detail="获取公开提示词列表失败")


@router.get("/categories")
async def get_categories(user=Depends(get_optional_user)):
    try:
        return {"categories": PromptService.get_categories()}
    except Exception as e:
        logger.exception("获取分类列表失败")
        raise HTTPException(status_code=500, detail="获取分类列表失败")


@router.post("/categories")
async def create_category(request: CategoryCreateRequest, admin=Depends(require_admin)):
    try:
        existing = CategoryService.get_by_slug(request.slug)
        if existing:
            raise HTTPException(status_code=400, detail="分类标识已存在")
        return CategoryService.create(request.slug, request.label)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("创建分类失败")
        raise HTTPException(status_code=500, detail="创建分类失败")


@router.put("/categories/{category_id}")
async def update_category(category_id: int, request: CategoryUpdateRequest, admin=Depends(require_admin)):
    try:
        result = CategoryService.update(category_id, request.label)
        if not result:
            raise HTTPException(status_code=404, detail="分类不存在")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("更新分类失败")
        raise HTTPException(status_code=500, detail="更新分类失败")


@router.delete("/categories/{category_id}")
async def delete_category(category_id: int, admin=Depends(require_admin)):
    try:
        success = CategoryService.delete(category_id)
        if not success:
            raise HTTPException(status_code=400, detail="分类不存在或有关联提示词")
        return {"message": "分类已删除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("删除分类失败")
        raise HTTPException(status_code=500, detail="删除分类失败")


@router.get("/evo-thumb/{path:path}")
async def serve_evo_thumbnail(path: str, size: int = Query(400)):
    import hashlib
    from pathlib import Path
    from fastapi.responses import FileResponse
    from backend.config import EVO_IMAGES_DIR, EVO_THUMBS_DIR

    source = EVO_IMAGES_DIR / path
    if not source.exists():
        raise HTTPException(status_code=404, detail="图片不存在")

    thumb_name = f"{size}_{hashlib.md5(path.encode()).hexdigest()}.jpg"
    thumb = EVO_THUMBS_DIR / thumb_name
    if thumb.exists():
        return FileResponse(str(thumb), media_type="image/jpeg")

    try:
        from PIL import Image
        img = Image.open(source)
        img.thumbnail((size, size))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(thumb, "JPEG", quality=80)
        return FileResponse(str(thumb), media_type="image/jpeg")
    except ImportError:
        return FileResponse(str(source))
    except Exception:
        raise HTTPException(status_code=500, detail="生成缩略图失败")


@router.post("", response_model=PromptItem)
async def create_prompt(request: PromptCreateRequest, user=Depends(get_current_user)):
    try:
        return PromptService.create(
            name=request.name,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            tags=request.tags,
            user_id=user["user_id"],
            category=request.category,
        )
    except Exception as e:
        logger.exception("创建提示词失败")
        raise HTTPException(status_code=500, detail="创建提示词失败")


@router.post("/public", response_model=PromptItem)
async def create_public_prompt(request: PromptCreateRequest, admin=Depends(require_admin)):
    try:
        return PromptService.create(
            name=request.name,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            tags=request.tags,
            user_id=None,
            category=request.category,
        )
    except Exception as e:
        logger.exception("创建提示词失败")
        raise HTTPException(status_code=500, detail="创建提示词失败")


@router.put("/{prompt_id}", response_model=PromptItem)
async def update_prompt(prompt_id: str, request: PromptUpdateRequest, user=Depends(get_current_user)):
    _check_ownership(prompt_id, user)
    result = PromptService.update(
        prompt_id,
        name=request.name,
        prompt=request.prompt,
        negative_prompt=request.negative_prompt,
        tags=request.tags,
        category=request.category,
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
        logger.exception("批量删除失败")
        raise HTTPException(status_code=500, detail="批量删除失败")


@router.post("/like")
async def toggle_prompt_like(prompt_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        prompt = conn.execute("SELECT id FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if not prompt:
            raise HTTPException(status_code=404, detail="提示词不存在")

        existing = conn.execute(
            "SELECT id FROM prompt_likes WHERE prompt_id = ? AND user_id = ?",
            (prompt_id, user["user_id"]),
        ).fetchone()

        if existing:
            conn.execute("DELETE FROM prompt_likes WHERE id = ?", (existing["id"],))
            conn.execute(
                "UPDATE prompts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?",
                (prompt_id,),
            )
            return {"liked": False, "message": "取消点赞"}
        else:
            conn.execute(
                "INSERT INTO prompt_likes (prompt_id, user_id) VALUES (?, ?)",
                (prompt_id, user["user_id"]),
            )
            conn.execute(
                "UPDATE prompts SET likes_count = likes_count + 1 WHERE id = ?",
                (prompt_id,),
            )
            return {"liked": True, "message": "点赞成功"}


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
        logger.exception("导入失败")
        raise HTTPException(status_code=500, detail="导入失败")


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
        logger.exception("导入失败")
        raise HTTPException(status_code=500, detail="导入失败")


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
        # 管理员导出全部，普通用户只导出自己的
        user_id = None if user.get("is_admin") else user["user_id"]
        data = PromptService.export_prompts(ids=id_list, format=format, user_id=user_id if not ids else None)

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
        logger.exception("导出失败")
        raise HTTPException(status_code=500, detail="导出失败")

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from backend.database import get_db
from backend.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


class AnnouncementCreateRequest(BaseModel):
    title: str = Field(..., max_length=200)
    content: str = Field(..., max_length=5000)


@router.post("")
async def create_announcement(req: AnnouncementCreateRequest, admin=Depends(require_admin)):
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO announcements (title, content, created_by) VALUES (?, ?, ?)",
            (req.title, req.content, admin["user_id"])
        )
        return {"id": cursor.lastrowid, "message": "公告发布成功"}


@router.get("")
async def list_announcements(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), user=Depends(get_current_user)):
    offset = (page - 1) * size
    with get_db() as conn:
        total = conn.execute("SELECT COUNT(*) as cnt FROM announcements").fetchone()["cnt"]
        rows = conn.execute("""
            SELECT a.*, u.nickname as author_name,
                   CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END as is_read
            FROM announcements a
            LEFT JOIN users u ON a.created_by = u.id
            LEFT JOIN announcement_reads ar ON a.id = ar.announcement_id AND ar.user_id = ?
            ORDER BY a.created_at DESC LIMIT ? OFFSET ?
        """, (user["user_id"], size, offset)).fetchall()
        return {"total": total, "items": [dict(r) for r in rows], "page": page, "size": size}


@router.get("/unread")
async def get_unread_announcements(user=Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT a.*, u.nickname as author_name
            FROM announcements a
            LEFT JOIN users u ON a.created_by = u.id
            WHERE a.id NOT IN (
                SELECT announcement_id FROM announcement_reads WHERE user_id = ?
            )
            ORDER BY a.created_at DESC
        """, (user["user_id"],)).fetchall()
        return {"items": [dict(r) for r in rows]}


@router.post("/{announcement_id}/read")
async def mark_as_read(announcement_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        ann = conn.execute("SELECT id FROM announcements WHERE id = ?", (announcement_id,)).fetchone()
        if not ann:
            raise HTTPException(status_code=404, detail="公告不存在")
        conn.execute(
            "INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)",
            (announcement_id, user["user_id"])
        )
        return {"message": "已标记为已读"}


@router.delete("/{announcement_id}")
async def delete_announcement(announcement_id: int, admin=Depends(require_admin)):
    with get_db() as conn:
        ann = conn.execute("SELECT id FROM announcements WHERE id = ?", (announcement_id,)).fetchone()
        if not ann:
            raise HTTPException(status_code=404, detail="公告不存在")
        conn.execute("DELETE FROM announcement_reads WHERE announcement_id = ?", (announcement_id,))
        conn.execute("DELETE FROM announcements WHERE id = ?", (announcement_id,))
        return {"message": "公告已删除"}

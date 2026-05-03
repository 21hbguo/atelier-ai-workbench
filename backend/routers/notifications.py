from fastapi import APIRouter, Depends, HTTPException, Query
from backend.auth import get_current_user
from backend.services.notification_service import NotificationService

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

@router.get("")
async def list_notifications(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100), user=Depends(get_current_user)):
    return NotificationService.list(user["user_id"], page, size)

@router.get("/unread-count")
async def unread_count(user=Depends(get_current_user)):
    return {"count": NotificationService.unread_count(user["user_id"])}

@router.post("/{notification_id}/read")
async def mark_read(notification_id: int, user=Depends(get_current_user)):
    if not NotificationService.mark_read(user["user_id"], notification_id):
        raise HTTPException(status_code=404, detail="通知不存在")
    return {"message": "已标记已读"}

@router.post("/read-all")
async def mark_all_read(user=Depends(get_current_user)):
    changed = NotificationService.mark_all_read(user["user_id"])
    return {"updated": changed, "message": "已全部标记已读"}

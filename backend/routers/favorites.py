from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from backend.auth import get_current_user
from backend.services.favorite_service import FavoriteService

router=APIRouter(prefix="/api/favorites",tags=["favorites"])

class FavoriteToggleRequest(BaseModel):
    target_type:str
    target_id:str

@router.post("/toggle")
async def toggle_favorite(req:FavoriteToggleRequest,user=Depends(get_current_user)):
    try:
        favorited=FavoriteService.toggle(user["user_id"],req.target_type,req.target_id)
        return {"favorited":favorited}
    except ValueError as e:
        raise HTTPException(status_code=400,detail=str(e))
    except Exception:
        raise HTTPException(status_code=500,detail="收藏操作失败")

@router.get("")
async def list_favorites(type:str=Query("all",regex="^(all|image|prompt)$"),page:int=Query(1,ge=1),size:int=Query(20,ge=1,le=100),user=Depends(get_current_user)):
    try:
        return FavoriteService.list(user["user_id"],type,page,size)
    except ValueError as e:
        raise HTTPException(status_code=400,detail=str(e))
    except Exception:
        raise HTTPException(status_code=500,detail="获取收藏失败")

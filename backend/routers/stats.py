from fastapi import APIRouter

from backend.services.stats_service import StatsService

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats")
async def get_stats():
    return StatsService.get_stats()

import json
import os
import threading
from datetime import datetime
from typing import Dict, Any

from backend.config import STATS_JSON


class StatsService:
    _lock = threading.Lock()

    @classmethod
    def _load_stats(cls) -> Dict[str, Any]:
        if os.path.exists(STATS_JSON):
            try:
                with open(STATS_JSON, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, Exception):
                pass
        return {
            "today_requests": 0,
            "today_success": 0,
            "today_failed": 0,
            "total_requests": 0,
            "total_success": 0,
            "total_failed": 0,
            "last_date": datetime.now().strftime("%Y-%m-%d"),
        }

    @classmethod
    def _save_stats(cls, stats: Dict[str, Any]) -> None:
        with open(STATS_JSON, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)

    @classmethod
    def _check_date_reset(cls, stats: Dict[str, Any]) -> Dict[str, Any]:
        today = datetime.now().strftime("%Y-%m-%d")
        if stats.get("last_date") != today:
            stats["today_requests"] = 0
            stats["today_success"] = 0
            stats["today_failed"] = 0
            stats["last_date"] = today
        return stats

    @classmethod
    def record_request(cls) -> None:
        with cls._lock:
            stats = cls._load_stats()
            stats = cls._check_date_reset(stats)
            stats["today_requests"] += 1
            stats["total_requests"] += 1
            cls._save_stats(stats)

    @classmethod
    def record_success(cls) -> None:
        with cls._lock:
            stats = cls._load_stats()
            stats = cls._check_date_reset(stats)
            stats["today_success"] += 1
            stats["total_success"] += 1
            cls._save_stats(stats)

    @classmethod
    def record_failed(cls) -> None:
        with cls._lock:
            stats = cls._load_stats()
            stats = cls._check_date_reset(stats)
            stats["today_failed"] += 1
            stats["total_failed"] += 1
            cls._save_stats(stats)

    @classmethod
    def get_stats(cls) -> Dict[str, Any]:
        stats = cls._load_stats()
        stats = cls._check_date_reset(stats)
        return stats

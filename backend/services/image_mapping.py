import csv
import os
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict

from backend.config import IMAGE_URL_MAPPING_CSV


class ImageUrlMapping:
    _lock = threading.Lock()

    @classmethod
    def load_mapping(cls) -> Dict[str, str]:
        if not os.path.exists(IMAGE_URL_MAPPING_CSV):
            return {}
        mapping = {}
        with open(IMAGE_URL_MAPPING_CSV, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            for i, row in enumerate(reader):
                if i == 0 and row and row[0] == "local_path":
                    continue
                if len(row) >= 2:
                    mapping[row[0]] = row[1]
        return mapping

    @classmethod
    def get_url(cls, local_path: str) -> Optional[str]:
        mapping = cls.load_mapping()
        abs_path = os.path.abspath(local_path)
        return mapping.get(abs_path)

    @classmethod
    def save_url(cls, local_path: str, url: str) -> None:
        abs_path = os.path.abspath(local_path)
        if cls.get_url(abs_path) is not None:
            return
        with cls._lock:
            file_exists = os.path.exists(IMAGE_URL_MAPPING_CSV)
            with open(IMAGE_URL_MAPPING_CSV, "a", encoding="utf-8", newline="") as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(["local_path", "url", "upload_time"])
                writer.writerow([abs_path, url, datetime.now().strftime("%Y-%m-%d %H:%M:%S")])

    @classmethod
    def ensure_url(cls, local_path: str, upload_func) -> Optional[str]:
        abs_path = os.path.abspath(local_path)
        existing_url = cls.get_url(abs_path)
        if existing_url:
            return existing_url, True
        url = upload_func(abs_path)
        if url:
            cls.save_url(abs_path, url)
            return url, False
        return None, False

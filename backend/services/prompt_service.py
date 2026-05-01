import json
import os
import csv
import threading
from typing import List, Dict, Any, Optional
from datetime import datetime
from uuid import uuid4

from backend.config import PROMPTS_JSON


class PromptService:
    _lock = threading.Lock()

    @classmethod
    def _load_prompts(cls) -> List[Dict[str, Any]]:
        if os.path.exists(PROMPTS_JSON):
            try:
                with open(PROMPTS_JSON, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, Exception):
                return []
        return []

    @classmethod
    def _save_prompts(cls, prompts: List[Dict[str, Any]]) -> None:
        with open(PROMPTS_JSON, "w", encoding="utf-8") as f:
            json.dump(prompts, f, ensure_ascii=False, indent=2)

    @classmethod
    def get_all(cls) -> List[Dict[str, Any]]:
        return cls._load_prompts()

    @classmethod
    def get_by_id(cls, prompt_id: str) -> Optional[Dict[str, Any]]:
        prompts = cls._load_prompts()
        for p in prompts:
            if p.get("id") == prompt_id:
                return p
        return None

    @classmethod
    def create(cls, name: str, prompt: str, negative_prompt: Optional[str] = None, tags: Optional[List[str]] = None) -> Dict[str, Any]:
        with cls._lock:
            prompts = cls._load_prompts()
            item = {
                "id": str(uuid4()),
                "name": name,
                "prompt": prompt,
                "negative_prompt": negative_prompt or "",
                "tags": tags or [],
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            prompts.append(item)
            cls._save_prompts(prompts)
            return item

    @classmethod
    def update(cls, prompt_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        with cls._lock:
            prompts = cls._load_prompts()
            for p in prompts:
                if p.get("id") == prompt_id:
                    for key, value in kwargs.items():
                        if value is not None:
                            p[key] = value
                    cls._save_prompts(prompts)
                    return p
            return None

    @classmethod
    def delete(cls, prompt_id: str) -> bool:
        with cls._lock:
            prompts = cls._load_prompts()
            new_prompts = [p for p in prompts if p.get("id") != prompt_id]
            if len(new_prompts) == len(prompts):
                return False
            cls._save_prompts(new_prompts)
            return True

    @classmethod
    def batch_delete(cls, ids: List[str]) -> int:
        with cls._lock:
            prompts = cls._load_prompts()
            id_set = set(ids)
            new_prompts = [p for p in prompts if p.get("id") not in id_set]
            deleted_count = len(prompts) - len(new_prompts)
            cls._save_prompts(new_prompts)
            return deleted_count

    @classmethod
    def search(cls, query: str, tags: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        prompts = cls._load_prompts()
        results = prompts

        if query:
            query_lower = query.lower()
            results = [
                p for p in results
                if query_lower in p.get("name", "").lower()
                or query_lower in p.get("prompt", "").lower()
                or any(query_lower in t.lower() for t in p.get("tags", []))
            ]

        if tags:
            tag_set = set(t.lower() for t in tags)
            results = [
                p for p in results
                if tag_set & set(t.lower() for t in p.get("tags", []))
            ]

        return results

    @classmethod
    def import_prompts(cls, prompts_data: List[Dict[str, Any]]) -> Dict[str, int]:
        with cls._lock:
            existing = cls._load_prompts()
            existing_prompts = {p.get("prompt", "") for p in existing}
            existing_names = {p.get("name", "") for p in existing}

            success = 0
            failed = 0

            for item in prompts_data:
                prompt_text = item.get("prompt", "")
                name = item.get("name", "")

                if not prompt_text:
                    failed += 1
                    continue

                if prompt_text in existing_prompts or name in existing_names:
                    failed += 1
                    continue

                new_item = {
                    "id": str(uuid4()),
                    "name": name or f"导入提示词_{success + 1}",
                    "prompt": prompt_text,
                    "negative_prompt": item.get("negative_prompt", ""),
                    "tags": item.get("tags", []),
                    "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
                existing.append(new_item)
                existing_prompts.add(prompt_text)
                existing_names.add(name)
                success += 1

            cls._save_prompts(existing)
            return {"success": success, "failed": failed}

    @classmethod
    def export_prompts(cls, ids: Optional[List[str]] = None, format: str = "json") -> bytes:
        prompts = cls._load_prompts()
        if ids:
            id_set = set(ids)
            prompts = [p for p in prompts if p.get("id") in id_set]

        if format == "csv":
            import io
            output = io.StringIO()
            if prompts:
                writer = csv.DictWriter(output, fieldnames=["id", "name", "prompt", "negative_prompt", "tags", "created_at"])
                writer.writeheader()
                for p in prompts:
                    row = p.copy()
                    row["tags"] = ",".join(row.get("tags", []))
                    writer.writerow(row)
            return output.getvalue().encode("utf-8")
        else:
            return json.dumps(prompts, ensure_ascii=False, indent=2).encode("utf-8")

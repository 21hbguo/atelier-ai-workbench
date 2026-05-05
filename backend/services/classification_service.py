import httpx
import json
import logging
from typing import List, Dict, Any, Optional
from backend.config import get_llm_config
from backend.database import get_db
from backend.services.category_service import CategoryService

logger = logging.getLogger(__name__)

SYSTEM_TEMPLATE = """你是一名专业的AI绘画内容分类专家。你的任务是根据作品的提示词内容，将其归类到最合适的分类中。

可用分类列表：
{categories}

规则：
1. 从可用分类中选择最合适的一个，输出该分类的 slug。
2. 如果没有任何现有分类合适，请输出一个新的分类建议，包含 slug（英文小写连字符格式）和 label（中文显示名）。
3. 严格按 JSON 格式输出，不要输出任何其他文字。
4. 输出格式为 JSON 数组，每个元素包含：
   - "item_id": 原始项目ID
   - "category_slug": 分类标识（现有分类的slug，或建议的新slug）
   - "category_label": 分类显示名（现有分类的label，或建议的新label）
   - "is_new": true 或 false，表示是否为新分类建议
   - "confidence": "high" / "medium" / "low"

示例输出：
[{{"item_id": "abc-123", "category_slug": "portrait", "category_label": "人像摄影", "is_new": false, "confidence": "high"}}]"""

USER_TEMPLATE = "请对以下 {count} 个项目进行分类：\n{items}"

BATCH_SIZE = 10


class ClassificationService:
    _client: httpx.AsyncClient | None = None

    @classmethod
    def _get_client(cls) -> httpx.AsyncClient:
        if cls._client is None or cls._client.is_closed:
            llm_cfg = get_llm_config()
            cls._client = httpx.AsyncClient(
                timeout=httpx.Timeout(float(llm_cfg["timeout_seconds"]), connect=5.0),
            )
        return cls._client

    @classmethod
    async def close(cls):
        if cls._client and not cls._client.is_closed:
            await cls._client.aclose()
            cls._client = None

    @classmethod
    def create_task(cls, admin_id: int, item_type: str = "prompt") -> Dict[str, Any]:
        with get_db() as conn:
            if item_type == "image":
                rows = conn.execute(
                    "SELECT id, filename, prompt, category FROM square_images WHERE (category IS NULL OR category = '') AND COALESCE(is_frozen, FALSE) = FALSE"
                ).fetchall()
                if not rows:
                    raise ValueError("没有需要分类的作品")
            else:
                rows = conn.execute(
                    "SELECT id, name, prompt, category FROM prompts WHERE (category IS NULL OR category = '') AND COALESCE(is_frozen, FALSE) = FALSE"
                ).fetchall()
                if not rows:
                    raise ValueError("没有需要分类的提示词")

            task = conn.execute(
                "INSERT INTO classification_tasks (status, item_type, total_items, created_by) VALUES ('processing', %s, %s, %s) RETURNING id, status, total_items, created_at",
                (item_type, len(rows), admin_id),
            ).fetchone()

            with conn.cursor() as cur:
                for r in rows:
                    name = r.get("filename") or r.get("name") or ""
                    cur.execute(
                        "INSERT INTO classification_results (task_id, item_id, item_type, item_name, item_prompt, item_category) VALUES (%s, %s, %s, %s, %s, %s)",
                        (task["id"], str(r["id"]), item_type, name, (r["prompt"] or "")[:500], r["category"]),
                    )
            return {"id": task["id"], "status": task["status"], "item_type": item_type, "total_items": task["total_items"], "created_at": str(task["created_at"])}

    @classmethod
    async def run_classification(cls, task_id: int):
        try:
            categories = CategoryService.get_all_as_dict()
            cat_text = "\n".join(f"- {slug}: {label}" for slug, label in categories.items())
            system_prompt = SYSTEM_TEMPLATE.format(categories=cat_text)

            with get_db() as conn:
                task = conn.execute("SELECT id, status FROM classification_tasks WHERE id = %s", (task_id,)).fetchone()
                if not task or task["status"] != "processing":
                    return

            processed = 0
            while True:
                with get_db() as conn:
                    batch = conn.execute(
                        "SELECT id, item_id, item_name, item_prompt FROM classification_results WHERE task_id = %s AND status = 'pending' AND suggested_category IS NULL LIMIT %s",
                        (task_id, BATCH_SIZE),
                    ).fetchall()

                if not batch:
                    break

                items = [
                    {"item_id": r["item_id"], "name": r["item_name"] or "", "prompt": (r["item_prompt"] or "")[:300]}
                    for r in batch
                ]
                results = await cls._classify_batch(system_prompt, items)

                result_map = {r["item_id"]: r for r in results} if results else {}
                with get_db() as conn:
                    for row in batch:
                        match = result_map.get(row["item_id"])
                        if match:
                            conn.execute(
                                "UPDATE classification_results SET suggested_category = %s, suggested_category_label = %s, is_new_category = %s WHERE id = %s",
                                (match.get("category_slug", ""), match.get("category_label", ""), match.get("is_new", False), row["id"]),
                            )
                        else:
                            conn.execute(
                                "UPDATE classification_results SET suggested_category = '_error', suggested_category_label = '分类失败', status = 'rejected' WHERE id = %s",
                                (row["id"],),
                            )
                        processed += 1

                    conn.execute(
                        "UPDATE classification_tasks SET processed_items = %s WHERE id = %s",
                        (processed, task_id),
                    )

            with get_db() as conn:
                conn.execute(
                    "UPDATE classification_tasks SET status = 'pending_review', processed_items = total_items, completed_at = NOW() WHERE id = %s",
                    (task_id,),
                )
            logger.info(f"[classification] Task {task_id} completed, {processed} items processed")

        except Exception:
            logger.exception(f"[classification] Task {task_id} failed")
            with get_db() as conn:
                conn.execute(
                    "UPDATE classification_tasks SET status = 'error', completed_at = NOW() WHERE id = %s",
                    (task_id,),
                )

    @classmethod
    async def _classify_batch(cls, system_prompt: str, items: List[Dict]) -> Optional[List[Dict]]:
        llm_cfg = get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            return None

        try:
            client = cls._get_client()
            url = f"{llm_cfg['base_url'].rstrip('/')}/v1/messages"
            headers = {
                "x-api-key": llm_cfg["api_key"],
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            user_content = USER_TEMPLATE.format(
                count=len(items),
                items=json.dumps(items, ensure_ascii=False),
            )
            body = {
                "model": llm_cfg["model"],
                "max_tokens": max(llm_cfg["max_tokens"], 2000),
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_content}],
            }
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()

            data = resp.json()
            text = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text += block.get("text", "")

            text = text.strip()
            if text.startswith("```"):
                lines = text.split("\n")
                text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
                text = text.strip()

            return json.loads(text)

        except httpx.TimeoutException:
            logger.warning("[classification] LLM API timeout")
            return None
        except json.JSONDecodeError:
            logger.warning(f"[classification] Failed to parse LLM response: {text[:200]}")
            return None
        except Exception:
            logger.exception("[classification] LLM API call failed")
            return None

    @classmethod
    def get_task(cls, task_id: int) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            task = conn.execute("SELECT * FROM classification_tasks WHERE id = %s", (task_id,)).fetchone()
            if not task:
                return None
            results = conn.execute(
                "SELECT * FROM classification_results WHERE task_id = %s ORDER BY id",
                (task_id,),
            ).fetchall()
            return {
                "id": task["id"],
                "status": task["status"],
                "item_type": task["item_type"],
                "total_items": task["total_items"],
                "processed_items": task["processed_items"],
                "created_at": str(task["created_at"]),
                "completed_at": str(task["completed_at"]) if task["completed_at"] else None,
                "results": [dict(r) for r in results],
            }

    @classmethod
    def list_tasks(cls, page: int = 1, size: int = 20) -> Dict[str, Any]:
        with get_db() as conn:
            total = conn.execute("SELECT COUNT(*) AS cnt FROM classification_tasks").fetchone()["cnt"]
            offset = (page - 1) * size
            rows = conn.execute(
                "SELECT * FROM classification_tasks ORDER BY id DESC LIMIT %s OFFSET %s",
                (size, offset),
            ).fetchall()
            return {
                "total": total,
                "page": page,
                "size": size,
                "items": [
                    {
                        "id": r["id"],
                        "status": r["status"],
                        "item_type": r["item_type"],
                        "total_items": r["total_items"],
                        "processed_items": r["processed_items"],
                        "created_at": str(r["created_at"]),
                        "completed_at": str(r["completed_at"]) if r["completed_at"] else None,
                    }
                    for r in rows
                ],
            }

    @classmethod
    def approve_results(cls, task_id: int, result_ids: List[int]) -> Dict[str, Any]:
        with get_db() as conn:
            task = conn.execute("SELECT id, status, item_type FROM classification_tasks WHERE id = %s", (task_id,)).fetchone()
            if not task:
                raise ValueError("任务不存在")

            placeholders = ",".join(["%s"] * len(result_ids))
            results = conn.execute(
                f"SELECT id, item_id, item_type, suggested_category, suggested_category_label, is_new_category FROM classification_results WHERE task_id = %s AND id IN ({placeholders}) AND status = 'pending'",
                (task_id, *result_ids),
            ).fetchall()

            approved = 0
            for r in results:
                if not r["suggested_category"] or r["suggested_category"] == "_error":
                    continue
                if r["is_new_category"]:
                    existing = conn.execute("SELECT id FROM categories WHERE slug = %s", (r["suggested_category"],)).fetchone()
                    if not existing:
                        max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS cnt FROM categories").fetchone()["cnt"]
                        conn.execute(
                            "INSERT INTO categories (slug, label, sort_order) VALUES (%s, %s, %s)",
                            (r["suggested_category"], r["suggested_category_label"] or r["suggested_category"], max_order + 1),
                        )
                if r["item_type"] == "image":
                    conn.execute(
                        "UPDATE square_images SET category = %s WHERE id = %s",
                        (r["suggested_category"], r["item_id"]),
                    )
                else:
                    conn.execute(
                        "UPDATE prompts SET category = %s WHERE id = %s",
                        (r["suggested_category"], r["item_id"]),
                    )
                conn.execute(
                    "UPDATE classification_results SET status = 'applied', applied_at = NOW() WHERE id = %s",
                    (r["id"],),
                )
                approved += 1

            remaining = conn.execute(
                "SELECT COUNT(*) AS cnt FROM classification_results WHERE task_id = %s AND status = 'pending'",
                (task_id,),
            ).fetchone()["cnt"]
            if remaining == 0:
                conn.execute(
                    "UPDATE classification_tasks SET status = 'completed' WHERE id = %s",
                    (task_id,),
                )

            return {"approved": approved, "remaining_pending": remaining}

    @classmethod
    def reject_results(cls, task_id: int, result_ids: List[int]) -> Dict[str, Any]:
        with get_db() as conn:
            placeholders = ",".join(["%s"] * len(result_ids))
            conn.execute(
                f"UPDATE classification_results SET status = 'rejected' WHERE task_id = %s AND id IN ({placeholders}) AND status = 'pending'",
                (task_id, *result_ids),
            )
            remaining = conn.execute(
                "SELECT COUNT(*) AS cnt FROM classification_results WHERE task_id = %s AND status = 'pending'",
                (task_id,),
            ).fetchone()["cnt"]
            if remaining == 0:
                task = conn.execute("SELECT id FROM classification_tasks WHERE id = %s AND status = 'pending_review'", (task_id,)).fetchone()
                if task:
                    conn.execute("UPDATE classification_tasks SET status = 'completed' WHERE id = %s", (task_id,))
            return {"rejected": len(result_ids), "remaining_pending": remaining}

    @classmethod
    def update_result(cls, result_id: int, suggested_category: str, suggested_category_label: str, is_new: bool) -> Dict[str, Any]:
        with get_db() as conn:
            conn.execute(
                "UPDATE classification_results SET suggested_category = %s, suggested_category_label = %s, is_new_category = %s WHERE id = %s AND status = 'pending'",
                (suggested_category, suggested_category_label, is_new, result_id),
            )
            row = conn.execute("SELECT * FROM classification_results WHERE id = %s", (result_id,)).fetchone()
            return dict(row) if row else {}

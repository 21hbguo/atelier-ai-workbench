import httpx
import json
import logging
import asyncio
from typing import List, Dict, Any, Optional
from backend.config import get_llm_config
from backend.database import get_db
from backend.services.category_service import CategoryService

logger = logging.getLogger(__name__)

# 任务日志缓冲区：task_id -> list of log entries
_task_logs: Dict[int, List[Dict]] = {}
_task_log_events: Dict[int, asyncio.Event] = {}

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
    def _push_log(cls, task_id: int, log_type: str, message: str, data: Any = None):
        """推送日志到任务缓冲区"""
        if task_id not in _task_logs:
            _task_logs[task_id] = []
            _task_log_events[task_id] = asyncio.Event()
        entry = {"type": log_type, "message": message, "data": data}
        _task_logs[task_id].append(entry)
        if task_id in _task_log_events:
            _task_log_events[task_id].set()

    @classmethod
    async def get_task_logs(cls, task_id: int):
        """异步生成器，yield 任务日志"""
        if task_id not in _task_logs:
            _task_logs[task_id] = []
            _task_log_events[task_id] = asyncio.Event()

        idx = 0
        while True:
            logs = _task_logs.get(task_id, [])
            while idx < len(logs):
                yield logs[idx]
                idx += 1

            # 检查任务是否已完成
            with get_db() as conn:
                task = conn.execute("SELECT status FROM classification_tasks WHERE id = %s", (task_id,)).fetchone()
                if task and task["status"] not in ("processing",):
                    # 推送剩余日志
                    while idx < len(logs):
                        yield logs[idx]
                        idx += 1
                    yield {"type": "complete", "message": "任务已完成"}
                    # 清理
                    _task_logs.pop(task_id, None)
                    _task_log_events.pop(task_id, None)
                    return

            _task_log_events[task_id].clear()
            try:
                await asyncio.wait_for(_task_log_events[task_id].wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass

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
    def create_review_task(cls, admin_id: int, item_type: str, category_slug: str) -> Dict[str, Any]:
        """创建分类审查任务，重新审查指定分类下的项目"""
        with get_db() as conn:
            if item_type == "image":
                rows = conn.execute(
                    "SELECT id, filename, prompt, category FROM square_images WHERE category = %s AND COALESCE(is_frozen, FALSE) = FALSE",
                    (category_slug,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, name, prompt, category FROM prompts WHERE category = %s AND COALESCE(is_frozen, FALSE) = FALSE",
                    (category_slug,)
                ).fetchall()

            if not rows:
                raise ValueError(f"分类 '{category_slug}' 下没有可审查的项目")

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
            cls._push_log(task_id, "info", "开始分类任务")

            categories = CategoryService.get_all_as_dict()
            cat_text = "\n".join(f"- {slug}: {label}" for slug, label in categories.items())
            system_prompt = SYSTEM_TEMPLATE.format(categories=cat_text)
            cls._push_log(task_id, "info", f"已加载 {len(categories)} 个分类")

            with get_db() as conn:
                task = conn.execute("SELECT id, status FROM classification_tasks WHERE id = %s", (task_id,)).fetchone()
                if not task or task["status"] != "processing":
                    return

            processed = 0
            batch_num = 0
            while True:
                with get_db() as conn:
                    batch = conn.execute(
                        "SELECT id, item_id, item_name, item_prompt FROM classification_results WHERE task_id = %s AND status = 'pending' AND suggested_category IS NULL LIMIT %s",
                        (task_id, BATCH_SIZE),
                    ).fetchall()

                if not batch:
                    break

                batch_num += 1
                cls._push_log(task_id, "info", f"处理批次 {batch_num}，{len(batch)} 个项目")

                items = [
                    {"item_id": r["item_id"], "name": r["item_name"] or "", "prompt": (r["item_prompt"] or "")[:300]}
                    for r in batch
                ]

                # 调用 LLM
                cls._push_log(task_id, "info", f"正在调用 LLM 分类 {len(items)} 个项目...")
                results = await cls._classify_batch(system_prompt, items)
                cls._push_log(task_id, "info", f"LLM 返回 {len(results)} 个分类结果")

                result_map = {r["item_id"]: r for r in results} if results else {}
                with get_db() as conn:
                    for row in batch:
                        match = result_map.get(row["item_id"])
                        if match:
                            conn.execute(
                                "UPDATE classification_results SET suggested_category = %s, suggested_category_label = %s, is_new_category = %s, confidence = %s WHERE id = %s",
                                (match.get("category_slug", ""), match.get("category_label", ""), match.get("is_new", False), match.get("confidence", ""), row["id"]),
                            )
                            cls._push_log(task_id, "result", f"{row['item_name']} -> {match.get('category_label', '')}")
                        else:
                            conn.execute(
                                "UPDATE classification_results SET suggested_category = '_error', suggested_category_label = '分类失败', status = 'failed' WHERE id = %s",
                                (row["id"],),
                            )
                            cls._push_log(task_id, "error", f"{row['item_name']} 分类失败")
                        processed += 1

                    conn.execute(
                        "UPDATE classification_tasks SET processed_items = %s WHERE id = %s",
                        (processed, task_id),
                    )

            with get_db() as conn:
                pending = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM classification_results WHERE task_id = %s AND status = 'pending'",
                    (task_id,),
                ).fetchone()["cnt"]
                new_status = "pending_review" if pending > 0 else "completed"
                conn.execute(
                    "UPDATE classification_tasks SET status = %s, processed_items = total_items, completed_at = NOW() WHERE id = %s",
                    (new_status, task_id),
                )
            cls._push_log(task_id, "info", f"任务完成，处理 {processed} 个项目")
            logger.info(f"[classification] Task {task_id} completed, {processed} items processed")

        except Exception as e:
            cls._push_log(task_id, "error", f"任务异常: {str(e)[:200]}")
            logger.exception(f"[classification] Task {task_id} failed")
            with get_db() as conn:
                conn.execute(
                    "UPDATE classification_tasks SET status = 'error', completed_at = NOW() WHERE id = %s",
                    (task_id,),
                )

    @classmethod
    async def _classify_batch(cls, system_prompt: str, items: List[Dict]) -> List[Dict]:
        llm_cfg = get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            logger.warning("[classification] LLM not enabled or API key missing")
            return []

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
                "thinking": {"type": "disabled"},
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
            return []
        except httpx.HTTPStatusError as e:
            logger.error(f"[classification] LLM API HTTP error: {e.response.status_code} - {e.response.text[:200]}")
            return []
        except json.JSONDecodeError:
            logger.warning(f"[classification] Failed to parse LLM response: {text[:200]}")
            return []
        except Exception:
            logger.exception("[classification] LLM API call failed")
            return []

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
                if not r["suggested_category"] or r["suggested_category"] in ("_error", "_removed"):
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
                f"UPDATE classification_results SET status = 'rejected' WHERE task_id = %s AND id IN ({placeholders}) AND status IN ('pending', 'failed')",
                (task_id, *result_ids),
            )
            remaining = conn.execute(
                "SELECT COUNT(*) AS cnt FROM classification_results WHERE task_id = %s AND status = 'pending'",
                (task_id,),
            ).fetchone()["cnt"]
            if remaining == 0:
                task = conn.execute("SELECT id FROM classification_tasks WHERE id = %s AND status IN ('pending_review', 'processing')", (task_id,)).fetchone()
                if task:
                    conn.execute("UPDATE classification_tasks SET status = 'completed', completed_at = NOW() WHERE id = %s", (task_id,))
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

    @classmethod
    async def stream_classify_batch(cls, system_prompt: str, items: List[Dict], use_stream: bool = True):
        """流式分类单个批次，yield 每个 token"""
        llm_cfg = get_llm_config()
        if not llm_cfg["enabled"] or not llm_cfg["api_key"]:
            yield {"type": "error", "message": "LLM 未启用或 API key 缺失"}
            return

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
            "thinking": {"type": "disabled"},
            "messages": [{"role": "user", "content": user_content}],
        }

        if use_stream:
            body["stream"] = True
            try:
                async with client.stream("POST", url, headers=headers, json=body, timeout=60.0) as resp:
                    resp.raise_for_status()
                    full_text = ""
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            event = json.loads(data_str)
                            if event.get("type") == "content_block_delta":
                                delta = event.get("delta", {})
                                if delta.get("type") == "text_delta":
                                    token = delta.get("text", "")
                                    full_text += token
                                    yield {"type": "token", "text": token}
                        except json.JSONDecodeError:
                            continue
                    yield {"type": "done", "full_text": full_text}
            except httpx.HTTPStatusError as e:
                yield {"type": "error", "message": f"HTTP {e.response.status_code}: {e.response.text[:200]}"}
            except Exception as e:
                yield {"type": "error", "message": f"流式请求失败: {type(e).__name__}: {str(e)[:200]}"}
        else:
            try:
                resp = await client.post(url, headers=headers, json=body, timeout=60.0)
                resp.raise_for_status()
                data = resp.json()
                text = ""
                for block in data.get("content", []):
                    if block.get("type") == "text":
                        text += block.get("text", "")
                yield {"type": "done", "full_text": text.strip()}
            except httpx.HTTPStatusError as e:
                yield {"type": "error", "message": f"HTTP {e.response.status_code}: {e.response.text[:200]}"}
            except Exception as e:
                yield {"type": "error", "message": f"请求失败: {type(e).__name__}: {str(e)[:200]}"}

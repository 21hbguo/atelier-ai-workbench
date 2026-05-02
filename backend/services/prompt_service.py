import json
import csv
import io
from typing import List, Dict, Any, Optional
from datetime import datetime
from uuid import uuid4
from backend.database import get_db


class PromptService:
    @classmethod
    def _row_to_dict(cls, row) -> Dict[str, Any]:
        d = dict(row)
        try:
            d["tags"] = json.loads(d.get("tags") or "[]")
        except (json.JSONDecodeError, TypeError):
            d["tags"] = []
        return d

    _ORDER_MAP = {
        "likes": "p.likes_count DESC",
        "time": "p.created_at DESC",
    }

    CATEGORY_LABELS = {
        "poster": "海报与插画",
        "portrait": "人像摄影",
        "ui": "UI设计",
        "comparison": "模型对比",
        "ad-creative": "广告创意",
        "ecommerce": "电商案例",
        "character": "角色设计",
    }

    @classmethod
    def get_all(cls, scope: str = "public", user_id: int = None, sort: str = "likes",
                category: str = None, page: int = 1, size: int = 50) -> Dict[str, Any]:
        with get_db() as conn:
            order = cls._ORDER_MAP.get(sort, cls._ORDER_MAP["likes"])
            where_clauses = []
            params = []

            if scope == "private" and user_id is not None:
                where_clauses.append("p.user_id = ?")
                params.append(user_id)
            elif scope == "external":
                where_clauses.append("p.source IS NOT NULL")
            elif scope in ("all", "community"):
                pass
            else:
                where_clauses.append("p.user_id IS NULL")

            if category:
                where_clauses.append("p.category = ?")
                params.append(category)

            where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
            join_sql = "LEFT JOIN users u ON p.user_id = u.id" if scope in ("all", "community") else ""
            select_extra = ", u.username, u.nickname" if scope in ("all", "community") else ""

            count_sql = f"SELECT COUNT(*) FROM prompts p {join_sql} {where_sql}"
            total = conn.execute(count_sql, params).fetchone()[0]

            offset = (page - 1) * size
            query_sql = f"SELECT p.*{select_extra} FROM prompts p {join_sql} {where_sql} ORDER BY {order} LIMIT ? OFFSET ?"
            rows = conn.execute(query_sql, params + [size, offset]).fetchall()

            results = [cls._row_to_dict(r) for r in rows]
            if user_id:
                for p in results:
                    like = conn.execute("SELECT id FROM prompt_likes WHERE prompt_id = ? AND user_id = ?", (p["id"], user_id)).fetchone()
                    p["is_liked"] = like is not None
            return {"prompts": results, "total": total}

    @classmethod
    def get_by_id(cls, prompt_id: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
            return cls._row_to_dict(row) if row else None

    @classmethod
    def create(cls, name: str, prompt: str, negative_prompt: Optional[str] = None, tags: Optional[List[str]] = None, user_id: int = None) -> Dict[str, Any]:
        item = {
            "id": str(uuid4()),
            "name": name,
            "prompt": prompt,
            "negative_prompt": negative_prompt or "",
            "tags": tags or [],
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "user_id": user_id,
        }
        with get_db() as conn:
            conn.execute(
                "INSERT INTO prompts (id, name, prompt, negative_prompt, tags, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (item["id"], item["name"], item["prompt"], item["negative_prompt"],
                 json.dumps(item["tags"], ensure_ascii=False), item["created_at"], item["user_id"]),
            )
        return item

    @classmethod
    def update(cls, prompt_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
            if not row:
                return None
            updates = []
            values = []
            for key, value in kwargs.items():
                if value is not None:
                    if key == "tags":
                        updates.append("tags = ?")
                        values.append(json.dumps(value, ensure_ascii=False))
                    else:
                        updates.append(f"{key} = ?")
                        values.append(value)
            if updates:
                values.append(prompt_id)
                conn.execute(f"UPDATE prompts SET {', '.join(updates)} WHERE id = ?", values)
            row = conn.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
            return cls._row_to_dict(row)

    @classmethod
    def delete(cls, prompt_id: str) -> bool:
        with get_db() as conn:
            cur = conn.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
            return cur.rowcount > 0

    @classmethod
    def batch_delete(cls, ids: List[str]) -> int:
        with get_db() as conn:
            placeholders = ",".join("?" for _ in ids)
            cur = conn.execute(f"DELETE FROM prompts WHERE id IN ({placeholders})", ids)
            return cur.rowcount

    @classmethod
    def search(cls, query: str, tags: Optional[List[str]] = None, scope: str = "public",
               user_id: int = None, sort: str = "likes", category: str = None,
               page: int = 1, size: int = 50) -> Dict[str, Any]:
        with get_db() as conn:
            order = cls._ORDER_MAP.get(sort, cls._ORDER_MAP["likes"])
            where_clauses = []
            params = []

            if scope == "private" and user_id is not None:
                where_clauses.append("p.user_id = ?")
                params.append(user_id)
            elif scope == "external":
                where_clauses.append("p.source IS NOT NULL")
            elif scope in ("all", "community"):
                pass
            else:
                where_clauses.append("p.user_id IS NULL")

            if category:
                where_clauses.append("p.category = ?")
                params.append(category)

            if query:
                q = f"%{query}%"
                where_clauses.append("(p.name LIKE ? OR p.prompt LIKE ? OR p.tags LIKE ?)")
                params.extend([q, q, q])
                if scope in ("all", "community"):
                    where_clauses[-1] = f"({where_clauses[-1]} OR u.username LIKE ? OR u.nickname LIKE ?)"
                    params.extend([q, q])

            join_sql = "LEFT JOIN users u ON p.user_id = u.id" if scope in ("all", "community") else ""
            select_extra = ", u.username, u.nickname" if scope in ("all", "community") else ""
            where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

            count_sql = f"SELECT COUNT(*) FROM prompts p {join_sql} {where_sql}"
            total = conn.execute(count_sql, params).fetchone()[0]

            if tags:
                tag_set = set(t.lower() for t in tags)
                query_sql = f"SELECT p.*{select_extra} FROM prompts p {join_sql} {where_sql} ORDER BY {order}"
                rows = conn.execute(query_sql, params).fetchall()
                results = [cls._row_to_dict(r) for r in rows]
                results = [p for p in results if tag_set & set(t.lower() for t in p.get("tags", []))]
                results = results[(page - 1) * size: page * size]
            else:
                offset = (page - 1) * size
                query_sql = f"SELECT p.*{select_extra} FROM prompts p {join_sql} {where_sql} ORDER BY {order} LIMIT ? OFFSET ?"
                rows = conn.execute(query_sql, params + [size, offset]).fetchall()
                results = [cls._row_to_dict(r) for r in rows]

            if user_id:
                for p in results:
                    like = conn.execute("SELECT id FROM prompt_likes WHERE prompt_id = ? AND user_id = ?", (p["id"], user_id)).fetchone()
                    p["is_liked"] = like is not None
            return {"prompts": results, "total": total}

    @classmethod
    def get_categories(cls) -> List[Dict[str, Any]]:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT category, COUNT(*) as count FROM prompts WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC"
            ).fetchall()
            return [{"slug": r["category"], "label": cls.CATEGORY_LABELS.get(r["category"], r["category"]), "count": r["count"]} for r in rows]

    @classmethod
    def import_prompts(cls, prompts_data: List[Dict[str, Any]], user_id: int = None) -> Dict[str, int]:
        success = 0
        failed = 0
        with get_db() as conn:
            existing = {row["prompt"] for row in conn.execute("SELECT prompt FROM prompts").fetchall()}
            existing_names = {row["name"] for row in conn.execute("SELECT name FROM prompts").fetchall()}

            for item in prompts_data:
                prompt_text = item.get("prompt", "")
                name = item.get("name", "")
                if not prompt_text or prompt_text in existing or name in existing_names:
                    failed += 1
                    continue
                conn.execute(
                    "INSERT INTO prompts (id, name, prompt, negative_prompt, tags, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        str(uuid4()),
                        name or f"导入提示词_{success + 1}",
                        prompt_text,
                        item.get("negative_prompt", ""),
                        json.dumps(item.get("tags", []), ensure_ascii=False),
                        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        user_id,
                    ),
                )
                existing.add(prompt_text)
                existing_names.add(name)
                success += 1
        return {"success": success, "failed": failed}

    @classmethod
    def export_prompts(cls, ids: Optional[List[str]] = None, format: str = "json") -> bytes:
        with get_db() as conn:
            if ids:
                placeholders = ",".join("?" for _ in ids)
                rows = conn.execute(f"SELECT * FROM prompts WHERE id IN ({placeholders}) ORDER BY created_at DESC", ids).fetchall()
            else:
                rows = conn.execute("SELECT * FROM prompts ORDER BY created_at DESC").fetchall()

        prompts = [cls._row_to_dict(r) for r in rows]

        if format == "csv":
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

import json
import csv
import io
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime
from uuid import uuid4
from backend.database import get_db
from backend.services.category_service import CategoryService
from backend.services.favorite_service import FavoriteService
from backend.config import EVO_IMAGES_DIR, EVO_IMPORTED_DIR, UPLOAD_DIR, GENERATED_IMAGES_DIR
from backend.services.image_dimensions import get_image_dimensions


def _get_evo_image_path(image_path: str):
    p = EVO_IMPORTED_DIR / image_path
    if p.exists():
        return p
    return EVO_IMAGES_DIR / image_path


class PromptService:
    @classmethod
    def _row_to_dict(cls, row) -> Dict[str, Any]:
        d = dict(row)
        val = d.get("tags")
        d["tags"] = val if isinstance(val, list) else json.loads(val or "[]")
        if d.get("created_at") is not None:
            d["created_at"] = d["created_at"].strftime("%Y-%m-%d %H:%M:%S") if hasattr(d["created_at"], "strftime") else str(d["created_at"])
        if d.get("image_path") and "/" in d["image_path"]:
            w,h=get_image_dimensions(str(_get_evo_image_path(d["image_path"])))
            d["width"]=w
            d["height"]=h
        elif d.get("image_path"):
            w,h=get_image_dimensions(str(UPLOAD_DIR / d["image_path"]))
            d["width"]=w
            d["height"]=h
        return d

    _ORDER_MAP = {
        "likes": "p.likes_count DESC, p.id",
        "time": "p.created_at DESC, p.id",
    }

    @classmethod
    def get_all(cls, scope: str = "public", user_id: int = None, sort: str = "likes",
                category: str = None, author_id: int = None, author_name: str = None, page: int = 1, size: int = 50) -> Dict[str, Any]:
        with get_db() as conn:
            order = cls._ORDER_MAP.get(sort, cls._ORDER_MAP["likes"])
            where_clauses = []
            params = []

            if scope == "private" and user_id is not None:
                where_clauses.append("p.user_id = %s")
                params.append(user_id)
            elif scope == "external":
                where_clauses.append("p.source IS NOT NULL")
            elif scope in ("all", "community"):
                where_clauses.append("COALESCE(p.is_frozen, FALSE) = FALSE")
            else:
                where_clauses.append("p.user_id IS NULL AND COALESCE(p.is_frozen, FALSE) = FALSE")

            if category:
                where_clauses.append("p.category = %s")
                params.append(category)
            if author_id is not None:
                where_clauses.append("p.user_id = %s")
                params.append(author_id)
            if author_name:
                where_clauses.append("(p.author = %s OR u.username = %s OR u.nickname = %s)")
                params.extend([author_name, author_name, author_name])

            where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
            join_sql = "LEFT JOIN users u ON p.user_id = u.id" if scope in ("all", "community") else ""
            join_sql += " LEFT JOIN categories cat ON p.category = cat.slug"
            select_extra = ", u.username, u.nickname" if scope in ("all", "community") else ""
            select_extra += ", cat.label as category_label"

            count_sql = f"SELECT COUNT(*) AS cnt FROM prompts p {join_sql} {where_sql}"
            total = conn.execute(count_sql, params).fetchone()["cnt"]

            offset = (page - 1) * size
            query_sql = f"SELECT p.*{select_extra} FROM prompts p {join_sql} {where_sql} ORDER BY {order} LIMIT %s OFFSET %s"
            rows = conn.execute(query_sql, params + [size, offset]).fetchall()

            results = [cls._row_to_dict(r) for r in rows]
            if user_id and results:
                prompt_ids = [p["id"] for p in results]
                like_rows = conn.execute(f"SELECT prompt_id FROM prompt_likes WHERE user_id = %s AND prompt_id IN ({','.join('%s' for _ in prompt_ids)})", [user_id, *prompt_ids]).fetchall()
                liked_ids = {str(r["prompt_id"]) for r in like_rows}
                favorited_ids = FavoriteService.get_flags(user_id, "prompt", prompt_ids, conn=conn)
                for p in results:
                    p["is_liked"] = str(p["id"]) in liked_ids
                    p["is_favorited"] = str(p["id"]) in favorited_ids
            return {"prompts": results, "total": total}

    @classmethod
    def get_by_id(cls, prompt_id: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM prompts WHERE id = %s", (prompt_id,)).fetchone()
            return cls._row_to_dict(row) if row else None

    @classmethod
    def _copy_image_to_uploads(cls, image_path: str) -> Optional[str]:
        if not image_path:
            return image_path
        src = GENERATED_IMAGES_DIR / image_path
        if not src.exists():
            return image_path
        ext = Path(image_path).suffix or '.png'
        new_filename = f"{uuid4().hex}{ext}"
        dst = UPLOAD_DIR / new_filename
        shutil.copy2(src, dst)
        return new_filename

    @classmethod
    def create(cls, name: str, prompt: str, negative_prompt: Optional[str] = None,
               tags: Optional[List[str]] = None, user_id: int = None, category: Optional[str] = None, image_path: Optional[str] = None, author: Optional[str] = None, allow_existing: bool = False) -> Dict[str, Any]:
        with get_db() as conn:
            existing = conn.execute("SELECT * FROM prompts WHERE prompt = %s AND user_id IS NOT DISTINCT FROM %s", (prompt, user_id)).fetchone()
            if existing:
                if allow_existing:
                    if image_path and not existing.get("image_path"):
                        if not image_path.startswith(("http://", "https://")):
                            image_path = cls._copy_image_to_uploads(image_path)
                        conn.execute("UPDATE prompts SET image_path = COALESCE(image_path, %s), author = COALESCE(NULLIF(author,''), %s), category = COALESCE(category, %s) WHERE id = %s", (image_path, (author or "").strip() or ("system" if user_id is None else ""), category, existing["id"]))
                    if name and (not existing.get("name") or len(str(existing.get("name") or "")) > 16 or str(existing.get("name") or "").lower() == str(prompt or "").lower()):
                        conn.execute("UPDATE prompts SET name = %s WHERE id = %s", (name, existing["id"]))
                    existing = conn.execute("SELECT * FROM prompts WHERE id = %s", (existing["id"],)).fetchone()
                    return cls._row_to_dict(existing)
                raise ValueError("相同内容的提示词已存在")
        if image_path and not image_path.startswith(("http://", "https://")):
            image_path = cls._copy_image_to_uploads(image_path)
        author = (author or "").strip() or ("system" if user_id is None else "")
        item = {
            "id": str(uuid4()),
            "name": name,
            "prompt": prompt,
            "negative_prompt": negative_prompt or "",
            "tags": tags or [],
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "user_id": user_id,
            "category": category,
            "image_path": image_path,
            "author": author,
        }
        with get_db() as conn:
            conn.execute(
                "INSERT INTO prompts (id, name, prompt, negative_prompt, tags, created_at, user_id, category, image_path, author) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (item["id"], item["name"], item["prompt"], item["negative_prompt"],
                 json.dumps(item["tags"], ensure_ascii=False), item["created_at"], item["user_id"], item["category"], item["image_path"], item["author"]),
            )
        return item

    @classmethod
    def update(cls, prompt_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM prompts WHERE id = %s", (prompt_id,)).fetchone()
            if not row:
                return None
            updates = []
            values = []
            for key, value in kwargs.items():
                if value is not None:
                    if key == "tags":
                        updates.append("tags = %s")
                        values.append(json.dumps(value, ensure_ascii=False))
                    else:
                        updates.append(f"{key} = %s")
                        values.append(value)
            if updates:
                values.append(prompt_id)
                conn.execute(f"UPDATE prompts SET {', '.join(updates)} WHERE id = %s", values)
            row = conn.execute("SELECT * FROM prompts WHERE id = %s", (prompt_id,)).fetchone()
            return cls._row_to_dict(row)

    @classmethod
    def delete(cls, prompt_id: str) -> bool:
        with get_db() as conn:
            conn.execute("DELETE FROM prompt_likes WHERE prompt_id = %s", (prompt_id,))
            cur = conn.execute("DELETE FROM prompts WHERE id = %s", (prompt_id,))
            return cur.rowcount > 0

    @classmethod
    def batch_delete(cls, ids: List[str]) -> int:
        with get_db() as conn:
            placeholders = ",".join("%s" for _ in ids)
            conn.execute(f"DELETE FROM prompt_likes WHERE prompt_id IN ({placeholders})", ids)
            cur = conn.execute(f"DELETE FROM prompts WHERE id IN ({placeholders})", ids)
            return cur.rowcount

    @classmethod
    def search(cls, query: str, tags: Optional[List[str]] = None, scope: str = "public",
               user_id: int = None, sort: str = "likes", category: str = None, author_id: int = None, author_name: str = None,
               page: int = 1, size: int = 50) -> Dict[str, Any]:
        with get_db() as conn:
            order = cls._ORDER_MAP.get(sort, cls._ORDER_MAP["likes"])
            where_clauses = []
            params = []

            if scope == "private" and user_id is not None:
                where_clauses.append("p.user_id = %s")
                params.append(user_id)
            elif scope == "external":
                where_clauses.append("p.source IS NOT NULL")
            elif scope in ("all", "community"):
                where_clauses.append("COALESCE(p.is_frozen, FALSE) = FALSE")
            else:
                where_clauses.append("p.user_id IS NULL AND COALESCE(p.is_frozen, FALSE) = FALSE")

            if category:
                where_clauses.append("p.category = %s")
                params.append(category)
            if author_id is not None:
                where_clauses.append("p.user_id = %s")
                params.append(author_id)
            if author_name:
                where_clauses.append("(p.author = %s OR u.username = %s OR u.nickname = %s)")
                params.extend([author_name, author_name, author_name])

            if query:
                q = f"%{query}%"
                where_clauses.append("(p.name LIKE %s OR p.prompt LIKE %s OR CAST(p.tags AS TEXT) LIKE %s)")
                params.extend([q, q, q])
                if scope in ("all", "community"):
                    where_clauses[-1] = f"({where_clauses[-1]} OR u.username LIKE %s OR u.nickname LIKE %s)"
                    params.extend([q, q])

            join_sql = "LEFT JOIN users u ON p.user_id = u.id" if scope in ("all", "community") else ""
            join_sql += " LEFT JOIN categories cat ON p.category = cat.slug"
            select_extra = ", u.username, u.nickname" if scope in ("all", "community") else ""
            select_extra += ", cat.label as category_label"
            where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

            count_sql = f"SELECT COUNT(*) AS cnt FROM prompts p {join_sql} {where_sql}"
            total = conn.execute(count_sql, params).fetchone()["cnt"]

            if tags:
                tag_set = set(t.lower() for t in tags)
                query_sql = f"SELECT p.*{select_extra} FROM prompts p {join_sql} {where_sql} ORDER BY {order}"
                rows = conn.execute(query_sql, params).fetchall()
                results = [cls._row_to_dict(r) for r in rows]
                results = [p for p in results if tag_set & set(t.lower() for t in p.get("tags", []))]
                results = results[(page - 1) * size: page * size]
            else:
                offset = (page - 1) * size
                query_sql = f"SELECT p.*{select_extra} FROM prompts p {join_sql} {where_sql} ORDER BY {order} LIMIT %s OFFSET %s"
                rows = conn.execute(query_sql, params + [size, offset]).fetchall()
                results = [cls._row_to_dict(r) for r in rows]

            if user_id:
                prompt_ids = [p["id"] for p in results]
                if prompt_ids:
                    like_rows = conn.execute(f"SELECT prompt_id FROM prompt_likes WHERE user_id = %s AND prompt_id IN ({','.join('%s' for _ in prompt_ids)})", [user_id, *prompt_ids]).fetchall()
                    liked_ids = {str(r["prompt_id"]) for r in like_rows}
                    favorited_ids = FavoriteService.get_flags(user_id, "prompt", prompt_ids, conn=conn)
                    for p in results:
                        p["is_liked"] = str(p["id"]) in liked_ids
                        p["is_favorited"] = str(p["id"]) in favorited_ids
            return {"prompts": results, "total": total}

    @classmethod
    def get_categories(cls, include_frozen: bool = False) -> List[Dict[str, Any]]:
        return CategoryService.get_all(include_frozen=include_frozen)

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

                image_path = item.get("image_path")
                if image_path:
                    image_path = cls._resolve_image_path(image_path)

                conn.execute(
                    "INSERT INTO prompts (id, name, prompt, negative_prompt, tags, created_at, user_id, category, image_path) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        str(uuid4()),
                        name or f"导入提示词_{success + 1}",
                        prompt_text,
                        item.get("negative_prompt", ""),
                        json.dumps(item.get("tags", []), ensure_ascii=False),
                        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        user_id,
                        item.get("category"),
                        image_path,
                    ),
                )
                existing.add(prompt_text)
                existing_names.add(name)
                success += 1
        return {"success": success, "failed": failed}

    @classmethod
    def _resolve_image_path(cls, image_path: str) -> Optional[str]:
        if image_path.startswith(("http://", "https://")):
            return cls._download_image(image_path)
        return image_path

    @classmethod
    def _download_image(cls, url: str) -> Optional[str]:
        import requests
        import secrets
        from urllib.parse import urlparse
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "jpeg" in content_type or "jpg" in content_type:
                ext = "jpg"
            elif "png" in content_type:
                ext = "png"
            elif "webp" in content_type:
                ext = "webp"
            elif "gif" in content_type:
                ext = "gif"
            else:
                path = urlparse(url).path
                ext = path.rsplit(".", 1)[-1].lower() if "." in path else "jpg"
                if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
                    ext = "jpg"
            filename = f"{secrets.token_hex(16)}.{ext}"
            save_path = UPLOAD_DIR / filename
            save_path.write_bytes(resp.content)
            return filename
        except Exception:
            return None

    @classmethod
    def export_prompts(cls, ids: Optional[List[str]] = None, format: str = "json", user_id: int = None) -> bytes:
        with get_db() as conn:
            if ids:
                placeholders = ",".join("%s" for _ in ids)
                rows = conn.execute(f"SELECT * FROM prompts WHERE id IN ({placeholders}) ORDER BY created_at DESC", ids).fetchall()
            elif user_id is not None:
                rows = conn.execute("SELECT * FROM prompts WHERE user_id = %s ORDER BY created_at DESC", (user_id,)).fetchall()
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

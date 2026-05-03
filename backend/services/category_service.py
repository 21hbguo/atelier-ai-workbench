from typing import List, Dict, Any, Optional
from backend.database import get_db


class CategoryService:

    @classmethod
    def get_all(cls, include_frozen: bool = False) -> List[Dict[str, Any]]:
        with get_db() as conn:
            join_cond = "p.category = c.slug" if include_frozen else "p.category = c.slug AND COALESCE(p.is_frozen, FALSE) = FALSE"
            rows = conn.execute(
                """SELECT c.id, c.slug, c.label, c.sort_order,
                   COUNT(p.id) as count
                   FROM categories c
                   LEFT JOIN prompts p ON """ + join_cond + """
                   GROUP BY c.id
                   ORDER BY c.sort_order, c.label"""
            ).fetchall()
            return [{"id": r["id"], "slug": r["slug"], "label": r["label"], "count": r["count"]} for r in rows]

    @classmethod
    def get_by_slug(cls, slug: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM categories WHERE slug = %s", (slug,)).fetchone()
            return dict(row) if row else None

    @classmethod
    def create(cls, slug: str, label: str) -> Dict[str, Any]:
        with get_db() as conn:
            max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS cnt FROM categories").fetchone()["cnt"]
            conn.execute(
                "INSERT INTO categories (slug, label, sort_order) VALUES (%s, %s, %s)",
                (slug, label, max_order + 1)
            )
            row = conn.execute("SELECT * FROM categories WHERE slug = %s", (slug,)).fetchone()
            return dict(row)

    @classmethod
    def update(cls, category_id: int, label: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            conn.execute("UPDATE categories SET label = %s WHERE id = %s", (label, category_id))
            row = conn.execute("SELECT * FROM categories WHERE id = %s", (category_id,)).fetchone()
            return dict(row) if row else None

    @classmethod
    def delete(cls, category_id: int) -> bool:
        with get_db() as conn:
            category = conn.execute("SELECT slug FROM categories WHERE id = %s", (category_id,)).fetchone()
            if not category:
                return False
            count = conn.execute(
                "SELECT COUNT(*) AS cnt FROM prompts WHERE category = %s", (category["slug"],)
            ).fetchone()["cnt"]
            if count > 0:
                return False
            conn.execute("DELETE FROM categories WHERE id = %s", (category_id,))
            return True

from typing import List, Dict, Any, Optional
from backend.database import get_db


class CategoryService:

    @classmethod
    def get_all(cls) -> List[Dict[str, Any]]:
        with get_db() as conn:
            rows = conn.execute(
                """SELECT c.id, c.slug, c.label, c.sort_order,
                   COUNT(p.id) as count
                   FROM categories c
                   LEFT JOIN prompts p ON p.category = c.slug
                   GROUP BY c.id
                   ORDER BY c.sort_order, c.label"""
            ).fetchall()
            return [{"id": r["id"], "slug": r["slug"], "label": r["label"], "count": r["count"]} for r in rows]

    @classmethod
    def get_by_slug(cls, slug: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM categories WHERE slug = ?", (slug,)).fetchone()
            return dict(row) if row else None

    @classmethod
    def create(cls, slug: str, label: str) -> Dict[str, Any]:
        with get_db() as conn:
            max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM categories").fetchone()[0]
            conn.execute(
                "INSERT INTO categories (slug, label, sort_order) VALUES (?, ?, ?)",
                (slug, label, max_order + 1)
            )
            row = conn.execute("SELECT * FROM categories WHERE slug = ?", (slug,)).fetchone()
            return dict(row)

    @classmethod
    def update(cls, category_id: int, label: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            conn.execute("UPDATE categories SET label = ? WHERE id = ?", (label, category_id))
            row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
            return dict(row) if row else None

    @classmethod
    def delete(cls, category_id: int) -> bool:
        with get_db() as conn:
            category = conn.execute("SELECT slug FROM categories WHERE id = ?", (category_id,)).fetchone()
            if not category:
                return False
            count = conn.execute(
                "SELECT COUNT(*) FROM prompts WHERE category = ?", (category["slug"],)
            ).fetchone()[0]
            if count > 0:
                return False
            conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
            return True

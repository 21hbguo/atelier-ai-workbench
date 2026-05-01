import re
from backend.database import get_db


class BannedWordsService:
    _cache = None
    _cache_time = 0

    @classmethod
    def _load_words(cls):
        import time
        now = time.time()
        if cls._cache is not None and now - cls._cache_time < 60:
            return cls._cache
        with get_db() as conn:
            rows = conn.execute("SELECT word FROM banned_words").fetchall()
            cls._cache = [row["word"] for row in rows]
            cls._cache_time = now
            return cls._cache

    @classmethod
    def check(cls, prompt: str) -> str | None:
        words = cls._load_words()
        prompt_lower = prompt.lower()
        for word in words:
            if word.lower() in prompt_lower:
                return word
        return None

    @classmethod
    def add(cls, word: str) -> bool:
        import time
        with get_db() as conn:
            try:
                conn.execute(
                    "INSERT INTO banned_words (word, created_at) VALUES (?, datetime('now'))",
                    (word.strip(),),
                )
                cls._cache = None
                return True
            except Exception:
                return False

    @classmethod
    def remove(cls, word_id: int) -> bool:
        import time
        with get_db() as conn:
            conn.execute("DELETE FROM banned_words WHERE id = ?", (word_id,))
            cls._cache = None
            return True

    @classmethod
    def batch_add(cls, words: list[str]) -> dict:
        added = 0
        skipped = 0
        with get_db() as conn:
            for word in words:
                word = word.strip()
                if not word or len(word) > 50:
                    skipped += 1
                    continue
                try:
                    conn.execute(
                        "INSERT INTO banned_words (word, created_at) VALUES (?, datetime('now'))",
                        (word,),
                    )
                    added += 1
                except Exception:
                    skipped += 1
            cls._cache = None
        return {"added": added, "skipped": skipped}

    @classmethod
    def list_words(cls, page: int = 1, size: int = 20, query: str = None):
        with get_db() as conn:
            offset = (page - 1) * size
            if query:
                q = f"%{query}%"
                total = conn.execute("SELECT COUNT(*) FROM banned_words WHERE word LIKE ?", (q,)).fetchone()[0]
                rows = conn.execute(
                    "SELECT * FROM banned_words WHERE word LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?",
                    (q, size, offset),
                ).fetchall()
            else:
                total = conn.execute("SELECT COUNT(*) FROM banned_words").fetchone()[0]
                rows = conn.execute(
                    "SELECT * FROM banned_words ORDER BY id DESC LIMIT ? OFFSET ?",
                    (size, offset),
                ).fetchall()
            return {"words": [dict(row) for row in rows], "total": total}

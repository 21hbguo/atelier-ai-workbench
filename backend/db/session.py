from contextlib import contextmanager
from backend.db.engine import pool


@contextmanager
def get_db():
    with pool.connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

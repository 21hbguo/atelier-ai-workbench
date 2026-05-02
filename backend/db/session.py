from contextlib import contextmanager
from backend.db import engine


@contextmanager
def get_db():
    with engine.pool.connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

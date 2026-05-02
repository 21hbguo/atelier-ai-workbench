import atexit
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from backend.config import DATABASE_URL, PG_POOL_MIN, PG_POOL_MAX

pool: ConnectionPool | None = None


def init_pool():
    global pool
    if pool is not None:
        return
    pool = ConnectionPool(
        conninfo=DATABASE_URL,
        min_size=PG_POOL_MIN,
        max_size=PG_POOL_MAX,
        kwargs={"row_factory": dict_row},
    )


def close_pool():
    global pool
    if pool is not None:
        pool.close()
        pool = None


atexit.register(close_pool)

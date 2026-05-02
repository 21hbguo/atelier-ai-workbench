#!/usr/bin/env python3
"""
SQLite → PostgreSQL 数据迁移脚本

用法:
    python -m backend.scripts.migrate_sqlite_to_pg
    python -m backend.scripts.migrate_sqlite_to_pg --sqlite-path /path/to/app.db
    python -m backend.scripts.migrate_sqlite_to_pg --dry-run
"""
import sys
import json
import sqlite3
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import psycopg
from psycopg.rows import dict_row
from backend.config import DATABASE_URL

# 表定义：(表名, JSONB字段列表, BOOLEAN字段列表)
TABLES = [
    ("users", [], ["is_admin", "is_frozen"]),
    ("user_requests", [], []),
    ("tasks", ["params", "result_urls", "external_result"], []),
    ("prompts", ["tags"], []),
    ("categories", [], []),
    ("prompt_likes", [], []),
    ("square_images", ["metadata"], []),
    ("square_likes", [], []),
    ("stats", [], []),
    ("daily_stats", [], []),
    ("banned_words", [], []),
    ("image_mappings", [], []),
    ("image_metadata", ["metadata"], []),
    ("recharge_requests", [], []),
    ("redemption_codes", [], ["is_used"]),
    ("point_transactions", [], []),
    ("daily_checkins", [], []),
    ("announcements", [], []),
    ("announcement_reads", [], []),
    ("import_sources", ["metadata"], []),
]

# 有 SERIAL 主键的表（需要重置序列）
SERIAL_TABLES = {
    "users", "user_requests", "categories", "prompt_likes",
    "square_images", "square_likes", "banned_words", "image_mappings",
    "image_metadata", "recharge_requests", "redemption_codes",
    "point_transactions", "daily_checkins", "announcements",
    "announcement_reads", "import_sources",
}


def convert_row(row: dict, jsonb_fields: list, bool_fields: list) -> dict:
    result = {}
    for key, value in row.items():
        if key in jsonb_fields and isinstance(value, str):
            try:
                result[key] = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                result[key] = value
        elif key in bool_fields:
            result[key] = bool(value) if value is not None else False
        else:
            result[key] = value
    return result


def reset_sequence(pg_conn, table_name: str):
    pg_conn.execute(
        f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), COALESCE(MAX(id), 1)) FROM {table_name}"
    )


def migrate_table(sqlite_conn, pg_conn, table_name: str, jsonb_fields: list, bool_fields: list, dry_run: bool = False):
    rows = sqlite_conn.execute(f"SELECT * FROM {table_name}").fetchall()
    if not rows:
        return 0

    columns = [desc[0] for desc in sqlite_conn.execute(f"SELECT * FROM {table_name} LIMIT 0").description]
    placeholders = ", ".join(["%s"] * len(columns))
    col_names = ", ".join(columns)
    insert_sql = f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"

    count = 0
    for row in rows:
        row_dict = dict(row)
        converted = convert_row(row_dict, jsonb_fields, bool_fields)
        values = [converted[col] for col in columns]
        if not dry_run:
            pg_conn.execute(insert_sql, values)
        count += 1

    if not dry_run and table_name in SERIAL_TABLES:
        reset_sequence(pg_conn, table_name)

    return count


def main():
    parser = argparse.ArgumentParser(description="Migrate SQLite to PostgreSQL")
    parser.add_argument("--sqlite-path", default=None, help="Path to SQLite database")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent.parent.parent
    sqlite_path = args.sqlite_path or str(project_root / "data" / "app.db")

    if not Path(sqlite_path).exists():
        print(f"Error: SQLite database not found: {sqlite_path}")
        sys.exit(1)

    print(f"Source: {sqlite_path}")
    print(f"Target: {DATABASE_URL}")
    if args.dry_run:
        print("DRY RUN - no data will be written")
    print()

    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row

    pg_conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)

    total = 0
    try:
        for table_name, jsonb_fields, bool_fields in TABLES:
            count = migrate_table(sqlite_conn, pg_conn, table_name, jsonb_fields, bool_fields, args.dry_run)
            status = "OK" if not args.dry_run else "DRY"
            print(f"  [{status}] {table_name}: {count} rows")
            total += count

        if not args.dry_run:
            pg_conn.commit()
        print(f"\nMigration complete: {total} total rows")
    except Exception as e:
        pg_conn.rollback()
        print(f"\nError: {e}")
        sys.exit(1)
    finally:
        sqlite_conn.close()
        pg_conn.close()


if __name__ == "__main__":
    main()

"""将旧积分单位迁移为 1 元 = 100 积分。

执行前先做数据库备份，再执行 --dry-run 核对报告；--apply 要求提供已生成的备份文件。
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from backend.config import CONFIG_FILE, DATA_DIR
from backend.database import get_db

VERSION = 100
FACTOR = 10
LOCK_KEY = 581900100
CSV_PATH = Path(DATA_DIR) / "llm_models.csv"
DB_FIELDS = (
    ("users", "points"),
    ("point_transactions", "amount"),
    ("point_transactions", "balance_after"),
    ("recharge_requests", "points"),
    ("redemption_codes", "points"),
    ("tasks", "points_cost"),
    ("tasks", "points_balance_after"),
    ("invite_events", "reward_points"),
    ("chat_usage_records", "cost_points"),
)
CSV_POINT_FIELDS = (
    "input_points_per_million", "output_points_per_million", "points_per_request",
    "points_per_1k_input", "points_per_1k_output", "points_per_1k_cache_read", "points_per_1k_cache_creation",
)


def _column_exists(conn, table: str, column: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s",
        (table, column),
    ).fetchone())


def _config_scale(value, key: str = ""):
    if isinstance(value, dict):
        return {k: _config_scale(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_config_scale(v, key) for v in value]
    if key in {"points_unit_version", "points_per_rmb"}:
        return VERSION
    if isinstance(value, (int, float)) and ("point" in key.lower() or key in {"cost", "grant_points"}):
        return round(value * FACTOR)
    return value


def _config_report(value, key: str = "") -> int:
    if isinstance(value, dict):
        return sum(_config_report(v, k) for k, v in value.items())
    if isinstance(value, list):
        return sum(_config_report(v, key) for v in value)
    return int(key not in {"points_unit_version", "points_per_rmb"} and isinstance(value, (int, float)) and ("point" in key.lower() or key in {"cost", "grant_points"}))


def _csv_rows():
    if not CSV_PATH.exists():
        return [], []
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader), list(reader.fieldnames or [])


def _scale_csv(rows: list[dict], fields: list[str]):
    for field in CSV_POINT_FIELDS:
        if field not in fields:
            fields.append(field)
    changes = 0
    for row in rows:
        for field in CSV_POINT_FIELDS:
            raw = str(row.get(field) or "").strip()
            if not raw:
                continue
            row[field] = str(round(float(raw) * FACTOR, 4)).rstrip("0").rstrip(".")
            changes += 1
    return changes


def _write_csv(rows: list[dict], fields: list[str]):
    tmp = CSV_PATH.with_suffix(".csv.points-unit.tmp")
    with tmp.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    tmp.replace(CSV_PATH)


def _report(conn) -> dict:
    tables = {}
    for table, column in DB_FIELDS:
        if not _column_exists(conn, table, column):
            continue
        row = conn.execute(f"SELECT COUNT(*) AS count, COALESCE(SUM({column}), 0) AS total FROM {table}").fetchone()
        tables[f"{table}.{column}"] = {"count": int(row["count"] or 0), "total": str(row["total"] or 0)}
    config = {}
    if CONFIG_FILE.exists():
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    csv_rows, _ = _csv_rows()
    return {
        "version": VERSION,
        "factor": FACTOR,
        "tables": tables,
        "config_values_to_scale": _config_report(config),
        "model_price_values_to_scale": sum(bool(str(row.get(field) or "").strip()) for row in csv_rows for field in CSV_POINT_FIELDS),
    }


def main():
    parser = argparse.ArgumentParser(description="积分单位迁移：旧值乘以 10 并取整")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", help="--apply 时必须提供已完成的数据库备份文件")
    args = parser.parse_args()
    if args.apply and (not args.backup or not Path(args.backup).is_file()):
        parser.error("--apply 必须通过 --backup 指定已完成的数据库备份文件")

    with get_db() as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
        try:
            conn.execute("""CREATE TABLE IF NOT EXISTS points_unit_migrations (
                id SERIAL PRIMARY KEY, version INTEGER UNIQUE NOT NULL, factor NUMERIC(12,4) NOT NULL,
                dry_run BOOLEAN NOT NULL DEFAULT FALSE, report JSONB NOT NULL DEFAULT '{}'::jsonb,
                applied_at TIMESTAMP DEFAULT NOW())""")
            applied = conn.execute(
                "SELECT 1 FROM points_unit_migrations WHERE version = %s AND dry_run = FALSE", (VERSION,)
            ).fetchone()
            if applied:
                raise SystemExit("积分单位迁移已执行，禁止重复放大")
            before = _report(conn)
            if args.dry_run:
                print(json.dumps({"mode": "dry-run", "before": before}, ensure_ascii=False, indent=2))
                return

            for table, column in DB_FIELDS:
                if _column_exists(conn, table, column):
                    conn.execute(f"UPDATE {table} SET {column} = ROUND({column} * %s)", (FACTOR,))
            conn.execute("""INSERT INTO point_buckets (user_id, bucket_type, granted_points, remaining_points)
                            SELECT id, points, points, points FROM users
                            ON CONFLICT (user_id) WHERE bucket_type = 'permanent' DO NOTHING""")
            config = {}
            if CONFIG_FILE.exists():
                config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
                CONFIG_FILE.write_text(json.dumps(_config_scale(config), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            rows, fields = _csv_rows()
            csv_changes = _scale_csv(rows, fields)
            if rows:
                _write_csv(rows, fields)
            after = _report(conn)
            report = {"before": before, "after": after, "config_scaled": bool(config), "model_price_values_scaled": csv_changes}
            conn.execute(
                "INSERT INTO points_unit_migrations (version, factor, dry_run, report) VALUES (%s, %s, FALSE, %s::jsonb)",
                (VERSION, FACTOR, json.dumps(report, ensure_ascii=False)),
            )
            print(json.dumps({"mode": "apply", **report}, ensure_ascii=False, indent=2))
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))


if __name__ == "__main__":
    main()

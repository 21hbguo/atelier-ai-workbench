#!/bin/bash
# 导出数据库为 SQL 文件，方便 git 追踪
# 用法: ./scripts/export_db.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT="${PROJECT_DIR}/data/db_snapshot.sql"

PGPASSWORD=CHANGE_ME pg_dump -h localhost -U app_user -d app_db \
    --no-owner --no-privileges --clean --if-exists \
    -f "$OUTPUT"

if [ $? -eq 0 ]; then
    SIZE=$(du -h "$OUTPUT" | cut -f1)
    echo "导出成功: data/db_snapshot.sql (${SIZE})"
else
    echo "导出失败"
    exit 1
fi

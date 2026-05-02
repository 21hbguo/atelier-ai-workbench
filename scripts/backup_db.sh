#!/bin/bash
# PostgreSQL 数据库备份脚本
# 用法: ./scripts/backup_db.sh [输出目录]

BACKUP_DIR="${1:-$(dirname "$0")/../data/backups}"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="app_db_${TIMESTAMP}.dump"
OUTPUT="${BACKUP_DIR}/${FILENAME}"

PGPASSWORD=CHANGE_ME pg_dump -h localhost -U app_user -d app_db -Fc -f "$OUTPUT"

if [ $? -eq 0 ]; then
    echo "备份成功: ${OUTPUT} ($(du -h "$OUTPUT" | cut -f1))"
    # 只保留最近 10 个备份
    ls -t "${BACKUP_DIR}"/app_db_*.dump 2>/dev/null | tail -n +11 | xargs -r rm
    echo "已清理旧备份，保留最近 10 份"
else
    echo "备份失败"
    exit 1
fi

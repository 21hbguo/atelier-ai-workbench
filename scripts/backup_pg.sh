#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/data/backups}"
TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT_DIR"
: "${DATABASE_URL:?DATABASE_URL is required}"
pg_dump "$DATABASE_URL" -Fc -f "$OUT_DIR/db_${TS}.dump"
echo "$OUT_DIR/db_${TS}.dump"

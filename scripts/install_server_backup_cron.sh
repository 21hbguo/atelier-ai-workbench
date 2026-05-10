#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log_dir="$project_dir/data/backups"
cron_line="15 3 * * * cd $project_dir && /usr/bin/env bash $project_dir/scripts/server_backup.sh >> $log_dir/backup.log 2>&1"
mkdir -p "$log_dir"
tmp_file="$(mktemp)"
crontab -l 2>/dev/null | grep -Fv "$project_dir/scripts/server_backup.sh" > "$tmp_file" || true
printf '%s\n' "$cron_line" >> "$tmp_file"
crontab "$tmp_file"
rm -f "$tmp_file"
echo "$cron_line"

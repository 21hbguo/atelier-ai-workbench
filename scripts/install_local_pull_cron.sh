#!/usr/bin/env bash
set -euo pipefail
if [ $# -lt 1 ]; then
  echo "usage: $0 user@host [remote_path] [local_dir]" >&2
  exit 1
fi
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote_host="$1"
remote_path="${2:?usage: $0 <remote-host> [remote-backup-path] [local-backup-path]}"
local_dir="${3:-$project_dir/local_backup}"
log_dir="$project_dir/local_backup"
mkdir -p "$log_dir"
cron_line_boot="@reboot sleep 120 && cd $project_dir && /usr/bin/env bash $project_dir/scripts/local_pull_backup.sh '$remote_host' '$remote_path' '$local_dir' >> $log_dir/pull.log 2>&1"
cron_line_loop="25 */6 * * * cd $project_dir && /usr/bin/env bash $project_dir/scripts/local_pull_backup.sh '$remote_host' '$remote_path' '$local_dir' >> $log_dir/pull.log 2>&1"
tmp_file="$(mktemp)"
crontab -l 2>/dev/null | grep -Fv "$project_dir/scripts/local_pull_backup.sh" > "$tmp_file" || true
printf '%s\n' "$cron_line_boot" >> "$tmp_file"
printf '%s\n' "$cron_line_loop" >> "$tmp_file"
crontab "$tmp_file"
rm -f "$tmp_file"
printf '%s\n%s\n' "$cron_line_boot" "$cron_line_loop"

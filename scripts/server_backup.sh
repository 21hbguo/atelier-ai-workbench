#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_root="${BACKUP_ROOT:-$project_dir/data/backups}"
retention_days="${RETENTION_DAYS:-3}"
ts="$(date +%Y%m%d_%H%M%S)"
name="backup_${ts}"
work_dir="$backup_root/.${name}"
final_dir="$backup_root/$name"
paths=()
mkdir -p "$work_dir"
mkdir -p "$backup_root"
cd "$project_dir"
docker compose exec -T db pg_dump -U "${PG_USER:-app_user}" -d "${PG_DB:-app_db}" -Fc > "$work_dir/db.dump"
for path in data/uploads data/images data/thumbs data/evo_images data/evo_thumbs data/config.json data/.jwt_secret; do
  [ -e "$path" ] && paths+=("$path")
done
[ -f .env ] && cp .env "$work_dir/.env"
[ "${#paths[@]}" -gt 0 ] && tar --exclude='prompt_embeddings/model_cache' -czf "$work_dir/data_files.tar.gz" "${paths[@]}"
mv "$work_dir" "$final_dir"
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'backup_*' -mtime +"$((retention_days-1))" -exec rm -rf {} +
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '.backup_*' -mtime +1 -exec rm -rf {} +
echo "$final_dir"

#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote_host="${1:-root@proxy.example.test}"
remote_dir="${2:-PROJECT_ROOT}"
parent_dir="$(dirname "$project_dir")"
project_name="$(basename "$project_dir")"
package_path="$parent_dir/${project_name}_update.tar.gz"
if [ ! -f "$project_dir/Dockerfile" ] || [ ! -f "$project_dir/docker-compose.yml" ]; then
  echo "请在项目根目录运行" >&2
  exit 1
fi
cd "$project_dir"
bash "$project_dir/scripts/server_backup.sh" >/dev/null 2>&1 || true
bash "$project_dir/package-update.sh" --no-data
if [ ! -f "$package_path" ]; then
  echo "没有需要更新的文件"
  exit 0
fi
scp -o StrictHostKeyChecking=no "$package_path" "$remote_host":"$remote_dir/../"
ssh -o StrictHostKeyChecking=no "$remote_host" "cd '$remote_dir' && bash scripts/server_backup.sh >/dev/null 2>&1 || true && if [ -f deploy-update.sh ]; then bash deploy-update.sh; else bash update.sh; fi"
echo "$package_path"

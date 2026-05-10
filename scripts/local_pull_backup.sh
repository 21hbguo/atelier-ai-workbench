#!/usr/bin/env bash
set -euo pipefail
remote_host="${1:-}"
remote_path="${2:-PROJECT_ROOT/data/backups/}"
local_dir="${3:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/local_backup}"
if [ -z "$remote_host" ]; then
  echo "usage: $0 user@host [remote_path] [local_dir]" >&2
  exit 1
fi
mkdir -p "$local_dir"
rsync -az --partial --append-verify "$remote_host:$remote_path" "$local_dir/"

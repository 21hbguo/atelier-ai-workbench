#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
git config core.hooksPath .githooks
echo "[ok] core.hooksPath 已设置为 .githooks"

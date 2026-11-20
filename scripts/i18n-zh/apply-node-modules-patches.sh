#!/usr/bin/env bash
# 重新安装依赖后，重新应用 node_modules 的中文补丁（antd / rc-pagination / design-system）。
set -euo pipefail
cd "$(dirname "$0")/../.."
for p in scripts/i18n-zh/patches/*.patch; do
  if patch -p1 -N -r - --dry-run < "$p" >/dev/null 2>&1; then
    patch -p1 -r - < "$p" >/dev/null
    echo "applied: $p"
  else
    echo "skipped: $p (already applied or version mismatch)"
  fi
done

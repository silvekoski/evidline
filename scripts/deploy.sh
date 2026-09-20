#!/usr/bin/env bash
set -euo pipefail
cd /opt/evidline
git fetch -q origin main
git reset -q --hard origin/main
pnpm install --frozen-lockfile
pnpm --filter @tpm/web build
systemctl restart evidline
sleep 4
systemctl is-active evidline
curl -fsS -o /dev/null http://localhost:8787/
echo "deployed $(git rev-parse --short HEAD)"

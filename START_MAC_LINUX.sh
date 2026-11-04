#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo 'Copy .env.example to .env and replace the placeholder secrets first.'
  exit 1
fi

pnpm install
pnpm infra:up
pnpm db:setup
pnpm --filter "./packages/*" build

echo 'Web http://127.0.0.1:3000  API http://127.0.0.1:3001'
trap 'kill 0' EXIT
pnpm dev:api &
pnpm dev:worker &
pnpm dev:web

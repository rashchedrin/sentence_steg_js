#!/usr/bin/env bash
set -euo pipefail

scriptDirectory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$scriptDirectory"

if [[ ! -d node_modules ]]; then
  npm install
fi

exec npm run dev

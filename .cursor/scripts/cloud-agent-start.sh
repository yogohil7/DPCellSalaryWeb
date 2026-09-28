#!/usr/bin/env bash
set -euo pipefail

# Per-boot hook: ensure node_modules exists after fresh checkout.
if [[ ! -d /workspace/node_modules ]]; then
  bash /workspace/.cursor/scripts/cloud-agent-install.sh
fi

exit 0

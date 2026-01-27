#!/usr/bin/env bash
set -euo pipefail

# Ensure PRESTA_ROOT is provided
if [[ -z "${PRESTA_ROOT:-}" ]]; then
  echo "PRESTA_ROOT not set" >&2
  exit 0
fi

DIR="${PRESTA_ROOT%/}/img/p"
if [[ ! -d "$DIR" ]]; then
  exit 0
fi

# Owner/group www-data (33:33) and mode 775 for dirs and image files
chown -R 33:33 "$DIR" || true
find "$DIR" -type d -print0 | xargs -0 -I {} chmod 775 "{}" || true
find "$DIR" -type f \( -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' \) -print0 | xargs -0 -I {} chmod 775 "{}" || true

exit 0


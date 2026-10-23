#!/usr/bin/env bash
# Geometry Wars 2 for the PlayStation 5 - save the edits made in vendor/geow2 as ps5/patches/geow2.patch.
#
# SPDX-License-Identifier: MIT
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
git -C "$root/vendor/geow2" diff > "$root/ps5/patches/geow2.patch"
echo "ps5/patches/geow2.patch: $(grep -c '^diff --git' "$root/ps5/patches/geow2.patch") files"

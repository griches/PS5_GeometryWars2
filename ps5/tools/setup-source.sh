#!/usr/bin/env bash
# Geometry Wars 2 for the PlayStation 5 - geow2 at its pin, with the console's changes.
#
#   ps5/tools/setup-source.sh        apply ps5/patches/geow2.patch to vendor/geow2
#
# The submodule stays at the commit the port pins; what the console needs on
# top of it is one patch. Edits made in vendor/geow2 are saved into the patch by
# ps5/tools/save-patches.sh; this refuses to build over edits not saved yet.
#
# SPDX-License-Identifier: MIT
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
game="$root/vendor/geow2"
patch="$root/ps5/patches/geow2.patch"
[[ -f $game/CMakeLists.txt ]] || git -C "$root" submodule update --init vendor/geow2
current=$(git -C "$game" diff)
if [[ -z $current ]]; then
    git -C "$game" apply --whitespace=nowarn "$patch"
elif [[ $current != "$(<"$patch")" ]]; then
    echo "setup-source.sh: vendor/geow2 has changes not in ps5/patches/geow2.patch (ps5/tools/save-patches.sh saves them)" >&2
    exit 1
fi

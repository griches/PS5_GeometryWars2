#!/usr/bin/env bash
# Geometry Wars 2 for the PlayStation 5 - SDL3 at the release geow2 pins, patched for the console.
#
#   ps5/tools/setup-sdl.sh       fetch it into .deps/SDL (once a release), print the path
#
# geow2's CMakeLists.txt names its SDL3 release archive (release-3.x.y). The same
# tag is cloned here and ps5/patches/sdl.patch registers the console's video,
# audio and joystick drivers, which live in ps5/sdl/, and builds them when the
# toolchain says PS5.
#
# SPDX-License-Identifier: MIT
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
sdl="$root/.deps/SDL"
tag=$(grep -o 'SDL/releases/download/release-[0-9.]*/' "$root/vendor/geow2/CMakeLists.txt" | sed 's|.*/\(release-[0-9.]*\)/|\1|' | head -1)
[[ -n $tag ]] || { echo "setup-sdl.sh: no SDL3 release in vendor/geow2/CMakeLists.txt" >&2; exit 2; }
patch="$root/ps5/patches/sdl.patch"
stamp="$tag $(sha256sum "$patch" | cut -d' ' -f1)"

if [[ ! -f $sdl/.ps5-sdl || $(<"$sdl/.ps5-sdl") != "$stamp" ]]; then
    {
        if [[ ! -d $sdl/.git ]]; then
            git clone -q --depth 1 -b "$tag" https://github.com/libsdl-org/SDL.git "$sdl"
        elif [[ $(git -C "$sdl" describe --tags --exact-match 2>/dev/null) != "$tag" ]]; then
            git -C "$sdl" fetch -q --depth 1 origin "refs/tags/$tag:refs/tags/$tag"
            git -C "$sdl" checkout -q -f "$tag"
        fi
        git -C "$sdl" checkout -q -f HEAD -- .
        git -C "$sdl" apply --whitespace=nowarn "$patch"
    } >&2
    echo "$stamp" > "$sdl/.ps5-sdl"
fi
echo "$sdl"

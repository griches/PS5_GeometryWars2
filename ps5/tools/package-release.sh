#!/usr/bin/env bash
# Geometry Wars 2 for the PlayStation 5 - zip dist/PPSA99322/ as a ready-made release.
#
#   ps5/tools/package-release.sh VERSION    -> dist/GeometryWars2-PS5-<VERSION>.zip
#
# The title as it is on the console, with an empty dump/ where the player puts
# their own Xbox Live Arcade package; the first start makes the game's data
# from it (ps5/src/startup.c). Nothing from the package or a player goes in:
# this checks that before zipping. Package after committing: SOURCE.txt names
# the commit the build came from.
#
# SPDX-License-Identifier: MIT
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
version=${1:?usage: package-release.sh VERSION (e.g. 1.0.0)}
title=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["titleId"])' "$root/ps5/sce_sys/param.json")
dist="$root/dist/$title"
[[ -f $dist/eboot.bin ]] || { echo "package-release.sh: build first (no $dist/eboot.bin)" >&2; exit 2; }
[[ -z $(git -C "$root" status --porcelain --ignore-submodules=dirty) ]] ||
    { echo "package-release.sh: commit first (the tree has changes)" >&2; exit 2; }

found=$(find "$dist" \( -name data -o -name dump -o -name userdata -o -name cache -o -name radv-shader-cache \
    -o -name 'Data.bin' -o -name '*.xex' -o -name '*.wav' -o -name env.txt -o -name args.txt \) -print)
[[ -z $found ]] || { echo "package-release.sh: game or player files in $dist:" >&2; echo "$found" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$dist" "$work/$title"
mkdir -p "$work/$title/dump"
cat > "$work/$title/dump/PUT YOUR GAME HERE.txt" <<'TXT'
Put your own copy of Geometry Wars: Retro Evolved 2 for Xbox Live Arcade in
this folder: the one file with a long hexadecimal name and no extension from
584108FF/000D0000/ (about 42 MB), or the whole 584108FF folder. Then start the
game. The first start checks it and makes the game's data from it (about half
a minute, once), and the game starts again by itself. After that you can
delete it.
TXT
cat > "$work/$title/SOURCE.txt" <<TXT
Geometry Wars 2 for PlayStation 5 $version
Source: https://github.com/griches/PS5_GeometryWars2 (commit $(git -C "$root" rev-parse --short HEAD))
Built on geow2 by Derek Quenneville: https://github.com/techknight/geow2
Licences: licenses/
TXT
zip_path="$root/dist/GeometryWars2-PS5-$version.zip"
rm -f "$zip_path"
(cd "$work" && COPYFILE_DISABLE=1 zip -q -r -X "$zip_path" "$title")
echo "$zip_path ($(du -h "$zip_path" | cut -f1), sha256 $(shasum -a 256 "$zip_path" | cut -d' ' -f1))"

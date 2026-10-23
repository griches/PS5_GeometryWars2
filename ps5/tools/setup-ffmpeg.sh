#!/usr/bin/env bash
# Geometry Wars 2 for the PlayStation 5 - FFmpeg's XMA1 decoder for the console.
#
#   ps5/tools/setup-ffmpeg.sh        build it into .deps/ffmpeg-ps5 (once a release), print the path
#
# geow2's extractor turns the package's XMA1 sound banks into PCM with the
# ffmpeg program; a title cannot run one, so the console's build decodes them
# itself (ps5/src/xma.cpp) with FFmpeg's libraries: the WAV demuxer and the
# XMA1 decoder, nothing else, built with the payload SDK.
#
# SPDX-License-Identifier: MIT
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
tag=n7.1.5
src="$root/.deps/ffmpeg"
out="$root/.deps/ffmpeg-ps5"
work=${PS5_FFMPEG_BUILD_DIR:-$HOME/ps5/build/PS5_GeometryWars2-ffmpeg}
sdk=$(bash "$root/ps5/tools/setup-sdk.sh")
stamp="$tag $(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)"

if [[ ! -f $out/.stamp || $(<"$out/.stamp") != "$stamp" ]]; then
    {
        if [[ ! -d $src/.git ]]; then
            git clone -q --depth 1 -b "$tag" https://git.ffmpeg.org/ffmpeg.git "$src"
        fi
        rm -rf "$work" "$out"
        mkdir -p "$work"
        cd "$work"
        "$src/configure" --prefix="$out" --enable-cross-compile --arch=x86_64 --target-os=freebsd \
            --cc="$sdk/bin/prospero-clang" --cxx="$sdk/bin/prospero-clang++" --ar="$sdk/bin/prospero-ar" \
            --ranlib="$sdk/bin/prospero-ranlib" --nm="$sdk/bin/prospero-nm" --pkg-config=false \
            --extra-cflags="-march=znver2 -fPIC" \
            --enable-static --disable-shared --enable-pic \
            --disable-everything --disable-programs --disable-doc --disable-network --disable-autodetect \
            --disable-x86asm --disable-pthreads --disable-debug \
            --disable-avdevice --disable-avfilter --disable-swscale --disable-swresample --disable-postproc \
            --enable-decoder=xma1 --enable-demuxer=wav --enable-protocol=file > configure.log 2>&1 ||
            { tail -30 configure.log; exit 1; }
        make -j"$(nproc)" > make.log 2>&1 || { grep -E "error" make.log | head -20; exit 1; }
        make install > install.log 2>&1
        cp "$src/COPYING.LGPLv2.1" "$out/LICENSE.txt"
        echo "$stamp" > "$out/.stamp"
    } >&2
fi
echo "$out"

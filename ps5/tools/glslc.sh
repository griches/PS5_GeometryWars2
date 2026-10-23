#!/bin/sh
# Geometry Wars 2 for the PlayStation 5 - glslc's command line on glslang's validator.
#
#   glslc.sh SHADER -o OUTPUT
#
# geow2's build compiles each shader with the Vulkan SDK's glslc; the Linux VM
# has glslang's validator, which gives the same SPIR-V for these (Vulkan 1.0,
# the stage from the file's suffix, #include beside the file).
#
# SPDX-License-Identifier: MIT
set -eu
[ "$#" -eq 3 ] && [ "$2" = "-o" ] || { echo "usage: glslc.sh SHADER -o OUTPUT" >&2; exit 2; }
exec glslangValidator -V --quiet "$1" -o "$3"

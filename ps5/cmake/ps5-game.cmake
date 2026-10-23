# Geometry Wars 2 for the PlayStation 5 - what the console adds to geow2's own build.
#
# tools/build.sh configures vendor/geow2 itself with the payload SDK's
# toolchain, and names this file as CMAKE_PROJECT_geow2_INCLUDE: CMake includes
# it right after geow2's project() call, before geow2 fetches SDL3. It provides:
#
#   SDL3    .deps/SDL, patched (tools/setup-sdl.sh), with the drivers in ps5/sdl;
#           its GPU API (geow2's renderer) on Vulkan, which is RADV
#   glslc   tools/glslc.sh: glslang's validator, for the SPIR-V shaders
#   FFmpeg  .deps/ffmpeg-ps5 (tools/setup-ffmpeg.sh): the XMA1 decoder for the
#           first start's setup (ps5/src/xma.cpp)
#
# and makes the executable's link PS5_Vulkan's (tools/link-title.sh, with RADV).
#
# SPDX-License-Identifier: GPL-3.0-or-later

foreach(required PS5_PORT_DIR PS5_VULKAN_DIR SDL_DIR)
	if(NOT ${required})
		message(FATAL_ERROR "ps5-game.cmake: ${required} is not set (use ps5/tools/build.sh)")
	endif()
endforeach()
set(ps5 ${PS5_PORT_DIR}/ps5)

# -fno-omit-frame-pointer: the console's crash backtraces are frame-pointer walks.
add_compile_options(-g1 -ffunction-sections -fdata-sections -fno-omit-frame-pointer)
# An init array, in the order the source has: tools/cc-init-array.sh has the reason
set(CMAKE_C_COMPILER_LAUNCHER sh ${ps5}/tools/cc-init-array.sh)
set(CMAKE_CXX_COMPILER_LAUNCHER sh ${ps5}/tools/cc-init-array.sh)
# geow2 has no C++ modules, and the SDK no clang-scan-deps for CMake to look for them with
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)
# The game is tuned for the console's CPU, not baseline x86-64 (geow2's
# -ffp-contract=off still keeps every a * b + c as the original rounds it)
add_compile_options(-march=znver2)

# The console: klog, the pad, the title's exit, and the libc names a title cannot import
enable_language(C)
add_library(ps5_platform STATIC ${ps5}/src/platform.c ${ps5}/src/shims.c ${ps5}/src/startup.c ${ps5}/src/http_ps5.c
	${ps5}/src/paths.c)
target_include_directories(ps5_platform PUBLIC ${ps5}/src)
target_include_directories(ps5_platform PRIVATE ${SDL_DIR}/include)
file(READ ${ps5}/sce_sys/param.json param_json)
string(JSON PS5_TITLE_NAME GET "${param_json}" localizedParameters en-US titleName)
string(JSON PS5_TITLE_ID GET "${param_json}" titleId)
target_compile_definitions(ps5_platform PRIVATE "PS5_TITLE_NAME=\"${PS5_TITLE_NAME}\"" "PS5_TITLE_ID=\"${PS5_TITLE_ID}\"")
set_target_properties(ps5_platform PROPERTIES ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
# By its file, not its target: it is linked whole into the title (below)
set(ps5_platform_archive ${CMAKE_BINARY_DIR}/libps5_platform.a)

# SDL3: threads, time and files as a FreeBSD has them; video, audio and the pad
# from ps5/sdl. geow2 fetches it (FetchContent): this is the source it gets.
set(FETCHCONTENT_SOURCE_DIR_SDL3 ${SDL_DIR} CACHE PATH "" FORCE)
set(SDL_PS5_PORT_DIR ${ps5}/sdl CACHE INTERNAL "")
set(SDL_PS5_PLATFORM_DIR ${ps5}/src CACHE INTERNAL "")
# no X11 and no Wayland, on purpose
set(SDL_UNIX_CONSOLE_BUILD ON CACHE BOOL "" FORCE)
set(SDL_GPU ON CACHE BOOL "" FORCE)
foreach(off SDL_TEST_LIBRARY SDL_TESTS SDL_EXAMPLES SDL_INSTALL
		SDL_X11 SDL_WAYLAND SDL_KMSDRM SDL_RPI SDL_ROCKCHIP SDL_VIVANTE SDL_OFFSCREEN SDL_DUMMYVIDEO
		SDL_OPENGL SDL_OPENGLES SDL_VULKAN SDL_RENDER_VULKAN SDL_RENDER_GPU SDL_CAMERA SDL_OPENVR
		SDL_OSS SDL_ALSA SDL_JACK SDL_PIPEWIRE SDL_PULSEAUDIO SDL_SNDIO SDL_DISKAUDIO SDL_DUMMYAUDIO
		SDL_DBUS SDL_IBUS SDL_LIBURING SDL_LIBUDEV SDL_HIDAPI SDL_HIDAPI_LIBUSB SDL_VIRTUAL_JOYSTICK
		SDL_DLOPEN_NOTES SDL_DEPS_SHARED SDL_ASSEMBLY_UNUSED)
	set(${off} OFF CACHE BOOL "" FORCE)
endforeach()
# (SDL_VULKAN is SDL's switch for a desktop's loader: ps5/patches/sdl.patch turns
# Vulkan on for the console itself, and SDL_GPU then builds its Vulkan backend)

# The extractor's XMA1 waves, decoded in the title (ps5/src/xma.cpp) with
# FFmpeg's libraries (tools/setup-ffmpeg.sh)
if(NOT FFMPEG_DIR)
	set(FFMPEG_DIR ${PS5_PORT_DIR}/.deps/ffmpeg-ps5)
endif()
add_library(ps5_xma STATIC ${ps5}/src/xma.cpp)
target_include_directories(ps5_xma PRIVATE ${FFMPEG_DIR}/include)
target_compile_features(ps5_xma PRIVATE cxx_std_20)
target_link_libraries(ps5_xma PUBLIC ${FFMPEG_DIR}/lib/libavformat.a ${FFMPEG_DIR}/lib/libavcodec.a
	${FFMPEG_DIR}/lib/libavutil.a)

# The shaders: geow2 asks for the Vulkan SDK's glslc
set(GLSLC ${ps5}/tools/glslc.sh CACHE FILEPATH "" FORCE)

# The link: every object and archive CMake would hand the linker goes to
# PS5_Vulkan's recipe instead (RADV, the platform layer, the CRT, the fake SELF)
set(CMAKE_CXX_LINK_EXECUTABLE
	"bash ${ps5}/tools/link-title.sh ${CMAKE_BINARY_DIR} ${PS5_VULKAN_DIR} ${PS5_PAYLOAD_SDK} <OBJECTS> --whole-archive ${ps5_platform_archive} --no-whole-archive <LINK_LIBRARIES>")
# (the start-up constructor in the platform archive has no caller: hence whole)

# The platform archive is named by its file in the link, so the game does not
# depend on it by itself (the game's target exists once its CMakeLists.txt has run)
function(ps5_late_fixes)
	add_dependencies(geow2 ps5_platform)
	target_link_libraries(geow2 PRIVATE ps5_xma)
	set_property(TARGET geow2 APPEND PROPERTY LINK_DEPENDS ${ps5_platform_archive})
endfunction()
cmake_language(DEFER DIRECTORY ${CMAKE_SOURCE_DIR} CALL ps5_late_fixes)

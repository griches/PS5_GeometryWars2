/*
 * Geometry Wars 2 for the PlayStation 5 - what runs before the game's main.
 *
 * The game's main is geow2's, so the console's start-up is a constructor:
 * standard error into klog and the shell's splash dismissed, where geow2 keeps
 * its profile (settings, unlocks, scores, achievements), and test options from
 * env.txt and args.txt. The CRT's call to main comes through __wrap_main, which
 * names the game's data folder (geow2's --data). On a first start there is
 * none: the player's own package (the LIVE file of the Xbox Live Arcade
 * release) in dump/ goes to geow2's setup screen (--setup-from), which makes
 * the folder from it; with no package there either, a notification says where
 * it goes.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <dirent.h>
#include <errno.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include <SDL3/SDL_stdinc.h>
#include <ps5platform/memory.h>

#include "platform.h"

#define TITLE_DIR "/app0"
#define USER_DIR TITLE_DIR "/userdata"
#define CACHE_DIR TITLE_DIR "/cache"
/* What geow2's extractor makes from the player's Xbox Live Arcade package */
#define DATA_DIR TITLE_DIR "/data"
/* Where the player puts the package */
#define DUMP_DIR TITLE_DIR "/dump"

int sceKernelSendNotificationRequest(int device, void *request, size_t size, int blocking);

/* The console's own notification: it stays on the home screen after the title has gone */
static void
notify(const char *text)
{
   static struct {
      char unused[45];
      char message[3075];
   } request;

   snprintf(request.message, sizeof(request.message), "%s", text);
   sceKernelSendNotificationRequest(0, &request, sizeof(request), 0);
}

/* /app0/env.txt: KEY=VALUE lines for a test run, since the console starts a
 * title with no arguments or environment. Set for the C library's getenv and in
 * SDL's copy of the environment. */
static void
set_variable(const char *name, const char *value)
{
   setenv(name, value, 1);
   SDL_SetEnvironmentVariable(SDL_GetEnvironment(), name, value, true);
}

static void
load_env_file(void)
{
   char line[1024];
   FILE *file = fopen(TITLE_DIR "/env.txt", "r");

   if (file == NULL)
      return;
   while (fgets(line, sizeof(line), file) != NULL) {
      char *equals, *end = line + strcspn(line, "\r\n");

      *end = '\0';
      if (line[0] == '#' || (equals = strchr(line, '=')) == NULL || equals == line)
         continue;
      *equals = '\0';
      set_variable(line, equals + 1);
      fprintf(stderr, "env.txt: %s=%s\n", line, equals + 1);
   }
   fclose(file);
}

/* The player's package: a file in dump/ (or in folders under it, as the
 * console's 584108FF/000D0000 copies them) that starts as an Xbox 360 content
 * package does (LIVE, PIRS or CON). geow2's extractor checks the rest. */
static bool
find_package(const char *folder, char *path, size_t size, int depth)
{
   struct dirent *entry;
   bool found = false;
   DIR *dir = opendir(folder);

   if (dir == NULL)
      return false;
   while (!found && (entry = readdir(dir)) != NULL) {
      char child[1024], magic[4];
      struct stat status;
      FILE *file;

      if (entry->d_name[0] == '.')
         continue;
      snprintf(child, sizeof(child), "%s/%s", folder, entry->d_name);
      if (stat(child, &status) != 0)
         continue;
      if (S_ISDIR(status.st_mode)) {
         found = depth < 4 && find_package(child, path, size, depth + 1);
      } else if ((file = fopen(child, "rb")) != NULL) {
         if (fread(magic, 1, 4, file) == 4 &&
             (memcmp(magic, "LIVE", 4) == 0 || memcmp(magic, "PIRS", 4) == 0 || memcmp(magic, "CON ", 4) == 0)) {
            snprintf(path, size, "%s", child);
            found = true;
         }
         fclose(file);
      }
   }
   closedir(dir);
   return found;
}

/* The CRT's call to main (--wrap=main, ps5/tools/link-title.sh): geow2's main
 * gets --data (and --setup-from on a first start), then one argument a line
 * from /app0/args.txt for a test run (--720p, --perf, ...), then any argument
 * the console passed */
int __real_main(int argc, char **argv, char **envp);

int
__wrap_main(int argc, char **argv, char **envp)
{
   static char data_flag[] = "--data", data[] = DATA_DIR, setup_flag[] = "--setup-from";
   static char package[1024];
   static char lines[48][256];
   char *args[64];
   int count = 0;
   struct stat status;

   args[count++] = argc > 0 ? argv[0] : "eboot.bin";
   args[count++] = data_flag;
   args[count++] = data;
   if (stat(DATA_DIR "/files/Data.bin", &status) != 0) {
      mkdir(DUMP_DIR, 0777);
      if (!find_package(DUMP_DIR, package, sizeof(package), 0)) {
         fprintf(stderr, "no game data in " DATA_DIR " and no package in " DUMP_DIR "\n");
         notify("Geometry Wars 2: copy your own Xbox Live Arcade copy of Geometry Wars: Retro Evolved 2 "
                "(the LIVE file in 584108FF/000D0000/) into /data/homebrew/" PS5_TITLE_ID "/dump/, "
                "then start again.");
         sleep(2);
         return 1;
      }
      fprintf(stderr, "first start: making " DATA_DIR " from %s\n", package);
      args[count++] = setup_flag;
      args[count++] = package;
   }
   FILE *file = fopen(TITLE_DIR "/args.txt", "r");
   for (int i = 0; file != NULL && i < 48 && fgets(lines[i], sizeof(lines[i]), file) != NULL; i++) {
      lines[i][strcspn(lines[i], "\r\n")] = '\0';
      if (lines[i][0] == '\0' || lines[i][0] == '#')
         continue;
      fprintf(stderr, "args.txt: %s\n", lines[i]);
      args[count++] = lines[i];
   }
   if (file != NULL)
      fclose(file);
   for (int i = 1; i < argc && count < 63; i++)
      args[count++] = argv[i];
   args[count] = NULL;
   return __real_main(count, args, envp);
}

/* After the first start's setup (geow2's main, ps5/patches/geow2.patch): the
 * game's own swap chain does not come up in a process whose setup screen had
 * one (RADV's VideoOut is the process's), so the title starts again, now with
 * its data. If the console will not, the player is told to start it again. */
int sceSystemServiceLoadExec(const char *path, const char *const *argv);
void catchReturnFromMain(int status); /* ps5/src/platform.c: the shell closes the title */

void
ps5_restart_title(void)
{
   say("setup done: starting the title again");
   fflush(NULL);
   const int result = sceSystemServiceLoadExec("/app0/eboot.bin", NULL);
   say("setup done: the console would not start the title again (0x%08x)", (unsigned)result);
   notify("Geometry Wars 2 is set up from your copy of the game. Start it again to play.");
   sleep(2);
   catchReturnFromMain(0);
}

/* A watchdog: the title's memory every two seconds into klog when it moves by
 * 64 MiB, and an end to the title before the console itself runs short
 * (GW_PS5_MEMORY_FLOOR_MB of direct memory left, default 1024; 96 MiB of
 * flexible memory). A first run of a new port once took the console's memory
 * with it and needed a restart. */
static void *
memory_guard(void *unused)
{
   const char *floor_text = getenv("GW_PS5_MEMORY_FLOOR_MB");
   const uint64_t floor = (floor_text ? strtoull(floor_text, NULL, 10) : 1024u) << 20;
   uint64_t last = 0;

   (void)unused;
   for (;;) {
      struct ps5_memory_stats memory;
      if (ps5_memory_query(&memory)) {
         const uint64_t used = memory.total_bytes - memory.free_bytes;
         if (last == 0 || used > last + (64u << 20) || used + (64u << 20) < last) {
            say("[memory] direct free %llu MiB of %llu, flexible %llu MiB",
                (unsigned long long)(memory.free_bytes >> 20),
                (unsigned long long)(memory.total_bytes >> 20),
                (unsigned long long)(memory.flexible_bytes >> 20));
            last = used;
         }
         if (memory.flexible_bytes != 0 && memory.flexible_bytes < (96u << 20)) {
            say("[memory] guard: only %llu MiB of flexible memory left, ending the title",
                (unsigned long long)(memory.flexible_bytes >> 20));
            _exit(71);
         }
         if (memory.free_bytes < floor) {
            say("[memory] guard: only %llu MiB of direct memory left, ending the title",
                (unsigned long long)(memory.free_bytes >> 20));
            _exit(70);
         }
      }
      sleep(2);
   }
   return NULL;
}

__attribute__((constructor)) static void
ps5_startup(void)
{
   platform_init(PS5_TITLE_NAME);
   mkdir(USER_DIR, 0777);
   mkdir(CACHE_DIR, 0777);
   /* geow2 keeps its profile in SDL_GetPrefPath("geow2", "geow2"), which is
    * $XDG_DATA_HOME/geow2/geow2 here, and the driver its shader cache in
    * $XDG_CACHE_HOME. A title sees its own folder (/app0, which is
    * /data/homebrew/<TITLE_ID>) and nothing else of /data, so that is where they
    * go. Set for the C library's getenv and in SDL's own copy of the
    * environment: the console's libc keeps what setenv sets apart from the
    * `environ` SDL copies. */
   set_variable("HOME", USER_DIR);
   set_variable("XDG_CONFIG_HOME", USER_DIR);
   set_variable("XDG_DATA_HOME", USER_DIR);
   set_variable("XDG_CACHE_HOME", CACHE_DIR);
   load_env_file();

   pthread_t guard;
   if (pthread_create(&guard, NULL, memory_guard, NULL) == 0)
      pthread_detach(guard);
}

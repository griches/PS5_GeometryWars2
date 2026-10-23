/*
 * Geometry Wars 2 for the PlayStation 5 - HTTPS for the online scores, through the console's libSceHttp.
 *
 * geow2's http_request (vendor/geow2/src/net/http.cpp) uses WinHTTP or a
 * libcurl it loads; the console has neither, so its build calls
 * ps5_http_request here. The console's network, TLS and HTTP modules are
 * loaded from the sandbox's own name for /system (as PS5_DevilutionX loads the
 * mouse's) and called through the SDK's stubs.
 *
 * Certificates: as Art Swap's helper found on firmware 13.60, a process may
 * not get the console's list of trusted roots, and every HTTPS request then
 * fails "not a known CA" (verify error 0x20). The certificate callback
 * accepts that one result and nothing else: the library still checks the
 * name and the dates, and any other failure is refused.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "platform.h"

int sceKernelLoadStartModule(const char *name, size_t argc, const void *argv, uint32_t flags, const void *option,
                             int *result);
const char *sceKernelGetFsSandboxRandomWord(void);

int sceNetInit(void);
int sceNetPoolCreate(const char *name, int size, int flags);
int sceSslInit(size_t pool);
int sceHttpInit(int net_pool, int ssl_context, size_t pool);
int sceHttpCreateTemplate(int context, const char *user_agent, int http_version, int auto_proxy);
int sceHttpCreateConnectionWithURL(int template_id, const char *url, int keep_alive);
int sceHttpCreateRequestWithURL(int connection, int method, const char *url, uint64_t content_length);
int sceHttpAddRequestHeader(int id, const char *name, const char *value, uint32_t mode);
int sceHttpSendRequest(int request, const void *data, size_t size);
int sceHttpGetStatusCode(int request, int *status);
int sceHttpReadData(int request, void *data, size_t size);
int sceHttpDeleteRequest(int request);
int sceHttpDeleteConnection(int connection);
int sceHttpSetConnectTimeOut(int id, uint32_t microseconds);
int sceHttpSetRecvTimeOut(int id, uint32_t microseconds);
int sceHttpsSetSslCallback(int id, int (*callback)(int, unsigned int, void *const *, int, void *), void *user);
int sceHttpsGetSslError(int id, int *error, uint32_t *detail);

#define METHOD_GET 0
#define METHOD_POST 1
#define HEADER_REPLACE 0
/* the callback's verify error that means "the root is not in the list this process has" */
#define VERIFY_UNKNOWN_CA 0x20u
/* the answers are a score server's JSON: a sync is well under a megabyte */
#define MAX_BODY (8u << 20)

static pthread_once_t once = PTHREAD_ONCE_INIT;
static int http_template = -1;
static char init_error[160];

static int
check_certificate(int ssl_context, unsigned int verify, void *const *certificates, int count, void *user)
{
   (void)ssl_context;
   (void)certificates;
   (void)user;
   if (verify != 0 && (verify & ~VERIFY_UNKNOWN_CA) != 0) {
      say("http: TLS refused: verify error 0x%08x, %d certificates", verify, count);
      return -1;
   }
   return 0;
}

/* One of the console's libraries, from the sandbox's own name for /system */
static void
load_module(const char *name)
{
   const char *word = sceKernelGetFsSandboxRandomWord();
   char path[128];
   snprintf(path, sizeof(path), "/%s/common/lib/%s", word != NULL ? word : "system", name);
   const int module = sceKernelLoadStartModule(path, 0, NULL, 0, NULL, NULL);
   if (module < 0)
      say("http: %s gave 0x%08x", path, (unsigned)module);
}

static void
start(void)
{
   load_module("libSceNet.sprx");
   load_module("libSceSsl.sprx");
   load_module("libSceHttp.sprx");
   const int net = sceNetInit();
   const int pool = sceNetPoolCreate("geow2", 256 * 1024, 0);
   const int ssl = sceSslInit(512 * 1024);
   const int http = pool >= 0 && ssl >= 0 ? sceHttpInit(pool, ssl, 512 * 1024) : -1;
   http_template = http >= 0 ? sceHttpCreateTemplate(http, "geow2-ps5", 2 /* HTTP/1.1 */, 1 /* system proxy */) : -1;
   const int callback = http_template >= 0 ? sceHttpsSetSslCallback(http_template, check_certificate, NULL) : -1;
   say("http: sceNetInit 0x%08x, pool %d, TLS %d, HTTP %d, template %d, certificate callback 0x%08x",
       (unsigned)net, pool, ssl, http, http_template, (unsigned)callback);
   if (http_template < 0 || callback < 0) {
      snprintf(init_error, sizeof(init_error), "the console's network could not be set up (0x%08x, 0x%08x, 0x%08x)",
               (unsigned)pool, (unsigned)ssl, (unsigned)http);
      http_template = -1;
   }
}

/* A request: GET when body is NULL, else POST of JSON. 0 with the status and
 * the answer (malloc'd, the caller frees it), or -1 and why in err. */
int
ps5_http_request(const char *url, const char *body, size_t body_size, const char *bearer, int timeout_seconds,
                 int *status, char **answer, size_t *answer_size, char *err, size_t err_size)
{
   *status = 0;
   *answer = NULL;
   *answer_size = 0;
   pthread_once(&once, start);
   if (http_template < 0) {
      snprintf(err, err_size, "%s", init_error);
      return -1;
   }
   const int connection = sceHttpCreateConnectionWithURL(http_template, url, 1);
   if (connection < 0) {
      snprintf(err, err_size, "the address was refused (0x%08x)", (unsigned)connection);
      return -1;
   }
   int result = -1;
   const int request =
      sceHttpCreateRequestWithURL(connection, body != NULL ? METHOD_POST : METHOD_GET, url, body != NULL ? body_size : 0);
   if (request < 0) {
      snprintf(err, err_size, "the request could not be made (0x%08x)", (unsigned)request);
      goto close_connection;
   }
   const uint32_t timeout = (uint32_t)(timeout_seconds > 0 ? timeout_seconds : 20) * 1000000u;
   sceHttpSetConnectTimeOut(request, timeout);
   sceHttpSetRecvTimeOut(request, timeout);
   sceHttpAddRequestHeader(request, "Accept", "application/json", HEADER_REPLACE);
   if (body != NULL)
      sceHttpAddRequestHeader(request, "Content-Type", "application/json", HEADER_REPLACE);
   if (bearer != NULL && bearer[0] != '\0') {
      char value[256];
      snprintf(value, sizeof(value), "Bearer %s", bearer);
      sceHttpAddRequestHeader(request, "Authorization", value, HEADER_REPLACE);
   }
   int rc = sceHttpSendRequest(request, body, body != NULL ? body_size : 0);
   if (rc < 0) {
      int ssl_error = 0;
      uint32_t detail = 0;
      if (sceHttpsGetSslError(request, &ssl_error, &detail) == 0 && ssl_error != 0)
         snprintf(err, err_size, "no answer (0x%08x, TLS 0x%08x/0x%x)", (unsigned)rc, (unsigned)ssl_error, detail);
      else
         snprintf(err, err_size, "no answer (0x%08x)", (unsigned)rc);
      goto close_request;
   }
   if ((rc = sceHttpGetStatusCode(request, status)) < 0) {
      snprintf(err, err_size, "no status (0x%08x)", (unsigned)rc);
      goto close_request;
   }
   size_t capacity = 0, size = 0;
   char *data = NULL;
   for (;;) {
      if (capacity - size < 16384) {
         if (capacity >= MAX_BODY) {
            snprintf(err, err_size, "the server's answer was too large");
            free(data);
            goto close_request;
         }
         capacity = capacity ? capacity * 2 : 65536;
         char *grown = realloc(data, capacity + 1);
         if (grown == NULL) {
            snprintf(err, err_size, "out of memory");
            free(data);
            goto close_request;
         }
         data = grown;
      }
      const int got = sceHttpReadData(request, data + size, capacity - size);
      if (got < 0) {
         snprintf(err, err_size, "the answer broke off (0x%08x)", (unsigned)got);
         free(data);
         goto close_request;
      }
      if (got == 0)
         break;
      size += (size_t)got;
   }
   if (data != NULL)
      data[size] = '\0';
   *answer = data;
   *answer_size = size;
   result = 0;
close_request:
   sceHttpDeleteRequest(request);
close_connection:
   sceHttpDeleteConnection(connection);
   return result;
}

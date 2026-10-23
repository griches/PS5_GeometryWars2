// geow2-scores: a score server for a group of geow2 players. The game
// pairs each device to a player (a code shown in the game, confirmed on
// a signed-in phone or browser), then syncs its games, unlocks and achievements and
// gets the group's boards back. See README.md.

import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as pages from "./pages";
import * as store from "./store";
import type { Env, Progress, ScoreEvent } from "./store";
import { checkName, cleanDeviceName, normalizeCode, sameSecret, sha256 } from "./util";

const app = new Hono<{ Bindings: Env }>();
const COOKIE = "geow2scores";
const API_VERSION = 1;

const group = (c: Context<{ Bindings: Env }>) => c.env.GROUP_NAME?.trim() || "geow2 scores";
const csrfFor = async (token: string) => (await sha256(`${token}:csrf`)).slice(0, 32);

async function session(c: Context<{ Bindings: Env }>) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const s = await store.getSession(c.env.DB, token);
  return s ? { ...s, token, csrf: await csrfFor(token) } : null;
}

function startSession(c: Context<{ Bindings: Env }>, token: string, admin: boolean) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: (admin ? 7 : store.SESSION_DAYS) * 86400,
  });
}

// Every response: never cached (pages carry codes, QR codes and form
// tokens), never framed, no referrer to other sites (codes travel in URLs;
// "same-origin" rather than "no-referrer", under which browsers send
// "Origin: null" with the pages' own forms), and only the pages' own
// script. Forms are posted only from this server's pages: a POST from
// another site (signing a visitor's browser in with someone else's invite,
// say) is refused. The game's API sends no Origin.
app.use("*", async (c, next) => {
  if (c.req.method === "POST" && !c.req.path.startsWith("/api/")) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.text("Forbidden", 403);
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", pages.CSP);
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
});

// A form posted by a page of ours: its csrf field matches the session's.
async function form(c: Context<{ Bindings: Env }>, s: { csrf: string } | null) {
  const body = await c.req.parseBody();
  const ok = !!s && typeof body.csrf === "string" && sameSecret(body.csrf, s.csrf);
  return { body, ok };
}

// --- The game's API ----------------------------------------------------------

app.get("/api/info", (c) => c.json({ server: "geow2-scores", version: API_VERSION, name: group(c) }));

app.post("/api/pair/start", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { code, poll, expires } = await store.startPairing(c.env.DB, cleanDeviceName(body.device_name));
  const origin = new URL(c.req.url).origin;
  return c.json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, url: `${origin}/pair/${code}`, poll, expires });
});

app.post("/api/pair/poll", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.poll !== "string") return c.json({ error: "poll token missing" }, 400);
  return c.json(await store.pollPairing(c.env.DB, body.poll));
});

// Games taken from one sync. The game sends at most 200 at a time; earlier
// versions sent everything unsent at once.
const MAX_EVENTS = 5000;

const int = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

function readEvent(v: any): ScoreEvent | null {
  if (!v || typeof v.id !== "string" || !/^[0-9a-f]{32}$/.test(v.id)) return null;
  const mode = int(v.mode, 0, 5), score = int(v.score, 1, Number.MAX_SAFE_INTEGER);
  const multiplier = int(v.multiplier, 0, 1_000_000), time = int(v.time, 0, 1e11);
  if (mode === null || score === null || multiplier === null || time === null) return null;
  const device = typeof v.device === "string" ? v.device.slice(0, 64) : "";
  const name = typeof v.name === "string" ? v.name.replace(/[\u0000-\u001f]/g, " ").slice(0, 64) : "";
  return { id: v.id, mode, score, multiplier, time, device, name };
}

function readProgress(v: any): Progress {
  const bits = (x: unknown) => int(x, 0, 0xffffffff) ?? 0;
  const p = Array.isArray(v?.progress) ? v.progress : [];
  return {
    unlocked: bits(v?.unlocked),
    millions: bits(v?.millions),
    progress: [0, 1, 2, 3, 4, 5].map((i) => int(p[i], 0, 400) ?? 0),
    achievements: bits(v?.achievements),
  };
}

// The device's new games and progress in; everything the player has from
// other devices since `since`, the merged progress and the group's boards out.
// `taken` says how many of the games sent were dealt with (stored, already
// there, or refused as malformed), so the device sends the rest next time.
app.post("/api/sync", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const device = token ? await store.deviceFor(c.env.DB, token) : null;
  if (!device) return c.json({ error: "This device is not paired (or was unpaired). Pair it again." }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "bad request" }, 400);
  const sent: unknown[] = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const events = sent.map(readEvent).filter((e): e is ScoreEvent => e !== null);
  await store.addEvents(c.env.DB, device.player, events);
  const progress = await store.mergeProgress(c.env.DB, device.player, readProgress(body.progress));
  const since = int(body.since, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const theirs = await store.eventsSince(c.env.DB, device.player, since);
  return c.json({
    group: group(c),
    taken: sent.length,
    player: { id: device.player, name: device.name },
    events: theirs.map(({ seq, ...e }) => e),
    cursor: theirs.length ? theirs[theirs.length - 1].seq : since,
    more: theirs.length >= 1000,
    progress,
    boards: await store.boards(c.env.DB),
  });
});

// --- Pages for players -------------------------------------------------------

// The public board (the PS5 port's server): everyone's best per mode, and how
// to join from the game.
app.get("/", async (c) => {
  const s = await session(c);
  return c.html(pages.publicHome(group(c), await store.boards(c.env.DB, 20), !!s?.player));
});

app.get("/invite/:code", async (c) => {
  const s = await session(c);
  if (s?.player) {
    const p = await store.getPlayer(c.env.DB, s.player);
    if (p) return c.html(pages.message(group(c), "You're already in", `This browser is signed in as <b>${pages.esc(p.name)}</b>.`, `<p><a href="/me">Your page</a></p>`));
  }
  const inv = await store.getInvite(c.env.DB, normalizeCode(c.req.param("code")));
  if (!inv || inv.player || inv.uses >= inv.max_uses || inv.expires < Date.now() / 1000)
    return c.html(pages.message(group(c), "This invite has expired", "Ask the person who sent it for a new one."), 404);
  return c.html(pages.invitePage(group(c), new URL(c.req.url).origin, inv.code));
});

app.post("/invite/:code", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const inv = await store.getInvite(c.env.DB, code);
  if (!inv || inv.player) return c.html(pages.message(group(c), "This invite has expired", "Ask the person who sent it for a new one."), 404);
  const body = await c.req.parseBody();
  const checked = checkName(String(body.name ?? ""));
  const origin = new URL(c.req.url).origin;
  if ("error" in checked) return c.html(pages.invitePage(group(c), origin, code, checked.error, String(body.name ?? "")), 400);
  if (!(await store.useInvite(c.env.DB, code)))
    return c.html(pages.message(group(c), "This invite has expired", "Ask the person who sent it for a new one."), 404);
  const player = await store.createPlayer(c.env.DB, checked.name);
  if (!player) {
    await store.refundInvite(c.env.DB, code);
    return c.html(pages.invitePage(group(c), origin, code, "Someone in the group already has that name.", checked.name), 400);
  }
  startSession(c, await store.createSession(c.env.DB, player.id, false), false);
  return c.redirect("/me?welcome=1");
});

app.get("/signin/:code", async (c) => {
  const inv = await store.getInvite(c.env.DB, normalizeCode(c.req.param("code")));
  const p = inv?.player ? await store.getPlayer(c.env.DB, inv.player) : null;
  if (!inv || !p || inv.uses >= inv.max_uses || inv.expires < Date.now() / 1000)
    return c.html(pages.message(group(c), "This link has expired", "Ask the group's admin for a new one."), 404);
  return c.html(pages.signInPage(group(c), p.name));
});

app.post("/signin/:code", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const inv = await store.getInvite(c.env.DB, code);
  if (!inv?.player || !(await store.useInvite(c.env.DB, code)))
    return c.html(pages.message(group(c), "This link has expired", "Ask the group's admin for a new one."), 404);
  startSession(c, await store.createSession(c.env.DB, inv.player, false), false);
  return c.redirect("/me");
});

async function playerSession(c: Context<{ Bindings: Env }>) {
  const s = await session(c);
  const player = s?.player ? await store.getPlayer(c.env.DB, s.player) : null;
  return s && player ? { ...s, player } : null;
}

const notSignedIn = (c: Context<{ Bindings: Env }>) =>
  c.html(
    pages.message(
      group(c),
      "This browser isn't signed in",
      "Pair a device from the game first (Help and options, Online scores, Pair this device) and scan its QR code: that joins this browser. If you joined on another browser, open your page there and choose Show a code for my phone.",
    ),
    401,
  );

app.get("/me", async (c) => {
  const s = await playerSession(c);
  if (!s) return notSignedIn(c);
  const notice = c.req.query("welcome")
    ? "Welcome! Now pair the devices you play on:"
    : c.req.query("paired")
      ? "Paired. The game picks it up in a moment."
      : "";
  return c.html(pages.mePage(group(c), new URL(c.req.url).origin, s.player.name, s.csrf, await store.listDevices(c.env.DB, s.player.id), notice));
});

app.post("/me/name", async (c) => {
  const s = await playerSession(c);
  if (!s) return notSignedIn(c);
  const { body, ok } = await form(c, s);
  if (!ok) return c.text("Forbidden", 403);
  const devices = await store.listDevices(c.env.DB, s.player.id);
  const checked = checkName(String(body.name ?? ""));
  if ("error" in checked) return c.html(pages.mePage(group(c), new URL(c.req.url).origin, s.player.name, s.csrf, devices, "", checked.error), 400);
  if (!(await store.renamePlayer(c.env.DB, s.player.id, checked.name)))
    return c.html(pages.mePage(group(c), new URL(c.req.url).origin, s.player.name, s.csrf, devices, "", "Someone in the group already has that name."), 400);
  return c.redirect("/me");
});

app.post("/me/devices/:id/revoke", async (c) => {
  const s = await playerSession(c);
  if (!s) return notSignedIn(c);
  if (!(await form(c, s)).ok) return c.text("Forbidden", 403);
  await store.revokeDevice(c.env.DB, c.req.param("id"), s.player.id);
  return c.redirect("/me");
});

// A one-time sign-in link for your own phone (one use, a day), shown as a QR code.
app.post("/me/phone", async (c) => {
  const s = await playerSession(c);
  if (!s) return notSignedIn(c);
  if (!(await form(c, s)).ok) return c.text("Forbidden", 403);
  const code = await store.createInvite(c.env.DB, 1, 1, s.player.id);
  return c.html(pages.phonePage(group(c), s.player.name, `${new URL(c.req.url).origin}/signin/${code}`));
});

app.post("/me/signout", async (c) => {
  const s = await session(c);
  if (s && (await form(c, s)).ok) await store.deleteSession(c.env.DB, s.token);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.redirect("/");
});

app.get("/pair", (c) => c.redirect(`/pair/${normalizeCode(c.req.query("code") ?? "")}`));

app.get("/pair/:code", async (c) => {
  const s = await playerSession(c);
  const code = normalizeCode(c.req.param("code"));
  const p = await store.getPairing(c.env.DB, code);
  if (!p || p.player)
    return c.html(pages.message(group(c), "No device is waiting for that code", "Codes last ten minutes: choose Pair this device in the game again for a new one."), 404);
  // A browser no one has signed in yet joins the public board here: a name,
  // and the device it scanned is paired to it in the same step.
  if (!s) return c.html(pages.joinPairPage(group(c), p.device_name, code));
  return c.html(pages.pairPage(group(c), s.player.name, p.device_name, code, s.csrf));
});

app.post("/pair/:code/join", async (c) => {
  const code = normalizeCode(c.req.param("code"));
  const p = await store.getPairing(c.env.DB, code);
  if (!p || p.player)
    return c.html(pages.message(group(c), "No device is waiting for that code", "Codes last ten minutes: choose Pair this device in the game again for a new one."), 404);
  const body = await c.req.parseBody();
  const checked = checkName(String(body.name ?? ""));
  if ("error" in checked) return c.html(pages.joinPairPage(group(c), p.device_name, code, checked.error, String(body.name ?? "")), 400);
  const player = await store.createPlayer(c.env.DB, checked.name);
  if (!player) return c.html(pages.joinPairPage(group(c), p.device_name, code, "Someone already has that name.", checked.name), 400);
  startSession(c, await store.createSession(c.env.DB, player.id, false), false);
  if (!(await store.confirmPairing(c.env.DB, code, player.id)))
    return c.html(pages.message(group(c), "No device is waiting for that code", "Codes last ten minutes: choose Pair this device in the game again for a new one."), 404);
  return c.redirect("/me?paired=1");
});

app.post("/pair/:code", async (c) => {
  const s = await playerSession(c);
  if (!s) return notSignedIn(c);
  if (!(await form(c, s)).ok) return c.text("Forbidden", 403);
  if (!(await store.confirmPairing(c.env.DB, normalizeCode(c.req.param("code")), s.player.id)))
    return c.html(pages.message(group(c), "No device is waiting for that code", "Codes last ten minutes: choose Pair this device in the game again for a new one."), 404);
  return c.redirect("/me?paired=1");
});

app.get("/boards", async (c) => c.html(pages.boardsPage(group(c), await store.boards(c.env.DB, 20))));

// --- Admin -------------------------------------------------------------------

async function adminSession(c: Context<{ Bindings: Env }>) {
  const s = await session(c);
  return s?.admin ? s : null;
}

// A secret shorter than this is flagged on the admin page: guesses are
// limited only by the free plan's 100,000 requests a day.
const SECRET_MIN = 16;

async function adminView(c: Context<{ Bindings: Env }>, csrf: string, notice = "") {
  const db = c.env.DB;
  await store.cleanUp(db);
  const short = (c.env.ADMIN_SECRET ?? "").length < SECRET_MIN;
  return c.html(
    pages.adminPage(group(c), new URL(c.req.url).origin, csrf, short, {
      players: await store.listPlayers(db),
      invites: await store.listInvites(db),
      devices: await store.listDevices(db, null),
      scores: await store.recentScores(db),
    }, notice),
  );
}

app.get("/admin", async (c) => {
  if (!c.env.ADMIN_SECRET)
    return c.html(pages.message(group(c), "Admin", "No admin secret is set. Set ADMIN_SECRET in the Worker's settings (Settings, Variables and Secrets) and reload."));
  const s = await adminSession(c);
  return s ? adminView(c, s.csrf) : c.html(pages.adminLogin(group(c)));
});

app.post("/admin/login", async (c) => {
  const body = await c.req.parseBody();
  const secret = c.env.ADMIN_SECRET ?? "";
  if (!secret || typeof body.secret !== "string" || !sameSecret(body.secret, secret))
    return c.html(pages.adminLogin(group(c), "That's not the admin secret."), 401);
  startSession(c, await store.createSession(c.env.DB, null, true), true);
  return c.redirect("/admin");
});

// Every other admin action: a form from the admin page.
async function adminAction(c: Context<{ Bindings: Env }>, act: (body: Record<string, unknown>) => Promise<string | void>) {
  const s = await adminSession(c);
  if (!s) return c.redirect("/admin");
  const { body, ok } = await form(c, s);
  if (!ok) return c.text("Forbidden", 403);
  const notice = await act(body as Record<string, unknown>);
  return notice ? adminView(c, s.csrf, notice) : c.redirect("/admin");
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

app.post("/admin/invites", (c) =>
  adminAction(c, async (b) => {
    const uses = clamp(b.uses, 1, 100, 5), days = clamp(b.days, 1, 365, 14);
    const code = await store.createInvite(c.env.DB, days, uses);
    const url = `${new URL(c.req.url).origin}/invite/${code}`;
    // The admin joins too: the QR code opens the invite on their own phone.
    return `New invite link, for ${uses} ${uses === 1 ? "person" : "people"}, valid for ${days} ${days === 1 ? "day" : "days"}:` +
      pages.linkBox(url) + `<span class="computer-only">To join yourself, scan this with your phone:${pages.qrSvg(url, "QR code of the invite link")}</span>`;
  }),
);
app.post("/admin/invites/:code/delete", (c) => adminAction(c, () => store.deleteInvite(c.env.DB, c.req.param("code"))));
app.post("/admin/players/:id/rename", (c) =>
  adminAction(c, async (b) => {
    const checked = checkName(String(b.name ?? ""));
    if ("error" in checked) return pages.esc(checked.error);
    if (!(await store.renamePlayer(c.env.DB, c.req.param("id"), checked.name))) return "Another player has that name.";
  }),
);
app.post("/admin/players/:id/signin", (c) =>
  adminAction(c, async () => {
    const code = await store.createInvite(c.env.DB, 7, 1, c.req.param("id"));
    return `Sign-in link (one use, seven days):` + pages.linkBox(`${new URL(c.req.url).origin}/signin/${code}`);
  }),
);
app.post("/admin/players/:id/signout", (c) => adminAction(c, () => store.signOutPlayer(c.env.DB, c.req.param("id"))));
app.post("/admin/players/:id/remove", (c) => adminAction(c, () => store.removePlayer(c.env.DB, c.req.param("id"))));
app.post("/admin/devices/:id/revoke", (c) => adminAction(c, () => store.revokeDevice(c.env.DB, c.req.param("id"), null)));
app.post("/admin/scores/:seq/remove", (c) =>
  adminAction(c, () => store.removeScore(c.env.DB, Number.parseInt(c.req.param("seq"), 10) || 0)),
);
app.post("/admin/signout", async (c) => {
  const s = await adminSession(c);
  if (s && (await form(c, s)).ok) await store.deleteSession(c.env.DB, s.token);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.redirect("/admin");
});

export default app;

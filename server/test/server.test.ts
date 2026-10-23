// The whole flow as a group would use it: the admin invites, a player
// joins on a phone, pairs two devices, and the devices sync.

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as pages from "../src/pages";

const BASE = "https://scores.example";

// A browser: keeps its cookie between requests.
class Browser {
  cookie = "";
  async fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const r = await SELF.fetch(BASE + path, { ...init, headers, redirect: "manual" });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    return r;
  }
  post(path: string, fields: Record<string, string>) {
    return this.fetch(path, { method: "POST", body: new URLSearchParams(fields) });
  }
  async csrf(path: string) {
    const html = await (await this.fetch(path)).text();
    return /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
  }
}

const api = (path: string, body: unknown, token?: string) =>
  SELF.fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const event = (id: string, mode: number, score: number) => ({
  id: id.padEnd(32, "0"),
  mode,
  score,
  multiplier: 3,
  time: 1760000000,
  device: "d".repeat(32),
  name: "Player 1",
});

async function invite(admin: Browser, uses = 5) {
  const csrf = await admin.csrf("/admin");
  const html = await (await admin.post("/admin/invites", { csrf, uses: String(uses), days: "7" })).text();
  return /\/invite\/([A-Z0-9]+)/.exec(html)![1];
}

async function pair(phone: Browser, deviceName: string) {
  const start = await (await api("/api/pair/start", { device_name: deviceName })).json<any>();
  expect(start.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  expect(await (await api("/api/pair/poll", { poll: start.poll })).json()).toEqual({ status: "waiting" });
  const code = start.code.replace("-", "");
  expect(start.url).toBe(`${BASE}/pair/${code}`);
  const csrf = await phone.csrf(`/pair/${code}`);
  expect((await phone.post(`/pair/${code}`, { csrf })).status).toBe(302);
  const done = await (await api("/api/pair/poll", { poll: start.poll })).json<any>();
  expect(done.status).toBe("paired");
  // Handed over once.
  expect(await (await api("/api/pair/poll", { poll: start.poll })).json()).toEqual({ status: "expired" });
  return done.token as string;
}

describe("geow2-scores", () => {
  it("runs a group: invite, join, pair two devices, sync", async () => {
    const admin = new Browser();
    expect((await admin.post("/admin/login", { secret: "wrong" })).status).toBe(401);
    expect((await admin.post("/admin/login", { secret: "test admin secret" })).status).toBe(302);
    const code = await invite(admin);

    // Names: the game's font, at most 20 characters, unique.
    const phone = new Browser();
    expect((await phone.post(`/invite/${code}`, { name: "user@example" })).status).toBe(400);
    expect((await phone.post(`/invite/${code}`, { name: "x".repeat(21) })).status).toBe(400);
    expect((await phone.post(`/invite/${code}`, { name: "  Pilot   One " })).status).toBe(302);
    const welcome = await (await phone.fetch("/me")).text();
    expect(welcome).toContain("Pilot One");
    // The address to type into the game, without https:// (the game adds it).
    expect(welcome).toContain('value="scores.example"');
    const other = new Browser();
    expect((await other.post(`/invite/${code}`, { name: "PILOT ONE" })).status).toBe(400);
    expect((await other.post(`/invite/${code}`, { name: "Copilot" })).status).toBe(302);

    // Forms need the page's token.
    expect((await phone.post("/me/name", { name: "Sneaky" })).status).toBe(403);

    const pc = await pair(phone, "PC");
    const deck = await pair(phone, "Steam Deck");
    const friend = await pair(other, "Laptop");

    // The PC sends two games and its progress.
    const first = await (
      await api("/api/sync", {
        events: [event("a1", 0, 5000), event("a2", 5, 900), { id: "bad" }],
        progress: { unlocked: 2 | 1, millions: 0, progress: [400, 10, 0, 0, 0, 0], achievements: 0x10 },
        since: 0,
      }, pc)
    ).json<any>();
    expect(first.player.name).toBe("Pilot One");
    expect(first.group).toBe("Test Group");
    expect(first.events.map((e: any) => e.id)).toEqual([event("a1", 0, 0).id, event("a2", 0, 0).id]);
    expect(first.progress).toEqual({ unlocked: 3, millions: 0, progress: [400, 10, 0, 0, 0, 0], achievements: 0x10 });

    // The Deck gets them, adds its own (one repeated: counted once), and the
    // progress merges.
    const second = await (
      await api("/api/sync", {
        events: [event("a1", 0, 5000), event("b1", 0, 7000)],
        progress: { unlocked: 2 | 4, millions: 1, progress: [100, 300, 0, 0, 0, 0], achievements: 0x01 },
        since: 0,
      }, deck)
    ).json<any>();
    expect(second.events).toHaveLength(3);
    expect(second.progress).toEqual({ unlocked: 7, millions: 1, progress: [400, 300, 0, 0, 0, 0], achievements: 0x11 });

    // The PC asks only for what's new since its cursor.
    const third = await (await api("/api/sync", { events: [], progress: {}, since: first.cursor }, pc)).json<any>();
    expect(third.events.map((e: any) => e.score)).toEqual([7000]);

    // The friend's game; the boards hold each player's best per mode.
    await api("/api/sync", { events: [event("c1", 0, 6000)], progress: {}, since: 0 }, friend);
    const boards = (await (await api("/api/sync", { events: [], progress: {}, since: 0 }, pc)).json<any>()).boards;
    expect(boards[0].map((r: any) => [r.name, r.score])).toEqual([["Pilot One", 7000], ["Copilot", 6000]]);
    expect(boards[5].map((r: any) => r.score)).toEqual([900]);

    // The admin deletes the 7,000: the player's next best takes its place,
    // and the game sent again stays out.
    const adminPage = await (await admin.fetch("/admin")).text();
    const seq = /7,000<\/td>\s*<td>[^<]*<\/td><td><form method="post" action="\/admin\/scores\/(\d+)\/remove"/.exec(adminPage)![1];
    const adminCsrf = await admin.csrf("/admin");
    expect((await admin.post(`/admin/scores/${seq}/remove`, { csrf: adminCsrf })).status).toBe(302);
    await api("/api/sync", { events: [event("b1", 0, 7000)], progress: {}, since: 0 }, deck);
    const after = (await (await api("/api/sync", { events: [], progress: {}, since: 0 }, pc)).json<any>()).boards;
    expect(after[0].map((r: any) => [r.name, r.score])).toEqual([["Copilot", 6000], ["Pilot One", 5000]]);

    // Renaming shows on the boards.
    const csrf = await phone.csrf("/me");
    expect((await phone.post("/me/name", { csrf, name: "Ace" })).status).toBe(302);
    const renamed = (await (await api("/api/sync", { events: [], progress: {}, since: 0 }, pc)).json<any>()).boards;
    expect(renamed[0].map((r: any) => r.name)).toEqual(["Copilot", "Ace"]);

    // An unpaired device is turned away.
    expect((await api("/api/sync", { events: [] }, "not a token")).status).toBe(401);
    const me = await (await phone.fetch("/me")).text();
    const deckId = /\/me\/devices\/([0-9a-f]+)\/revoke/.exec(me)![1];
    expect((await phone.post(`/me/devices/${deckId}/revoke`, { csrf })).status).toBe(302);
    const revoked = await Promise.all([pc, deck].map(async (t) => (await api("/api/sync", { events: [] }, t)).status));
    expect(revoked.sort()).toEqual([200, 401]);
  });

  it("keeps the same game id for two players apart", async () => {
    // Rows imported from an earlier scores.txt get ids from their contents,
    // so two players (or one player invited again) can send the same id.
    const admin = new Browser();
    await admin.post("/admin/login", { secret: "test admin secret" });
    const code = await invite(admin, 2);
    const a = new Browser(), b = new Browser();
    await a.post(`/invite/${code}`, { name: "Same Score A" });
    await b.post(`/invite/${code}`, { name: "Same Score B" });
    const ta = await pair(a, "PC A"), tb = await pair(b, "PC B");
    const shared = event("feed", 3, 4242);
    const ra = await (await api("/api/sync", { events: [shared], progress: {}, since: 0 }, ta)).json<any>();
    const rb = await (await api("/api/sync", { events: [shared], progress: {}, since: 0 }, tb)).json<any>();
    expect(ra.events).toHaveLength(1);
    expect(rb.events).toHaveLength(1);
    const names = rb.boards[3].map((r: any) => r.name).sort();
    expect(names).toEqual(["Same Score A", "Same Score B"]);
  });

  it("signs in a phone for a player who joined on a computer", async () => {
    const admin = new Browser();
    await admin.post("/admin/login", { secret: "test admin secret" });
    const code = await invite(admin, 1);
    // The invite page offers a QR code of itself, for joining on a phone.
    const invitePage = await (await new Browser().fetch(`/invite/${code}`)).text();
    expect(invitePage).toContain('<svg class="qr"');
    const computer = new Browser();
    expect((await computer.post(`/invite/${code}`, { name: "Desk Pilot" })).status).toBe(302);
    const csrf = await computer.csrf("/me");
    expect((await computer.post("/me/phone", {})).status).toBe(403);
    const shown = await (await computer.post("/me/phone", { csrf })).text();
    expect(shown).toContain('<svg class="qr"');
    const signin = /\/signin\/([A-Z0-9]+)/.exec(shown)![1];
    const phone = new Browser();
    expect((await phone.post(`/signin/${signin}`, {})).status).toBe(302);
    expect(await (await phone.fetch("/me")).text()).toContain("Desk Pilot");
    await pair(phone, "Mac");
    // One use only; the computer stays signed in.
    expect((await new Browser().post(`/signin/${signin}`, {})).status).toBe(404);
    expect((await computer.fetch("/me")).status).toBe(200);
  });

  it("sends the security headers, and the script matches its CSP hash", async () => {
    for (const path of ["/", "/admin", "/api/info"]) {
      const r = await new Browser().fetch(path);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(r.headers.get("referrer-policy")).toBe("same-origin");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pages.SCRIPT_BODY));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(pages.SCRIPT_HASH).toBe(`sha256-${b64}`);
  });

  it("refuses forms posted from another site", async () => {
    const admin = new Browser();
    await admin.post("/admin/login", { secret: "test admin secret" });
    const code = await invite(admin, 2);
    const victim = new Browser();
    const r = await victim.fetch(`/invite/${code}`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: new URLSearchParams({ name: "Tricked" }),
    });
    expect(r.status).toBe(403);
    expect(victim.cookie).toBe("");
    const ok = await victim.fetch(`/invite/${code}`, {
      method: "POST",
      headers: { origin: BASE },
      body: new URLSearchParams({ name: "Same Site" }),
    });
    expect(ok.status).toBe(302);
  });

  it("takes a large upload in one sync, and says how many it took", async () => {
    const admin = new Browser();
    await admin.post("/admin/login", { secret: "test admin secret" });
    const phone = new Browser();
    await phone.post(`/invite/${await invite(admin, 1)}`, { name: "Long History" });
    const token = await pair(phone, "Old PC");
    const events = Array.from({ length: 300 }, (_, i) => event(`e${i.toString(16).padStart(4, "0")}`, i % 6, 1000 + i));
    const r = await (await api("/api/sync", { events: [...events, { id: "bad" }], progress: {}, since: 0 }, token)).json<any>();
    expect(r.taken).toBe(301);
    expect(r.events).toHaveLength(300);
    // Each mode's best is its highest of the 300.
    const mine = (r.boards as any[][]).map((b) => b.find((row) => row.name === "Long History")?.score);
    expect(mine).toEqual([1294, 1295, 1296, 1297, 1298, 1299]);
  });

  it("makes one device when a pairing is confirmed twice", async () => {
    const admin = new Browser();
    await admin.post("/admin/login", { secret: "test admin secret" });
    const phone = new Browser();
    await phone.post(`/invite/${await invite(admin, 1)}`, { name: "Double Tap" });
    const start = await (await api("/api/pair/start", { device_name: "Deck" })).json<any>();
    const code = start.code.replace("-", "");
    const csrf = await phone.csrf(`/pair/${code}`);
    const [a, b] = await Promise.all([phone.post(`/pair/${code}`, { csrf }), phone.post(`/pair/${code}`, { csrf })]);
    expect([a.status, b.status].sort()).toEqual([302, 404]);
    const me = await (await phone.fetch("/me")).text();
    expect(me.match(/\/revoke"/g)).toHaveLength(1);
  });

  it("signs a player out of every browser", async () => {
    const admin = new Browser();
    await admin.post("/admin/login", { secret: "test admin secret" });
    const phone = new Browser();
    await phone.post(`/invite/${await invite(admin, 1)}`, { name: "Lost Phone" });
    expect((await phone.fetch("/me")).status).toBe(200);
    const page = await (await admin.fetch("/admin")).text();
    const id = /\/admin\/players\/([0-9a-f]+)\/rename" class="inline"><input type="hidden" name="csrf" value="[^"]+">\s*<input name="name" value="Lost Phone"/.exec(page)![1];
    const csrf = await admin.csrf("/admin");
    expect((await admin.post(`/admin/players/${id}/signout`, { csrf })).status).toBe(302);
    expect((await phone.fetch("/me")).status).toBe(401);
  });

  it("turns away expired invites, unknown codes and missing sessions", async () => {
    const admin = new Browser();
    await admin.post("/admin/login", { secret: "test admin secret" });
    const code = await invite(admin, 1);
    expect((await new Browser().post(`/invite/${code}`, { name: "Only One" })).status).toBe(302);
    expect((await new Browser().post(`/invite/${code}`, { name: "Second" })).status).toBe(404);
    // An unknown code finds no device, signed in or not; the boards are public.
    expect((await new Browser().fetch("/pair/ABCDEFGH")).status).toBe(404);
    expect((await new Browser().fetch("/boards")).status).toBe(200);
    expect((await api("/api/pair/poll", { poll: "nothing" })).status).toBe(200);
  });

  it("lets anyone join from a device's code (the public board)", async () => {
    const start = await (await api("/api/pair/start", { device_name: "PlayStation 5" })).json<any>();
    const code = start.code.replace("-", "");
    const phone = new Browser();
    // Not signed in: the pairing link asks for a name, and joining pairs.
    const form = await (await phone.fetch(`/pair/${code}`)).text();
    expect(form).toContain(`/pair/${code}/join`);
    expect((await phone.post(`/pair/${code}/join`, { name: "user@example" })).status).toBe(400);
    expect((await phone.post(`/pair/${code}/join`, { name: "Public Pilot" })).status).toBe(302);
    const done = await (await api("/api/pair/poll", { poll: start.poll })).json<any>();
    expect(done.status).toBe("paired");
    expect(await (await phone.fetch("/me")).text()).toContain("Public Pilot");
    // A taken name is refused for the next one.
    const next = await (await api("/api/pair/start", { device_name: "PlayStation 5" })).json<any>();
    const other = new Browser();
    expect((await other.post(`/pair/${next.code.replace("-", "")}/join`, { name: "public pilot" })).status).toBe(400);
    // The device's games reach the front page's boards.
    const sync = await (await api("/api/sync", { events: [event("e1", 1, 12345)], progress: {}, since: 0 }, done.token)).json<any>();
    expect(sync.player.name).toBe("Public Pilot");
    const home = await (await new Browser().fetch("/")).text();
    expect(home).toContain("Public Pilot");
    expect(home).toContain("12,345");
  });
});

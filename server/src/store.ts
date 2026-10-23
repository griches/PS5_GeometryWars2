// The database: players, sessions, devices, pairings, games and progress.

import { nameKey, now, randomCode, randomId, randomToken, sha256 } from "./util";

export interface Env {
  DB: D1Database;
  ADMIN_SECRET?: string;
  GROUP_NAME?: string;
}

export interface Player {
  id: string;
  name: string;
}

export interface ScoreEvent {
  id: string;
  mode: number;
  score: number;
  multiplier: number;
  time: number;
  device: string;
  name: string;
}

// The profile block's unlocked modes, million bits and unlock progress
// (per mode index, 0-400), and the achievements' bits.
export interface Progress {
  unlocked: number;
  millions: number;
  progress: number[];
  achievements: number;
}

export interface BoardRow {
  player: string;
  name: string;
  score: number;
  multiplier: number;
  time: number;
}

const DAY = 86400;
export const SESSION_DAYS = 365;
export const PAIRING_SECONDS = 600;

// --- Players -----------------------------------------------------------------

export async function createPlayer(db: D1Database, name: string): Promise<Player | null> {
  const id = randomId();
  try {
    await db
      .prepare("INSERT INTO players (id, name, name_key, created) VALUES (?, ?, ?, ?)")
      .bind(id, name, nameKey(name), now())
      .run();
  } catch {
    return null;  // the name is taken
  }
  return { id, name };
}

export async function getPlayer(db: D1Database, id: string): Promise<Player | null> {
  return db.prepare("SELECT id, name FROM players WHERE id = ? AND removed = 0").bind(id).first<Player>();
}

// Returns false when another player has the name.
export async function renamePlayer(db: D1Database, id: string, name: string): Promise<boolean> {
  try {
    await db.prepare("UPDATE players SET name = ?, name_key = ? WHERE id = ?").bind(name, nameKey(name), id).run();
    return true;
  } catch {
    return false;
  }
}

export async function removePlayer(db: D1Database, id: string): Promise<void> {
  // The name is freed (a removed player keeps their row for their games).
  await db.batch([
    db.prepare("UPDATE players SET removed = 1, name_key = ? WHERE id = ?").bind(`removed:${id}`, id),
    db.prepare("UPDATE devices SET revoked = 1 WHERE player = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE player = ?").bind(id),
  ]);
}

export async function listPlayers(db: D1Database) {
  const r = await db
    .prepare(
      `SELECT p.id, p.name, p.created,
              (SELECT COUNT(*) FROM devices d WHERE d.player = p.id AND d.revoked = 0) AS devices,
              (SELECT COUNT(*) FROM scores s WHERE s.player = p.id AND s.removed = 0) AS games
       FROM players p WHERE p.removed = 0 ORDER BY p.name_key`,
    )
    .all<{ id: string; name: string; created: number; devices: number; games: number }>();
  return r.results;
}

// --- Invites and sessions ----------------------------------------------------

// An invite link (player null: makes a new player) or a sign-in link for
// an existing player.
export async function createInvite(db: D1Database, days: number, maxUses: number, player: string | null = null) {
  const code = randomCode(10);
  await db
    .prepare("INSERT INTO invites (code, player, created, expires, max_uses) VALUES (?, ?, ?, ?, ?)")
    .bind(code, player, now(), now() + days * DAY, maxUses)
    .run();
  return code;
}

export async function getInvite(db: D1Database, code: string) {
  return db
    .prepare("SELECT code, player, expires, max_uses, uses FROM invites WHERE code = ?")
    .bind(code)
    .first<{ code: string; player: string | null; expires: number; max_uses: number; uses: number }>();
}

export async function useInvite(db: D1Database, code: string): Promise<boolean> {
  const r = await db
    .prepare("UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses AND expires > ?")
    .bind(code, now())
    .run();
  return (r.meta.changes ?? 0) > 0;
}

// A use given back (the name chosen with it was taken).
export async function refundInvite(db: D1Database, code: string): Promise<void> {
  await db.prepare("UPDATE invites SET uses = uses - 1 WHERE code = ? AND uses > 0").bind(code).run();
}

export async function listInvites(db: D1Database) {
  const r = await db
    .prepare(
      `SELECT i.code, i.player, p.name, i.expires, i.max_uses, i.uses FROM invites i
       LEFT JOIN players p ON p.id = i.player
       WHERE i.expires > ? AND i.uses < i.max_uses ORDER BY i.created DESC`,
    )
    .bind(now())
    .all<{ code: string; player: string | null; name: string | null; expires: number; max_uses: number; uses: number }>();
  return r.results;
}

export async function deleteInvite(db: D1Database, code: string): Promise<void> {
  await db.prepare("DELETE FROM invites WHERE code = ?").bind(code).run();
}

export async function createSession(db: D1Database, player: string | null, admin: boolean): Promise<string> {
  const token = randomToken();
  await db
    .prepare("INSERT INTO sessions (token_hash, player, admin, created, expires) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), player, admin ? 1 : 0, now(), now() + (admin ? 7 : SESSION_DAYS) * DAY)
    .run();
  return token;
}

export async function getSession(db: D1Database, token: string) {
  return db
    .prepare("SELECT player, admin FROM sessions WHERE token_hash = ? AND expires > ?")
    .bind(await sha256(token), now())
    .first<{ player: string | null; admin: number }>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

// --- Devices and pairing -----------------------------------------------------

export async function startPairing(db: D1Database, deviceName: string) {
  const code = randomCode(8);
  const poll = randomToken();
  const expires = now() + PAIRING_SECONDS;
  await db.batch([
    db.prepare("DELETE FROM pairings WHERE expires < ?").bind(now()),
    db
      .prepare("INSERT INTO pairings (code, poll_hash, device_name, created, expires) VALUES (?, ?, ?, ?, ?)")
      .bind(code, await sha256(poll), deviceName, now(), expires),
  ]);
  return { code, poll, expires };
}

export async function getPairing(db: D1Database, code: string) {
  return db
    .prepare("SELECT code, device_name, expires, player FROM pairings WHERE code = ? AND expires > ?")
    .bind(code, now())
    .first<{ code: string; device_name: string; expires: number; player: string | null }>();
}

// A signed-in player confirms: the device row is made now and its token
// waits in the pairing until the game collects it.
// Both statements test that the pairing is still waiting, in one
// transaction, so two confirmations at once make only one device.
export async function confirmPairing(db: D1Database, code: string, player: string): Promise<boolean> {
  const token = randomToken();
  const t = now();
  const [device] = await db.batch([
    db
      .prepare(
        `INSERT INTO devices (id, token_hash, player, name, created)
           SELECT ?, ?, ?, device_name, ? FROM pairings WHERE code = ? AND player IS NULL AND expires > ?`,
      )
      .bind(randomId(), await sha256(token), player, t, code, t),
    db
      .prepare("UPDATE pairings SET player = ?, device_token = ? WHERE code = ? AND player IS NULL AND expires > ?")
      .bind(player, token, code, t),
  ]);
  return (device.meta.changes ?? 0) > 0;
}

// Rows that can no longer be used: expired sessions, spent or expired
// invites and sign-in links, and expired pairings (a confirmed one never
// collected holds a device's token). Run when the admin page opens.
export async function cleanUp(db: D1Database): Promise<void> {
  const t = now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires <= ?").bind(t),
    db.prepare("DELETE FROM invites WHERE expires <= ? OR uses >= max_uses").bind(t),
    db.prepare("DELETE FROM pairings WHERE expires <= ?").bind(t),
  ]);
}

// Signs a player out of every browser (a lost phone, say).
export async function signOutPlayer(db: D1Database, player: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE player = ?").bind(player).run();
}

export type PollResult =
  | { status: "waiting" | "expired" }
  | { status: "paired"; token: string; player: Player };

export async function pollPairing(db: D1Database, poll: string): Promise<PollResult> {
  const row = await db
    .prepare("SELECT code, expires, player, device_token FROM pairings WHERE poll_hash = ?")
    .bind(await sha256(poll))
    .first<{ code: string; expires: number; player: string | null; device_token: string | null }>();
  if (!row) return { status: "expired" };
  if (!row.player || !row.device_token) return row.expires > now() ? { status: "waiting" } : { status: "expired" };
  await db.prepare("DELETE FROM pairings WHERE code = ?").bind(row.code).run();
  const player = await getPlayer(db, row.player);
  return player ? { status: "paired", token: row.device_token, player } : { status: "expired" };
}

export async function deviceFor(db: D1Database, token: string) {
  const d = await db
    .prepare(
      `SELECT d.id, d.player, p.name FROM devices d JOIN players p ON p.id = d.player
       WHERE d.token_hash = ? AND d.revoked = 0 AND p.removed = 0`,
    )
    .bind(await sha256(token))
    .first<{ id: string; player: string; name: string }>();
  if (d) await db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").bind(now(), d.id).run();
  return d;
}

export async function listDevices(db: D1Database, player: string | null) {
  const r = await (player
    ? db.prepare(
        "SELECT d.id, d.name, d.created, d.last_seen, p.name AS player FROM devices d JOIN players p ON p.id = d.player WHERE d.revoked = 0 AND d.player = ? ORDER BY d.created",
      ).bind(player)
    : db.prepare(
        "SELECT d.id, d.name, d.created, d.last_seen, p.name AS player FROM devices d JOIN players p ON p.id = d.player WHERE d.revoked = 0 AND p.removed = 0 ORDER BY p.name_key, d.created",
      )
  ).all<{ id: string; name: string; created: number; last_seen: number | null; player: string }>();
  return r.results;
}

// `player` set: only that player's own device.
export async function revokeDevice(db: D1Database, id: string, player: string | null): Promise<void> {
  if (player) await db.prepare("UPDATE devices SET revoked = 1 WHERE id = ? AND player = ?").bind(id, player).run();
  else await db.prepare("UPDATE devices SET revoked = 1 WHERE id = ?").bind(id).run();
}

// --- Games and progress ------------------------------------------------------

// All of a sync's games in two statements, whatever their number (the free
// plan allows 50 queries a request): the games go in as one JSON array.
export async function addEvents(db: D1Database, player: string, events: ScoreEvent[]): Promise<void> {
  if (!events.length) return;
  const json = JSON.stringify(events);
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO scores (id, player, mode, score, multiplier, time, device, name)
           SELECT value ->> '$.id', ?1, value ->> '$.mode', value ->> '$.score', value ->> '$.multiplier',
                  value ->> '$.time', value ->> '$.device', value ->> '$.name'
           FROM json_each(?2) ORDER BY key`,
      )
      .bind(player, json),
    // The player's bests, from the stored rows: a game the admin removed and
    // a device sends again stays out.
    db
      .prepare(
        `INSERT INTO bests (player, mode, score, multiplier, time)
           SELECT player, mode, score, multiplier, time FROM scores
           WHERE player = ?1 AND removed = 0 AND id IN (SELECT value ->> '$.id' FROM json_each(?2))
           ORDER BY score DESC, time ASC
         ON CONFLICT (player, mode) DO UPDATE SET score = excluded.score, multiplier = excluded.multiplier, time = excluded.time
           WHERE excluded.score > bests.score OR (excluded.score = bests.score AND excluded.time < bests.time)`,
      )
      .bind(player, json),
  ]);
}

// A player's best for one mode again from their games (after a removal).
function rebuildBest(db: D1Database, player: string, mode: number) {
  return [
    db.prepare("DELETE FROM bests WHERE player = ? AND mode = ?").bind(player, mode),
    db
      .prepare(
        `INSERT INTO bests (player, mode, score, multiplier, time)
           SELECT player, mode, score, multiplier, time FROM scores WHERE player = ? AND mode = ? AND removed = 0
           ORDER BY score DESC, time ASC LIMIT 1`,
      )
      .bind(player, mode),
  ];
}

export async function eventsSince(db: D1Database, player: string, since: number, limit = 1000) {
  const r = await db
    .prepare(
      `SELECT seq, id, mode, score, multiplier, time, device, name FROM scores
       WHERE player = ? AND seq > ? AND removed = 0 ORDER BY seq LIMIT ?`,
    )
    .bind(player, since, limit)
    .all<ScoreEvent & { seq: number }>();
  return r.results;
}

export async function mergeProgress(db: D1Database, player: string, p: Progress): Promise<Progress> {
  const pr = [0, 1, 2, 3, 4, 5].map((i) => Math.max(0, Math.min(400, Math.trunc(p.progress[i] ?? 0))));
  await db
    .prepare(
      `INSERT INTO progress (player, unlocked, millions, p0, p1, p2, p3, p4, p5, achievements, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (player) DO UPDATE SET
         unlocked = unlocked | excluded.unlocked, millions = millions | excluded.millions,
         p0 = MAX(p0, excluded.p0), p1 = MAX(p1, excluded.p1), p2 = MAX(p2, excluded.p2),
         p3 = MAX(p3, excluded.p3), p4 = MAX(p4, excluded.p4), p5 = MAX(p5, excluded.p5),
         achievements = achievements | excluded.achievements, updated = excluded.updated`,
    )
    .bind(player, p.unlocked | 2, p.millions, ...pr, p.achievements, now())
    .run();
  const r = (await db.prepare("SELECT * FROM progress WHERE player = ?").bind(player).first<Record<string, number>>())!;
  return {
    unlocked: r.unlocked,
    millions: r.millions,
    progress: [r.p0, r.p1, r.p2, r.p3, r.p4, r.p5],
    achievements: r.achievements,
  };
}

// The group's boards: per mode, each player's best game, best first.
export async function boards(db: D1Database, rows = 100): Promise<BoardRow[][]> {
  const r = await db
    .prepare(
      `SELECT b.mode, b.player, p.name, b.score, b.multiplier, b.time
       FROM bests b JOIN players p ON p.id = b.player
       WHERE p.removed = 0`,
    )
    .all<BoardRow & { mode: number }>();
  const out: BoardRow[][] = [[], [], [], [], [], []];
  for (const { mode, ...row } of r.results) if (mode >= 0 && mode < 6) out[mode].push(row);
  for (const b of out) {
    b.sort((a, c) => c.score - a.score || a.time - c.time);
    b.splice(rows);
  }
  return out;
}

export async function recentScores(db: D1Database, limit = 50) {
  const r = await db
    .prepare(
      `SELECT s.seq, s.mode, s.score, s.time, p.name AS player FROM scores s JOIN players p ON p.id = s.player
       WHERE s.removed = 0 ORDER BY s.seq DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ seq: number; mode: number; score: number; time: number; player: string }>();
  return r.results;
}

// By the row's seq: a game id is unique only for its player.
export async function removeScore(db: D1Database, seq: number): Promise<void> {
  const row = await db.prepare("SELECT player, mode FROM scores WHERE seq = ?").bind(seq).first<{ player: string; mode: number }>();
  if (!row) return;
  await db.batch([db.prepare("UPDATE scores SET removed = 1 WHERE seq = ?").bind(seq), ...rebuildBest(db, row.player, row.mode)]);
}

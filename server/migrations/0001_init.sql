-- A group's players, the devices paired to them, their games and their
-- progress (unlocked modes and achievements). Times are seconds since 1970.

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,  -- the name in lower case: names are unique without regard to case
  created INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0
);

-- An invite link makes a new player; a sign-in link (player set) signs a
-- phone in as an existing one.
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  player TEXT,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);

-- Browser sessions: a player's phone, or the admin.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  player TEXT,
  admin INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  player TEXT NOT NULL,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_seen INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

-- A device waiting to be paired: the game shows `code` and asks with its
-- poll token until a signed-in phone confirms; the device's token is
-- handed over once and the row deleted.
CREATE TABLE pairings (
  code TEXT PRIMARY KEY,
  poll_hash TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  player TEXT,
  device_token TEXT
);

-- Finished single-player games, as the game's scores.log keeps them. seq
-- orders them as they arrived, for the devices' "since" cursor.
CREATE TABLE scores (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  player TEXT NOT NULL,
  mode INTEGER NOT NULL,
  score INTEGER NOT NULL,
  multiplier INTEGER NOT NULL,
  time INTEGER NOT NULL,
  device TEXT NOT NULL,
  name TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX scores_player_seq ON scores (player, seq);
CREATE INDEX scores_mode_player ON scores (mode, player, score);

-- A player's progress, merged from every device: the profile block's
-- unlocked modes, million bits and unlock progress per mode index, and
-- the achievements' bits.
CREATE TABLE progress (
  player TEXT PRIMARY KEY,
  unlocked INTEGER NOT NULL DEFAULT 2,
  millions INTEGER NOT NULL DEFAULT 0,
  p0 INTEGER NOT NULL DEFAULT 0,
  p1 INTEGER NOT NULL DEFAULT 0,
  p2 INTEGER NOT NULL DEFAULT 0,
  p3 INTEGER NOT NULL DEFAULT 0,
  p4 INTEGER NOT NULL DEFAULT 0,
  p5 INTEGER NOT NULL DEFAULT 0,
  achievements INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL
);

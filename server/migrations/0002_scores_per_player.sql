-- A game's id is unique for its player, not across the group: rows the
-- game imports from an earlier scores.txt get ids made from their
-- contents, so two players (or a player invited again) can send the same
-- id. The table is rebuilt with that key, keeping every row and its seq.

CREATE TABLE scores_new (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  player TEXT NOT NULL,
  mode INTEGER NOT NULL,
  score INTEGER NOT NULL,
  multiplier INTEGER NOT NULL,
  time INTEGER NOT NULL,
  device TEXT NOT NULL,
  name TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (player, id)
);
INSERT INTO scores_new (seq, id, player, mode, score, multiplier, time, device, name, removed)
  SELECT seq, id, player, mode, score, multiplier, time, device, name, removed FROM scores;
DROP TABLE scores;
ALTER TABLE scores_new RENAME TO scores;
CREATE INDEX scores_player_seq ON scores (player, seq);
CREATE INDEX scores_mode_player ON scores (mode, player, score);

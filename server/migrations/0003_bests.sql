-- Each player's best game per mode, kept up to date as games arrive, so the
-- boards (sent with every sync) read one row per player and mode rather
-- than every game ever played. Of two equal scores the earlier counts.

CREATE TABLE bests (
  player TEXT NOT NULL,
  mode INTEGER NOT NULL,
  score INTEGER NOT NULL,
  multiplier INTEGER NOT NULL,
  time INTEGER NOT NULL,
  PRIMARY KEY (player, mode)
);
INSERT INTO bests (player, mode, score, multiplier, time)
  SELECT player, mode, score, multiplier, time FROM (
    SELECT player, mode, score, multiplier, time,
           ROW_NUMBER() OVER (PARTITION BY player, mode ORDER BY score DESC, time ASC) AS rank
    FROM scores WHERE removed = 0
  ) WHERE rank = 1;

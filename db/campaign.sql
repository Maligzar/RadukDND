PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────
-- sessions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_code TEXT    NOT NULL UNIQUE,
  dm_name      TEXT    NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  status       TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  party_level  INTEGER NOT NULL DEFAULT 1,
  party_size   INTEGER NOT NULL DEFAULT 4
);

-- ─────────────────────────────────────────
-- players
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  character_name   TEXT    NOT NULL,
  player_name      TEXT    NOT NULL,
  ddb_character_id TEXT,
  role             TEXT    NOT NULL DEFAULT 'player' CHECK (role IN ('dm','player')),
  joined_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_id);

-- ─────────────────────────────────────────
-- rolls
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rolls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES sessions(id)  ON DELETE CASCADE,
  player_id    INTEGER          REFERENCES players(id)   ON DELETE SET NULL,
  dice_type    TEXT    NOT NULL,
  raw_result   INTEGER NOT NULL,
  modifier     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL,
  action_label TEXT,
  roll_type    TEXT    NOT NULL DEFAULT 'check'
                CHECK (roll_type IN ('attack','damage','check','save','heal','other')),
  is_secret    INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0,1)),
  is_crit      INTEGER NOT NULL DEFAULT 0 CHECK (is_crit   IN (0,1)),
  is_nat1      INTEGER NOT NULL DEFAULT 0 CHECK (is_nat1   IN (0,1)),
  source       TEXT    NOT NULL DEFAULT 'ddb' CHECK (source IN ('ddb','r20','manual')),
  rolled_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rolls_session     ON rolls(session_id, rolled_at);
CREATE INDEX IF NOT EXISTS idx_rolls_player      ON rolls(player_id);
CREATE INDEX IF NOT EXISTS idx_rolls_secret      ON rolls(is_secret);
CREATE INDEX IF NOT EXISTS idx_rolls_source      ON rolls(source);

-- ─────────────────────────────────────────
-- initiative
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS initiative (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  combatant_name   TEXT    NOT NULL,
  combatant_type   TEXT    NOT NULL DEFAULT 'player'
                   CHECK (combatant_type IN ('player','enemy','ally','neutral')),
  initiative_score INTEGER NOT NULL DEFAULT 0,
  hp_current       INTEGER NOT NULL DEFAULT 0,
  hp_max           INTEGER NOT NULL DEFAULT 0,
  ac               INTEGER NOT NULL DEFAULT 10,
  is_active_turn   INTEGER NOT NULL DEFAULT 0 CHECK (is_active_turn IN (0,1)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  monster_id       TEXT
);

CREATE INDEX IF NOT EXISTS idx_initiative_session ON initiative(session_id, sort_order);

-- ─────────────────────────────────────────
-- npcs
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS npcs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name                TEXT    NOT NULL,
  first_mentioned_at  INTEGER,
  role                TEXT,
  faction             TEXT,
  notes               TEXT,
  status              TEXT    NOT NULL DEFAULT 'unknown'
                      CHECK (status IN ('unknown','alive','dead','missing','ally','enemy'))
);

CREATE INDEX IF NOT EXISTS idx_npcs_session ON npcs(session_id);

-- ─────────────────────────────────────────
-- utterances
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS utterances (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id           INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  speaker_name         TEXT    NOT NULL,
  text                 TEXT    NOT NULL,
  spoken_at            INTEGER NOT NULL,
  transcript_source_id TEXT,
  chunk_index          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_utterances_session ON utterances(session_id, spoken_at);

-- ─────────────────────────────────────────
-- embeddings
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS embeddings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  utterance_id INTEGER NOT NULL REFERENCES utterances(id) ON DELETE CASCADE,
  vector       BLOB    NOT NULL,
  model        TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_utterance ON embeddings(utterance_id);

-- ─────────────────────────────────────────
-- encounters_log
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS encounters_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  encounter_json TEXT    NOT NULL,
  difficulty     TEXT    NOT NULL DEFAULT 'medium'
                 CHECK (difficulty IN ('easy','medium','hard','deadly')),
  xp_total       INTEGER NOT NULL DEFAULT 0,
  generated_at   INTEGER NOT NULL,
  used           INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_encounters_session ON encounters_log(session_id);

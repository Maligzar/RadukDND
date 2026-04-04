PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────
-- monsters  (one row per creature)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monsters (
  id                     TEXT    PRIMARY KEY,
  name                   TEXT    NOT NULL,
  source                 TEXT    NOT NULL DEFAULT 'open5e'
                         CHECK (source IN ('open5e','ddb','homebrew')),
  size                   TEXT    NOT NULL DEFAULT 'Medium'
                         CHECK (size IN ('Tiny','Small','Medium','Large','Huge','Gargantuan')),
  type                   TEXT    NOT NULL,
  subtype                TEXT,
  alignment              TEXT,

  hp_avg                 INTEGER NOT NULL DEFAULT 0,
  hp_formula             TEXT,

  ac                     INTEGER NOT NULL DEFAULT 10,
  ac_notes               TEXT,

  speed_walk             INTEGER NOT NULL DEFAULT 30,
  speed_fly              INTEGER NOT NULL DEFAULT 0,
  speed_swim             INTEGER NOT NULL DEFAULT 0,
  speed_climb            INTEGER NOT NULL DEFAULT 0,
  speed_burrow           INTEGER NOT NULL DEFAULT 0,

  str                    INTEGER NOT NULL DEFAULT 10,
  dex                    INTEGER NOT NULL DEFAULT 10,
  con                    INTEGER NOT NULL DEFAULT 10,
  int                    INTEGER NOT NULL DEFAULT 10,
  wis                    INTEGER NOT NULL DEFAULT 10,
  cha                    INTEGER NOT NULL DEFAULT 10,

  save_proficiencies     TEXT,
  skill_proficiencies    TEXT,

  damage_immunities      TEXT,
  damage_resistances     TEXT,
  damage_vulnerabilities TEXT,
  condition_immunities   TEXT,

  senses                 TEXT,
  languages              TEXT,

  cr                     REAL    NOT NULL DEFAULT 0,
  xp                     INTEGER NOT NULL DEFAULT 0,

  legendary_actions      INTEGER NOT NULL DEFAULT 0,
  lair_actions           INTEGER NOT NULL DEFAULT 0,

  source_book            TEXT,
  ddb_url                TEXT,
  scrape_updated_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_monsters_cr      ON monsters(cr);
CREATE INDEX IF NOT EXISTS idx_monsters_type    ON monsters(type);
CREATE INDEX IF NOT EXISTS idx_monsters_source  ON monsters(source);
CREATE INDEX IF NOT EXISTS idx_monsters_name    ON monsters(name COLLATE NOCASE);

-- ─────────────────────────────────────────
-- monster_actions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monster_actions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id   TEXT    NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  action_type  TEXT    NOT NULL DEFAULT 'action'
               CHECK (action_type IN ('action','bonus_action','reaction',
                                      'legendary','lair','special','multiattack')),
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  attack_bonus TEXT,
  damage_dice  TEXT,
  damage_type  TEXT,
  reach_range  TEXT,
  save_dc      TEXT,
  save_ability TEXT
);

CREATE INDEX IF NOT EXISTS idx_actions_monster ON monster_actions(monster_id);

-- ─────────────────────────────────────────
-- monster_traits
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monster_traits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id  TEXT    NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traits_monster ON monster_traits(monster_id);

-- ─────────────────────────────────────────
-- monster_environments
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monster_environments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id  TEXT    NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  environment TEXT    NOT NULL
              CHECK (environment IN (
                'arctic','coastal','desert','forest','grassland',
                'hill','mountain','swamp','underdark','underwater',
                'urban','dungeon','planar','any'
              ))
);

CREATE INDEX IF NOT EXISTS idx_env_monster     ON monster_environments(monster_id);
CREATE INDEX IF NOT EXISTS idx_env_environment ON monster_environments(environment);

-- ─────────────────────────────────────────
-- monster_tags  (freeform labels for encounter gen + mind map)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monster_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id TEXT    NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  tag        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_monster ON monster_tags(monster_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag     ON monster_tags(tag);

-- ─────────────────────────────────────────
-- db_meta  (version, scrape timestamps, counts)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS db_meta (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  key   TEXT    NOT NULL UNIQUE,
  value TEXT    NOT NULL
);

INSERT OR IGNORE INTO db_meta (key, value) VALUES
  ('schema_version',    '1'),
  ('open5e_scraped_at', '0'),
  ('ddb_scraped_at',    '0'),
  ('monster_count',     '0');

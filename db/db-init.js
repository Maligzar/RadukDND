'use strict';

const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = 2;

function getCampaignDbPath(app) {
  return path.join(app.getPath('userData'), 'campaign.db');
}

function getBestiaryDbPath() {
  return path.join(process.resourcesPath ?? __dirname, 'bestiary.db');
}

// ─────────────────────────────────────────────────────────────
// openCampaignDb
// Creates campaign.db in the user data folder on first launch.
// Safe to call on every launch — all statements are IF NOT EXISTS.
// ─────────────────────────────────────────────────────────────
function openCampaignDb(app) {
  const dbPath = getCampaignDbPath(app);
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS players (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      character_name   TEXT    NOT NULL,
      player_name      TEXT    NOT NULL,
      ddb_character_id TEXT,
      role             TEXT    NOT NULL DEFAULT 'player' CHECK (role IN ('dm','player')),
      joined_at        INTEGER NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS utterances (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id           INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      speaker_name         TEXT    NOT NULL,
      text                 TEXT    NOT NULL,
      spoken_at            INTEGER NOT NULL,
      transcript_source_id TEXT,
      chunk_index          INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      utterance_id INTEGER NOT NULL REFERENCES utterances(id) ON DELETE CASCADE,
      vector       BLOB    NOT NULL,
      model        TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
      created_at   INTEGER NOT NULL
    );

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

    CREATE INDEX IF NOT EXISTS idx_players_session    ON players(session_id);
    CREATE INDEX IF NOT EXISTS idx_rolls_session      ON rolls(session_id, rolled_at);
    CREATE INDEX IF NOT EXISTS idx_rolls_player       ON rolls(player_id);
    CREATE INDEX IF NOT EXISTS idx_rolls_secret       ON rolls(is_secret);
    CREATE INDEX IF NOT EXISTS idx_rolls_source       ON rolls(source);
    CREATE INDEX IF NOT EXISTS idx_initiative_session ON initiative(session_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_npcs_session       ON npcs(session_id);
    CREATE INDEX IF NOT EXISTS idx_utterances_session ON utterances(session_id, spoken_at);
    CREATE INDEX IF NOT EXISTS idx_embeddings_utt     ON embeddings(utterance_id);
    CREATE INDEX IF NOT EXISTS idx_encounters_session ON encounters_log(session_id);
  `);

  migrateIfNeeded(db, 'campaign');
  return db;
}

// ─────────────────────────────────────────────────────────────
// openBestiaryDb
// Opens the bundled read-only bestiary shipped with the installer.
// In dev mode falls back to a local dev copy in /data/bestiary.db.
// ─────────────────────────────────────────────────────────────
function openBestiaryDb() {
  const prodPath = getBestiaryDbPath();
  const devPath  = path.join(__dirname, '..', 'data', 'bestiary.db');

  const dbPath = fs.existsSync(prodPath) ? prodPath
               : fs.existsSync(devPath)  ? devPath
               : null;

  if (!dbPath) {
    console.warn('[db] bestiary.db not found — encounter generator unavailable');
    return null;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  // WAL pragma requires a write — skip it for read-only bestiary
  ensureBestiarySchema(db);
  return db;
}

// ─────────────────────────────────────────────────────────────
// ensureBestiarySchema
// Called against the dev bestiary before the first scrape run.
// In production the bundled file already has the schema baked in.
// ─────────────────────────────────────────────────────────────
function ensureBestiarySchema(db) {
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='monsters'`
  ).get();
  if (tables) return;

  if (db.readonly) {
    console.warn('[db] bestiary.db is empty and read-only — run the scraper first');
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS monsters (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'open5e'
        CHECK (source IN ('open5e','ddb','homebrew')),
      size TEXT NOT NULL DEFAULT 'Medium'
        CHECK (size IN ('Tiny','Small','Medium','Large','Huge','Gargantuan')),
      type TEXT NOT NULL, subtype TEXT, alignment TEXT,
      hp_avg INTEGER NOT NULL DEFAULT 0, hp_formula TEXT,
      ac INTEGER NOT NULL DEFAULT 10, ac_notes TEXT,
      speed_walk INTEGER NOT NULL DEFAULT 30,
      speed_fly INTEGER NOT NULL DEFAULT 0,
      speed_swim INTEGER NOT NULL DEFAULT 0,
      speed_climb INTEGER NOT NULL DEFAULT 0,
      speed_burrow INTEGER NOT NULL DEFAULT 0,
      str INTEGER NOT NULL DEFAULT 10, dex INTEGER NOT NULL DEFAULT 10,
      con INTEGER NOT NULL DEFAULT 10, int INTEGER NOT NULL DEFAULT 10,
      wis INTEGER NOT NULL DEFAULT 10, cha INTEGER NOT NULL DEFAULT 10,
      save_proficiencies TEXT, skill_proficiencies TEXT,
      damage_immunities TEXT, damage_resistances TEXT,
      damage_vulnerabilities TEXT, condition_immunities TEXT,
      senses TEXT, languages TEXT,
      cr REAL NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0,
      legendary_actions INTEGER NOT NULL DEFAULT 0,
      lair_actions INTEGER NOT NULL DEFAULT 0,
      source_book TEXT, ddb_url TEXT, scrape_updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS monster_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monster_id TEXT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL DEFAULT 'action'
        CHECK (action_type IN ('action','bonus_action','reaction',
                               'legendary','lair','special','multiattack')),
      name TEXT NOT NULL, description TEXT NOT NULL,
      attack_bonus TEXT, damage_dice TEXT, damage_type TEXT,
      reach_range TEXT, save_dc TEXT, save_ability TEXT
    );
    CREATE TABLE IF NOT EXISTS monster_traits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monster_id TEXT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monster_environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monster_id TEXT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
      environment TEXT NOT NULL
        CHECK (environment IN (
          'arctic','coastal','desert','forest','grassland',
          'hill','mountain','swamp','underdark','underwater',
          'urban','dungeon','planar','any'
        ))
    );
    CREATE TABLE IF NOT EXISTS monster_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monster_id TEXT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
      tag TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS db_meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE, value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO db_meta (key,value) VALUES
      ('schema_version','1'),('open5e_scraped_at','0'),
      ('ddb_scraped_at','0'),('monster_count','0');

    CREATE INDEX IF NOT EXISTS idx_monsters_cr     ON monsters(cr);
    CREATE INDEX IF NOT EXISTS idx_monsters_type   ON monsters(type);
    CREATE INDEX IF NOT EXISTS idx_monsters_source ON monsters(source);
    CREATE INDEX IF NOT EXISTS idx_monsters_name   ON monsters(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_actions_monster ON monster_actions(monster_id);
    CREATE INDEX IF NOT EXISTS idx_traits_monster  ON monster_traits(monster_id);
    CREATE INDEX IF NOT EXISTS idx_env_monster     ON monster_environments(monster_id);
    CREATE INDEX IF NOT EXISTS idx_env_environment ON monster_environments(environment);
    CREATE INDEX IF NOT EXISTS idx_tags_monster    ON monster_tags(monster_id);
    CREATE INDEX IF NOT EXISTS idx_tags_tag        ON monster_tags(tag);
  `);
}

// ─────────────────────────────────────────────────────────────
// migrateIfNeeded
// Reads user_version pragma and runs any pending migration blocks.
// Add future migrations as numbered entries in the migrations array.
// ─────────────────────────────────────────────────────────────
function migrateIfNeeded(db, label) {
  const currentVersion = db.pragma('user_version', { simple: true });

  const migrations = [
    // v1 → baseline, nothing to run (tables created above)
    // v1 → v2: Phase 17 — add ddb_character_url column to sessions
    (db) => {
      db.exec(`ALTER TABLE sessions ADD COLUMN ddb_character_url TEXT;`);
      console.log('[db] Added ddb_character_url column to sessions table');
    },
  ];

  for (let v = currentVersion; v < SCHEMA_VERSION; v++) {
    const migration = migrations[v];
    if (migration) {
      console.log(`[db:${label}] migrating v${v} → v${v + 1}`);
      db.transaction(() => {
        migration(db);
        db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  if (currentVersion < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Prepared statement helpers used throughout the app
// ─────────────────────────────────────────────────────────────
function getStatements(campaignDb) {
  return {

    // sessions
    insertSession: campaignDb.prepare(`
      INSERT INTO sessions (session_code, dm_name, started_at, party_level, party_size)
      VALUES (@session_code, @dm_name, @started_at, @party_level, @party_size)
    `),
    endSession: campaignDb.prepare(`
      UPDATE sessions SET status='ended', ended_at=@ended_at WHERE id=@id
    `),
    getActiveSession: campaignDb.prepare(`
      SELECT * FROM sessions WHERE status='active' ORDER BY started_at DESC LIMIT 1
    `),

    // players
    upsertPlayer: campaignDb.prepare(`
      INSERT INTO players (session_id, character_name, player_name, ddb_character_id, role, joined_at)
      VALUES (@session_id, @character_name, @player_name, @ddb_character_id, @role, @joined_at)
      ON CONFLICT(id) DO UPDATE SET character_name=excluded.character_name
    `),
    getPlayers: campaignDb.prepare(`
      SELECT * FROM players WHERE session_id=? ORDER BY joined_at
    `),

    // rolls
    insertRoll: campaignDb.prepare(`
      INSERT INTO rolls
        (session_id, player_id, dice_type, raw_result, modifier, total,
         action_label, roll_type, is_secret, is_crit, is_nat1, source, rolled_at)
      VALUES
        (@session_id, @player_id, @dice_type, @raw_result, @modifier, @total,
         @action_label, @roll_type, @is_secret, @is_crit, @is_nat1, @source, @rolled_at)
    `),
    getPublicRolls: campaignDb.prepare(`
      SELECT r.*, p.character_name, p.player_name
      FROM rolls r LEFT JOIN players p ON r.player_id = p.id
      WHERE r.session_id=? AND r.is_secret=0 AND r.source='ddb'
      ORDER BY r.rolled_at DESC LIMIT 100
    `),
    getAllRollsDM: campaignDb.prepare(`
      SELECT r.*, p.character_name, p.player_name
      FROM rolls r LEFT JOIN players p ON r.player_id = p.id
      WHERE r.session_id=? AND r.source='ddb'
      ORDER BY r.rolled_at DESC LIMIT 100
    `),

    // initiative
    upsertCombatant: campaignDb.prepare(`
      INSERT INTO initiative
        (session_id, combatant_name, combatant_type, initiative_score,
         hp_current, hp_max, ac, sort_order, monster_id)
      VALUES
        (@session_id, @combatant_name, @combatant_type, @initiative_score,
         @hp_current, @hp_max, @ac, @sort_order, @monster_id)
    `),
    updateHp: campaignDb.prepare(`
      UPDATE initiative SET hp_current=@hp_current WHERE id=@id
    `),
    setActiveTurn: campaignDb.prepare(`
      UPDATE initiative SET is_active_turn = (id=@id) WHERE session_id=@session_id
    `),
    getInitiative: campaignDb.prepare(`
      SELECT * FROM initiative WHERE session_id=? ORDER BY sort_order
    `),
    clearInitiative: campaignDb.prepare(`
      DELETE FROM initiative WHERE session_id=?
    `),

    // npcs
    upsertNpc: campaignDb.prepare(`
      INSERT INTO npcs (session_id, name, first_mentioned_at, role, faction, notes, status)
      VALUES (@session_id, @name, @first_mentioned_at, @role, @faction, @notes, @status)
      ON CONFLICT DO NOTHING
    `),
    getNpcs: campaignDb.prepare(`
      SELECT * FROM npcs WHERE session_id=? ORDER BY first_mentioned_at
    `),

    // utterances
    insertUtterance: campaignDb.prepare(`
      INSERT INTO utterances
        (session_id, speaker_name, text, spoken_at, transcript_source_id, chunk_index)
      VALUES
        (@session_id, @speaker_name, @text, @spoken_at, @transcript_source_id, @chunk_index)
    `),
    getUtterances: campaignDb.prepare(`
      SELECT * FROM utterances WHERE session_id=? ORDER BY spoken_at
    `),

    // embeddings
    insertEmbedding: campaignDb.prepare(`
      INSERT INTO embeddings (utterance_id, vector, model, created_at)
      VALUES (@utterance_id, @vector, @model, @created_at)
    `),

    // encounters_log
    insertEncounter: campaignDb.prepare(`
      INSERT INTO encounters_log
        (session_id, encounter_json, difficulty, xp_total, generated_at)
      VALUES
        (@session_id, @encounter_json, @difficulty, @xp_total, @generated_at)
    `),
    markEncounterUsed: campaignDb.prepare(`
      UPDATE encounters_log SET used=1 WHERE id=?
    `),

    // stats
    getSessionStats: campaignDb.prepare(`
      SELECT
        COUNT(*)                                              AS total_rolls,
        ROUND(AVG(CAST(total AS REAL)), 1)                   AS avg_roll,
        MAX(total)                                           AS highest_roll,
        MIN(total)                                           AS lowest_roll,
        SUM(is_crit)                                         AS total_crits,
        SUM(is_nat1)                                         AS total_nat1s,
        ROUND(100.0 * SUM(is_crit) / MAX(COUNT(*), 1), 1)   AS crit_pct,
        ROUND(100.0 * SUM(is_nat1) / MAX(COUNT(*), 1), 1)   AS nat1_pct
      FROM rolls
      WHERE session_id=? AND is_secret=0 AND source='ddb'
    `),
    getRollDistribution: campaignDb.prepare(`
      SELECT
        SUM(CASE WHEN total BETWEEN 1  AND 5  THEN 1 ELSE 0 END) AS band_1_5,
        SUM(CASE WHEN total BETWEEN 6  AND 10 THEN 1 ELSE 0 END) AS band_6_10,
        SUM(CASE WHEN total BETWEEN 11 AND 15 THEN 1 ELSE 0 END) AS band_11_15,
        SUM(CASE WHEN total BETWEEN 16 AND 20 THEN 1 ELSE 0 END) AS band_16_20,
        SUM(CASE WHEN total >= 21             THEN 1 ELSE 0 END) AS band_20plus
      FROM rolls
      WHERE session_id=? AND is_secret=0 AND source='ddb'
    `),
    getTopActions: campaignDb.prepare(`
      SELECT action_label, COUNT(*) AS count, ROUND(AVG(CAST(total AS REAL)), 1) AS avg_total
      FROM rolls
      WHERE session_id=? AND is_secret=0 AND source='ddb' AND action_label IS NOT NULL
      GROUP BY action_label
      ORDER BY count DESC
      LIMIT 8
    `),
  };
}

module.exports = {
  openCampaignDb,
  openBestiaryDb,
  getStatements,
  getCampaignDbPath,
  getBestiaryDbPath,
};

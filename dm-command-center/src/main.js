'use strict';

const { app, BrowserWindow, ipcMain, WebContentsView } = require('electron');
const path = require('path');
const { openCampaignDb, openBestiaryDb, getStatements } = require('./db/db-init');
const relay = require('./relay-client');

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let mainWindow   = null;
let campaignDb   = null;
let bestiaryDb   = null;
let db           = null;
let activeSession = null;
let appRole      = null; // 'dm' | 'player'

// WebContentsView references
let ddbView      = null;
let roll20View   = null;
let discordView  = null;
let overlayView  = null;

// Layout constants (pixels)
const HEADER_H       = 34;
const DISCORD_H      = 160; // default, resizable
const SIDEBAR_W      = 260;

// ─────────────────────────────────────────────────────────────
// App ready
// ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  campaignDb = openCampaignDb(app);
  bestiaryDb = openBestiaryDb();
  db         = getStatements(campaignDb);

  registerIpcHandlers();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  relay.disconnect();
  if (campaignDb) campaignDb.close();
  // bestiaryDb is read-only, SQLite closes it safely on process exit
});

// ─────────────────────────────────────────────────────────────
// Main window
// ─────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:  1600,
    height: 960,
    minWidth:  1200,
    minHeight: 700,
    backgroundColor: '#0d0b08',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The shell HTML — header bar + role picker UI
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', () => layoutViews());
  mainWindow.webContents.on('did-finish-load', () => layoutViews());
}

// ─────────────────────────────────────────────────────────────
// WebContentsView layout
// Called on window resize and whenever discord strip height changes.
// ─────────────────────────────────────────────────────────────
let discordStripH = DISCORD_H;

function layoutViews() {
  if (!mainWindow) return;
  const [winW, winH] = mainWindow.getContentSize();

  const contentTop  = HEADER_H + discordStripH;
  const contentH    = winH - contentTop;
  const mainW       = winW - SIDEBAR_W;

  if (discordView) {
    discordView.setBounds({ x: 0, y: HEADER_H, width: winW, height: discordStripH });
  }

  if (appRole === 'dm') {
    // DM: left panel = Roll20, right sidebar = overlay
    if (roll20View) {
      roll20View.setBounds({ x: 0, y: contentTop, width: mainW, height: contentH });
    }
    if (overlayView) {
      overlayView.setBounds({ x: mainW, y: contentTop, width: SIDEBAR_W, height: contentH });
    }
    if (ddbView) ddbView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // hidden

  } else if (appRole === 'player') {
    // Player: left panel = DDB character sheet, right sidebar = overlay
    if (ddbView) {
      ddbView.setBounds({ x: 0, y: contentTop, width: mainW, height: contentH });
    }
    if (overlayView) {
      overlayView.setBounds({ x: mainW, y: contentTop, width: SIDEBAR_W, height: contentH });
    }
    if (roll20View) roll20View.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // hidden
  }
}

// ─────────────────────────────────────────────────────────────
// Create views for a given role
// ─────────────────────────────────────────────────────────────
function createViews(role) {
  const urls = {
    ddb:     'https://www.dndbeyond.com',
    roll20:  'https://app.roll20.net',
    discord: 'https://discord.com/app',
    overlay: path.join(__dirname, 'renderer', role === 'dm' ? 'overlay-dm.html' : 'overlay-player.html'),
  };

  // Discord view (both roles)
  discordView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.contentView.addChildView(discordView);
  discordView.webContents.loadURL(urls.discord);

  // DDB view
  ddbView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-ddb.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.contentView.addChildView(ddbView);
  ddbView.webContents.loadURL(urls.ddb);

  // Roll20 view (DM only — created for both but only shown for DM)
  roll20View = new WebContentsView({
    webPreferences: {
      preload: role === 'dm' ? path.join(__dirname, 'preload-r20.js') : undefined,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.contentView.addChildView(roll20View);
  if (role === 'dm') roll20View.webContents.loadURL(urls.roll20);

  // Overlay view (local HTML file, has access to ipcRenderer via preload-main)
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.contentView.addChildView(overlayView);
  overlayView.webContents.loadFile(
    role === 'dm'
      ? path.join(__dirname, 'renderer', 'overlay-dm.html')
      : path.join(__dirname, 'renderer', 'overlay-player.html')
  );

  layoutViews();
}

// ─────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────
function registerIpcHandlers() {

  // ── Role picker ──────────────────────────────────────────
  // Renderer sends this when the user clicks DM or Player on launch
  ipcMain.handle('session:set-role', async (_, { role, playerName, sessionCode, partyLevel, partySize, isCreating }) => {
    appRole = role;

    if (role === 'dm') {
      // DM always creates a new session
      const code = generateSessionCode();
      const info = db.insertSession.run({
        session_code: code,
        host_name:    playerName || 'Dungeon Master',
        host_role:    'dm',
        started_at:   Date.now(),
        party_level:  partyLevel || 1,
        party_size:   partySize  || 4,
      });
      activeSession = { id: info.lastInsertRowid, code, role: 'dm' };

    } else if (role === 'player' && isCreating) {
      // Player creating a new session — gets a real session_id for roll tracking
      const code = generateSessionCode();
      const info = db.insertSession.run({
        session_code: code,
        host_name:    playerName || 'Player',
        host_role:    'player',
        started_at:   Date.now(),
        party_level:  1,
        party_size:   4,
      });
      activeSession = { id: info.lastInsertRowid, code, role: 'player' };

    } else {
      // Player joining an existing session by code
      // Create a local stub so rolls have a session_id in this instance's DB
      const code = sessionCode.toUpperCase();
      const existing = db.getSessionByCode.get(code);
      if (existing) {
        activeSession = { id: existing.id, code, role: 'player' };
      } else {
        const info = db.insertSession.run({
          session_code: code,
          host_name:    playerName || 'Player',
          host_role:    'player',
          started_at:   Date.now(),
          party_level:  1,
          party_size:   4,
        });
        activeSession = { id: info.lastInsertRowid, code, role: 'player' };
      }
    }

    createViews(role);
    relay.joinSession(activeSession.code, role, playerName);
    setupRelayListeners();

    return { ok: true, session: activeSession };
  });

  // ── Roll capture (from preload-ddb.js) ───────────────────
  ipcMain.on('roll:captured', (_, payload) => {
    if (!activeSession) return;

    const roll = {
      session_id:   activeSession.id ?? null,
      player_id:    payload.player_id ?? null,
      dice_type:    payload.dice_type,
      raw_result:   payload.raw_result,
      modifier:     payload.modifier ?? 0,
      total:        payload.total,
      action_label: payload.action_label ?? null,
      roll_type:    payload.roll_type ?? 'check',
      is_secret:    payload.is_secret ? 1 : 0,
      is_crit:      payload.is_crit   ? 1 : 0,
      is_nat1:      payload.is_nat1   ? 1 : 0,
      source:       'ddb',
      rolled_at:    payload.rolled_at ?? Date.now(),
    };

    db.insertRoll.run(roll);

    // Don't broadcast secret rolls to overlay or relay
    if (roll.is_secret) return;

    // Push to overlay
    overlayView?.webContents.send('roll:display', roll);

    // Broadcast to relay
    relay.broadcastRoll(roll);
  });

  // ── HP update (from preload-r20.js, DM only) ────────────
  ipcMain.on('hp:update', (_, { combatant_name, hp_current }) => {
    if (!activeSession || appRole !== 'dm') return;

    campaignDb.prepare(`
      UPDATE initiative SET hp_current=?
      WHERE session_id=? AND combatant_name=?
    `).run(hp_current, activeSession.id, combatant_name);

    overlayView?.webContents.send('hp:update', { combatant_name, hp_current });
    relay.broadcastHpUpdate(combatant_name, hp_current);
  });

  // ── Initiative ───────────────────────────────────────────
  ipcMain.handle('initiative:get', () => {
    if (!activeSession) return [];
    return db.getInitiative.all(activeSession.id);
  });

  ipcMain.on('initiative:set-turn', (_, { id }) => {
    if (!activeSession || appRole !== 'dm') return;
    db.setActiveTurn.run({ id, session_id: activeSession.id });
    const combatants = db.getInitiative.all(activeSession.id);
    overlayView?.webContents.send('initiative:sync', combatants);
    relay.broadcastInitiativeSync(combatants);
  });

  ipcMain.handle('initiative:add-combatant', (_, combatant) => {
    if (!activeSession || appRole !== 'dm') return { ok: false };
    const info = db.upsertCombatant.run({ ...combatant, session_id: activeSession.id });
    const combatants = db.getInitiative.all(activeSession.id);
    overlayView?.webContents.send('initiative:sync', combatants);
    relay.broadcastInitiativeSync(combatants);
    return { ok: true, id: info.lastInsertRowid };
  });

  ipcMain.on('initiative:clear', () => {
    if (!activeSession || appRole !== 'dm') return;
    db.clearInitiative.run(activeSession.id);
    overlayView?.webContents.send('initiative:sync', []);
    relay.broadcastInitiativeSync([]);
  });

  // ── Rolls — query for overlay (all roles) ───────────────
  ipcMain.handle('rolls:get', (_) => {
    if (!activeSession) return [];
    return appRole === 'dm'
      ? db.getAllRollsDM.all(activeSession.id)
      : db.getPublicRolls.all(activeSession.id);
  });

  // ── Roll stats ───────────────────────────────────────────
  ipcMain.handle('stats:get', () => {
    if (!activeSession?.id) return null;
    const id = activeSession.id;
    return {
      summary:      db.getSessionStats.get(id),
      distribution: db.getRollDistribution.get(id),
      topActions:   db.getTopActions.all(id),
      byType:       db.getRollsByType.all(id),
      byPlayer:     db.getPlayerStats.all(id),
    };
  });

  // ── Session info ─────────────────────────────────────────
  ipcMain.handle('session:get-info', () => {
    if (!activeSession) return null;
    return {
      code: activeSession.code,
      role: activeSession.role,
      playerCount: 1, // TODO: Get from relay in Phase 11.5
    };
  });

  // ── Discord strip resize ─────────────────────────────────
  ipcMain.on('discord:resize', (_, { height }) => {
    discordStripH = Math.max(60, Math.min(320, height));
    layoutViews();
  });

  // ── Bestiary query (encounter generator) ─────────────────
  ipcMain.handle('bestiary:query', (_, { crMin, crMax, environment, type, limit }) => {
    if (!bestiaryDb) return [];

    let sql = `
      SELECT m.* FROM monsters m
      WHERE m.cr >= @crMin AND m.cr <= @crMax
    `;
    const params = { crMin: crMin ?? 0, crMax: crMax ?? 30, limit: limit ?? 20 };

    if (environment) {
      sql += ` AND m.id IN (
        SELECT monster_id FROM monster_environments WHERE environment=@environment
      )`;
      params.environment = environment;
    }
    if (type) {
      sql += ` AND m.type=@type`;
      params.type = type;
    }

    sql += ` ORDER BY RANDOM() LIMIT @limit`;

    return bestiaryDb.prepare(sql).all(params);
  });

  ipcMain.handle('bestiary:get-monster', (_, { id }) => {
    if (!bestiaryDb) return null;
    const monster  = bestiaryDb.prepare(`SELECT * FROM monsters WHERE id=?`).get(id);
    if (!monster) return null;
    monster.actions = bestiaryDb.prepare(`SELECT * FROM monster_actions WHERE monster_id=? ORDER BY action_type`).all(id);
    monster.traits  = bestiaryDb.prepare(`SELECT * FROM monster_traits  WHERE monster_id=?`).all(id);
    return monster;
  });

  // ── Encounter log ────────────────────────────────────────
  ipcMain.handle('encounter:save', (_, encounter) => {
    if (!activeSession || appRole !== 'dm') return { ok: false };
    const info = db.insertEncounter.run({
      session_id:     activeSession.id,
      encounter_json: JSON.stringify(encounter.monsters),
      difficulty:     encounter.difficulty,
      xp_total:       encounter.xp_total,
      generated_at:   Date.now(),
    });
    return { ok: true, id: info.lastInsertRowid };
  });

  // ── Session end ──────────────────────────────────────────
  ipcMain.on('session:end', () => {
    if (!activeSession) return;
    relay.leaveSession();
    if (activeSession.id) db.endSession.run({ id: activeSession.id, ended_at: Date.now() });
    activeSession = null;
  });
}

// ─────────────────────────────────────────────────────────────
// Relay event listeners
// ─────────────────────────────────────────────────────────────
function setupRelayListeners() {
  relay.onRollBroadcast((roll) => {
    // Tag as remote so the overlay can show player attribution
    overlayView?.webContents.send('roll:display', { ...roll, _fromRelay: true });
  });

  relay.onHpUpdate(({ combatant_name, hp_current }) => {
    overlayView?.webContents.send('hp:update', { combatant_name, hp_current });
  });

  relay.onInitiativeSync((combatants) => {
    overlayView?.webContents.send('initiative:sync', combatants);
  });

  relay.onPlayerJoined(() => {
    console.log('[Relay] Player joined session');
  });

  relay.onPlayerLeft(() => {
    console.log('[Relay] Player left session');
  });
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function generateSessionCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

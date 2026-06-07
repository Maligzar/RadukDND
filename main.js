'use strict';

const { app, BrowserWindow, BrowserView, ipcMain, shell } = require('electron');
const path = require('path');
const { openCampaignDb, openBestiaryDb, getStatements } = require('./db/db-init');

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let mainWindow    = null; // BrowserWindow — shell + role picker
let campaignDb    = null;
let bestiaryDb    = null;
let db            = null;
let activeSession = null;
let appRole       = null;

// BrowserView references (Electron 29 API for embedded panels)
let titlebarView    = null; // always-on-top full-width title bar
let cardBrowserView = null; // Phase 13: card browser (spells/items) on left
let ddbView         = null;
let roll20View      = null;
let overlayView     = null;

// Phase 10: guard against duplicate createViews() calls
let viewsCreated = false;
let activeView   = 'ddb'; // 'ddb' | 'roll20'

const HEADER_H       = 34;
const SIDEBAR_W      = 260;
const CARD_BROWSER_W = 80; // Phase 13: collapsible card browser (left sidebar)

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

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (campaignDb) campaignDb.close(); });

// ─────────────────────────────────────────────────────────────
// Main window
// BrowserWindow hosts the shell HTML (role picker).
// After role is chosen, BrowserViews are added for each panel.
// ─────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1200, minHeight: 700,
    backgroundColor: '#0d0b08',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.show();
  mainWindow.focus();

  // Titlebar view — full width, always on top, created immediately so it's
  // visible from launch and never covered by other BrowserViews.
  titlebarView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(titlebarView);
  titlebarView.webContents.loadFile(path.join(__dirname, 'renderer', 'titlebar.html'));
  layoutTitlebar();

  mainWindow.on('resize', () => {
    layoutTitlebar();
    layoutViews();
  });
}

// ─────────────────────────────────────────────────────────────
// Titlebar layout — always full width, always at y:0
// Called on startup and every resize.
// ─────────────────────────────────────────────────────────────
function layoutTitlebar() {
  if (!mainWindow || !titlebarView) return;
  const [winW] = mainWindow.getContentSize();
  titlebarView.setBounds({ x: 0, y: 0, width: winW, height: HEADER_H });
  // Ensure titlebar stays on top by re-adding it last
  mainWindow.removeBrowserView(titlebarView);
  mainWindow.addBrowserView(titlebarView);
}

// ─────────────────────────────────────────────────────────────
// Layout — positions all content BrowserViews below the titlebar
// ─────────────────────────────────────────────────────────────
function layoutViews() {
  if (!mainWindow || !appRole) return;

  const [winW, winH] = mainWindow.getContentSize();
  const contentTop   = HEADER_H;
  const contentH     = winH - contentTop;
  const mainW        = winW - SIDEBAR_W - CARD_BROWSER_W;
  const sidebarH     = winH - HEADER_H;

  // Phase 13: Card browser on left (80px)
  if (cardBrowserView) {
    cardBrowserView.setBounds({ x: 0, y: HEADER_H, width: CARD_BROWSER_W, height: sidebarH });
  }

  // Main content shifted right by card browser width
  const showBounds = { x: CARD_BROWSER_W, y: contentTop, width: mainW, height: contentH };
  const hideBounds = { x: 0, y: 0, width: 0, height: 0 };

  if (ddbView)     ddbView.setBounds(activeView === 'ddb'    ? showBounds : hideBounds);
  if (roll20View)  roll20View.setBounds(activeView === 'roll20' ? showBounds : hideBounds);
  if (overlayView) overlayView.setBounds({ x: CARD_BROWSER_W + mainW, y: HEADER_H, width: SIDEBAR_W, height: sidebarH });

  // Keep titlebar on top after every layout
  layoutTitlebar();
}

// ─────────────────────────────────────────────────────────────
// Create BrowserViews after role picker submits
// Phase 10: guard prevents duplicate invocation
// ─────────────────────────────────────────────────────────────
function createViews(role) {
  if (viewsCreated) {
    console.warn('[main] createViews() called more than once — ignored');
    return;
  }
  viewsCreated = true;

  // Phase 13: Card browser (spells & items) on left
  cardBrowserView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(cardBrowserView);
  cardBrowserView.webContents.loadFile(path.join(__dirname, 'renderer', 'card-browser.html'));

  // Overlay sidebar
  overlayView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(overlayView);
  overlayView.webContents.loadFile(
    role === 'dm'
      ? path.join(__dirname, 'renderer', 'overlay-dm.html')
      : path.join(__dirname, 'renderer', 'overlay-player.html')
  );

  // D&D Beyond
  ddbView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-ddb.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(ddbView);
  ddbView.webContents.loadURL('https://www.dndbeyond.com');
  ddbView.webContents.openDevTools({ mode: 'detach' });

  // Roll20 — shared map for all roles
  roll20View = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-r20.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.addBrowserView(roll20View);
  roll20View.webContents.loadURL('https://app.roll20.net');

  // Default active view per role; tell the titlebar to show tabs
  activeView = role === 'dm' ? 'roll20' : 'ddb';
  layoutViews();
  setTimeout(() => {
    titlebarView?.webContents.send('view:active', {
      view: activeView,
      sessionCode: activeSession?.code ?? null,
    });
  }, 500);
}

// ─────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────
function registerIpcHandlers() {

  // ── Phase 10: Window controls ──────────────────────────────
  ipcMain.on('window:exit', () => {
    app.quit();
  });

  ipcMain.on('window:fullscreen', () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

  ipcMain.on('window:minimize', () => {
    if (!mainWindow) return;
    mainWindow.minimize();
  });

  // ── Role picker ────────────────────────────────────────────
  ipcMain.handle('session:set-role', async (_, { role, characterName, playerName, sessionCode, partyLevel, partySize }) => {
    appRole = role;

    if (role === 'dm') {
      const code = sessionCode || generateSessionCode();
      const info = db.insertSession.run({
        session_code: code, dm_name: playerName || 'Dungeon Master',
        started_at: Date.now(), party_level: partyLevel || 1, party_size: partySize || 6,
      });
      activeSession = { id: info.lastInsertRowid, code, role: 'dm' };
    } else {
      const code = generateSessionCode();
      const info = db.insertSession.run({
        session_code: code, dm_name: 'DM',
        started_at: Date.now(), party_level: partyLevel || 1, party_size: partySize || 6,
      });
      const playerInfo = campaignDb.prepare(
        `INSERT INTO players (session_id, character_name, player_name, role, joined_at) VALUES (?, ?, ?, 'player', ?)`
      ).run(info.lastInsertRowid, characterName || 'Hero', playerName || 'Player', Date.now());

      activeSession = {
        id: info.lastInsertRowid, player_id: playerInfo.lastInsertRowid,
        code, role: 'player',
        characterName: characterName || 'Hero',
        playerName:    playerName    || 'Player',
      };
    }

    createViews(role);
    return { ok: true, session: activeSession };
  });

  // ── Phase 16: Get current session info for onboarding ──────
  ipcMain.handle('session:get', () => {
    if (!activeSession) return null;
    return campaignDb.prepare('SELECT * FROM sessions WHERE id=?').get(activeSession.id);
  });

  // ── Roll capture ───────────────────────────────────────────
  ipcMain.on('roll:captured', (_, payload) => {
    if (!activeSession) return;
    const roll = {
      session_id: activeSession.id, player_id: activeSession.player_id ?? null,
      dice_type: payload.dice_type, raw_result: payload.raw_result,
      modifier: payload.modifier ?? 0, total: payload.total,
      action_label: payload.action_label ?? null, roll_type: payload.roll_type ?? 'check',
      is_secret: payload.is_secret ? 1 : 0, is_crit: payload.is_crit ? 1 : 0,
      is_nat1: payload.is_nat1 ? 1 : 0, source: 'ddb',
      rolled_at: payload.rolled_at ?? Date.now(),
    };
    db.insertRoll.run(roll);
    if (roll.is_secret) return;
    if (overlayView) {
      overlayView.webContents.send('roll:display', {
        ...roll,
        character_name: activeSession.characterName ?? null,
        player_name:    activeSession.playerName    ?? null,
      });
    }
    // TODO Phase 11: relaySocket?.emit('roll:broadcast', roll);
  });

  // ── HP update (DM only) ────────────────────────────────────
  ipcMain.on('hp:update', (_, { combatant_name, hp_current }) => {
    if (!activeSession || appRole !== 'dm') return;
    campaignDb.prepare(`UPDATE initiative SET hp_current=? WHERE session_id=? AND combatant_name=?`)
      .run(hp_current, activeSession.id, combatant_name);
    overlayView?.webContents.send('hp:update', { combatant_name, hp_current });
  });

  // ── Phase 14: HP update from Roll20 ────────────────────────
  ipcMain.on('hp:r20-update', (_, { token_name, token_id, hp_current, hp_max }) => {
    if (!activeSession) return;

    // Try to find matching combatant by name
    const combatant = campaignDb.prepare(
      `SELECT id FROM initiative WHERE session_id=? AND combatant_name=? LIMIT 1`
    ).get(activeSession.id, token_name);

    if (combatant) {
      // Update existing combatant
      campaignDb.prepare(`UPDATE initiative SET hp_current=? WHERE id=? AND session_id=?`)
        .run(hp_current, combatant.id, activeSession.id);

      console.log(`[main] R20 HP sync: ${token_name} → ${hp_current}`);

      // Broadcast update to overlay
      overlayView?.webContents.send('hp:update', { combatant_name: token_name, hp_current });
      overlayView?.webContents.send('initiative:sync', db.getInitiative.all(activeSession.id));
    } else {
      console.log(`[main] R20 HP update for unknown combatant: ${token_name}`);
      // Could optionally auto-add combatant, but DM should add manually for control
    }
  });

  // ── Phase 14: Damage parsing from chat ─────────────────────
  ipcMain.on('damage:parsed', (_, { type, amount, target_name }) => {
    if (!activeSession || appRole !== 'dm') return;

    const combatant = campaignDb.prepare(
      `SELECT id, hp_current, hp_max FROM initiative WHERE session_id=? AND combatant_name=? LIMIT 1`
    ).get(activeSession.id, target_name);

    if (combatant && type === 'damage') {
      const newHp = Math.max(0, combatant.hp_current - amount);
      campaignDb.prepare(`UPDATE initiative SET hp_current=? WHERE id=?`)
        .run(newHp, combatant.id);

      console.log(`[main] Chat damage: ${target_name} took ${amount} → ${newHp}/${combatant.hp_max}`);

      overlayView?.webContents.send('initiative:sync', db.getInitiative.all(activeSession.id));
    } else if (combatant && type === 'heal') {
      const newHp = Math.min(combatant.hp_max, combatant.hp_current + amount);
      campaignDb.prepare(`UPDATE initiative SET hp_current=? WHERE id=?`)
        .run(newHp, combatant.id);

      console.log(`[main] Chat heal: ${target_name} healed ${amount} → ${newHp}/${combatant.hp_max}`);

      overlayView?.webContents.send('initiative:sync', db.getInitiative.all(activeSession.id));
    }
  });

  // ── Initiative ─────────────────────────────────────────────
  ipcMain.handle('initiative:get', () => {
    if (!activeSession) return [];
    return db.getInitiative.all(activeSession.id);
  });

  ipcMain.on('initiative:set-turn', (_, { id }) => {
    if (!activeSession || appRole !== 'dm') return;
    db.setActiveTurn.run({ id, session_id: activeSession.id });
    overlayView?.webContents.send('initiative:sync', db.getInitiative.all(activeSession.id));
  });

  ipcMain.handle('initiative:add-combatant', (_, combatant) => {
    if (!activeSession || appRole !== 'dm') return { ok: false };
    const count = campaignDb.prepare('SELECT COUNT(*) AS n FROM initiative WHERE session_id=?').get(activeSession.id).n;
    const info = db.upsertCombatant.run({
      session_id:       activeSession.id,
      combatant_name:   combatant.combatant_name,
      combatant_type:   combatant.combatant_type ?? 'player',
      initiative_score: combatant.initiative_score ?? 0,
      hp_current:       combatant.hp_current ?? 0,
      hp_max:           combatant.hp_max     ?? 0,
      ac:               combatant.ac         ?? 10,
      sort_order:       combatant.sort_order ?? count,
      monster_id:       combatant.monster_id ?? null,
    });
    overlayView?.webContents.send('initiative:sync', db.getInitiative.all(activeSession.id));
    return { ok: true, id: info.lastInsertRowid };
  });

  ipcMain.handle('initiative:update', (_, { id, initiative_score, hp_current }) => {
    if (!activeSession || appRole !== 'dm') return { ok: false };
    if (initiative_score !== undefined) {
      campaignDb.prepare('UPDATE initiative SET initiative_score=? WHERE id=? AND session_id=?')
        .run(initiative_score, id, activeSession.id);
    }
    if (hp_current !== undefined) {
      campaignDb.prepare('UPDATE initiative SET hp_current=? WHERE id=? AND session_id=?')
        .run(hp_current, id, activeSession.id);
    }
    overlayView?.webContents.send('initiative:sync', db.getInitiative.all(activeSession.id));
    return { ok: true };
  });

  ipcMain.handle('initiative:remove', (_, { id }) => {
    if (!activeSession || appRole !== 'dm') return { ok: false };
    campaignDb.prepare('DELETE FROM initiative WHERE id=? AND session_id=?').run(id, activeSession.id);
    overlayView?.webContents.send('initiative:sync', db.getInitiative.all(activeSession.id));
    return { ok: true };
  });

  ipcMain.on('initiative:sort', () => {
    if (!activeSession || appRole !== 'dm') return;
    const rows   = db.getInitiative.all(activeSession.id);
    const sorted = [...rows].sort((a, b) => b.initiative_score - a.initiative_score);
    const stmt   = campaignDb.prepare('UPDATE initiative SET sort_order=? WHERE id=?');
    campaignDb.transaction(() => sorted.forEach((r, i) => stmt.run(i, r.id)))();
    overlayView?.webContents.send('initiative:sync', db.getInitiative.all(activeSession.id));
  });

  ipcMain.on('initiative:clear', () => {
    if (!activeSession || appRole !== 'dm') return;
    db.clearInitiative.run(activeSession.id);
    overlayView?.webContents.send('initiative:sync', []);
  });

  // ── Roll history — Phase 10 fix: dmMode derived from appRole, not renderer ──
  ipcMain.handle('rolls:get', () => {
    if (!activeSession) return [];
    return appRole === 'dm'
      ? db.getAllRollsDM.all(activeSession.id)
      : db.getPublicRolls.all(activeSession.id);
  });

  // ── Roll stats ─────────────────────────────────────────────
  ipcMain.handle('stats:get', () => {
    if (!activeSession) return null;
    const id = activeSession.id;
    return {
      summary:      db.getSessionStats.get(id),
      distribution: db.getRollDistribution.get(id),
      topActions:   db.getTopActions.all(id),
    };
  });

  // ── View tab switching ─────────────────────────────────────
  ipcMain.on('view:switch', (_, { view }) => {
    if (!viewsCreated) return;
    activeView = view;
    layoutViews();
  });

  // ── Bestiary — Phase 10 fix: DM role gate added ───────────
  ipcMain.handle('bestiary:query', (_, { crMin, crMax, environment, type, limit }) => {
    if (!bestiaryDb || appRole !== 'dm') return [];
    let sql = `SELECT m.* FROM monsters m WHERE m.cr >= @crMin AND m.cr <= @crMax`;
    const params = { crMin: crMin ?? 0, crMax: crMax ?? 30, limit: limit ?? 20 };
    if (environment) { sql += ` AND m.id IN (SELECT monster_id FROM monster_environments WHERE environment=@environment)`; params.environment = environment; }
    if (type) { sql += ` AND m.type=@type`; params.type = type; }
    sql += ` ORDER BY RANDOM() LIMIT @limit`;
    return bestiaryDb.prepare(sql).all(params);
  });

  ipcMain.handle('bestiary:get-monster', (_, { id }) => {
    if (!bestiaryDb || appRole !== 'dm') return null;
    const monster = bestiaryDb.prepare(`SELECT * FROM monsters WHERE id=?`).get(id);
    if (!monster) return null;
    monster.actions = bestiaryDb.prepare(`SELECT * FROM monster_actions WHERE monster_id=? ORDER BY action_type`).all(id);
    monster.traits  = bestiaryDb.prepare(`SELECT * FROM monster_traits  WHERE monster_id=?`).all(id);
    return monster;
  });

  // ── Encounter save (DM only) ───────────────────────────────
  ipcMain.handle('encounter:save', (_, encounter) => {
    if (!activeSession || appRole !== 'dm') return { ok: false };
    const info = db.insertEncounter.run({
      session_id: activeSession.id, encounter_json: JSON.stringify(encounter.monsters),
      difficulty: encounter.difficulty, xp_total: encounter.xp_total, generated_at: Date.now(),
    });
    return { ok: true, id: info.lastInsertRowid };
  });

  // ── Session end (DM only) ──────────────────────────────────
  ipcMain.on('session:end', () => {
    if (!activeSession || appRole !== 'dm') return;
    db.endSession.run({ id: activeSession.id, ended_at: Date.now() });
    activeSession = null;
  });

  // ── Phase 15: Session Recap data fetchers ─────────────────
  ipcMain.handle('recap:get-rolls', () => {
    if (!activeSession) return [];
    return db.getAllRollsDM.all(activeSession.id);
  });

  ipcMain.handle('recap:get-stats', () => {
    if (!activeSession) return {};
    const id = activeSession.id;
    return {
      summary:      db.getSessionStats.get(id),
      distribution: db.getRollDistribution.get(id),
      topActions:   db.getTopActions.all(id),
    };
  });

  ipcMain.handle('recap:get-initiative', () => {
    if (!activeSession) return [];
    return db.getInitiative.all(activeSession.id);
  });

  ipcMain.handle('recap:get-session', () => {
    if (!activeSession) return {};
    return campaignDb.prepare('SELECT * FROM sessions WHERE id=?').get(activeSession.id);
  });

  // Open recap in a new floating window (DM only)
  ipcMain.on('recap:open', () => {
    if (!activeSession || appRole !== 'dm') return;

    const recapWin = new BrowserWindow({
      width: 900, height: 800,
      title: 'Session Recap',
      backgroundColor: '#f5f0e8',
      parent: mainWindow,
      webPreferences: {
        preload: path.join(__dirname, 'preload-main.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    recapWin.loadFile(path.join(__dirname, 'renderer', 'recap.html'));
    recapWin.setMenuBarVisibility(false);
  });
}

function generateSessionCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

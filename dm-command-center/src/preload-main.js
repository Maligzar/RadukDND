'use strict';

// preload-main.js
// Runs in the main BrowserWindow (the overlay toolbar).
// Exposes a safe bridge between the renderer UI and the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dmBridge', {

  // ── Roll events (listen from main process) ──────────────────────────────
  onRollFlash: (callback) => {
    ipcRenderer.on('overlay:roll-flash', (_event, data) => callback(data));
  },

  // ── Manual roll submission ───────────────────────────────────────────────
  submitManualRoll: (rollData) => {
    ipcRenderer.send('manual:roll', rollData);
  },

  // ── DB queries ───────────────────────────────────────────────────────────
  getRecentRolls: () => ipcRenderer.invoke('db:get-recent-rolls'),
  getSessionStats: () => ipcRenderer.invoke('db:get-session-stats'),

  // ── View controls ────────────────────────────────────────────────────────
  reloadView: (key) => ipcRenderer.send('view:reload', key),
  navigateView: (key, url) => ipcRenderer.send('view:navigate', { key, url }),

  // ── Hotkey list ───────────────────────────────────────────────────────────
  getHotkeys: () => ipcRenderer.invoke('hotkeys:list'),
});

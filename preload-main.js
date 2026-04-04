'use strict';
/**
 * preload-main.js
 * Runs in the shell BrowserWindow (index.html) and the overlay
 * WebContentsView (overlay-dm.html / overlay-player.html).
 * Exposes a minimal, safe ipcRenderer bridge via contextBridge.
 * No Node.js APIs are exposed directly.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Channels the renderer is allowed to SEND to main (fire-and-forget)
const ALLOWED_SEND = new Set([
  'roll:captured',
  'hp:update',
  'initiative:set-turn',
  'initiative:clear',
  'discord:resize',
  'session:end',
  // Phase 10: window controls
  'window:exit',
  'window:fullscreen',
  'window:minimize',
]);

// Channels the renderer is allowed to INVOKE (request/response)
const ALLOWED_INVOKE = new Set([
  'session:set-role',
  'rolls:get',
  'initiative:get',
  'initiative:add-combatant',
  'bestiary:query',
  'bestiary:get-monster',
  'encounter:save',
]);

// Channels the renderer is allowed to RECEIVE from main
const ALLOWED_RECEIVE = new Set([
  'roll:display',
  'hp:update',
  'initiative:sync',
]);

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Send a one-way message to main.js
   * @param {string} channel
   * @param {any} data
   */
  send(channel, data) {
    if (!ALLOWED_SEND.has(channel)) {
      console.warn('[preload-main] blocked send on:', channel);
      return;
    }
    ipcRenderer.send(channel, data);
  },

  /**
   * Send a request to main.js and await a response
   * @param {string} channel
   * @param {any} data
   * @returns {Promise<any>}
   */
  invoke(channel, data) {
    if (!ALLOWED_INVOKE.has(channel)) {
      console.warn('[preload-main] blocked invoke on:', channel);
      return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, data);
  },

  /**
   * Listen for messages pushed from main.js
   * @param {string} channel
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  on(channel, callback) {
    if (!ALLOWED_RECEIVE.has(channel)) {
      console.warn('[preload-main] blocked on() for:', channel);
      return () => {};
    }
    const wrapped = (_, ...args) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /**
   * Listen for a single message then auto-unsubscribe
   * @param {string} channel
   * @param {Function} callback
   */
  once(channel, callback) {
    if (!ALLOWED_RECEIVE.has(channel)) {
      console.warn('[preload-main] blocked once() for:', channel);
      return;
    }
    ipcRenderer.once(channel, (_, ...args) => callback(...args));
  },
});

'use strict';

// preload-ddb.js
// Runs inside the D&D Beyond WebContentsView (isolated world).
// Captures roll results by watching for the toast notification DDB renders
// after every roll — class contains "NotRoot" (tss-1y82djs-NotRoot).
//
// Toast text format: "[Character] Rolled [action_label] [total]"
// e.g. "The Mags Rolled Rajjer the Redeemed to hit 18 and rolled 1d6+9 = 14"
//      "The Mags Rolled custom 41"
//      "The Mags Rolled Insight (+4): Check 16"
//
// Sends roll:captured IPC to main.js with full normalised payload.

const { ipcRenderer } = require('electron');

// ─────────────────────────────────────────────────────────────
// Toast parser
// Extracts roll data from the DDB notification text.
// ─────────────────────────────────────────────────────────────

function parseToastText(text) {
  if (!text) return null;

  const t = text.replace(/\s+/g, ' ').trim();

  if (!t.includes('Rolled')) return null;

  // Extract final total — the last number in the string.
  // Handles: "to hit 18", "Check 16", "custom 41", "= 14"
  const totalMatch = t.match(/(\d+)\s*(?:and rolled.*?=\s*(\d+))?\s*$/);
  if (!totalMatch) return null;

  const total = parseInt(totalMatch[2] ?? totalMatch[1], 10);
  if (isNaN(total)) return null;

  // Extract action label — text between "Rolled " and the trailing number
  const rolledIdx = t.indexOf('Rolled ');
  const afterRolled = t.slice(rolledIdx + 7);

  const action_label = afterRolled
    .replace(/\s*=\s*\d+\s*$/, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/\s+and rolled.*$/, '')
    .trim() || null;

  const roll_type  = inferRollType(action_label ?? '');
  const dice_type  = inferDiceType(action_label ?? '', t);
  const is_crit    = /critical hit|nat\s*20|natural 20/i.test(t);
  const is_nat1    = /critical fail|fumble|nat\s*1\b|natural 1\b/i.test(t);
  const is_secret  = /privat|secret/i.test(t);

  return {
    dice_type,
    raw_result:   total,
    modifier:     0,
    total,
    action_label,
    roll_type,
    is_secret,
    is_crit,
    is_nat1,
    source:       'ddb',
    rolled_at:    Date.now(),
  };
}

function inferRollType(label) {
  const l = label.toLowerCase();
  if (l.includes('to hit') || l.includes('attack'))        return 'attack';
  if (l.includes('damage') || l.includes('rolled 1d'))     return 'damage';
  if (l.includes('saving throw') || l.includes(' save'))   return 'save';
  if (l.includes('heal'))                                   return 'heal';
  if (l.includes('check') || l.includes('initiative') ||
      l.includes('perception') || l.includes('insight') ||
      l.includes('stealth') || l.includes('athletics'))    return 'check';
  return 'other';
}

function inferDiceType(label, fullText) {
  const diceMatch = fullText.match(/\d+(d\d+)/i);
  if (diceMatch) return diceMatch[1].toLowerCase();
  const l = label.toLowerCase();
  if (l.includes('to hit') || l.includes('check') ||
      l.includes('save')   || l.includes('initiative')) return 'd20';
  return 'd20';
}

// ─────────────────────────────────────────────────────────────
// Debounce — ignore duplicate toasts within 800ms
// ─────────────────────────────────────────────────────────────

let lastKey      = null;
let lastKeyTimer = null;

function isDuplicate(roll) {
  const key = `${roll.total}:${roll.action_label}`;
  if (key === lastKey) return true;
  lastKey = key;
  clearTimeout(lastKeyTimer);
  lastKeyTimer = setTimeout(() => { lastKey = null; }, 800);
  return false;
}

// ─────────────────────────────────────────────────────────────
// MutationObserver — watch for NotRoot toast divs
// ─────────────────────────────────────────────────────────────

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;

      const candidates = [];

      if (typeof node.className === 'string' && node.className.includes('NotRoot')) {
        candidates.push(node);
      }
      node.querySelectorAll?.('[class*="NotRoot"]').forEach(el => candidates.push(el));

      for (const el of candidates) {
        const text = el.textContent?.trim();
        if (!text) continue;

        const roll = parseToastText(text);
        if (!roll) continue;
        if (isDuplicate(roll)) continue;

        console.log('[DDB Preload] Roll captured:', roll);
        ipcRenderer.send('roll:captured', roll);
      }
    }
  }
});

function startObserver() {
  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[DDB Preload] Active — watching for roll toasts (NotRoot)');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserver);
} else {
  startObserver();
}

console.log('[DDB Preload] Loaded.');

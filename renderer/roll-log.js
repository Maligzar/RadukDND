'use strict';
/**
 * roll-log.js
 * Runs in the overlay WebContentsView (overlay-dm.html / overlay-player.html).
 * Listens for roll:display events from main.js and renders timestamped
 * roll entries in the WoW Horde ElvUI style.
 *
 * Phase 9: rolled_at (Unix ms) is now formatted as HH:MM:SS local time
 * and shown on every roll entry.
 */

// ─────────────────────────────────────────────────────────────
// IPC bridge (exposed by preload-main.js)
// ─────────────────────────────────────────────────────────────
const { ipcRenderer } = window.electronAPI ?? require('electron');

// ─────────────────────────────────────────────────────────────
// DOM references — set these after the overlay HTML loads
// ─────────────────────────────────────────────────────────────
let rollLogContainer = null;
let MAX_VISIBLE_ROLLS = 100;

// ─────────────────────────────────────────────────────────────
// Phase 9: Timestamp formatter
// Takes a Unix millisecond timestamp and returns "HH:MM:SS"
// in the user's local timezone.
// ─────────────────────────────────────────────────────────────
function formatTimestamp(unixMs) {
  if (!unixMs) return '--:--:--';
  const d = new Date(unixMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ─────────────────────────────────────────────────────────────
// Roll entry renderer
// Builds a DOM element for one roll and prepends it to the log.
// ─────────────────────────────────────────────────────────────
function renderRollEntry(roll) {
  const {
    dice_type    = 'd20',
    raw_result   = 0,
    modifier     = 0,
    total        = 0,
    action_label = null,
    roll_type    = 'check',
    is_secret    = 0,
    is_crit      = 0,
    is_nat1      = 0,
    source       = 'ddb',
    rolled_at    = null,
    character_name = null,
    player_name    = null,
  } = roll;

  const timestamp = formatTimestamp(rolled_at); // Phase 9

  // ── CSS class modifiers ───────────────────────────────────
  const isCrit   = Boolean(is_crit);
  const isNat1   = Boolean(is_nat1);
  const isR20    = source === 'r20';
  const isSecret = Boolean(is_secret);

  let diceClass  = 'dice-face';
  let numClass   = 'roll-result-num';
  let nameClass  = 'roll-action-name';
  if (isCrit) { diceClass += ' crit'; numClass += ' crit'; nameClass += ' crit'; }
  if (isNat1) { diceClass += ' nat1'; numClass += ' nat1'; nameClass += ' nat1'; }

  // ── Modifier display ──────────────────────────────────────
  let modDisplay = '';
  if (modifier > 0)      modDisplay = `+${modifier}`;
  else if (modifier < 0) modDisplay = `${modifier}`;

  // ── Breakdown string ──────────────────────────────────────
  const breakdownParts = [`${raw_result} (${dice_type})`];
  if (modDisplay) breakdownParts.push(modDisplay);
  const breakdown = breakdownParts.join(' ');

  // ── Badge ─────────────────────────────────────────────────
  let badgeHtml = '';
  if (isCrit)   badgeHtml = '<span class="roll-badge crit">CRIT</span>';
  else if (isNat1) badgeHtml = '<span class="roll-badge nat1">NAT 1</span>';
  else if (isR20)  badgeHtml = '<span class="roll-badge r20">R20 \u00b7 skip</span>';
  else             badgeHtml = `<span class="roll-badge source">DDB</span>`;

  // ── Character display ─────────────────────────────────────
  const charDisplay = character_name || player_name || 'Unknown';

  // ── Build DOM element ─────────────────────────────────────
  const entry = document.createElement('div');
  entry.className = `roll-entry${isR20 ? ' ignored' : ''}${isSecret ? ' secret' : ''}`;
  entry.dataset.source    = source;
  entry.dataset.rolledAt  = rolled_at ?? '';
  entry.dataset.total     = total;

  entry.innerHTML = `
    <div class="${diceClass}">${dice_type}</div>
    <div class="roll-info">
      <div class="${nameClass}">${escHtml(action_label || roll_type)}</div>
      <div class="roll-char">${escHtml(charDisplay)}</div>
      <div class="roll-breakdown">${escHtml(breakdown)}</div>
      <div class="roll-time">${timestamp}</div>
    </div>
    <div class="roll-meta">
      <div class="${numClass}">${total}</div>
      ${badgeHtml}
    </div>
  `;

  return entry;
}

// ─────────────────────────────────────────────────────────────
// Prepend to log, trim old entries
// ─────────────────────────────────────────────────────────────
function prependRoll(roll) {
  if (!rollLogContainer) return;

  const entry = renderRollEntry(roll);
  rollLogContainer.prepend(entry);

  // Trim to MAX_VISIBLE_ROLLS to prevent unbounded growth
  const entries = rollLogContainer.querySelectorAll('.roll-entry');
  if (entries.length > MAX_VISIBLE_ROLLS) {
    for (let i = MAX_VISIBLE_ROLLS; i < entries.length; i++) {
      entries[i].remove();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Load roll history on overlay init
// Fetches the last N rolls from main.js SQLite and renders them
// oldest-first so the most recent is at the top.
// ─────────────────────────────────────────────────────────────
async function loadHistory(dmMode = false) {
  try {
    const rolls = await ipcRenderer.invoke('rolls:get', { dmMode });
    if (!Array.isArray(rolls) || rolls.length === 0) return;

    // rolls:get returns DESC order (newest first) — render as-is
    for (const roll of rolls) {
      const entry = renderRollEntry(roll);
      rollLogContainer.appendChild(entry);
    }
  } catch (err) {
    console.error('[roll-log] loadHistory failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────
// IPC listeners
// ─────────────────────────────────────────────────────────────
function attachListeners(dmMode) {
  // Live roll pushed from main.js
  ipcRenderer.on('roll:display', (_, roll) => {
    prependRoll(roll);
  });
}

// ─────────────────────────────────────────────────────────────
// Escape HTML for safe innerHTML insertion
// ─────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────
// Init — called from overlay HTML after DOM is ready
// ─────────────────────────────────────────────────────────────
function initRollLog(containerSelector, options = {}) {
  rollLogContainer  = document.querySelector(containerSelector);
  MAX_VISIBLE_ROLLS = options.maxRolls ?? 100;
  const dmMode      = options.dmMode  ?? false;

  if (!rollLogContainer) {
    console.error('[roll-log] container not found:', containerSelector);
    return;
  }

  attachListeners(dmMode);
  loadHistory(dmMode);
}

// Export for use in overlay HTML via script tag or module
window.initRollLog = initRollLog;

// ─────────────────────────────────────────────────────────────
// CSS — injected into the overlay document
// Defines all roll entry styles in the Horde ElvUI theme.
// ─────────────────────────────────────────────────────────────
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .roll-entry {
      display: grid;
      grid-template-columns: 36px 1fr auto;
      align-items: start;
      gap: 8px;
      padding: 5px 10px;
      border-bottom: 1px solid rgba(74,60,40,0.25);
      transition: background 0.1s;
    }
    .roll-entry:hover { background: rgba(200,146,42,0.04); }
    .roll-entry.ignored { opacity: 0.32; }
    .roll-entry.secret  { opacity: 0.60; }

    .dice-face {
      width: 32px; height: 32px;
      background: #1e1916;
      border: 1px solid #4a3c28;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Cinzel', serif;
      font-size: 10px;
      color: #a08060;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .dice-face.crit {
      border-color: #ffd100;
      background: rgba(255,209,0,0.07);
      color: #ffd100;
    }
    .dice-face.nat1 {
      border-color: #cc2a2a;
      background: rgba(140,26,26,0.13);
      color: #cc2a2a;
    }

    .roll-info { min-width: 0; }

    .roll-action-name {
      font-size: 12px;
      color: #e8dcc8;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .roll-action-name.crit { color: #ffd100; }
    .roll-action-name.nat1 { color: #cc2a2a; }

    .roll-char {
      font-size: 10px;
      color: #705a3a;
      margin-top: 2px;
    }
    .roll-breakdown {
      font-size: 10px;
      color: #4a3820;
      margin-top: 1px;
      font-family: 'Courier New', monospace;
    }

    /* Phase 9: timestamp */
    .roll-time {
      font-size: 10px;
      color: #4a3820;
      margin-top: 1px;
      font-family: 'Courier New', monospace;
      letter-spacing: 0.03em;
    }

    .roll-meta {
      text-align: right;
      flex-shrink: 0;
    }
    .roll-result-num {
      font-family: 'Cinzel', serif;
      font-size: 20px;
      font-weight: 700;
      color: #c9b08a;
      line-height: 1;
    }
    .roll-result-num.crit { color: #ffd100; }
    .roll-result-num.nat1 { color: #cc2a2a; }

    .roll-badge {
      display: inline-block;
      font-family: 'Cinzel', serif;
      font-size: 8px;
      letter-spacing: 0.08em;
      padding: 1px 5px;
      border: 1px solid;
      margin-top: 3px;
    }
    .roll-badge.crit   { color: #ffd100; border-color: rgba(255,209,0,0.4);  background: rgba(255,209,0,0.06); }
    .roll-badge.nat1   { color: #cc2a2a; border-color: rgba(204,42,42,0.4);  background: rgba(140,26,26,0.10); }
    .roll-badge.r20    { color: #705a3a; border-color: rgba(74,60,40,0.4);   background: transparent; font-size: 7px; }
    .roll-badge.source { color: #705a3a; border-color: rgba(74,60,40,0.35);  background: transparent; font-size: 7px; }
  `;
  document.head.appendChild(style);
})();

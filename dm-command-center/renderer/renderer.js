'use strict';

// renderer.js — runs in the overlay toolbar BrowserWindow

const bridge = window.dmBridge;

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENTS
// ─────────────────────────────────────────────────────────────────────────────

const rollIndicator = document.getElementById('roll-indicator');
const rollLabel     = document.getElementById('roll-label');
const rollExpr      = document.getElementById('roll-expr');
const rollResult    = document.getElementById('roll-result');
const rollBadge     = document.getElementById('roll-badge');

const statTotal   = document.getElementById('stat-total');
const statAvg     = document.getElementById('stat-avg');
const statCrits   = document.getElementById('stat-crits');
const statFumbles = document.getElementById('stat-fumbles');
const statHigh    = document.getElementById('stat-high');

const logOverlay  = document.getElementById('log-overlay');
const logList     = document.getElementById('log-list');
const helpOverlay = document.getElementById('help-overlay');
const hotkeyList  = document.getElementById('hotkey-list');

// ─────────────────────────────────────────────────────────────────────────────
// ROLL FLASH
// ─────────────────────────────────────────────────────────────────────────────

let flashTimeout = null;

bridge.onRollFlash((roll) => {
  // Update display
  rollLabel.textContent  = roll.label  ?? 'Roll';
  rollExpr.textContent   = roll.expression ?? '?';
  rollResult.textContent = roll.result !== null ? roll.result : '…';

  // Badge
  if (roll.isCrit) {
    rollBadge.textContent = 'CRIT!';
    rollBadge.style.background = 'var(--crit)';
    rollBadge.style.display = 'inline';
  } else if (roll.isFumble) {
    rollBadge.textContent = 'MISS';
    rollBadge.style.background = 'var(--fumble)';
    rollBadge.style.display = 'inline';
  } else {
    rollBadge.style.display = 'none';
  }

  // Flash class
  rollIndicator.classList.remove('flash-crit', 'flash-fumble', 'flash-normal');
  if (flashTimeout) clearTimeout(flashTimeout);

  void rollIndicator.offsetWidth; // force reflow for re-animation
  rollIndicator.classList.add(
    roll.isCrit ? 'flash-crit' : roll.isFumble ? 'flash-fumble' : 'flash-normal'
  );

  flashTimeout = setTimeout(() => {
    rollIndicator.classList.remove('flash-crit', 'flash-fumble', 'flash-normal');
  }, 3000);

  // Refresh stats
  refreshStats();
});

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────

async function refreshStats() {
  try {
    const s = await bridge.getSessionStats();
    if (!s) return;
    statTotal.textContent   = s.total_rolls   ?? 0;
    statAvg.textContent     = s.avg_result    ?? '—';
    statCrits.textContent   = s.total_crits   ?? 0;
    statFumbles.textContent = s.total_fumbles ?? 0;
    statHigh.textContent    = s.highest_roll  ?? '—';
  } catch (e) {
    console.warn('[Renderer] Stats fetch failed:', e);
  }
}

// Refresh once on load
refreshStats();

// ─────────────────────────────────────────────────────────────────────────────
// ROLL LOG PANEL
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-log').addEventListener('click', async () => {
  const isOpen = logOverlay.classList.toggle('open');
  helpOverlay.classList.remove('open');

  if (isOpen) {
    const rolls = await bridge.getRecentRolls();
    logList.innerHTML = '';

    if (!rolls.length) {
      logList.innerHTML = '<div style="color:var(--muted);font-size:10px">No rolls yet this session.</div>';
      return;
    }

    for (const r of rolls) {
      const row = document.createElement('div');
      row.className = `log-row${r.is_crit ? ' is-crit' : r.is_fumble ? ' is-fumble' : ''}`;

      const time = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      row.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-expr">${r.expression}${r.label ? ` <span style="color:var(--muted)">[${r.label}]</span>` : ''}</span>
        <span class="log-result">${r.result ?? '?'}</span>
      `;
      logList.appendChild(row);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VIEW RELOAD BUTTONS
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-reload-ddb').addEventListener('click', () => {
  bridge.reloadView('ddb');
});

document.getElementById('btn-reload-roll20').addEventListener('click', () => {
  bridge.reloadView('roll20');
});

document.getElementById('btn-reload-discord').addEventListener('click', () => {
  bridge.reloadView('discord');
});

// ─────────────────────────────────────────────────────────────────────────────
// HOTKEY HELP PANEL
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-help').addEventListener('click', async () => {
  const isOpen = helpOverlay.classList.toggle('open');
  logOverlay.classList.remove('open');

  if (isOpen && !hotkeyList.children.length) {
    const hotkeys = await bridge.getHotkeys();
    hotkeyList.innerHTML = '';

    for (const hk of hotkeys) {
      const row = document.createElement('div');
      row.className = 'hk-row';
      row.innerHTML = `
        <span class="hk-label">${hk.label}</span>
        <span class="hk-key">${hk.accelerator.replace('CommandOrControl', 'Ctrl')}</span>
      `;
      hotkeyList.appendChild(row);
    }
  }
});

// Close overlays on outside click
document.addEventListener('click', (e) => {
  if (!helpOverlay.contains(e.target) && e.target.id !== 'btn-help') {
    helpOverlay.classList.remove('open');
  }
  if (!logOverlay.contains(e.target) && e.target.id !== 'btn-log') {
    logOverlay.classList.remove('open');
  }
});

'use strict';

const ipcRenderer = window.ipcRenderer;

let rolls = [];

// ─── Tabs ─────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');

      document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      document.getElementById(`tab-${tabName}`)?.classList.add('active');

      if (tabName === 'stats') refreshStats();
    });
  });
}

// ─── Roll Chronicle ───────────────────────────────────────────
function displayRoll(roll) {
  rolls.unshift(roll);
  if (rolls.length > 30) rolls.pop();
  renderRolls();
  // Refresh stats silently whenever a new roll arrives
  refreshStats();
}

function renderRolls() {
  const el = document.getElementById('rolls-list');
  if (!el) return;

  if (rolls.length === 0) {
    el.innerHTML = '<div style="color:#8b7355;text-align:center;padding:20px;">No rolls yet</div>';
    return;
  }

  el.innerHTML = rolls.map((roll) => {
    const critCls  = roll.is_crit ? 'crit' : '';
    const failCls  = roll.is_nat1 ? 'fail' : '';
    const label    = roll.action_label || 'Roll';
    const time     = new Date(roll.rolled_at).toLocaleTimeString();
    const fromLine = roll._fromRelay && roll.player_id
      ? `<span style="color:#8b7355;font-size:10px;">${roll.player_id} </span>`
      : '';
    const mod = roll.modifier > 0 ? `+${roll.modifier}` : roll.modifier < 0 ? roll.modifier : '';
    return `
      <div class="roll-item ${critCls} ${failCls}">
        <div>${fromLine}<span class="roll-label">${label}</span> <span class="roll-value">${roll.total}</span></div>
        <div class="roll-meta">${roll.dice_type}${mod} · ${time}${roll.is_crit ? ' 🎉 CRIT' : ''}${roll.is_nat1 ? ' 💀 FAIL' : ''}</div>
      </div>`;
  }).join('');
}

// ─── Stats Panel ──────────────────────────────────────────────
async function refreshStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel) return;

  let data;
  try {
    data = await ipcRenderer.invoke('stats:get');
  } catch {
    return;
  }

  if (!data || !data.summary || !data.summary.total_rolls) {
    panel.innerHTML = '<div style="color:#8b7355;text-align:center;padding:20px;">Roll some dice to see stats</div>';
    return;
  }

  panel.innerHTML =
    renderSummary(data.summary) +
    renderDistribution(data.distribution) +
    renderByType(data.byType) +
    renderTopActions(data.topActions) +
    (data.byPlayer.length > 1 ? renderByPlayer(data.byPlayer) : '');
}

function renderSummary(s) {
  return `
    <div class="stats-section">
      <div class="stats-section-title">Session Overview</div>
      <div class="stats-grid">
        <div class="stat-tile"><div class="stat-tile-val">${s.total_rolls}</div><div class="stat-tile-key">Rolls</div></div>
        <div class="stat-tile"><div class="stat-tile-val">${s.avg_roll ?? '—'}</div><div class="stat-tile-key">Avg</div></div>
        <div class="stat-tile"><div class="stat-tile-val high">${s.highest_roll ?? '—'}</div><div class="stat-tile-key">High</div></div>
        <div class="stat-tile"><div class="stat-tile-val">${s.lowest_roll ?? '—'}</div><div class="stat-tile-key">Low</div></div>
        <div class="stat-tile"><div class="stat-tile-val crit">${s.total_crits} <small style="color:#8b7355">${s.crit_pct}%</small></div><div class="stat-tile-key">Crits</div></div>
        <div class="stat-tile"><div class="stat-tile-val nat1">${s.total_nat1s} <small style="color:#8b7355">${s.nat1_pct}%</small></div><div class="stat-tile-key">Nat 1s</div></div>
      </div>
    </div>`;
}

function renderDistribution(dist) {
  if (!dist) return '';
  const bands = [
    { label: '1–5',   key: 'band_1_5',    cls: 'low'   },
    { label: '6–10',  key: 'band_6_10',   cls: 'mid'   },
    { label: '11–15', key: 'band_11_15',  cls: 'good'  },
    { label: '16–20', key: 'band_16_20',  cls: 'high'  },
    { label: '21+',   key: 'band_20plus', cls: 'bonus' },
  ];
  const total = bands.reduce((s, b) => s + (dist[b.key] || 0), 0);
  if (!total) return '';

  const rows = bands.map((b) => {
    const count = dist[b.key] || 0;
    const pct   = Math.round((count / total) * 100);
    return `
      <div class="dist-bar-row">
        <div class="dist-bar-label">${b.label}</div>
        <div class="dist-bar-track"><div class="dist-bar-fill ${b.cls}" style="width:${pct}%"></div></div>
        <div class="dist-bar-count">${count}</div>
      </div>`;
  }).join('');

  return `<div class="stats-section"><div class="stats-section-title">d20 Distribution</div>${rows}</div>`;
}

function renderByType(byType) {
  if (!byType?.length) return '';
  const rows = byType.map((r) => `
    <div class="action-row">
      <div class="action-name">${cap(r.roll_type)}</div>
      <div class="action-count">${r.count}</div>
      <div class="action-avg">${r.avg_total}</div>
    </div>`).join('');
  return `
    <div class="stats-section">
      <div class="stats-section-title">By Type <span style="color:#3a3530;font-size:9px;">count/avg</span></div>
      ${rows}
    </div>`;
}

function renderTopActions(actions) {
  if (!actions?.length) return '';
  const rows = actions.map((a) => `
    <div class="action-row">
      <div class="action-name" title="${a.action_label}">${a.action_label}</div>
      <div class="action-count">${a.count}</div>
      <div class="action-avg">${a.avg_total}</div>
    </div>`).join('');
  return `
    <div class="stats-section">
      <div class="stats-section-title">Top Actions <span style="color:#3a3530;font-size:9px;">count/avg</span></div>
      ${rows}
    </div>`;
}

function renderByPlayer(players) {
  const rows = players.map((p) => {
    const name = p.character_name || p.player_id || 'Unknown';
    return `
      <div class="player-row">
        <div class="player-name" title="${name}">${name}</div>
        <div class="player-avg">${p.avg_roll}</div>
        <div class="player-crits">${p.crits}</div>
        <div class="player-nat1s">${p.nat1s}</div>
      </div>`;
  }).join('');
  return `
    <div class="stats-section">
      <div class="stats-section-title">Players <span style="color:#3a3530;font-size:9px;">avg/💛/💀</span></div>
      <div class="player-row" style="color:#8b7355;font-size:9px;"><div>Name</div><div>Avg</div><div>💛</div><div>💀</div></div>
      ${rows}
    </div>`;
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

// ─── IPC Listeners ────────────────────────────────────────────
function setupIpcListeners() {
  ipcRenderer.on('roll:display', (roll) => displayRoll(roll));
  ipcRenderer.on('hp:update', ({ combatant_name, hp_current }) => {
    console.log(`[DM] HP: ${combatant_name} = ${hp_current}`);
  });
  ipcRenderer.on('initiative:sync', (combatants) => {
    console.log('[DM] Initiative sync:', combatants.length);
  });
}

// ─── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupIpcListeners();

  // Load initiative tracker into its tab
  fetch('./initiative-tracker.html')
    .then((r) => r.text())
    .then((html) => {
      document.getElementById('tab-initiative').innerHTML = html;
      const s = document.createElement('script');
      s.src = './initiative-tracker.js';
      document.body.appendChild(s);
    })
    .catch(() => {
      document.getElementById('tab-initiative').innerHTML =
        '<div style="color:#8b3333;padding:12px;">Failed to load initiative tracker</div>';
    });

  // Auto-refresh stats every 15 seconds
  setInterval(refreshStats, 15000);
});

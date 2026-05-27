'use strict';

const ipcRenderer = window.ipcRenderer;

let refreshTimer = null;

async function refreshStats() {
  const data = await ipcRenderer.invoke('stats:get');
  if (!data || !data.summary) return;
  render(data);
}

function render({ summary, distribution, topActions, byType, byPlayer }) {
  const panel = document.getElementById('stats-panel');
  if (!panel) return;

  panel.innerHTML = `
    ${renderSummary(summary)}
    ${renderDistribution(distribution)}
    ${renderByType(byType)}
    ${renderTopActions(topActions)}
    ${byPlayer.length > 1 ? renderByPlayer(byPlayer) : ''}
  `;
}

function renderSummary(s) {
  return `
    <div class="stats-section">
      <div class="stats-section-title">Session Overview</div>
      <div class="stats-grid">
        <div class="stat-tile">
          <div class="stat-tile-val">${s.total_rolls ?? 0}</div>
          <div class="stat-tile-key">Rolls</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-val">${s.avg_roll ?? '—'}</div>
          <div class="stat-tile-key">Avg</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-val high">${s.highest_roll ?? '—'}</div>
          <div class="stat-tile-key">High</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-val">${s.lowest_roll ?? '—'}</div>
          <div class="stat-tile-key">Low</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-val crit">${s.total_crits ?? 0} <span style="font-size:11px;color:#8b7355">(${s.crit_pct ?? 0}%)</span></div>
          <div class="stat-tile-key">Crits</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-val nat1">${s.total_nat1s ?? 0} <span style="font-size:11px;color:#8b7355">(${s.nat1_pct ?? 0}%)</span></div>
          <div class="stat-tile-key">Nat 1s</div>
        </div>
      </div>
    </div>
  `;
}

function renderDistribution(dist) {
  if (!dist) return '';

  const bands = [
    { label: '1–5',  key: 'band_1_5',    cls: 'low'   },
    { label: '6–10', key: 'band_6_10',   cls: 'mid'   },
    { label: '11–15',key: 'band_11_15',  cls: 'good'  },
    { label: '16–20',key: 'band_16_20',  cls: 'high'  },
    { label: '21+',  key: 'band_20plus', cls: 'bonus' },
  ];

  const total = bands.reduce((sum, b) => sum + (dist[b.key] || 0), 0);
  if (total === 0) return '';

  const rows = bands.map((b) => {
    const count = dist[b.key] || 0;
    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div class="dist-bar-row">
        <div class="dist-bar-label">${b.label}</div>
        <div class="dist-bar-track">
          <div class="dist-bar-fill ${b.cls}" style="width:${pct}%"></div>
        </div>
        <div class="dist-bar-count">${count}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="stats-section">
      <div class="stats-section-title">d20 Distribution</div>
      ${rows}
    </div>
  `;
}

function renderByType(byType) {
  if (!byType?.length) return '';

  const rows = byType.map((r) => `
    <div class="action-row">
      <div class="action-name">${capitalize(r.roll_type)}</div>
      <div class="action-count">${r.count}</div>
      <div class="action-avg">${r.avg_total}</div>
    </div>
  `).join('');

  return `
    <div class="stats-section">
      <div class="stats-section-title">By Roll Type &nbsp;<span style="color:#3a3530">count / avg</span></div>
      ${rows}
    </div>
  `;
}

function renderTopActions(actions) {
  if (!actions?.length) return '';

  const rows = actions.map((a) => `
    <div class="action-row">
      <div class="action-name" title="${a.action_label}">${a.action_label}</div>
      <div class="action-count">${a.count}</div>
      <div class="action-avg">${a.avg_total}</div>
    </div>
  `).join('');

  return `
    <div class="stats-section">
      <div class="stats-section-title">Top Actions &nbsp;<span style="color:#3a3530">count / avg</span></div>
      ${rows}
    </div>
  `;
}

function renderByPlayer(players) {
  const header = `
    <div class="player-row" style="color:#8b7355;font-size:9px;">
      <div>Character</div>
      <div style="text-align:center">Avg</div>
      <div style="text-align:center">💛</div>
      <div style="text-align:center">💀</div>
    </div>
  `;

  const rows = players.map((p) => {
    const name = p.character_name || `ID:${p.player_id}` || 'Unknown';
    return `
      <div class="player-row">
        <div class="player-name" title="${name}">${name}</div>
        <div class="player-avg">${p.avg_roll}</div>
        <div class="player-crits">${p.crits}</div>
        <div class="player-nat1s">${p.nat1s}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="stats-section">
      <div class="stats-section-title">By Player</div>
      ${header}
      ${rows}
    </div>
  `;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function startAutoRefresh() {
  refreshStats();
  refreshTimer = setInterval(refreshStats, 15000);
}

function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
}

// Refresh when tab becomes active
document.addEventListener('DOMContentLoaded', () => {
  // Tab click triggers immediate refresh
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-tab') === 'stats') refreshStats();
    });
  });

  startAutoRefresh();
});

// Also refresh whenever a roll comes in
if (window.ipcRenderer) {
  window.ipcRenderer.on('roll:display', () => {
    setTimeout(refreshStats, 500);
  });
}

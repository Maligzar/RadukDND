'use strict';

const ipcRenderer = window.ipcRenderer;

let rolls = [];
let combatants = [];

// ─── Tabs ─────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');

      document.querySelectorAll('.tab-button').forEach((b) => {
        b.style.background = '#2a2520';
        b.style.color = '#8b7355';
        b.classList.remove('active');
      });
      btn.style.background = '#8b7355';
      btn.style.color = '#0d0b08';
      btn.classList.add('active');

      document.querySelectorAll('.tab-content-p').forEach((c) => (c.style.display = 'none'));
      const el = document.getElementById(`tab-${tab}`);
      if (el) el.style.display = 'block';

      if (tab === 'stats') refreshStats();
    });
  });
}

// ─── Roll Chronicle ───────────────────────────────────────────
function displayRoll(roll) {
  rolls.unshift(roll);
  if (rolls.length > 30) rolls.pop();
  renderRolls();
  refreshStats();
}

function renderRolls() {
  const el = document.getElementById('rolls-list');
  if (!el) return;

  if (rolls.length === 0) {
    el.innerHTML = '<div style="color:#8b7355;text-align:center;padding:20px;">Roll some dice!</div>';
    return;
  }

  el.innerHTML = rolls.map((roll) => {
    const critCls = roll.is_crit ? 'crit' : '';
    const failCls = roll.is_nat1 ? 'fail' : '';
    const label   = roll.action_label || 'Roll';
    const time    = new Date(roll.rolled_at).toLocaleTimeString();
    const from    = roll.player_id
      ? `<span style="color:#8b7355;font-size:10px;">${roll.player_id} </span>`
      : '';
    const mod = roll.modifier > 0 ? `+${roll.modifier}` : roll.modifier < 0 ? roll.modifier : '';
    return `
      <div class="roll-item ${critCls} ${failCls}">
        <div>${from}<span class="roll-label">${label}</span> <span class="roll-value">${roll.total}</span></div>
        <div class="roll-meta">${roll.dice_type}${mod} · ${time}${roll.is_crit ? ' 🎉 CRIT' : ''}${roll.is_nat1 ? ' 💀 FAIL' : ''}</div>
      </div>`;
  }).join('');
}

// ─── Combat status (read-only) ────────────────────────────────
function renderCombat() {
  const status = document.getElementById('combat-status');
  const roster = document.getElementById('combat-roster-mini');
  if (!status || !roster) return;

  if (!combatants.length) { status.style.display = 'none'; return; }
  status.style.display = 'block';

  const sorted = [...combatants].sort((a, b) => b.initiative_roll - a.initiative_roll);
  roster.innerHTML = sorted.map((c) => {
    const pct = c.hp_max > 0 ? Math.round((c.hp_current / c.hp_max) * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    return `
      <div class="${c.is_active_turn ? 'active' : ''}">
        <span>${c.combatant_name}</span>
        <span style="font-size:9px;">${bar} ${c.hp_current}/${c.hp_max}</span>
      </div>`;
  }).join('');
}

// ─── Stats Panel ──────────────────────────────────────────────
async function refreshStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel) return;

  let data;
  try { data = await ipcRenderer.invoke('stats:get'); } catch { return; }

  if (!data?.summary?.total_rolls) {
    panel.innerHTML = '<div style="color:#8b7355;text-align:center;padding:20px;">Roll some dice to see stats</div>';
    return;
  }

  const s = data.summary;
  const dist = data.distribution;
  const bands = [
    { label: '1–5',   key: 'band_1_5',    cls: 'low'   },
    { label: '6–10',  key: 'band_6_10',   cls: 'mid'   },
    { label: '11–15', key: 'band_11_15',  cls: 'good'  },
    { label: '16–20', key: 'band_16_20',  cls: 'high'  },
    { label: '21+',   key: 'band_20plus', cls: 'bonus' },
  ];
  const distTotal = bands.reduce((sum, b) => sum + (dist?.[b.key] || 0), 0);
  const distRows = distTotal ? bands.map((b) => {
    const count = dist[b.key] || 0;
    const pct   = Math.round((count / distTotal) * 100);
    return `<div class="dist-bar-row">
      <div class="dist-bar-label">${b.label}</div>
      <div class="dist-bar-track"><div class="dist-bar-fill ${b.cls}" style="width:${pct}%"></div></div>
      <div class="dist-bar-count">${count}</div>
    </div>`;
  }).join('') : '';

  const actionRows = (data.topActions || []).map((a) => `
    <div class="action-row">
      <div class="action-name" title="${a.action_label}">${a.action_label}</div>
      <div class="action-count">${a.count}</div>
      <div class="action-avg">${a.avg_total}</div>
    </div>`).join('');

  panel.innerHTML = `
    <div class="stats-section">
      <div class="stats-section-title">Overview</div>
      <div class="stats-grid">
        <div class="stat-tile"><div class="stat-tile-val">${s.total_rolls}</div><div class="stat-tile-key">Rolls</div></div>
        <div class="stat-tile"><div class="stat-tile-val">${s.avg_roll ?? '—'}</div><div class="stat-tile-key">Avg</div></div>
        <div class="stat-tile"><div class="stat-tile-val high">${s.highest_roll ?? '—'}</div><div class="stat-tile-key">High</div></div>
        <div class="stat-tile"><div class="stat-tile-val">${s.lowest_roll ?? '—'}</div><div class="stat-tile-key">Low</div></div>
        <div class="stat-tile"><div class="stat-tile-val crit">${s.total_crits} <small>${s.crit_pct}%</small></div><div class="stat-tile-key">Crits</div></div>
        <div class="stat-tile"><div class="stat-tile-val nat1">${s.total_nat1s} <small>${s.nat1_pct}%</small></div><div class="stat-tile-key">Nat 1s</div></div>
      </div>
    </div>
    ${distTotal ? `<div class="stats-section"><div class="stats-section-title">d20 Distribution</div>${distRows}</div>` : ''}
    ${actionRows ? `<div class="stats-section"><div class="stats-section-title">Top Actions <span style="color:#3a3530;font-size:9px;">count/avg</span></div>${actionRows}</div>` : ''}
  `;
}

// ─── IPC ──────────────────────────────────────────────────────
function setupIpcListeners() {
  ipcRenderer.on('roll:display', (roll) => displayRoll(roll));

  ipcRenderer.on('initiative:sync', (list) => {
    combatants = list;
    renderCombat();
  });

  ipcRenderer.on('hp:update', ({ combatant_name, hp_current }) => {
    const c = combatants.find((x) => x.combatant_name === combatant_name);
    if (c) { c.hp_current = hp_current; renderCombat(); }
  });
}

// ─── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupIpcListeners();
  setInterval(refreshStats, 15000);
});

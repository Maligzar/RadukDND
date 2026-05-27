const ipcRenderer = window.ipcRenderer;

let rolls = [];
let combatants = [];

function displayRoll(roll) {
  rolls.unshift(roll);
  if (rolls.length > 30) rolls.pop();
  renderRolls();
}

function renderRolls() {
  const rollsList = document.getElementById('rolls-list');

  if (rolls.length === 0) {
    rollsList.innerHTML =
      '<div style="color: #8b7355; text-align: center; padding: 20px;">No rolls yet</div>';
    return;
  }

  rollsList.innerHTML = rolls
    .map((roll) => {
      const isCrit = roll.is_crit ? 'crit' : '';
      const isFail = roll.is_nat1 ? 'fail' : '';
      const label = roll.action_label || 'Roll';
      const timestamp = new Date(roll.rolled_at).toLocaleTimeString();
      const fromPlayer = roll.player_id
        ? `<span style="color:#8b7355;font-size:10px;">${roll.player_id}</span> `
        : '';

      return `
        <div class="roll-item ${isCrit} ${isFail}">
          <div>
            ${fromPlayer}<span class="roll-label">${label}</span>
            <span class="roll-value">${roll.total}</span>
          </div>
          <div class="roll-meta">
            ${roll.dice_type} ${roll.modifier > 0 ? '+' : ''}${roll.modifier} • ${timestamp}
            ${isCrit ? ' 🎉 CRITICAL' : ''}
            ${isFail ? ' 💀 FAIL' : ''}
          </div>
        </div>
      `;
    })
    .join('');
}

function renderCombat() {
  const combatStatus = document.getElementById('combat-status');
  const roster = document.getElementById('combat-roster-mini');

  if (combatants.length === 0) {
    combatStatus.style.display = 'none';
    return;
  }

  combatStatus.style.display = 'block';

  const sorted = [...combatants].sort(
    (a, b) => b.initiative_roll - a.initiative_roll
  );

  roster.innerHTML = sorted
    .map((c) => {
      const isActive = c.is_active_turn ? 'active' : '';
      const healthPercent = (c.hp_current / c.hp_max) * 100;
      const barLength = Math.round(healthPercent / 10);
      const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);

      return `
        <div class="${isActive}">
          <span>${c.combatant_name}</span>
          <span>${bar} ${c.hp_current}/${c.hp_max}</span>
        </div>
      `;
    })
    .join('');
}

function setupIpcListeners() {
  ipcRenderer.on('roll:display', (roll) => {
    displayRoll(roll);
  });

  ipcRenderer.on('initiative:sync', (combatantList) => {
    combatants = combatantList;
    renderCombat();
  });

  ipcRenderer.on('hp:update', ({ combatant_name, hp_current }) => {
    const c = combatants.find((x) => x.combatant_name === combatant_name);
    if (c) {
      c.hp_current = hp_current;
      renderCombat();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupIpcListeners();
  setupTabs();
});

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
    });
  });
}

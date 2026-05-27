const ipcRenderer = window.ipcRenderer;

let rolls = [];
let sessionInfo = null;

function loadSessionInfo() {
  ipcRenderer.invoke('session:get-info').catch(() => {
    document.getElementById('session-code').textContent = '—';
  });
}

function displayRoll(roll) {
  rolls.unshift(roll);
  if (rolls.length > 20) rolls.pop();
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

      return `
        <div class="roll-item ${isCrit} ${isFail}">
          <div>
            <span class="roll-label">${label}</span>
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

function setupTabs() {
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');

      document.querySelectorAll('.tab-button').forEach((b) => {
        b.classList.remove('active');
      });
      btn.classList.add('active');

      document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.remove('active');
      });
      document.getElementById(`tab-${tabName}`).classList.add('active');
    });
  });
}

function setupIpcListeners() {
  ipcRenderer.on('roll:display', (roll) => {
    displayRoll(roll);
  });

  ipcRenderer.on('hp:update', ({ combatant_name, hp_current }) => {
    console.log(`[DM] HP Update: ${combatant_name} = ${hp_current}`);
  });

  ipcRenderer.on('initiative:sync', (combatants) => {
    console.log('[DM] Initiative synced:', combatants.length, 'combatants');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSessionInfo();
  setupTabs();
  setupIpcListeners();

  fetch('./initiative-tracker.html')
    .then((res) => res.text())
    .then((html) => {
      const initiativeTab = document.getElementById('tab-initiative');
      initiativeTab.innerHTML = html;
      const script = document.createElement('script');
      script.src = './initiative-tracker.js';
      document.body.appendChild(script);
    })
    .catch((err) => {
      console.error('Failed to load initiative tracker:', err);
      document.getElementById('tab-initiative').innerHTML =
        '<div style="color: #8b3333;">Failed to load initiative tracker</div>';
    });
});

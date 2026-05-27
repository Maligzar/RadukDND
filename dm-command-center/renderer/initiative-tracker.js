let combatants = [];
let currentRound = 1;
let activeTurnIndex = -1;
let combatActive = false;

const ipc = window.ipcRenderer;

function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

function addCombatantLocally(name, ac, hpMax, initiative) {
  const combatant = {
    name,
    ac,
    hp_max: hpMax,
    hp_current: hpMax,
    initiative_roll: initiative || rollD20(),
    is_dead: false,
  };
  combatants.push(combatant);
  return combatant;
}

function addCombatant() {
  const name = document.getElementById('combatant-name').value.trim();
  const ac = parseInt(document.getElementById('combatant-ac').value) || 10;
  const hpMax = parseInt(document.getElementById('combatant-hp-max').value);
  const init = parseInt(document.getElementById('combatant-init').value) || rollD20();

  if (!name || !hpMax) {
    alert('Name and Max HP required');
    return;
  }

  const combatant = addCombatantLocally(name, ac, hpMax, init);

  ipc.invoke('initiative:add-combatant', {
    combatant_name: name,
    ac,
    hp_max: hpMax,
    hp_current: hpMax,
    initiative_roll: init,
  });

  document.getElementById('add-combatant-form').reset();
  render();
}

function rollInitiativeAll() {
  combatants.forEach((c) => {
    c.initiative_roll = rollD20();
  });
  render();
}

function startCombat() {
  if (combatants.length === 0) {
    alert('Add combatants first');
    return;
  }

  combatActive = true;
  currentRound = 1;

  const sorted = [...combatants]
    .filter((c) => !c.is_dead)
    .sort((a, b) => b.initiative_roll - a.initiative_roll);

  activeTurnIndex = 0;

  document.getElementById('combat-status').style.display = 'block';
  render();
}

function nextTurn() {
  if (!combatActive || combatants.length === 0) return;

  const alive = combatants.filter((c) => !c.is_dead);
  if (alive.length === 0) {
    combatActive = false;
    document.getElementById('combat-status').style.display = 'none';
    render();
    return;
  }

  activeTurnIndex = (activeTurnIndex + 1) % alive.length;

  if (activeTurnIndex === 0) {
    currentRound++;
  }

  render();
}

function clearCombat() {
  if (confirm('Clear all combatants?')) {
    combatants = [];
    currentRound = 1;
    activeTurnIndex = -1;
    combatActive = false;
    document.getElementById('combat-status').style.display = 'none';

    ipc.send('initiative:clear');
    render();
  }
}

function toggleDead(index) {
  combatants[index].is_dead = !combatants[index].is_dead;
  render();
}

function removeCombatant(index) {
  combatants.splice(index, 1);
  if (activeTurnIndex >= combatants.length) {
    activeTurnIndex = Math.max(-1, combatants.length - 1);
  }
  render();
}

function updateHp(index, delta) {
  const c = combatants[index];
  c.hp_current = Math.max(0, Math.min(c.hp_max, c.hp_current + delta));
  if (c.hp_current === 0) c.is_dead = true;
  if (c.hp_current > 0) c.is_dead = false;

  ipc.send('hp:update', {
    combatant_name: c.name,
    hp_current: c.hp_current,
  });

  render();
}

function render() {
  document.getElementById('round-number').textContent = currentRound;

  const tbody = document.getElementById('combat-roster');
  tbody.innerHTML = '';

  const alive = combatants.filter((c) => !c.is_dead);
  const sorted = [...combatants].sort((a, b) => b.initiative_roll - a.initiative_roll);

  sorted.forEach((combatant, index) => {
    const isActive = combatActive && alive[activeTurnIndex] === combatant;
    const hpPercent = (combatant.hp_current / combatant.hp_max) * 100;
    const healthClass =
      hpPercent > 50 ? 'healthy' : hpPercent > 0 ? 'critical' : '';

    const row = document.createElement('tr');
    row.className = `${isActive ? 'active' : ''} ${
      combatant.is_dead ? 'dead' : ''
    }`;

    row.innerHTML = `
      <td>
        <span style="${combatant.is_dead ? 'text-decoration: line-through;' : ''}">${
          combatant.name
        }</span>
        ${isActive ? ' <span style="color: #ffcc00;">→</span>' : ''}
      </td>
      <td>${combatant.initiative_roll}</td>
      <td>${combatant.ac}</td>
      <td>
        <div class="hp-bar">
          <div
            class="hp-bar-fill ${healthClass}"
            style="width: ${Math.max(10, hpPercent)}%"
          ></div>
          <span class="hp-text">${combatant.hp_current}/${combatant.hp_max}</span>
        </div>
      </td>
      <td class="combatant-actions">
        <button onclick="updateHp(${index}, -1)" title="Damage -1">−</button>
        <button onclick="updateHp(${index}, 1)" title="Heal +1">+</button>
        <button onclick="toggleDead(${index})" title="Toggle dead">${
          combatant.is_dead ? '↻' : '✓'
        }</button>
        <button onclick="removeCombatant(${index})" title="Remove">✕</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function show() {
  document.getElementById('initiative-panel').style.display = 'block';
  render();
}

function hide() {
  document.getElementById('initiative-panel').style.display = 'none';
}

function loadCombatants() {
  ipc.invoke('initiative:get').then((data) => {
    combatants = data.map((c) => ({
      name: c.combatant_name,
      ac: c.ac,
      hp_max: c.hp_max,
      hp_current: c.hp_current,
      initiative_roll: c.initiative_roll,
      is_dead: c.hp_current === 0,
      is_active_turn: c.is_active_turn,
    }));
    activeTurnIndex = combatants.findIndex((c) => c.is_active_turn) ?? -1;
    render();
  });
}

function listenForRelayUpdates() {
  if (window.ipcRenderer) {
    ipcRenderer.on('initiative:sync', (combatantList) => {
      combatants = combatantList.map((c) => ({
        name: c.combatant_name,
        ac: c.ac,
        hp_max: c.hp_max,
        hp_current: c.hp_current,
        initiative_roll: c.initiative_roll,
        is_dead: c.hp_current === 0,
        is_active_turn: c.is_active_turn,
      }));
      activeTurnIndex = combatants.findIndex((c) => c.is_active_turn) ?? -1;
      render();
    });

    ipcRenderer.on('hp:update', ({ combatant_name, hp_current }) => {
      const combatant = combatants.find((c) => c.name === combatant_name);
      if (combatant) {
        combatant.hp_current = hp_current;
        combatant.is_dead = hp_current === 0;
        render();
      }
    });
  }
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('add-combatant-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      addCombatant();
    });
  }

  const btnRollInit = document.getElementById('btn-roll-init');
  if (btnRollInit) btnRollInit.addEventListener('click', rollInitiativeAll);

  const btnStartCombat = document.getElementById('btn-start-combat');
  if (btnStartCombat) btnStartCombat.addEventListener('click', startCombat);

  const btnNextTurn = document.getElementById('btn-next-turn');
  if (btnNextTurn) btnNextTurn.addEventListener('click', nextTurn);

  const btnClearCombat = document.getElementById('btn-clear-combat');
  if (btnClearCombat) btnClearCombat.addEventListener('click', clearCombat);

  loadCombatants();
  listenForRelayUpdates();
});

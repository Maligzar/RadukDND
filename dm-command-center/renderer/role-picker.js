'use strict';

const ipcRenderer = window.ipcRenderer;

let selectedRole = null;

document.addEventListener('DOMContentLoaded', () => {
  setupRoleButtons();
  setupPlayerTabs();
  setupSubmitHandlers();
});

function setupRoleButtons() {
  document.querySelectorAll('.role-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const role = btn.getAttribute('data-role');
      selectedRole = role;

      document.querySelectorAll('.role-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.role-form').forEach((f) => f.classList.remove('active'));
      document.querySelector(`.role-form[data-role="${role}"]`)?.classList.add('active');
    });
  });
}

function setupPlayerTabs() {
  document.querySelectorAll('.player-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const ptab = tab.getAttribute('data-ptab');

      document.querySelectorAll('.player-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.player-tab-content').forEach((c) => c.classList.remove('active'));
      document.querySelector(`.player-tab-content[data-ptab="${ptab}"]`)?.classList.add('active');
    });
  });
}

function setupSubmitHandlers() {
  // ── DM: create session ──────────────────────────────────
  document.getElementById('btn-create-session')?.addEventListener('click', async () => {
    const playerName = document.getElementById('dm-name').value.trim() || 'Dungeon Master';
    const partyLevel = parseInt(document.getElementById('party-level').value) || 5;
    const partySize  = parseInt(document.getElementById('party-size').value) || 4;

    const result = await ipcRenderer.invoke('session:set-role', {
      role: 'dm',
      playerName,
      partyLevel,
      partySize,
    });

    if (result.ok) showCodeScreen(result.session.code, 'dm');
  });

  // ── Player: create new session ──────────────────────────
  document.getElementById('btn-player-create')?.addEventListener('click', async () => {
    const playerName = document.getElementById('player-name-create').value.trim() || 'Player';

    const result = await ipcRenderer.invoke('session:set-role', {
      role: 'player',
      playerName,
      isCreating: true,
    });

    if (result.ok) showCodeScreen(result.session.code, 'player');
  });

  // ── Player: join existing session ───────────────────────
  document.getElementById('btn-join-session')?.addEventListener('click', async () => {
    const code       = document.getElementById('session-code').value.trim().toUpperCase();
    const playerName = document.getElementById('player-name-join').value.trim() || 'Player';

    if (!code || code.length < 3) {
      alert('Enter a valid session code');
      return;
    }

    const result = await ipcRenderer.invoke('session:set-role', {
      role: 'player',
      playerName,
      sessionCode: code,
      isCreating:  false,
    });

    if (result.ok) closePicker();
  });

  // Enter-key shortcuts
  document.getElementById('dm-name')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-create-session')?.click();
  });
  document.getElementById('player-name-create')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-player-create')?.click();
  });
  document.getElementById('session-code')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-join-session')?.click();
  });
  document.getElementById('player-name-join')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-join-session')?.click();
  });
}

function showCodeScreen(sessionCode, role) {
  const picker = document.getElementById('role-picker');
  const box = picker.querySelector('.role-picker-box');
  const label = role === 'dm' ? 'DM' : 'Player';

  box.innerHTML = `
    <h2>✓ Session Ready</h2>
    <p style="color: var(--muted); text-align: center; margin-bottom: 16px;">
      Share this code with ${role === 'dm' ? 'your players' : 'the other player'}
    </p>
    <div class="session-code-display">
      <strong>${sessionCode}</strong>
      <div class="session-code-copy">Click to copy</div>
    </div>
    <div style="margin-top: 14px; color: var(--muted); font-size: 11px; line-height: 1.6;">
      <p>Others should:</p>
      <ol style="margin-left: 16px;">
        <li>Open the app and choose <b>${role === 'dm' ? 'Player' : 'Player → Join Session'}</b></li>
        <li>Enter code <b style="color: var(--crit)">${sessionCode}</b></li>
        <li>Rolls sync automatically via relay</li>
      </ol>
    </div>
    <button class="btn-submit" id="btn-start-game" style="width:100%;margin-top:20px;">
      Let's Play
    </button>
  `;

  box.querySelector('.session-code-display')?.addEventListener('click', () => {
    navigator.clipboard.writeText(sessionCode);
    const el = box.querySelector('.session-code-copy');
    el.textContent = '✓ Copied!';
    setTimeout(() => { el.textContent = 'Click to copy'; }, 2000);
  });

  document.getElementById('btn-start-game')?.addEventListener('click', closePicker);
}

function closePicker() {
  document.getElementById('role-picker').style.display = 'none';
}

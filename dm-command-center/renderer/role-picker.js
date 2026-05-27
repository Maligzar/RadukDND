'use strict';

// Role picker logic — shows modal on startup to select DM or Player
// and manage session code entry/display

const ipcRenderer = window.ipcRenderer;

let selectedRole = null;

document.addEventListener('DOMContentLoaded', () => {
  const rolePicker = document.getElementById('role-picker');
  const roleButtons = document.querySelectorAll('.role-btn');
  const createBtn = document.getElementById('btn-create-session');
  const joinBtn = document.getElementById('btn-join-session');

  // Role selection
  roleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const role = btn.getAttribute('data-role');
      selectedRole = role;

      // Update active button
      roleButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Show corresponding form
      document.querySelectorAll('.role-form').forEach((form) => {
        form.classList.remove('active');
      });
      document.querySelector(`.role-form[data-role="${role}"]`)?.classList.add('active');
    });
  });

  // DM: Create session
  createBtn?.addEventListener('click', async () => {
    const dmName = document.getElementById('dm-name').value || 'Dungeon Master';
    const partyLevel = parseInt(document.getElementById('party-level').value) || 5;
    const partySize = parseInt(document.getElementById('party-size').value) || 4;

    try {
      const result = await ipcRenderer.invoke('session:set-role', {
        role: 'dm',
        playerName: dmName,
        partyLevel,
        partySize,
      });

      if (result.ok) {
        showSessionCreated(result.session.code);
      }
    } catch (err) {
      alert('Error creating session: ' + err.message);
    }
  });

  // Player: Join session
  joinBtn?.addEventListener('click', async () => {
    const code = document.getElementById('session-code').value.trim().toUpperCase();
    if (!code || code.length < 3) {
      alert('Please enter a session code');
      return;
    }

    try {
      const result = await ipcRenderer.invoke('session:set-role', {
        role: 'player',
        sessionCode: code,
      });

      if (result.ok) {
        closePicker();
      }
    } catch (err) {
      alert('Error joining session: ' + err.message);
    }
  });

  // Allow Enter key to submit
  document.getElementById('dm-name')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createBtn?.click();
  });
  document.getElementById('session-code')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinBtn?.click();
  });
});

function showSessionCreated(sessionCode) {
  const picker = document.getElementById('role-picker');
  const box = picker.querySelector('.role-picker-box');

  box.innerHTML = `
    <h2>✓ Session Created!</h2>
    <p style="color: var(--muted); text-align: center; margin-bottom: 16px;">
      Share this code with your players
    </p>
    <div class="session-code-display">
      <strong>${sessionCode}</strong>
      <div class="session-code-copy">Click to copy</div>
    </div>
    <div style="margin-top: 16px; color: var(--muted); font-size: 12px; line-height: 1.5;">
      <p>Players should:</p>
      <ol style="margin-left: 16px;">
        <li>Click "Player" on their app</li>
        <li>Enter code <strong>${sessionCode}</strong></li>
        <li>All rolls will sync automatically</li>
      </ol>
    </div>
    <div style="margin-top: 20px;">
      <button class="btn-submit" id="btn-start-game" style="width: 100%;">Start Game</button>
    </div>
  `;

  // Copy code on click
  document.querySelector('.session-code-display')?.addEventListener('click', () => {
    navigator.clipboard.writeText(sessionCode);
    const copy = document.querySelector('.session-code-copy');
    copy.textContent = '✓ Copied!';
    setTimeout(() => {
      copy.textContent = 'Click to copy';
    }, 2000);
  });

  // Start game closes picker
  document.getElementById('btn-start-game')?.addEventListener('click', closePicker);
}

function closePicker() {
  const picker = document.getElementById('role-picker');
  picker.style.display = 'none';
}

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─────────────────────────────────────────────────────────────
// Roll20 HP Sync — Phase 14
// Monitors token HP changes and damage rolls in chat
// ─────────────────────────────────────────────────────────────

// Expose ipcRenderer for sending HP updates to main process
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    if (['hp:r20-update', 'damage:parsed'].includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  invoke: (channel, data) => {
    if (['initiative:get-combatants'].includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
  },
});

// ─────────────────────────────────────────────────────────────
// Wait for Roll20 to load, then set up observers
// ─────────────────────────────────────────────────────────────
function initR20Sync() {
  // Check if Roll20 is loaded
  if (!window.d20) {
    console.log('[r20] Waiting for Roll20 to load...');
    setTimeout(initR20Sync, 500);
    return;
  }

  console.log('[r20] Roll20 loaded, setting up HP sync');

  // ── Monitor token HP changes via MutationObserver ────────────
  monitorTokenHpChanges();

  // ── Monitor chat for damage rolls ───────────────────────────
  monitorChatDamage();

  // ── Listen for manual HP edits (character sheet) ────────────
  monitorCharacterSheetHp();
}

// ─────────────────────────────────────────────────────────────
// Monitor token HP via DOM mutations
// ─────────────────────────────────────────────────────────────
function monitorTokenHpChanges() {
  // Roll20 stores token HP in the token attributes and displays in token bubbles
  // Look for the token layer and stat bubbles
  const tokenLayer = document.getElementById('token-layer');
  if (!tokenLayer) {
    console.warn('[r20] Token layer not found');
    return;
  }

  // Cache to track HP changes (avoid duplicate sends)
  const hpCache = new Map();

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // Look for stat bubble updates or token attribute changes
      if (mutation.type === 'attributes' || mutation.type === 'childList') {
        const tokens = document.querySelectorAll('[data-token-id]');
        tokens.forEach((token) => {
          const tokenId = token.getAttribute('data-token-id');
          if (!tokenId) return;

          // Try to extract HP from token tooltip or bubbles
          const hpMatch = token.title?.match(/HP:\s*(\d+)\s*\/\s*(\d+)/i);
          const hpBubble = token.querySelector('[data-hp-current]');

          let currentHp = null;
          let maxHp = null;

          if (hpMatch) {
            currentHp = parseInt(hpMatch[1], 10);
            maxHp = parseInt(hpMatch[2], 10);
          } else if (hpBubble) {
            // Try parsing the bubble text
            const bubbleText = hpBubble.textContent || hpBubble.innerText;
            const bubbleMatch = bubbleText.match(/(\d+)\s*\/\s*(\d+)/);
            if (bubbleMatch) {
              currentHp = parseInt(bubbleMatch[1], 10);
              maxHp = parseInt(bubbleMatch[2], 10);
            }
          }

          if (currentHp !== null && maxHp !== null) {
            const cacheKey = `${tokenId}`;
            const cached = hpCache.get(cacheKey);

            // Only send if HP changed
            if (!cached || cached.hp !== currentHp) {
              hpCache.set(cacheKey, { hp: currentHp, max: maxHp });

              // Get token name
              const tokenName = token.getAttribute('data-character-name') ||
                               token.title?.split('\n')[0] ||
                               `Token ${tokenId.slice(0, 8)}`;

              console.log(`[r20] HP change: ${tokenName} → ${currentHp}/${maxHp}`);

              // Send to main process
              window.electronAPI.send('hp:r20-update', {
                token_id: tokenId,
                token_name: tokenName,
                hp_current: currentHp,
                hp_max: maxHp,
                timestamp: Date.now(),
              });
            }
          }
        });
      }
    });
  });

  observer.observe(tokenLayer, {
    attributes: true,
    attributeFilter: ['title', 'data-hp-current', 'data-hp-max'],
    childList: true,
    subtree: true,
  });

  console.log('[r20] Token HP observer installed');
}

// ─────────────────────────────────────────────────────────────
// Monitor chat for damage rolls
// ─────────────────────────────────────────────────────────────
function monitorChatDamage() {
  const chatArea = document.getElementById('chat-area');
  if (!chatArea) {
    console.warn('[r20] Chat area not found');
    return;
  }

  // Patterns to match damage in chat
  const damagePattern = /(\d+)\s*(?:hp|damage|d(?:amage)?)/i;
  const healPattern = /heal|restore|recover/i;
  const toPattern = /(?:to|on|vs\.?|against)\s+([a-z0-9\s]+?)(?:\s*(?:took|takes|take|failed|passes|saves|succeeds)|\s*for\s+|\s*-\s*|\s*$)/i;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        // New chat message added
        const newMessages = Array.from(mutation.addedNodes).filter(
          (node) => node.classList && node.classList.contains('message')
        );

        newMessages.forEach((msg) => {
          const text = msg.textContent || msg.innerText;
          const isHealing = healPattern.test(text);
          const damageMatch = text.match(damagePattern);

          if (damageMatch) {
            const damage = parseInt(damageMatch[1], 10);
            const targetMatch = text.match(toPattern);
            const targetName = targetMatch ? targetMatch[1].trim() : 'Unknown';

            console.log(`[r20] Chat: ${isHealing ? 'Heal' : 'Damage'} ${damage} to ${targetName}`);

            window.electronAPI.send('damage:parsed', {
              type: isHealing ? 'heal' : 'damage',
              amount: damage,
              target_name: targetName,
              source_text: text.substring(0, 100),
              timestamp: Date.now(),
            });
          }
        });
      }
    });
  });

  observer.observe(chatArea, {
    childList: true,
    subtree: true,
  });

  console.log('[r20] Chat damage observer installed');
}

// ─────────────────────────────────────────────────────────────
// Monitor character sheet HP edits
// ─────────────────────────────────────────────────────────────
function monitorCharacterSheetHp() {
  // Look for character sheet HP inputs
  // Roll20 character sheets have HP in various places depending on the sheet
  const hpInputs = document.querySelectorAll(
    'input[name*="hp"], input[name*="HP"], input[name*="health"], [data-attribute*="hp"]'
  );

  if (hpInputs.length === 0) {
    console.warn('[r20] No HP inputs found on character sheet');
    return;
  }

  hpInputs.forEach((input) => {
    const prevValue = input.value;

    input.addEventListener('change', () => {
      const newValue = input.value;
      if (newValue !== prevValue) {
        const charName = document.querySelector('[data-character-name]')?.getAttribute('data-character-name') ||
                         'Unknown Character';

        console.log(`[r20] Sheet HP change: ${charName} → ${newValue}`);

        window.electronAPI.send('hp:r20-update', {
          token_name: charName,
          hp_current: parseInt(newValue, 10),
          source: 'character-sheet',
          timestamp: Date.now(),
        });
      }
    });
  });

  console.log('[r20] Character sheet HP monitor installed');
}

// ─────────────────────────────────────────────────────────────
// Start monitoring when document is ready
// ─────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initR20Sync);
} else {
  initR20Sync();
}

console.log('[r20] Preload script loaded');

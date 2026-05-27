'use strict';

const { ipcRenderer } = require('electron');

// Parse current character ID from the URL so we can ignore other party
// members' roll notifications that appear on the same page.
function getCharacterIdFromUrl() {
  const m = window.location.pathname.match(/\/characters\/(\d+)/i);
  return m ? m[1] : null;
}

let currentCharacterId = getCharacterIdFromUrl();

// Re-check on SPA navigation
const _pushState = history.pushState.bind(history);
history.pushState = function (...args) {
  _pushState(...args);
  currentCharacterId = getCharacterIdFromUrl();
};
window.addEventListener('popstate', () => {
  currentCharacterId = getCharacterIdFromUrl();
});

// Build a normalised payload matching the roll:captured schema in main.js
function buildPayload({ expression, result, label, isCrit, isFumble }) {
  const exprMatch = expression.match(/^([\dd+\-*]+?)([+\-]\d+)?$/i);
  const dice_type = exprMatch ? exprMatch[1].trim() : expression;
  const modifier  = exprMatch && exprMatch[2] ? parseInt(exprMatch[2], 10) : 0;

  return {
    player_id:    currentCharacterId ?? null,
    dice_type,
    raw_result:   String(result),
    modifier,
    total:        typeof result === 'number' ? result : (parseInt(result, 10) || 0),
    action_label: label ?? null,
    roll_type:    'check',
    is_secret:    false,
    is_crit:      isCrit   ?? false,
    is_nat1:      isFumble ?? false,
    rolled_at:    Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1: DOM Event Interception
// D&D Beyond dispatches custom events on the document when a roll happens.
// ─────────────────────────────────────────────────────────────────────────────

const DDB_ROLL_EVENTS = [
  'DDB.Dice.Roll',
  'DDB.Dice.RollResult',
];

function parseDDBRollEvent(event) {
  try {
    const d = event.detail ?? event.data ?? {};

    // If the event includes a character entity ID that doesn't match the
    // current character, this is a party notification — skip it.
    const entityId = String(d.entityId ?? d.characterId ?? d.entity_id ?? '');
    if (entityId && currentCharacterId && entityId !== currentCharacterId) return null;

    const result = d.result ?? d.total ?? null;
    if (result === null) return null;

    return {
      expression: d.diceExpression ?? d.rollExpression ?? d.expression ?? '?',
      result,
      label:    d.context   ?? d.label   ?? d.rollType ?? null,
      isCrit:   !!(d.isCritical  ?? d.criticalHit),
      isFumble: !!(d.isFumble    ?? d.criticalFail),
    };
  } catch {
    return null;
  }
}

for (const eventName of DDB_ROLL_EVENTS) {
  window.addEventListener(eventName, (event) => {
    const roll = parseDDBRollEvent(event);
    if (roll) {
      console.log('[DM:DDB] Roll event captured:', roll);
      ipcRenderer.send('roll:captured', buildPayload(roll));
    }
  }, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2: MutationObserver on the dice result popup
// Fallback: watches for the result tooltip DDB renders after each roll.
// Skips popups that belong to other party members.
// ─────────────────────────────────────────────────────────────────────────────

const RESULT_SELECTORS = {
  container: '[class*="dice-roll-result"]',
  total:     '[class*="dice-roll-result__total"]',
  type:      '[class*="dice-roll-result__roll-type"]',
  detail:    '[class*="dice-roll-result__dice-detail"]',
};

// Containers that identify a roll as belonging to another party member
const PARTY_SELECTORS = [
  '[class*="party-member"]',
  '[class*="PlayerName"]',
  '[class*="player-name"]',
  '[class*="character-name"]',
  '[class*="notification"]',
  '[class*="toast"]',
];

let lastReportedResult = null;

function isPartyNotification(node) {
  return PARTY_SELECTORS.some(
    (sel) => node.closest(sel) !== null || node.querySelector(sel) !== null
  );
}

function extractRollFromPopup(node) {
  try {
    if (isPartyNotification(node)) return null;

    const totalEl  = node.querySelector(RESULT_SELECTORS.total);
    const typeEl   = node.querySelector(RESULT_SELECTORS.type);
    const detailEl = node.querySelector(RESULT_SELECTORS.detail);

    if (!totalEl) return null;

    const result = parseInt(totalEl.textContent.trim(), 10);
    if (isNaN(result)) return null;

    const label      = typeEl?.textContent.trim() ?? null;
    const detailText = detailEl?.textContent.trim() ?? '';

    // DDB shows detail like "d20 + 5 = 20"
    const expressionMatch = detailText.match(/^([d0-9+\-\s]+)=/i);
    const expression = expressionMatch
      ? expressionMatch[1].trim().replace(/\s+/g, '')
      : '1d20';

    const isCrit   = node.classList.toString().includes('critical')
                  || node.textContent.includes('Critical Hit');
    const isFumble = node.classList.toString().includes('fumble')
                  || node.textContent.includes('Critical Fail');

    return { expression, result, label, isCrit, isFumble };
  } catch {
    return null;
  }
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;

      const target = node.matches(RESULT_SELECTORS.container)
        ? node
        : node.querySelector(RESULT_SELECTORS.container);

      if (!target) continue;

      const roll = extractRollFromPopup(target);
      if (!roll) continue;

      // Debounce: skip duplicate results within 500ms
      const key = `${roll.expression}:${roll.result}`;
      if (key === lastReportedResult) continue;
      lastReportedResult = key;
      setTimeout(() => { lastReportedResult = null; }, 500);

      console.log('[DM:DDB] Popup roll captured:', roll);
      ipcRenderer.send('roll:captured', buildPayload(roll));
    }
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserver);
} else {
  startObserver();
}

function startObserver() {
  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[DM:DDB] Preload active. Character ID:', currentCharacterId ?? 'unknown (navigate to character sheet)');
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3: Fetch Intercept
// Cleanest source — DDB API responses include character attribution.
// ─────────────────────────────────────────────────────────────────────────────

const ROLL_API_PATTERN = /\/api\/dice\/roll|\/dice-roll/i;

const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);

  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
    if (ROLL_API_PATTERN.test(url)) {
      const clone = response.clone();
      clone.json().then((data) => {
        const roll = parseAPIRollData(data);
        if (roll) {
          console.log('[DM:DDB] API roll intercepted:', roll);
          ipcRenderer.send('roll:captured', buildPayload(roll));
        }
      }).catch(() => {});
    }
  } catch {}

  return response;
};

function parseAPIRollData(data) {
  try {
    // Check character attribution — skip if this API response belongs to
    // another character (e.g., party sync endpoint)
    const entityId = String(data?.data?.characterId ?? data?.entityId ?? '');
    if (entityId && currentCharacterId && entityId !== currentCharacterId) return null;

    const rolls = data?.data?.diceRolls ?? data?.rolls ?? [];
    if (!rolls.length) return null;

    const roll   = rolls[0];
    const result = roll?.total ?? roll?.result ?? null;
    if (result === null) return null;

    const expr   = roll?.diceExpression ?? roll?.expression ?? '?';
    const isCrit = !!(roll?.isCritical || data?.data?.isCritical);
    const label  = data?.data?.context ?? data?.context ?? null;

    return { expression: expr, result, label, isCrit, isFumble: false };
  } catch {
    return null;
  }
}

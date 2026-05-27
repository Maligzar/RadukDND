'use strict';

const { ipcRenderer } = require('electron');

// ─── Character ID from URL ────────────────────────────────────────────────────
function getCharacterIdFromUrl() {
  const m = window.location.pathname.match(/\/characters\/(\d+)/i);
  return m ? m[1] : null;
}

let currentCharacterId = getCharacterIdFromUrl();

const _pushState = history.pushState.bind(history);
history.pushState = function (...args) {
  _pushState(...args);
  currentCharacterId = getCharacterIdFromUrl();
};
window.addEventListener('popstate', () => {
  currentCharacterId = getCharacterIdFromUrl();
});

// ─── Cross-layer deduplication ────────────────────────────────────────────────
// All three capture layers funnel through here. A roll is emitted at most once
// per 3-second window per (label + total) signature. This prevents:
//   • DDB.Dice.Roll + DDB.Dice.RollResult both firing for one physical roll
//   • MutationObserver firing after a DOM event already captured the roll
//   • Fetch interceptor double-firing with DOM events
const recentKeys = new Map(); // key → expiry timestamp

function emit(roll) {
  const key = `${roll.action_label ?? ''}:${roll.total}`;
  const now = Date.now();

  if (recentKeys.has(key) && recentKeys.get(key) > now) return;

  recentKeys.set(key, now + 3000);
  setTimeout(() => recentKeys.delete(key), 3100);

  console.log('[DM:DDB] Roll emitted:', roll.action_label, roll.total);
  ipcRenderer.send('roll:captured', roll);
}

// ─── Payload normalisation ────────────────────────────────────────────────────
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

// ─── LAYER 1: DOM Events ──────────────────────────────────────────────────────
// Only listen to RollResult (final value). DDB.Dice.Roll fires at click-time
// before the result exists — listening to it causes double-records.

window.addEventListener('DDB.Dice.RollResult', (event) => {
  try {
    const d = event.detail ?? event.data ?? {};

    const entityId = String(d.entityId ?? d.characterId ?? d.entity_id ?? '');
    if (entityId && currentCharacterId && entityId !== currentCharacterId) return;

    const result = d.result ?? d.total ?? null;
    if (result === null) return;

    emit(buildPayload({
      expression: d.diceExpression ?? d.rollExpression ?? d.expression ?? '1d20',
      result,
      label:    d.context ?? d.label ?? d.rollType ?? null,
      isCrit:   !!(d.isCritical ?? d.criticalHit),
      isFumble: !!(d.isFumble   ?? d.criticalFail),
    }));
  } catch {}
}, true);

// ─── LAYER 2: MutationObserver on dice result popup ───────────────────────────
// Fallback for when DOM events don't fire. Skips party-member notifications.

const RESULT_SELECTORS = {
  container: '[class*="dice-roll-result"]',
  total:     '[class*="dice-roll-result__total"]',
  type:      '[class*="dice-roll-result__roll-type"]',
  detail:    '[class*="dice-roll-result__dice-detail"]',
};

const PARTY_SELECTORS = [
  '[class*="party-member"]',
  '[class*="PlayerName"]',
  '[class*="player-name"]',
  '[class*="character-name"]',
  '[class*="notification"]',
  '[class*="toast"]',
];

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

// Delay observer start so DDB's initial React render doesn't fire false positives
let observerReady = false;
setTimeout(() => { observerReady = true; }, 4000);

const observer = new MutationObserver((mutations) => {
  if (!observerReady) return;

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;

      const target = node.matches(RESULT_SELECTORS.container)
        ? node
        : node.querySelector(RESULT_SELECTORS.container);

      if (!target) continue;

      const roll = extractRollFromPopup(target);
      if (roll) emit(buildPayload(roll));
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
  console.log('[DM:DDB] Preload active. Character:', currentCharacterId ?? 'unknown (open character sheet)');
}

// ─── LAYER 3: Fetch Intercept ─────────────────────────────────────────────────
// Cleanest data source when DDB's API is used. Character ID checked in response.

const ROLL_API_PATTERN = /\/api\/dice\/roll|\/dice-roll/i;

const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);

  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
    if (ROLL_API_PATTERN.test(url)) {
      response.clone().json().then((data) => {
        const entityId = String(data?.data?.characterId ?? data?.entityId ?? '');
        if (entityId && currentCharacterId && entityId !== currentCharacterId) return;

        const rolls = data?.data?.diceRolls ?? data?.rolls ?? [];
        if (!rolls.length) return;

        const roll   = rolls[0];
        const result = roll?.total ?? roll?.result ?? null;
        if (result === null) return;

        emit(buildPayload({
          expression: roll?.diceExpression ?? roll?.expression ?? '1d20',
          result,
          label:    data?.data?.context ?? data?.context ?? null,
          isCrit:   !!(roll?.isCritical || data?.data?.isCritical),
          isFumble: false,
        }));
      }).catch(() => {});
    }
  } catch {}

  return response;
};

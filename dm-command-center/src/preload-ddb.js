'use strict';

// preload-ddb.js
// ─────────────────────────────────────────────────────────────────────────────
// This script runs INSIDE the D&D Beyond WebContentsView, in an isolated world.
// It watches for roll events and tunnels them to main.js via ipcRenderer.
//
// Strategy: DDB triggers rolls via custom DOM events and visible dice roll
// result popups. We intercept both layers for maximum coverage.
// ─────────────────────────────────────────────────────────────────────────────

const { ipcRenderer } = require('electron');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1: DOM Event Interception
// D&D Beyond dispatches custom events on the document when a roll happens.
// These event names were discovered by inspecting DDB's JS bundle.
// ─────────────────────────────────────────────────────────────────────────────

const DDB_ROLL_EVENTS = [
  'DDB.Dice.Roll',       // Primary dice roll event
  'DDB.Dice.RollResult', // Final result (after animation)
];

function parseDDBRollEvent(event) {
  try {
    const d = event.detail ?? event.data ?? {};
    return {
      expression: d.diceExpression ?? d.rollExpression ?? d.expression ?? '?',
      result:     d.result         ?? d.total           ?? null,
      label:      d.context        ?? d.label            ?? d.rollType ?? null,
      isCrit:     !!(d.isCritical  ?? d.criticalHit),
      isFumble:   !!(d.isFumble    ?? d.criticalFail),
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
      ipcRenderer.send('ddb:roll-detected', roll);
    }
  }, true); // useCapture = true so we grab it before DDB's handlers
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2: MutationObserver on the dice result popup
// As a fallback, watch for the result tooltip/modal that DDB renders
// after every dice roll. Parse the result text from the DOM.
// ─────────────────────────────────────────────────────────────────────────────

// These selectors target the DDB dice roll result overlay.
// They may need updating if DDB changes their markup.
const RESULT_SELECTORS = {
  container: '[class*="dice-roll-result"]',
  total:     '[class*="dice-roll-result__total"]',
  type:      '[class*="dice-roll-result__roll-type"]',
  detail:    '[class*="dice-roll-result__dice-detail"]',
};

let lastReportedResult = null; // Debounce identical results

function extractRollFromPopup(node) {
  try {
    const totalEl  = node.querySelector(RESULT_SELECTORS.total);
    const typeEl   = node.querySelector(RESULT_SELECTORS.type);
    const detailEl = node.querySelector(RESULT_SELECTORS.detail);

    if (!totalEl) return null;

    const result = parseInt(totalEl.textContent.trim(), 10);
    if (isNaN(result)) return null;

    const label      = typeEl?.textContent.trim() ?? null;
    const detailText = detailEl?.textContent.trim() ?? '';

    // Attempt to reconstruct expression from the detail text
    // DDB shows something like "d20 + 5 = 20"
    const expressionMatch = detailText.match(/^([d0-9+\-\s]+)=/i);
    const expression      = expressionMatch
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

      // Check if this node IS a result container, or CONTAINS one
      const target = node.matches(RESULT_SELECTORS.container)
        ? node
        : node.querySelector(RESULT_SELECTORS.container);

      if (!target) continue;

      const roll = extractRollFromPopup(target);
      if (!roll) continue;

      // Debounce: skip if same result reported within 500ms
      const key = `${roll.expression}:${roll.result}`;
      if (key === lastReportedResult) continue;
      lastReportedResult = key;
      setTimeout(() => { lastReportedResult = null; }, 500);

      console.log('[DM:DDB] Popup roll captured:', roll);
      ipcRenderer.send('ddb:roll-detected', roll);
    }
  }
});

// Start observing once the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserver);
} else {
  startObserver();
}

function startObserver() {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  console.log('[DM:DDB] Preload active. Watching for dice rolls...');
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3: XHR/Fetch Intercept (optional deep integration)
// DDB hits their own API when processing rolls. Intercepting this gives us
// the cleanest, most reliable roll data — no DOM parsing needed.
// ─────────────────────────────────────────────────────────────────────────────

const ROLL_API_PATTERN = /\/api\/dice\/roll|\/dice-roll/i;

// Intercept fetch
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);

  try {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    if (ROLL_API_PATTERN.test(url)) {
      const clone = response.clone();
      clone.json().then((data) => {
        const roll = parseAPIRollData(data);
        if (roll) {
          console.log('[DM:DDB] API roll intercepted:', roll);
          ipcRenderer.send('ddb:roll-detected', roll);
        }
      }).catch(() => {});
    }
  } catch {}

  return response;
};

function parseAPIRollData(data) {
  try {
    // DDB API response shape — may vary; update if needed
    const rolls  = data?.data?.diceRolls ?? data?.rolls ?? [];
    if (!rolls.length) return null;

    const roll    = rolls[0];
    const result  = roll?.total ?? roll?.result ?? null;
    const expr    = roll?.diceExpression ?? roll?.expression ?? '?';
    const isCrit  = !!(roll?.isCritical || data?.data?.isCritical);
    const label   = data?.data?.context ?? data?.context ?? null;

    return { expression: expr, result, label, isCrit, isFumble: false };
  } catch {
    return null;
  }
}

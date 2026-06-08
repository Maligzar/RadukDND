# RadukDND — Complete Code Audit & Phased Fix Plan
**Date:** 2026-06-08  
**Scope:** End-to-end review of Phases 17–19 implementation  
**Status:** Bug inventory complete; ready for phased fixes

---

## Executive Summary

The RadukDND application (Phases 17–19) has **1 CRITICAL bug, 3 HIGH bugs, 5 MEDIUM bugs, and 6 LOW bugs**. The linchpin issue is in **Phase 19 multiplayer relay integration**: when a player joins a session, they generate a new session code instead of using the code entered by the user, causing players to connect to a different relay room than the DM. This breaks all cross-client synchronization.

Additionally, the relay client has two high-severity issues:
1. After reconnection, the socket no longer holds room membership (doesn't re-emit `session:join`)
2. If `joinSession()` is called before the socket is ready, the join is silently dropped with no retry

The player HP update listener also incorrectly re-queries the local database instead of patching in-memory state, wiping relay-synced combatants.

All issues are documented below with file paths, line numbers, and phased fixes.

---

## Bug Inventory

### CRITICAL (1 issue)

#### C1: Player Session Join Uses Wrong Code (main.js:239)
**Severity:** CRITICAL  
**Impact:** Players cannot join DM's relay room; all cross-client features fail  
**File:** `main.js`  
**Location:** Line 239 (role-picker branch)  
**Current Code:**
```javascript
} else if (role === 'player') {
  const code = generateSessionCode();  // ← WRONG: ignores sessionCode parameter
  relayClient.joinSession(code, role);
  ...
```
**Expected Code:**
```javascript
} else if (role === 'player') {
  relayClient.joinSession(sessionCode, role);  // Use the code player entered
  ...
```
**Root Cause:** Copy-paste error from Phase 16; DM branch generates a new code, but player branch should use the entered code.  
**Test:** Player enters DM's session code → player's relay room should match DM's.

---

### HIGH (3 issues)

#### H1: Relay Doesn't Re-Join After Reconnect (relay-client.js:29–34)
**Severity:** HIGH  
**Impact:** After network disconnect/reconnect, socket loses room membership; no longer receives broadcasts  
**File:** `relay-client.js`  
**Location:** Lines 29–34 (connect() 'connect' handler)  
**Current Code:**
```javascript
this.socket.on('connect', () => {
  this.connected = true;
  console.log('[Relay] Connected to server');
  this._emit('relay:connected');
  resolve();  // ← No re-emit of session:join
});
```
**Expected Code:**
```javascript
this.socket.on('connect', () => {
  this.connected = true;
  console.log('[Relay] Connected to server');
  this._emit('relay:connected');
  // Re-join the room if we were in one before disconnect
  if (this.sessionCode && this.role) {
    this.socket.emit('session:join', {
      code: this.sessionCode,
      role: this.role,
      dmName: this.dmName || 'DM',
    });
  }
  resolve();
});
```
**Root Cause:** `sessionCode` and `role` are stored on the instance, but reconnection handler doesn't restore room membership.  
**Test:** Disconnect network → wait for reconnect → verify socket re-emits `session:join`.

#### H2: Relay Join Silently Dropped If Socket Not Ready (relay-client.js:86–89)
**Severity:** HIGH  
**Impact:** If `joinSession()` called before socket connected, request is lost; no retry or queue  
**File:** `relay-client.js`  
**Location:** Lines 86–89 (joinSession method)  
**Current Code:**
```javascript
joinSession(code, role, dmName) {
  if (!this.socket || !this.connected) {
    console.warn('[Relay] Not connected, cannot join session');
    return;  // ← Silently returns without queueing
  }
  ...
}
```
**Expected Code:**
```javascript
joinSession(code, role, dmName) {
  this.sessionCode = code;
  this.role = role;
  this.dmName = dmName;
  
  if (!this.socket || !this.connected) {
    console.warn('[Relay] Not connected, will retry when ready');
    // Will be auto-emitted on reconnect (see H1 fix)
    return;
  }
  
  console.log(`[Relay] Joining session ${code} as ${role}`);
  this.socket.emit('session:join', {
    code,
    role,
    dmName: dmName || 'DM',
  });
}
```
**Root Cause:** Code doesn't store `code`/`role` for later use on reconnect (vs. DM branch which has a race condition).  
**Test:** Call `joinSession()` before `connect()` resolves → verify it joins when ready.

#### H3: Player HP Update Wipes Relay-Synced Combatants (overlay-player.html:581–583)
**Severity:** HIGH  
**Impact:** When HP updates arrive from relay, player overlay calls `loadInitiative()`, which re-queries player's empty local DB; wiped combatants are lost  
**File:** `renderer/overlay-player.html`  
**Location:** Lines 581–583 (hp:update listener)  
**Current Code:**
```javascript
api.on('hp:update', (data) => {
  console.log('HP update:', data);
  loadInitiative();  // ← Re-queries DB (player's is empty!)
});
```
**Expected Code:**
```javascript
api.on('hp:update', (data) => {
  console.log('HP update:', data);
  // Patch in-memory combatants, don't re-query
  if (data.combatant_name && combatantList) {
    const combatant = combatantList.find(c => c.name === data.combatant_name);
    if (combatant) {
      combatant.hp_current = data.hp_current;
      combatant.hp_max = data.hp_max;
      renderInitiative(combatantList);
    }
  }
});
```
**Root Cause:** Copy-paste from earlier code; DM overlay patches in-memory (correct), player overlay re-queries (wrong).  
**Test:** Player joins → relay sends combatants → player receives HP update → combatants still visible.

---

### MEDIUM (5 issues)

#### M1: Relay Events Not Whitelisted in Preload (preload-main.js:56–62)
**Severity:** MEDIUM  
**Impact:** Relay player-join/leave events sent by main.js are blocked by context isolation; player count not displayed  
**File:** `preload-main.js`  
**Location:** Lines 56–62 (ALLOWED_RECEIVE)  
**Current Code:**
```javascript
const ALLOWED_RECEIVE = [
  'roll:display',
  'roll:ddb',
  'hp:update',
  'initiative:sync',
  'initiative:add',
  'encounter:broadcast',
];
```
**Expected Code:**
```javascript
const ALLOWED_RECEIVE = [
  'roll:display',
  'roll:ddb',
  'hp:update',
  'initiative:sync',
  'initiative:add',
  'encounter:broadcast',
  'relay:player-joined',
  'relay:player-left',
  'relay:connected',
  'relay:disconnected',
];
```
**Root Cause:** Relay features added after initial preload allowlist; not updated.  
**Test:** DM connects → verifies relay:connected received; players join → verifies relay:player-joined received.

#### M2: Relay Doesn't Echo-Suppress Self-Sent Events (relay-client.js + main.js integration)
**Severity:** MEDIUM  
**Impact:** When DM broadcasts a roll, it's relayed back to DM's overlay, displaying duplicate rolls  
**File:** `relay-client.js` (no explicit sender ID) + `main.js` (no suppression on receive)  
**Location:** `relay-client.js` lines 54–64 (broadcast listeners); `main.js` lines 610–632 (relay event forwarding)  
**Current Code:** Relay server broadcasts to all clients in room, including sender. No de-duplication.  
**Expected Fix:**
  1. Client tags outgoing events with unique client ID (generated on connect)
  2. Relay server preserves sender ID
  3. Client skips incoming events with own ID
  
**Implementation:**
```javascript
// In relay-client.js constructor:
this.clientId = `client-${Date.now()}-${Math.random()}`;

// In broadcastRoll():
this.socket.emit('roll:broadcast', { code: this.sessionCode, roll, clientId: this.clientId });

// In 'roll:broadcast' listener:
this.socket.on('roll:broadcast', (data) => {
  if (data.clientId === this.clientId) return;  // Skip own echo
  this._emit('roll:broadcast', data);
});
```
**Test:** DM rolls → only one roll appears in overlay (not two).

#### M3: Relayed Rolls Lose Character Attribution (main.js:612, relay-client.js:115–118)
**Severity:** MEDIUM  
**Impact:** When relay broadcasts a roll, character name is lost; overlay shows "Unknown" instead of character  
**File:** `relay-client.js`, `main.js`  
**Location:** `relay-client.js:115` (broadcastRoll sends `roll` only); `main.js:612` (receives and forwards with no character context)  
**Current Code:**
```javascript
// main.js:612
relayClient.on('roll:broadcast', (data) => {
  if (overlayView && !overlayView.isDestroyed()) {
    overlayView.webContents.send('roll:display', data);  // data = { roll: {...} }, no character
  }
});
```
**Expected Fix:** Broadcast must include character name from DDB.  
**Implementation:**
```javascript
// In main.js, on DDB roll capture:
ipcMain.on('roll:captured', (event, roll) => {
  // Fetch current DDB character info
  const sessionRow = campaignDb.prepare('SELECT ddb_character_url FROM sessions WHERE id = ?').get(currentSessionId);
  const characterName = ddbCharacterName || 'Unknown';  // Store name when character-info arrives
  
  const enrichedRoll = { ...roll, character_name: characterName };
  relayClient.broadcastRoll(enrichedRoll);
  ...
});
```
**Test:** DM in DDB rolls → player overlay shows DM's character name with roll.

#### M4: DDB Character URL Validation Too Weak (preload-ddb.js:145)
**Severity:** MEDIUM  
**Impact:** Non-character URLs (e.g., `dndbeyond.com` homepage) accepted as valid characters; stored in DB  
**File:** `preload-ddb.js`  
**Location:** Line 145 (extractCharacterInfo)  
**Current Code:**
```javascript
const info = {
  name: null,
  class: null,
  level: null,
  url: window.location.href,  // ← Always set, even if not a character page
};
```
**Expected Code:**
```javascript
const info = {
  name: null,
  class: null,
  level: null,
  url: window.location.href,
};

// Only send URL if it matches character page pattern
const isCharacterPage = /\/characters\/\d+/i.test(window.location.href);
if (!isCharacterPage && !info.name) {
  console.log('[DDB Preload] Not a character page; skipping info send');
  return;
}
```
**Root Cause:** `window.location.href` is always truthy, even for non-character pages.  
**Test:** DM navigates to dndbeyond.com homepage → character info not sent; navigates to character page → info sent.

#### M5: Roll20 Observer Initialization Weak (preload-r20.js:27–45)
**Severity:** MEDIUM  
**Impact:** `monitorTokenHpChanges()` called once; if token layer added dynamically later, HP changes not observed  
**File:** `preload-r20.js`  
**Location:** Lines 27–45 (initR20Sync)  
**Current Code:**
```javascript
function initR20Sync() {
  if (!window.d20) {
    setTimeout(initR20Sync, 500);
    return;
  }
  monitorTokenHpChanges();  // Called once; if token layer added later, missed
  monitorChatDamage();
  monitorCharacterSheetHp();
}
```
**Expected Code:** Add retries if token layer not found.  
**Implementation:**
```javascript
function monitorTokenHpChanges() {
  const tokenLayer = document.getElementById('token-layer');
  if (!tokenLayer) {
    console.warn('[r20] Token layer not found; retrying...');
    setTimeout(monitorTokenHpChanges, 1000);  // Retry every second
    return;
  }
  // ... rest of observer setup
}
```
**Test:** Roll20 loads without token layer initially → layer added later → HP changes observed.

---

### LOW (6 issues)

#### L1: Roll20 Invalid Handler Reference (preload-r20.js:18)
**Severity:** LOW  
**Impact:** Line `if (['initiative:get-combatants'].includes(channel))` references handler that doesn't exist in main.js; dead code  
**File:** `preload-r20.js`  
**Location:** Line 18 (contextBridge.exposeInMainWorld)  
**Current Code:**
```javascript
invoke: (channel, data) => {
  if (['initiative:get-combatants'].includes(channel)) {  // ← No such handler
    return ipcRenderer.invoke(channel, data);
  }
},
```
**Fix:** Remove dead code; Roll20 can't invoke handlers anyway.  
**Expected Code:**
```javascript
invoke: (channel, data) => {
  // Roll20 preload has no invoke calls; remove this method
},
```
or leave empty since nothing calls it.

#### L2: Roll20 Sheet HP Staleness (preload-r20.js:202–205)
**Severity:** LOW  
**Impact:** `monitorCharacterSheetHp()` captures HP value at load time (`prevValue`); never updated on subsequent edits  
**File:** `preload-r20.js`  
**Location:** Lines 202–205 (monitorCharacterSheetHp)  
**Current Code:**
```javascript
hpInputs.forEach((input) => {
  const prevValue = input.value;  // Captured once at startup
  input.addEventListener('change', () => {
    const newValue = input.value;
    if (newValue !== prevValue) {  // Always true after first change
      ...
    }
  });
});
```
**Fix:** Update `prevValue` after each change.  
**Expected Code:**
```javascript
hpInputs.forEach((input) => {
  input.addEventListener('change', () => {
    const newValue = input.value;
    const charName = document.querySelector('[data-character-name]')?.getAttribute('data-character-name') ||
                     'Unknown Character';
    
    console.log(`[r20] Sheet HP change: ${charName} → ${newValue}`);
    
    window.electronAPI.send('hp:r20-update', {
      token_name: charName,
      hp_current: parseInt(newValue, 10),
      source: 'character-sheet',
      timestamp: Date.now(),
    });
  });
});
```

#### L3: PartyLevel Hardcoded to 1 (renderer/index.html:507–508)
**Severity:** LOW  
**Impact:** Encounter difficulty always scales to level-1 thresholds; conflicts with schema default (4)  
**File:** `renderer/index.html`  
**Location:** Lines 507–508 (role picker script)  
**Current Code:**
```javascript
const partyLevel = 1;      // Hardcoded
const partySize = 6;       // Hardcoded
```
**Fix:** Add inputs to role picker; default to schema values.  
**Expected Code:**
```html
<!-- In HTML form -->
<div class="form-group">
  <label>Party Level:</label>
  <input type="number" id="partyLevel" min="1" max="20" value="4" />
</div>

<!-- In JavaScript -->
const partyLevel = parseInt(document.getElementById('partyLevel')?.value || 4, 10);
const partySize = parseInt(document.getElementById('partySize')?.value || 6, 10);
```

#### L4: DevTools Opens on Every Launch (main.js:184)
**Severity:** LOW  
**Impact:** DevTools window opens by default; should be dev-flag-gated  
**File:** `main.js`  
**Location:** Line 184 (ddbView creation)  
**Current Code:**
```javascript
ddbView.webContents.openDevTools({ mode: 'detach' });
```
**Fix:** Gate behind process.env.DEBUG flag or app.isPackaged check.  
**Expected Code:**
```javascript
if (process.env.NODE_ENV === 'development') {
  ddbView.webContents.openDevTools({ mode: 'detach' });
}
```

#### L5: Dead Variable in Phase 19 Handler (main.js — formerly present, now removed)
**Severity:** LOW  
**Impact:** (Already fixed during Phase 19 review)  
**Status:** ✓ Complete

#### L6: Unused Relay Initialization Check (relay-client.js:16–17)
**Severity:** LOW  
**Impact:** `connect()` returns early if `this.socket` already exists, but doesn't verify connected state; can race  
**File:** `relay-client.js`  
**Location:** Lines 16–17 (connect method)  
**Current Code:**
```javascript
connect() {
  if (this.socket) return Promise.resolve();  // ← Resolves even if disconnected
  ...
}
```
**Fix:** Check both socket and connected state.  
**Expected Code:**
```javascript
connect() {
  if (this.socket && this.connected) return Promise.resolve();
  if (this.socket) {
    // Existing socket, wait for connection
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.connected) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }
  // Create new socket (rest of code)
}
```

---

## Phased Fix Plan

### Phase A: CRITICAL — Multiplayer Session Join (1–2 days)
**Goals:**
- Fix player session code to use entered value (C1)
- Fix relay reconnection to restore room membership (H1)
- Fix relay join to store code/role for retry (H2)
- Verify players and DM connect to same relay room

**Changes:**
1. **main.js:239** — Change `const code = generateSessionCode()` → `relayClient.joinSession(sessionCode, role)`
2. **relay-client.js** — Add sessionCode/role/dmName instance variables; fix reconnect handler; improve joinSession()
3. **Test:** Player enters DM code → relay room matches → rolls sync

**Commits:**
- `Fix: Player session join uses wrong relay room code (C1)`
- `Fix: Relay doesn't restore room membership on reconnect (H1)`
- `Fix: Relay join silently dropped if socket not ready (H2)`

---

### Phase B: HIGH/MEDIUM — Relay Sync Correctness (2–3 days)
**Goals:**
- Fix player HP update to patch in-memory instead of re-querying (H3)
- Add relay event whitelist to preload (M1)
- Implement echo suppression for self-sent events (M2)
- Preserve character name in relayed rolls (M3)
- Harden DDB character URL validation (M4)

**Changes:**
1. **overlay-player.html:581** — Patch combatant in-memory (copy DM pattern)
2. **preload-main.js:56** — Add relay:* events to ALLOWED_RECEIVE
3. **relay-client.js** — Add clientId; suppress self-echo
4. **main.js** — Enrich relayed rolls with character name
5. **preload-ddb.js** — Validate character page pattern before sending URL
6. **Test:** Player receives relay events; rolls deduplicated; character names preserved

**Commits:**
- `Fix: Player HP update overwrites relay-synced state (H3)`
- `Fix: Relay events blocked by preload context isolation (M1)`
- `Fix: Relay broadcasts duplicate to sender (M2)`
- `Fix: Relayed rolls lose character attribution (M3)`
- `Fix: DDB character URL validation missing (M4)`

---

### Phase C: MEDIUM/LOW — Connection Robustness (1–2 days)
**Goals:**
- Harden Roll20 observer initialization with retries (M5)
- Remove dead Roll20 handler reference (L1)
- Fix Roll20 sheet HP staleness (L2)
- Add party level/size inputs to role picker (L3)
- Gate DevTools behind dev flag (L4)
- Fix relay connect() race condition (L6)

**Changes:**
1. **preload-r20.js:27** — Add retry loop if token layer not found
2. **preload-r20.js:18** — Remove dead invoke handler
3. **preload-r20.js:202** — Remove prevValue capture; always send on change
4. **renderer/index.html** — Add partyLevel/partySize inputs
5. **main.js:184** — Gate DevTools with NODE_ENV check
6. **relay-client.js:16** — Fix connect() to check both socket and connected state
7. **Test:** Roll20 observers survive async load; all robustness edge cases covered

**Commits:**
- `Fix: Roll20 observer initialization weak on async load (M5)`
- `Fix: Dead Roll20 invoke handler reference (L1)`
- `Fix: Roll20 sheet HP staleness on subsequent edits (L2)`
- `Fix: Party level/size hardcoded in role picker (L3)`
- `Fix: DevTools always open on launch (L4)`
- `Fix: Relay connect() race condition (L6)`

---

### Phase D: Config & Cleanup (1 day)
**Goals:**
- Remove stale `dm-command-center/` directory and `.zip` files
- Clean up unused imports/variables
- Verify all test checkpoints pass
- Final integration test: two client instances, full workflow

**Changes:**
1. **Bash** — `rm -rf dm-command-center/ *.zip`
2. **Grep** — Audit for stale references to Discord/deleted modules
3. **main.js** — Verify all current IPC handlers used
4. **package.json** — Ensure socket.io-client is pinned

**Commits:**
- `Cleanup: Remove stale dm-command-center/ and archives`
- `Cleanup: Remove unused imports and dead code references`

**Test Checklist:**
- [ ] DM instance: starts, picks role, generates session code
- [ ] Player instance: starts, picks role, enters DM code, joins relay
- [ ] DM rolls in DDB → appears on player overlay (no duplicate)
- [ ] DM initiates combat, adds combatants → player sees same initiative
- [ ] DM reduces combatant HP → player HP bar updates (in-memory)
- [ ] Network disconnect/reconnect → relay re-joins, continues syncing
- [ ] Kill DM instance, player continues (no crash)
- [ ] Both instances quit cleanly, no connection leaks

---

## Implementation Notes

- **Branch Strategy:** Each phase gets its own feature branch; PR review before merge to `claude/md-review-planning-Tx6kt`
- **Commit Format:** `Fix: [severity] — [issue name] ([file:line])`; body includes before/after code snippets
- **Testing:** Manual testing against above checkpoints; no automated test suite required
- **Deploy:** Merge Phase D → main → tag release
- **Rollback:** Each phase is independently reversible; if issue found, revert commit and fix in new PR

---

## Known Limitations & Future Work

- **Relay Auth:** Current relay server assumes trusted network; no authentication
- **Relay Scaling:** Design supports ~10–20 concurrent rooms; beyond that requires horizontal scaling
- **Audio/Video:** Phase 20+ planned; current focus is combat sync only
- **Offline Mode:** App works fully offline; relay is optional enhancement

---

## Appendix: Code Snippets by Severity

### CRITICAL (C1) — One-line fix in main.js:239

### HIGH (H1–H3) — Three files: relay-client.js (2 methods), overlay-player.html (1 listener), main.js (verify integration)

### MEDIUM (M1–M5) — Five files: preload-main.js (whitelist), relay-client.js (clientId), main.js (enrich rolls), preload-ddb.js (validate URL), preload-r20.js (retry loop)

### LOW (L1–L6) — Six files: preload-r20.js (2 issues), renderer/index.html (hardcoded values), main.js (DevTools), relay-client.js (race condition)

---

**End of Review Document**


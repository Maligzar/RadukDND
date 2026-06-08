# DM Command Center — Elminster Edition
## Project Documentation & Phase 12+ Implementation Plan

**Project Goal:** Electron desktop app for D&D session management with multi-player support, roll bridging, and initiative tracking. **Discord integration removed** — focus is on portability and core combat UX.

**Current Phase:** 19 (Multi-player Relay Integration - In Progress)

---

## Project Architecture

### High-Level Overview
```
Electron Main (main.js)
  ├─ D&D Beyond WebContentsView (with preload-ddb.js for roll capture)
  ├─ Roll20 WebContentsView (with preload-r20.js for HP tracking)
  └─ Overlay WebContentsView (local HTML + preload-main.js for IPC)
       ├─ Card Browser (Spells & Items)
       ├─ Initiative Tracker
       ├─ Roll Display
       └─ Combat Controls

Databases (SQLite)
  ├─ campaign.db — sessions, rolls, initiative, combatants
  └─ bestiary.db — monster data for encounter generation

External Relay (Google Cloud) — Optional for multi-player
  └─ Socket.io server at 34.31.125.161
       ├─ Room management by session_code
       ├─ Broadcast rolls, HP, initiative
       └─ Multi-player event synchronization
```

### Key Files
- **main.js** — Electron main, IPC handlers, view layout, DB queries
- **relay-client.js** — Phase 19: Socket.io client for multi-player sync
- **preload-main.js** — Exposes ipcRenderer to overlay
- **preload-ddb.js** — Intercepts D&D Beyond rolls (DOM events, MutationObserver, fetch hooks)
- **preload-r20.js** — Captures Roll20 HP updates
- **renderer/index.html** — Role picker UI
- **renderer/overlay-dm.html** / **overlay-player.html** — Combat UIs
- **renderer/card-browser.html** / **card-browser.js** — Spell/item browser
- **renderer/encounter-generator.html** — Phase 18: Random encounter builder
- **db/db-init.js** — SQLite schema + prepared statements

### Database Schema
```sql
-- sessions
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  session_code TEXT UNIQUE,
  dm_name TEXT,
  started_at INTEGER,
  party_level INTEGER,
  party_size INTEGER,
  ddb_character_url TEXT  -- Phase 17: D&D Beyond character URL
);

-- rolls
CREATE TABLE rolls (
  id INTEGER PRIMARY KEY,
  session_id INTEGER,
  player_id TEXT,
  dice_type TEXT,          -- "d20", "2d6+3", etc.
  raw_result TEXT,         -- individual dice: "[5, 3, 4]"
  modifier INTEGER,
  total INTEGER,
  action_label TEXT,       -- "Fireball", "Sneak Attack"
  roll_type TEXT,          -- "check", "damage", "save"
  is_secret BOOLEAN,
  is_crit BOOLEAN,
  is_nat1 BOOLEAN,
  source TEXT,             -- "ddb", "roll20"
  rolled_at INTEGER
);

-- initiative
CREATE TABLE initiative (
  id INTEGER PRIMARY KEY,
  session_id INTEGER,
  combatant_name TEXT,
  initiative_roll INTEGER,
  hp_current INTEGER,
  hp_max INTEGER,
  ac INTEGER,
  is_active_turn BOOLEAN
);
```

---

## Phase 11: Relay Server Integration

### Objectives
1. **Connect to relay server** — DM/players join session room by code
2. **Broadcast events** — Rolls, HP updates, initiative changes propagate to all clients
3. **Multi-player sync** — All clients see consistent state without polling
4. **Session lifecycle** — Join/leave, session persistence, cleanup

### Implementation Plan

#### Step 1: Add Socket.io Client Dependency
```bash
npm install socket.io-client
```
Add to `package.json` dependencies.

#### Step 2: Create Relay Client Module
**New file:** `src/relay-client.js`
- Singleton Socket.io connection to `34.31.125.161`
- Auto-connect on app start (no auth needed)
- Expose `joinSession(code, role)`, `broadcast(event, payload)`, `disconnect()`
- Handle reconnection, error logging

#### Step 3: Integrate Relay with Main Process
**Modify:** `src/main.js`
- On `session:set-role`, call `relay.joinSession(code, role)`
- Hook roll/HP/initiative events to `relay.broadcast()` after local DB
- Listen to relay events and update local state

#### Step 4: Overlay UI Updates (Optional Phase 11.5)
- Display session code prominently for players to share
- Show connected player count
- "Leave Session" button to gracefully disconnect

### Relay Server Event Schema

**Client → Server**
```javascript
// DM starts session
socket.emit('session:join', { code, role: 'dm', dmName });

// Any role broadcasts events
socket.emit('roll:broadcast', { code, roll: {...} });
socket.emit('hp:update', { code, combatant_name, hp_current });
socket.emit('initiative:sync', { code, combatants: [...] });
socket.emit('session:leave', { code, role });
```

**Server → Client**
```javascript
// Broadcast to room
socket.on('roll:broadcast', (roll) => {...});
socket.on('hp:update', (update) => {...});
socket.on('initiative:sync', (combatants) => {...});
socket.on('player:joined', (playerCount) => {...});
socket.on('player:left', (playerCount) => {...});
```

---

## Phase 12: Initiative Tracker & Combat UI

### Objectives
1. **Full combat workflow** — Add/remove combatants, roll initiative, track turn order
2. **Live HP tracking** — Display current/max HP, visual health bars
3. **Turn management** — Highlight active combatant, advance turns
4. **Multi-player sync** — All clients see consistent initiative state
5. **Round counter** — Track combat rounds and total time

### Implementation Plan

#### Step 1: Create Initiative Tracker HTML/CSS
**New file:** `renderer/initiative-tracker.html`
- Combat control panel with:
  - Round counter (starts at 1)
  - Add combatant form (name, AC, HP, initiative roll)
  - Combat roster table (name, initiative, HP bar, AC, turn indicator)
  - Action buttons: Start Combat, Next Turn, Clear Combat
  - Roll initiative for all button

#### Step 2: Create Tracker JavaScript Logic
**New file:** `renderer/initiative-tracker.js`
- IPC communication: fetch combatants, add/update combatant
- Initiative roll logic: d20 + modifiers
- Turn advancement: skip dead/unconscious
- HP updates from Roll20 (real-time)
- Relay event listeners for multi-player sync

#### Step 3: Integrate into Overlay
**Modify:** `renderer/overlay-dm.html` / `renderer/overlay-player.html`
- Tab system: "Rolls" | "Initiative" | "Actions"
- Initiative tab shows full tracker
- Collapse/expand for space management
- DM-only controls (add/manage), Player-readonly view

#### Step 4: Roll20 HP Sync
**Enhance:** `src/preload-r20.js`
- When Roll20 token HP changes, emit `hp:update` to relay
- Parse damage rolls from Roll20 chat: "-5 damage to Goblin"
- Auto-subtract from initiative tracker HP

### UI Mockup
```
┌─────────────────────────────────────┐
│ COMBAT TRACKER      [Round 3]        │
├─────────────────────────────────────┤
│ [+ Add Combatant] [Roll Initiative]  │
├─────────────────────────────────────┤
│ NAME        | INIT | HP      | AC  → │
│ Glendorak   | 18   | 47/50  ▓▓▓ | 16│ ← ACTIVE
│ Goblin 1    | 14   | 8/12   ▓▓  | 15│
│ Goblin 2    | 12   | 0/12   ░░  | 15│ (dead)
│ Giant       | 9    | 52/65  ▓▓▓ | 17│
├─────────────────────────────────────┤
│ [Previous Turn] [Next Turn] [Clear] │
└─────────────────────────────────────┘
```

### Database Updates (if needed)
- `initiative` table already stores: id, session_id, combatant_name, initiative_roll, hp_current, hp_max, ac, is_active_turn
- No schema changes needed

---

## Phase 14: Roll20 HP Sync

### Objectives
1. **Monitor token HP changes** — Detect when Roll20 tokens take damage
2. **Parse damage from chat** — Extract damage numbers from damage rolls in chat
3. **Auto-sync to initiative tracker** — Update combatant HP in real-time
4. **Heal tracking** — Support healing spells that restore HP

### Implementation

#### Step 1: Enhanced preload-r20.js
- **MutationObserver** on token layer — detect HP stat bubble changes
- **Chat monitor** — parse damage/heal patterns from messages
- **Character sheet** — track HP field edits on character sheets
- **IPC channels:**
  - `hp:r20-update` — token HP changes with token_name, hp_current, hp_max
  - `damage:parsed` — damage/heal from chat with amount, target_name

#### Step 2: IPC Handlers (main.js)
| Handler | Trigger | Action |
|---------|---------|--------|
| `hp:r20-update` | Token HP changes | Match combatant by name, update HP, sync initiative |
| `damage:parsed` | Chat damage roll | Auto-reduce HP, clamp to 0 |
| `damage:parsed` | Chat heal | Auto-increase HP, clamp to max |

#### Step 3: Matching Logic
- **By combatant_name** — search initiative table for exact match
- **Silent fail** — if no match, log warning (DM must add combatant manually)
- **Auto-clamp** — damage can't go below 0, healing can't exceed max

### Test Plan
- [ ] Open Roll20 with a token
- [ ] Reduce token HP via token stat — initiative tracker updates
- [ ] Roll damage in Roll20 chat → "12 damage to Goblin" → Goblin HP decreases
- [ ] Roll healing spell → HP increases (clamped to max)
- [ ] Unknown target → logs warning, no crash
- [ ] DM and player both see updated HP

### Limitations & Future
- **Name matching fragile** — fragmented HP might not match names (e.g., "Goblin 1" vs "Goblin")
- **Chat parsing heuristic** — not 100% accurate for all sheet types
- **No Roll20 API** — uses DOM observation (more resilient, works for all sheets)

---

## Phase 17: Character URL Switcher

### Objectives
1. **Mid-session character switching** — Allow DM to switch D&D Beyond characters without restarting
2. **Character info extraction** — Extract character name, class, level from DDB page
3. **URL persistence** — Store character URL in session database
4. **DM-only control** — Only DM can switch characters

### Implementation

#### Step 1: Database Migration
- Add `ddb_character_url TEXT` column to sessions table
- Increment SCHEMA_VERSION from 1 to 2
- Migration runs automatically on first launch with new version

#### Step 2: Enhanced preload-ddb.js
- Extract character info from D&D Beyond DOM (name, class, level)
- Send `ddb:character-info` IPC with extracted data
- Triggered on page load with 1000ms delay to allow DOM settlement

#### Step 3: IPC Handlers (main.js)
| Handler | Trigger | Action |
|---------|---------|--------|
| `ddb:switch-character` | invoke from overlay | Load new character URL in ddbView, update session |
| `ddb:character-info` | sent from preload | Store character info, broadcast to overlay |

#### Step 4: Overlay UI (overlay-dm.html)
- New "D&D Beyond Character" panel below rolls
- Display current character name
- Text input for character URL
- "Switch Character" button

### UI Workflow
1. DM opens character sheet on D&D Beyond in browser
2. Copies URL from address bar
3. Pastes into character switcher input
4. Clicks "Switch Character"
5. App loads new URL in ddbView, extracts character info
6. Character name updates in overlay

### Test Plan
- [ ] DM switches from one character to another mid-session
- [ ] Character name displays correctly in overlay
- [ ] Character URL stored in session database
- [ ] New rolls from new character are captured
- [ ] Initiative tracker unaffected by character switch

---

## Phase 19: Multi-player Relay Integration

### Objectives
1. **Connect to relay server** — DM/players join session room by code
2. **Broadcast events** — Rolls, HP updates, initiative changes propagate to all clients
3. **Multi-player sync** — All clients see consistent state in real-time
4. **Graceful fallback** — App works offline; relay is optional enhancement

### Implementation

#### Step 1: Socket.io Client Module
**New file:** `relay-client.js`
- Singleton Socket.io client to `34.31.125.161`
- Auto-connect on app startup (non-blocking)
- Methods: `joinSession(code, role)`, `broadcastRoll(roll)`, `broadcastHpUpdate(...)`, `broadcastInitiativeSync(...)`
- Event listeners for incoming broadcast events
- Reconnection with exponential backoff (1s → 5s, max 5 attempts)

#### Step 2: Main Process Integration
**Modify:** `main.js`
- Import and initialize relay-client on app ready
- Call `relayClient.joinSession()` when role is set
- Hook all roll/HP/initiative events to `relayClient.broadcast*()`
- Set up relay event listeners that forward to overlayView
- Disconnect on app quit

#### Step 3: Event Flow
| Event | Source → Relay → Target |
|-------|------------------------|
| Rolls | DM/Player DDB → relay.roll:broadcast → all overlay views |
| HP Updates | DM initiative → relay.hp:update → all overlay views |
| Initiative | DM action → relay.initiative:sync → all overlay views |
| Player Join | Any client → relay.player:joined → all clients |

#### Step 4: Package Dependencies
- Add `socket.io-client@^4.7.2` to package.json (auto-installed on npm install)

### Relay Server Event Schema

**Client → Server**
```javascript
// Join session room
socket.emit('session:join', { code, role, dmName });

// Broadcast events
socket.emit('roll:broadcast', { code, roll: {...} });
socket.emit('hp:update', { code, combatant_name, hp_current, hp_max });
socket.emit('initiative:sync', { code, combatants: [...] });

// Leave session
socket.emit('session:leave', { code, role });
```

**Server → Client**
```javascript
// Broadcast to room
socket.on('roll:broadcast', (data) => { ... });
socket.on('hp:update', (data) => { ... });
socket.on('initiative:sync', (data) => { ... });
socket.on('player:joined', (playerCount) => { ... });
socket.on('player:left', (playerCount) => { ... });
```

### Test Plan
- [ ] DM and Player instances connect to relay on app start
- [ ] Both join same session by code
- [ ] Roll in DDB (DM side) → appears on Player side overlay
- [ ] Update HP in initiative (DM side) → reflects on Player side
- [ ] Add/remove combatant (DM side) → syncs to Player side
- [ ] Relay disconnects → app continues, events queue
- [ ] Relay reconnects → pending events flush

### Limitations & Future
- **No auth** — relay server assumes trusted network (internal only)
- **No persistence** — relay is stateless, clients are source of truth
- **Optional** — if relay unavailable, app works locally (no cross-client sync)
- **Scaling** — current design supports ~10-20 concurrent rooms

---

## Phase 12+ Roadmap

| Feature | Phase | Status | Effort |
|---------|-------|--------|--------|
| Character URL Switcher | 17 | ✓ Complete | 3 days |
| Session Recap PDF Export | 15 | ✓ Complete | 1 week |
| Player Onboarding | 16 | ✓ Complete | 1 week |
| Encounter Generator UI | 18 | ✓ Complete | 1 week |
| Multi-player Relay Integration | 19 | ⧗ In Progress | 2 weeks |
| Audio/Video Streaming | 20+ | Planned | TBD |

---

## Development Notes

### Testing Multiplayer Locally
Run two instances of the app:
1. **Instance 1 (DM)** — Click "Dungeon Master" on role picker, note session code
2. **Instance 2 (Player)** — Click "Player", paste DM's session code
3. Roll in DDB on either instance — both should see the roll in overlay

### Debugging Relay Connection
- Check DevTools console for `[Relay]` log messages
- Verify `34.31.125.161` is reachable: `curl -I http://34.31.125.161`
- Inspect Socket.io events in Network tab (WebSocket frames)

### Common Issues
- **Relay not found** — Firewall/network policy blocking 34.31.125.161
- **Events not syncing** — Check session code matches on both clients
- **Stale connection** — Relay reconnects automatically; manual reconnect: close app & reopen

---

## Code Style & Guidelines
- No comments unless WHY is non-obvious
- Prefer editing over new files
- Trust framework guarantees (no defensive null checks for internal code)
- One-liners for simple logic, avoid premature abstraction
- Secure by default: context isolation, no node integration, preload sandboxing

---

## Current Status
- **Phase:** 19 (Multi-player Relay Integration)
- **Branch:** `claude/phase19-relay-integration` (in progress)
- **Next:** Merge Phase 19, then Phase 20 (Audio/Video Streaming or other features)

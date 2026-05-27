# DM Command Center — Elminster Edition
## Project Documentation & Phase 11 Implementation Plan

**Project Goal:** Electron desktop app for D&D session management with multi-player support, roll bridging, and initiative tracking.

**Current Phase:** 11 (Relay Server Integration)

---

## Project Architecture

### High-Level Overview
```
Electron Main (main.js)
  ├─ Discord WebContentsView
  ├─ D&D Beyond WebContentsView (with preload-ddb.js for roll capture)
  ├─ Roll20 WebContentsView (with preload-r20.js for HP tracking)
  └─ Overlay WebContentsView (local HTML + preload-main.js for IPC)
       ├─ Initiative Tracker
       ├─ Roll Display
       └─ Combat Controls

Databases (SQLite)
  ├─ campaign.db — sessions, rolls, initiative, combatants
  └─ bestiary.db — monster data for encounter generation

External Relay (Google Cloud)
  └─ Socket.io server at 34.31.125.161
       ├─ Room management by session_code
       ├─ Broadcast rolls, HP, initiative
       └─ Multi-player event synchronization
```

### Key Files
- **src/main.js** — Electron main, IPC handlers, view layout, DB queries
- **src/preload-main.js** — Exposes ipcRenderer to overlay
- **src/preload-ddb.js** — Intercepts D&D Beyond rolls (DOM events, MutationObserver, fetch hooks)
- **src/preload-r20.js** — Captures Roll20 HP updates
- **renderer/index.html** — Role picker UI
- **renderer/overlay-dm.html** / **overlay-player.html** — Combat UIs
- **src/db/db-init.js** — SQLite schema + prepared statements

### Database Schema
```sql
-- sessions
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  session_code TEXT UNIQUE,
  dm_name TEXT,
  started_at INTEGER,
  party_level INTEGER,
  party_size INTEGER
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

## Phase 12+ Roadmap

| Feature | Phase | Effort | Blocker |
|---------|-------|--------|---------|
| Initiative Tracker Panel (full combat UI) | 12 | 2 weeks | None |
| Discord Webhooks (critical hit alerts) | 12 | 1 week | None |
| Character URL Switcher | 12 | 3 days | None |
| Session Recap PDF Export | 13 | 1 week | None |
| Player Onboarding (QR code share) | 13 | 1 week | None |

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

## Current Branch
Working on: `claude/md-review-planning-Tx6kt`

Push to: `main` (after PR review)

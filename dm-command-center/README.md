# ⚔ DM Command Center — Elminster Edition

A dedicated Electron shell for D&D sessions. Embeds D&D Beyond, Roll20, and
Discord in a tiled layout with automatic roll bridging, global hotkeys, and
local session logging.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Launch in dev mode (shows DevTools for the overlay)
npm run dev

# 3. Launch production mode
npm start
```

---

## Project Structure

```
dm-command-center/
├── package.json
├── src/
│   ├── main.js            ← Electron main process: windows, IPC, hotkeys, DB
│   ├── preload-main.js    ← Bridge for the toolbar overlay renderer
│   └── preload-ddb.js     ← Injected into D&D Beyond — intercepts dice rolls
├── renderer/
│   ├── index.html         ← Toolbar overlay UI
│   └── renderer.js        ← Toolbar overlay logic
└── assets/
    └── icon.png           ← App icon (add your own)
```

---

## Configuration

### Step 1 — Set your URLs

In `src/main.js`, update the `URLS` object at the top:

```js
const URLS = {
  ddb:     'https://www.dndbeyond.com/characters/YOUR_CHARACTER_ID',
  roll20:  'https://app.roll20.net/campaigns/play/YOUR_CAMPAIGN_ID',
  discord: 'https://discord.com/app',  // or a specific channel URL
};
```

### Step 2 — Adjust Layout Proportions

```js
const LAYOUT = {
  ddb:     { widthFrac: 0.35 },   // 35% of window width
  roll20:  { widthFrac: 0.42 },   // 42%
  discord: { widthFrac: 0.23 },   // 23%
  toolbarHeight: 40,
};
```

---

## Features

### 🎲 DDB → Roll20 Roll Bridging

The `preload-ddb.js` script is injected into D&D Beyond and uses three
interception strategies (in order of reliability):

1. **DOM Event Listener** — Catches `DDB.Dice.Roll` and `DDB.Dice.RollResult`
   custom events dispatched by DDB's JS.
2. **MutationObserver** — Watches for the dice result popup appearing in the
   DOM and parses the result text.
3. **Fetch Intercept** — Hooks into `window.fetch` to catch DDB's dice API
   calls and read the clean JSON response.

When a roll is detected, it is:
- Logged to the local SQLite database
- Bridged to Roll20 via `executeJavaScript` on the Roll20 view
- Flashed in the toolbar overlay

### ⌨ Global Hotkeys

| Hotkey          | Action                        |
|-----------------|-------------------------------|
| `Ctrl+M`        | Mute/Unmute Discord           |
| `Ctrl+R`        | Center Roll20 Map             |
| `Ctrl+1`        | Focus D&D Beyond panel        |
| `Ctrl+2`        | Focus Roll20 panel            |
| `Ctrl+3`        | Focus Discord panel           |
| `Ctrl+Shift+R`  | Reload all three panels       |
| `F12`           | DevTools (focused panel)      |

These work even when the window is not in focus.

### 🗄 Session Logging (SQLite)

Every roll and hotkey event is saved to:

```
%APPDATA%\dm-command-center\sessions.db   (Windows)
~/Library/Application Support/dm-command-center/sessions.db  (macOS)
```

Tables:
- `sessions` — One row per app launch
- `rolls` — Every detected roll with expression, result, crit flag, label
- `events` — Hotkey presses and system events

Query example (using DB Browser for SQLite):
```sql
-- Best rolls of the session
SELECT label, expression, result, is_crit
FROM rolls
ORDER BY result DESC
LIMIT 10;
```

---

## Troubleshooting

### Roll bridging not working
- Roll20's chat input selector may have changed. Open DevTools on the Roll20
  panel (`F12` with it focused) and verify `#textchat-input textarea` exists.
- DDB may have updated their event names. Check the console in the DDB panel
  for `[DM:DDB]` log messages to confirm the preload is running.

### Discord won't load
- Discord Web occasionally requires you to log in fresh. Click inside the
  Discord panel and complete the login flow — your session is persisted in the
  `persist:discord` partition.

### Hotkeys not registering
- Another application may have claimed the shortcut. Change the accelerator
  strings in `main.js` to something unused.

---

## Roadmap (Next Build)

- [ ] Discord auto-post on critical hit (Discord Webhook)
- [ ] Playwright integration for Roll20 token damage automation
- [ ] Initiative tracker overlay panel
- [ ] Session recap PDF export from SQLite log
- [ ] Custom character URL switcher per player

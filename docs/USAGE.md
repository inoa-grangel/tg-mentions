# Usage & TUI Keybindings Guide

## Command-Line Interface

```bash
tg-mentions [flags]
```

### Flags

- **`--select-chats`** *(aliases: `--configure-chats`, `--list-chats`)*
  Fetches all forum supergroups on your Telegram account and opens an interactive checklist TUI to configure `TG_ALLOWED_CHAT_IDS`. Blocked when an administrator `policy.json` enforces `allowedChatIds`.
- **`--all`**
  Starts the main TUI with hidden (`[forever]`, `[until-msg]`) and snoozed (`[zzz]`) topics displayed alongside active topics.
- **`--open`**
  Non-interactively opens the top active mentioned topic in Telegram Desktop (or browser if Desktop is unavailable) and exits.
- **`--web`**
  Forces `https://t.me/...` browser links instead of `tg://` protocol links. Ignored if corporate policy sets `"requireDesktopApp": true`.
- **`--purge`**
  Deletes all stored credentials from the OS credential store and wipes all local databases, logs, and configuration files.

---

## Main TUI (`NORMAL` Mode)

### Navigation

| Key | Action |
| :--- | :--- |
| `j` or `↓` | Move cursor down (wraps around) |
| `k` or `↑` | Move cursor up (wraps around) |
| `gg` | Jump to the first topic |
| `G` | Jump to the last topic |
| `:<number>` + `Enter` | Jump to a specific row number (e.g., `:5`) |

### Opening & Refreshing

| Key | Action |
| :--- | :--- |
| `Enter` or `o` | Open the selected topic using the default scheme (`tg://` if Telegram Desktop is installed, otherwise `https://t.me/...`) |
| `O` | Force-open the selected topic in your web browser (`https://t.me/...`) |
| `r` | Reload active mentions from Telegram |

### Hiding, Snoozing & Filtering

| Key | Action |
| :--- | :--- |
| `h` | Open the interactive **Hide Menu** for the selected topic |
| `d` | Quick-action: **Hide forever** (`[forever]`) |
| `m` | Quick-action: **Hide until a new message arrives** (`[until-msg]`) |
| `s` | Open the interactive **Snooze Date/Duration Menu** (`[zzz]`) |
| `u` | Unhide / unsnooze the currently selected hidden topic |
| `a` | Toggle visibility of hidden and snoozed topics (`[+hidden]`) |
| `/` | Enter **Search Mode** to filter topics by topic name or group title |
| `Esc` | Clear active search filter (in `NORMAL` mode) or cancel current prompt |
| `:` | Enter **Command Mode** |
| `q` or `Ctrl+C` | Quit `tg-mentions` and zero in-memory cryptographic keys |

---

## Hide & Snooze Menus

### Hide Menu (`h`)

1. **`[1]` Hide forever:** Keeps the topic hidden until its retention period expires (default: 90 days).
2. **`[2]` Hide until it gets a new message:** Hides the topic until `lastMessageDate` exceeds the timestamp recorded when it was hidden.
3. **`[3]` Hide until new message or after a date...:** Opens the Snooze Date/Duration menu.

### Snooze Menu (`s`)

Select a preset using `j`/`k` or `↑`/`↓` and press `Enter`:

- **`30m`** — 30 minutes
- **`1h`** — 1 hour
- **`3h`** — 3 hours
- **`1d`** — Tomorrow at 9:00 AM
- **`3d`** — 3 days
- **`1w`** — 1 week

Snoozed topics automatically wake early if a new message is posted in the topic, or once the scheduled timestamp passes.

---

## Vim Command Mode (`:`)

Press `:` in `NORMAL` mode to enter commands:

| Command | Aliases | Description |
| :--- | :--- | :--- |
| `:open` | `:o` | Open the selected topic |
| `:reload` | `:r`, `:refresh` | Reload topics from Telegram |
| `:hide` | `:h` | Open the Hide Menu |
| `:hide forever` | `:d`, `:archive` | Hide selected topic forever |
| `:hide msg` | `:m`, `:hide message` | Hide selected topic until a new message arrives |
| `:snooze <spec>` | `:s <spec>`, `:hide <spec>` | Snooze using a preset (`30m`, `1h`), relative duration (`45m`, `2h`, `4d`, `1w`), 24h time (`18:30`), or date/time (`2026-11-30` or `2026-11-30 09:00`) |
| `:unhide` | `:u`, `:unsnooze`, `:unarchive` | Unhide the selected topic |
| `:all` | `:a` | Toggle showing hidden topics |
| `:clear` | — | Clear the active `/` search filter |
| `:chats` | `:groups`, `:allowlist` | Show instructions for updating allowed groups |
| `:help` | — | Display quick command summary in the status bar |
| `:quit` | `:q`, `:exit` | Exit the application |

---

## Allowlist Checklist TUI (`--select-chats`)

| Key | Action |
| :--- | :--- |
| `j`/`k` or `↑`/`↓` | Move cursor through forum supergroups |
| `Space` | Toggle check/uncheck on the focused group (or Check All on row 1) |
| `a` | Toggle check/uncheck all forum supergroups |
| `Enter` | Save selected chat IDs to `TG_ALLOWED_CHAT_IDS` in `.env` |
| `q`, `Esc`, or `Ctrl+C` | Cancel without modifying `.env` |

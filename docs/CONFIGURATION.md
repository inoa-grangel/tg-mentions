# Configuration & Enterprise Policy

## Data & Configuration Directory Locations

By default, `tg-mentions` stores local state in an OS-specific user configuration directory with strict owner-only permissions (`0700` on POSIX, owner-only NTFS ACL on Windows):

- **macOS / Linux:** `$XDG_CONFIG_HOME/tg-mentions` (defaults to `~/.config/tg-mentions`)
- **Windows:** `%APPDATA%\tg-mentions`

### Directory Layout

```text
<configDir>/
├── .env                        # Non-secret settings (TG_ALLOWED_CHAT_IDS, TG_RETENTION_DAYS)
├── tdlib-db/                   # Encrypted TDLib database
├── tdlib-files/                # TDLib temporary file directory
└── data/
    ├── tg-mentions.sqlite      # Encrypted hidden/snoozed topic states (WAL mode)
    └── audit.jsonl             # Tamper-evident hash-chained security audit log
```

> **Security Restriction:** `TG_MENTIONS_HOME` cannot point to temporary directories (`/tmp`, `/var/tmp`, `AppData\Local\Temp`) or cloud-synced folders (OneDrive, Dropbox, Google Drive, iCloud, Box Sync, Nextcloud).

---

## Environment Variables

Configure via `<configDir>/.env` or your shell environment:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `TG_ALLOWED_CHAT_IDS` | Comma-separated list of numeric Telegram forum supergroup chat IDs to scan (e.g., `-1001234567890,-1009876543210`). Managed automatically by `--select-chats`. | *(none — prompts selector on first run)* |
| `TG_RETENTION_DAYS` | Number of days to retain `forever`-hidden topics and rotated audit log entries (minimum `1`). | `90` |
| `TG_MENTIONS_HOME` | Custom directory path for `tg-mentions` configuration and data. Blocked if corporate policy sets `lockConfigDir: true`. | OS default config path |
| `TG_API_ID` / `TG_API_HASH` | Legacy bootstrap inputs. If present in `.env`, `tg-mentions` automatically migrates them into the OS credential vault and removes them from `.env`. | Stored in OS Vault |
| `TG_DB_ENCRYPTION_KEY` | Legacy 64-char hex master key bootstrap. Automatically migrated to the OS credential vault and removed from `.env`. | Generated & stored in OS Vault |

---

## Corporate Administrator Policy (`policy.json`)

Organizations can centrally lock security settings by deploying an administrator-owned `policy.json` file:

- **macOS / Linux:** `/etc/tg-mentions/policy.json` (directory and file must be owned by `root` with mode `0755`/`0644` or stricter — not writable by group or others)
- **Windows:** `C:\ProgramData\tg-mentions\policy.json` (directory and file must be owned by `SYSTEM` `S-1-5-18` or `Administrators` `S-1-5-32-544`)

### Example `policy.json`

```json
{
  "allowedChatIds": [-1001234567890, -1009876543210],
  "requireDesktopApp": true,
  "lockConfigDir": true,
  "proxy": {
    "server": "proxy.corp.example.com",
    "port": 1080,
    "type": {
      "@type": "proxyTypeSocks5"
    }
  }
}
```

### Policy Fields

| Field | Type | Required | Effect |
| :--- | :--- | :--- | :--- |
| `allowedChatIds` | `number[]` | **Yes** | Enforces the exact list of allowed Telegram forum chat IDs. Disables `--select-chats` and overrides `TG_ALLOWED_CHAT_IDS`. |
| `requireDesktopApp` | `boolean` | No | Blocks `https://t.me/` browser fallbacks and `--web`, requiring `tg://` Telegram Desktop links. |
| `lockConfigDir` | `boolean` | No | Rejects `TG_MENTIONS_HOME` overrides so state stays in the standard OS user profile path. |
| `proxy` | `object` | No | Configures TDLib `addProxy` (`server`, `port`, and TDLib proxy `type` object, e.g., `{"_": "proxyTypeSocks5"}`). |

---

## Pinning TDLib Binary Checksums

Before running on a new platform or after upgrading `prebuilt-tdlib`, compute the SHA-256 hash of the native `tdjson` library:

```bash
npm run verify:tdlib
```

Update `APPROVED_TDJSON_SHA256` in `src/infrastructure/telegram/TdlibBinaryVerifier.js` with the verified 64-character lowercase hex digest for your target platform (`darwin-arm64`, `darwin-x64`, `linux-x64`, or `win32-x64`).

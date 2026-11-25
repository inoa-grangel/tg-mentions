# tg-mentions

> **Security-hardened terminal UI (TUI) and CLI tool to list, triage, snooze, and open active Telegram forum topics where you have been mentioned.**

Built with Node.js (ESM), native TDLib (`tdl` + `prebuilt-tdlib`), built-in `node:sqlite`, and `terminal-kit`, `tg-mentions` scans your allowlisted Telegram forum supergroups for unread/active mentions and presents them in a Vim-inspired terminal interface with direct `tg://` desktop deep links and `https://t.me` fallbacks.

---

## Features

- **Forum Mention Triage:** Scans allowlisted Telegram forum supergroups for active mentions, sorted by most recent activity.
- **Vim-Style Terminal UI (TUI):** Fast keyboard-driven navigation (`j`/`k`, `gg`/`G`), live fuzzy filtering (`/`), command mode (`:`), and one-key link opening (`Enter`/`o` for Desktop app, `O` for Web).
- **Flexible Topic Hiding & Snoozing:**
  - **Hide forever (`d`)** until retention expiration.
  - **Hide until new message (`m`)** — automatically wakes when new activity arrives.
  - **Snooze (`s`)** — hide until a preset duration (`30m`, `1h`, `3h`, `1d`, `3d`, `1w`), relative duration (`45m`), time (`18:30`), or ISO timestamp (`2026-11-30 09:00`), waking early if a new message arrives.
- **Zero-Plaintext Credential Vault:** Stores Telegram API credentials (`TG_API_ID`, `TG_API_HASH`) and a 256-bit master encryption key exclusively in your OS credential store (**macOS Keychain**, **Windows DPAPI**, or **Linux `secret-tool` / `libsecret`**).
- **Encrypted Local State & Tamper-Evident Audit Log:**
  - HKDF-SHA256 subkey derivation for metadata encryption, blind indexing, and audit signing.
  - AES-256-GCM encrypted topic metadata stored in SQLite (`WAL` mode + `secure_delete = ON`) keyed by HMAC-SHA256 blind indexes.
  - Hash-chained JSONL audit log (`audit.jsonl`) with HMAC-SHA256 integrity verification and automatic rotation.
- **Enterprise & Corporate Policy Support:** Supports root/Administrator-enforced `policy.json` to lock group allowlists, enforce Telegram Desktop `tg://` links, disable `TG_MENTIONS_HOME` overrides, and configure SOCKS5/HTTP proxies.
- **TDLib Binary Integrity Verification:** Verifies the SHA-256 checksum of the native `tdjson` library before loading.

---

## Quick Start

### Prerequisites

- **Node.js `>= 22.0.0`** (`.nvmrc` targets `v22.14.0`) — required for built-in `node:sqlite`.
- **Telegram API Credentials:** Obtain your `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org) under **API development tools**.
- **OS Secret Store Backend:**
  - **macOS:** Built-in Keychain (`/usr/bin/security`)
  - **Windows:** Built-in PowerShell + DPAPI (`System.Security.Cryptography.ProtectedData`)
  - **Linux:** `libsecret` CLI (`secret-tool` at `/usr/bin/secret-tool`)

### Installation

```bash
git clone https://github.com/<owner>/tg-mentions.git
cd tg-mentions
npm ci --ignore-scripts --audit
npm link
```

### First Run & Setup

1. **Launch `tg-mentions`:**
   ```bash
   tg-mentions
   ```
2. **Enter Telegram API Credentials:** On first launch, you will be prompted for your `TG_API_ID` and `TG_API_HASH`, which are saved directly to your OS credential vault.
3. **Authenticate with Telegram:** Complete standard TDLib login (phone number with country code, login code, and optional 2FA password).
4. **Select Forum Supergroups:** If `TG_ALLOWED_CHAT_IDS` is not yet configured, an interactive checklist TUI opens so you can select which Telegram forum groups to monitor.

---

## Usage & CLI Flags

```bash
tg-mentions [options]
```

| Flag | Description |
| :--- | :--- |
| *(no flags)* | Fetch active mentioned topics across allowlisted forums and launch the Vim TUI. |
| `--select-chats` | Open the interactive forum supergroup allowlist selector and save to `.env`. *(Aliases: `--configure-chats`, `--list-chats`)* |
| `--all` | Start the TUI with hidden and snoozed topics visible. |
| `--open` | Immediately open the highest-priority visible mentioned topic without launching the TUI. |
| `--web` | Force `https://t.me/...` web links instead of `tg://` desktop deep links (unless prohibited by corporate policy). |
| `--purge` | Wipe all local TDLib session databases, cached files, SQLite state, audit logs, `.env`, and OS vault secrets. |

For full keyboard shortcuts and `:command` mode references, see [docs/USAGE.md](docs/USAGE.md).

---

## Documentation

- **[Usage & TUI Keybindings Guide](docs/USAGE.md)** — Complete reference for Vim navigation, hide/snooze workflows, search filters, and `:command` syntax.
- **[Configuration & Enterprise Policy](docs/CONFIGURATION.md)** — Environment variables, storage paths, `policy.json` schema, proxy settings, and TDLib SHA-256 pinning.
- **[Security & Architecture](docs/SECURITY_ARCHITECTURE.md)** — Clean architecture layers, HKDF key hierarchy, SQLite blind indexing, and hash-chained audit logging.
- **[Contributing](CONTRIBUTING.md)** — Development setup, coding conventions, and pull request guidelines.
- **[Security Policy](SECURITY.md)** — Vulnerability reporting and threat model overview.

---

## License

MIT © [Gabriel Rangel de Abreu](LICENSE)

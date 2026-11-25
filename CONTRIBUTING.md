# Contributing to `tg-mentions`

Thank you for your interest in contributing to `tg-mentions`! Because this tool handles personal/corporate Telegram sessions, local encryption keys, and native TDLib binaries, all contributions must uphold strict security and architectural standards.

---

## Development Setup

1. **Use Node.js `>= 22.0.0`** (matching `.nvmrc` `v22.14.0`):
   ```bash
   nvm use
   ```
2. **Install dependencies safely (without lifecycle scripts):**
   ```bash
   npm ci --ignore-scripts --audit
   ```
3. **Verify your platform's TDLib binary digest:**
   ```bash
   npm run verify:tdlib
   ```
   Ensure the printed SHA-256 matches the entry for `${process.platform}-${process.arch}` in `src/infrastructure/telegram/TdlibBinaryVerifier.js`.

---

## Architecture Guidelines

`tg-mentions` follows a **Clean / Hexagonal Architecture** organized under `src/` using Node.js subpath imports (`#*` mapped to `./src/*`):

- **`src/domain/`** — Pure domain entities (`MentionedTopic`), policies (`CorporatePolicy`), value objects (`DeepLink`, `SnoozeSchedule`, `TopicKey`), and port interfaces (`AuditLogger`, `SecretVault`, `TelegramGateway`, `TopicRepository`). **Must have zero infrastructure or UI dependencies.**
- **`src/application/`** — Use-case orchestrators (`ConfigureAllowlist`, `FetchMentionedTopics`, `HideTopic`, `UnhideTopic`, `PurgeLocalData`) that coordinate domain objects and ports.
- **`src/infrastructure/`** — Adapters for OS paths/launchers (`os/`), `.env` and `node:sqlite` persistence (`persistence/`), cryptography/keychain/audit/policy enforcement (`security/`), and TDLib (`telegram/`).
- **`src/presentation/`** — CLI argument parsing (`cli/`) and `terminal-kit` TUI views (`tui/`).

---

## Security & Code Standards

When submitting changes, please adhere to the following rules:

1. **Never Store Secrets in Plaintext:** Credentials and encryption keys must only reside in `KeychainVault` (OS credential store) and be zeroed (`Buffer.fill(0)`) in memory after use.
2. **Strict Input & Output Sanitization:**
   - All untrusted Telegram strings (group titles, topic names, 2FA hints, stderr messages) must pass through `sanitizeText()` before rendering in the terminal or writing to storage.
   - All deep links must be validated through the `DeepLink` value object regex allowlists (`tg://` and `https://t.me/`).
3. **Safe Process Execution:** Always use `execFileSync` or `spawn` with explicit argument arrays and absolute system tool paths resolved via `resolveSystemToolPath()`. Never pass unsanitized strings to a shell.
4. **File & Directory Permissions:** Any newly created config/data directories or files must use `ensurePrivateDir()` (`0700` / owner-only NTFS ACL) and `enforcePrivateFile()` (`0600` / owner-only NTFS ACL), rejecting symlinks.
5. **Module Format:** Use ES Modules (`"type": "module"`) and `#*` subpath imports for cross-layer references.

---

## Pull Request Process

1. Fork the repository and create a feature or bugfix branch from `master`.
2. Keep changes focused and atomic; update documentation in `docs/` or `README.md` if CLI flags, keybindings, or configuration options change.
3. Test your changes across TUI states (`NORMAL`, `SEARCH`, `COMMAND`, `HIDE_MENU`, `SNOOZE_DATE`) and verify `--purge` and `--select-chats` workflows.
4. Open a Pull Request describing the problem, your architectural approach, and any security considerations.

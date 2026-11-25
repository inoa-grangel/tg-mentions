# Security & Architecture Overview

## Layered Hexagonal Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                       │
│   CliArgs.js  •  TopicsVimTui.js  •  AllowlistChecklistTui.js   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                        Application Layer                        │
│  FetchMentionedTopics • ConfigureAllowlist • Hide/Unhide/Purge  │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                               │
┌───────────────▼───────────────┐ ┌─────────────▼─────────────────┐
│         Domain Layer          │ │     Infrastructure Layer      │
│  MentionedTopic • DeepLink    │ │  TdlibTelegramGateway         │
│  CorporatePolicy • TopicKey   │ │  SqliteTopicRepository        │
│  SnoozeSchedule • Ports       │ │  KeychainVault • CryptoService│
└───────────────────────────────┘ └───────────────────────────────┘
```

---

## Cryptographic Key Hierarchy

1. **Master Key (`db-encryption-key`):** A 256-bit random secret generated via `crypto.randomBytes(32)` on first run and stored exclusively in the OS credential store (`com.corp.tg-mentions`).
2. **TDLib Encryption:** Passed as a base64 key to TDLib's `databaseEncryptionKey` parameter; the raw buffer is immediately zeroed in memory (`fill(0)`).
3. **HKDF-SHA256 Subkey Derivation (`CryptoService`):**
   - `tg-mentions-sqlite-metadata-v1` → **AES-256-GCM** key used to encrypt topic metadata (`chatId`, `topicId`, `topicName`, `groupTitle`) with random 96-bit IVs (`enc:v1:<iv>:<tag>:<ciphertext>`).
   - `tg-mentions-sqlite-index-v1` → **HMAC-SHA256** key used to generate deterministic 64-char hex blind indexes (`TopicKey`) for primary-key lookups in SQLite without exposing raw chat/topic IDs in plaintext columns.
   - `tg-mentions-audit-hmac-v1` → **HMAC-SHA256** key used to sign audit log entries and generate 16-char redacted identifiers (`topicHash`, `uriHash`).
4. **Memory Hygiene:** `SIGINT`, `SIGTERM`, and normal exit handlers invoke `cleanupSecrets()` to zero all derived subkey buffers.

---

## Tamper-Evident Audit Log (`audit.jsonl`)

Every security-relevant event (`ALLOWLIST_UPDATED`, `HIDE_TOPIC`, `UNHIDE_TOPIC`, `OPEN_TOPIC_URI`) is appended to `data/audit.jsonl` as a canonical JSON line containing:

- `ts`: ISO-8601 timestamp
- `user`: OS username
- `pid`: Process ID
- `action`: Event type
- `prevHash`: `hmac` of the preceding log entry (starting from 64 zeros)
- Redacted metadata (`topicHash`, `uriHash`, `hideMode`, `hideUntil`, `count`)
- `hmac`: `HMAC-SHA256(auditHmacKey, canonicalPayload)`

When `audit.jsonl` reaches **5 MB**, `HashChainAuditLogger` atomically rotates the file, pruning entries older than `TG_RETENTION_DAYS` and keeping up to the most recent 2,000 entries.

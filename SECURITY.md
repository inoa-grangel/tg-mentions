# Security Policy

## Supported Versions

Security fixes and TDLib binary hash updates are applied to the latest release on the `master` branch.

| Version | Supported |
| :--- | :--- |
| `1.0.x` | :white_check_mark: |

---

## Security Architecture Highlights

`tg-mentions` is designed with defense-in-depth controls for enterprise and personal environments:

- **OS Credential Vault (`KeychainVault`):** API credentials (`tg-api-id`, `tg-api-hash`) and the 256-bit database master key (`db-encryption-key`) are stored in macOS Keychain, Windows DPAPI, or Linux `libsecret` (`secret-tool`). Plaintext fallback in `.env` is explicitly refused.
- **Cryptographic Key Separation (`CryptoService`):** Uses HKDF-SHA256 to derive isolated subkeys from the master key for AES-256-GCM SQLite field encryption, HMAC-SHA256 blind topic indexing, and HMAC-SHA256 audit log signing.
- **Native Binary Integrity (`TdlibBinaryVerifier`):** Verifies the SHA-256 hash of `tdjson` inside `node_modules` against a pinned allowlist before loading native code.
- **Tamper-Evident Audit Logging (`HashChainAuditLogger`):** Appends HMAC-signed, hash-chained JSONL entries (`audit.jsonl`) with redacted identifiers for allowlist updates, hide/unhide actions, and URI launches.
- **Terminal Escape Injection Protection (`TextSanitizer`):** Strips ANSI escape sequences, C0/C1 control characters, zero-width characters, and Unicode bidi overrides from Telegram chat/topic titles before rendering.
- **URI Allowlisting (`DeepLink` & `UriLauncher`):** Enforces strict regex validation on `tg://` and `https://t.me/` URIs prior to OS launcher invocation.

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in `tg-mentions`:

1. Use GitHub's **Private Vulnerability Reporting** ("Report a vulnerability" under the **Security** tab) if enabled on the repository, or contact the repository maintainer directly.
2. Include a clear description of the vulnerability, affected files/components, steps to reproduce, and potential impact.
3. Allow reasonable time for the issue to be investigated and patched before public disclosure.

---

## Emergency Local Data Purge

If a workstation is compromised or needs to be decommissioned, run:

```bash
tg-mentions --purge
```

This command deletes all OS vault secrets (`db-encryption-key`, `tg-api-id`, `tg-api-hash`, and legacy entries) and recursively removes `tdlib-db/`, `tdlib-files/`, `data/tg-mentions.sqlite*`, `data/audit.jsonl`, `.env`, and `.dpapi` blobs.

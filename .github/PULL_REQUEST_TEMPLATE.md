## Summary
Describe the changes introduced in this pull request and link any related issues.

## Type of Change
- [ ] Bug fix
- [ ] New feature / TUI enhancement
- [ ] Security hardening
- [ ] Documentation update
- [ ] Refactoring / internal architecture

## Checklist
- [ ] Verified compatibility with Node.js `>= 22.0.0` (ESM + `node:sqlite`)
- [ ] Untrusted Telegram strings are sanitized via `sanitizeText()`
- [ ] No secrets or encryption keys are logged or written to plaintext files
- [ ] File/directory permissions use `ensurePrivateDir()` / `enforcePrivateFile()` where applicable
- [ ] Updated `README.md` or `docs/` if CLI flags, keybindings, or config options changed

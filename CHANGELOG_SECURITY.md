# SafeNest — Security Changelog

## 2026-10-01 — Security Closure Pass

### Added
- `scripts/security-vaultprivate-tests.js` (`test:security:vault`)
- `scripts/security-closure-tests.js` (`test:security:closure`)
- `SECURITY_IPC_MATRIX.md`

### Changed
- **Electron** upgraded `37.x` → **`44.5.1`** (`npm audit` → 0 vulnerabilities)
- `passwordManager` — min password length **10**; max 512; generic verify failures
- `authThrottle` — generic lockout message (no exact-seconds string)
- `privateFilesManager` — expand dangerous extensions (`.vbe`, `.msp`); Windows trailing `.`/space strip
- `vaultBackup` — align password length gate with policy
- `recentFilesManager` — stricter relativePath sanitize; sanitize on **read**
- `navigationGuard` — `file:` internal only for Nest-owned `renderer/` paths (blocks arbitrary local file nav)
- `login.html` / change-password modal — `minlength=10`
- Symlink smoke reporting: `SYMLINK_TEST_PASS` / `FAIL` / `SKIPPED_PRIVILEGE`

### Verified (not newly introduced)
- `privateMediaProtocol` — `bypassCSP: false`, `corsEnabled: false` (audit F9 was stale)
- Session isolation: vault serve on defaultSession only; BrowserView denier

### Docs
- Updated `SECURITY_AUDIT.md`, `SECURITY_MATRIX.md`, `SECURITY_TEST_REPORT.md`

---

## 2026-10-01 — Audit hardening pass

### Added
- `src/security/authThrottle.js` — unlock/password attempt rate limiting + lockout
- `scripts/security-smoke.js`
- `scripts/security-path-tests.js`
- `scripts/security-ipc-tests.js`
- `scripts/security-lock-tests.js`
- npm scripts: `test:security`, `test:security:path`, `test:security:ipc`, `test:security:lock`
- `SECURITY_AUDIT.md`, `SECURITY_ARCHITECTURE.md`, `SECURITY_MATRIX.md`, `SECURITY_TEST_REPORT.md`

### Changed
- `main.js` — wire auth throttle into verify/unlock; redact locked `dashboard:get` payload
- `src/browser/browserManager.js` — **reject** downloads for unmapped browser spaces (no personal fallback)
- `src/personal/privateFilesManager.js` — block dangerous extensions on import + download destination; expand dangerous list
- `src/personal/privateSpacePaths.js` — reject encoded `%2e` / `%2f` path forms
- `src/storage/activityLog.js` — `UNLOCK_RATE_LIMITED` event; strip control chars from meta
- `renderer/animations/toast.js` — toast body via `textContent`
- `.gitignore` — ignore `.env`, keys, credential-like files
- `scripts/personal-m2-smoke.js` — expect executable download block; sanitize non-exe traversal names

### 2026-10-01 — Follow-up (audit agents)

- `privateMediaProtocol` — serve only on defaultSession; **deny** on BrowserView partitions; disable CORS/bypassCSP
- `browser:getUrl` — empty when locked
- `navigationGuard` — do not treat `data:` as internal
- `authResolver` — `safeLogUrl` + strict Google host checks
- `ipcValidation.validateRelativePath` — reject `..` / `\` / encoded forms

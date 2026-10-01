# SafeNest — Security Audit

**Date:** 2026-10-01  
**Closure pass:** 2026-10-01  
**Scope:** Full application security review + closure hardening  
**Method:** Static review, source verification, automated security suites, dependency upgrade  

This document does **not** claim SafeNest is “100% secure.”  
Statement supported by evidence: **No known critical vulnerabilities were identified in the tested attack surface.**

---

## Summary counts (after Security Closure Pass)

| Severity | Open (remaining) | Fixed this program |
| --- | --- | --- |
| CRITICAL | **0** | 1+ (`vaultprivate` BrowserView exfil) |
| HIGH | **0** | Electron advisories cleared via upgrade to **44.5.1** (`npm audit` → 0) |
| MEDIUM | **0** actionable | F9 CSP contradiction closed; `file:` internal bypass fixed; password policy |
| LOW | **1** (symlink CI elevation) | encoded paths, toast XSS, etc. |
| INFORMATIONAL | several (threat model) | — |

---

## Security Closure Pass — 2026-10-01

### F9 — `vaultprivate` `bypassCSP` contradiction (FIXED / WAS STALE)

| Field | Detail |
| --- | --- |
| Investigation | Source of truth: `privateMediaProtocol.js` — `corsEnabled: false`, `bypassCSP: false` |
| Changelog | Correct |
| Prior audit row | Stale — still said OPEN with `bypassCSP: true` |
| Status | **FIXED** (already in code; audit corrected). Verified by `test:security:vault` source scan |
| Attack surface | No CSP bypass for vault scheme. Media serves only on `defaultSession`; BrowserView partitions register 403 denier |

### F7 — Electron dependency advisories (FIXED)

| Field | Detail |
| --- | --- |
| Before | `electron@37.10.3` — multiple HIGH advisories including custom-protocol CORS fetch (GHSA-v3j7-r9gq-3gjw) |
| After | **`electron@44.5.1`** |
| `npm audit` | **0 vulnerabilities** |
| Regression | All listed security + feature/personal smoke tests **PASS** on 44.5.1 |
| Status | **FIXED** |

### F8 — Password policy (FIXED)

| Field | Detail |
| --- | --- |
| Before | Minimum 6 characters |
| After | **Minimum 10**, max 512; length-based (no complexity theatre) |
| Verify failures | Generic `Incorrect password.` (no config/algorithm leak) |
| Status | **FIXED** — `test:security:closure` |

### F-FILE — Arbitrary `file:` treated as internal navigation (FIXED)

| Field | Detail |
| --- | --- |
| Threat | BrowserView could treat any `file:///C:/...` as allowed “internal” URL |
| Fix | `isInternalUrl` only allows Nest-owned `renderer/` file URLs (+ about/devtools/chrome-error) |
| Status | **FIXED** — `test:security:closure` |
| Risk was | **MEDIUM** |

### F10 — Symlink tests without elevation (OPEN / LOW)

| Field | Detail |
| --- | --- |
| Status | **OPEN** — reports `SYMLINK_TEST_SKIPPED_PRIVILEGE` (not treated as PASS) |
| Code | `fsSecurity` lstat/realpath protections remain |
| Action | Run elevated Windows CI/manual for `SYMLINK_TEST_PASS` |

---

## Findings table (prior + closed)

### F-MEDIA — Cross-origin exfiltration via `vaultprivate://` from BrowserView (FIXED)

Serve only on shell `defaultSession`; deny on BrowserView partitions; `corsEnabled`/`bypassCSP` false.

### F-URL — `browser:getUrl` while locked (FIXED) → returns `''`

### F-DATA — `data:` treated as internal (FIXED)

### F-OAUTH — authResolver secret logs + loose Google match (FIXED)

### F1 — Unlock brute-force (FIXED) — main-process `authThrottle`

### F2 — Unmapped download → personal (FIXED) — reject

### F3 — Locked dashboard disclosure (FIXED) — redact

### F4 — Executable import/download (FIXED) — expanded blocklist + trailing-dot/case

### F5 — Toast XSS (FIXED) — `textContent`

### F6 — Encoded `%2e` paths (FIXED)

### F11 — App-level privacy only (INFORMATIONAL)

Same Windows user/admin can access `userData`. SafeNest is not OS hard security.

### F12 — Persistent browser sessions while locked (INFORMATIONAL / by design)

Sessions stay warm; BrowserView hidden; private IPC gated.

---

## Electron window baseline (verified)

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- No `webSecurity: false` / `enableRemoteModule` / `shell.openExternal` / `child_process` / `openDevTools` / `--remote-debugging-port` in app code

---

## Password model (verified)

- PBKDF2-SHA512, 600000 iterations, 32-byte salt, timingSafeEqual
- Verifier via `safeStorage` when available
- Min length **10**; never logged/stored plaintext

---

## Auth throttle (verified)

- State lives **only** in main process (`authThrottle.js`)
- Renderer reload / new window cannot reset counters
- After 5 failures / 15 min window → 60s lockout
- User message: generic (“Try again later”) — no exact-seconds oracle in error string
- `retryAfterMs` may still be returned for UX timing (not a password oracle)

---

## Next actions (residual)

1. Elevated Windows symlink/junction CI → expect `SYMLINK_TEST_PASS`
2. Optional: further CSP tightening (`unsafe-inline` styles remain for Nest shell)
3. Optional: live BrowserView `fetch(vaultprivate://)` e2e under automation harness
4. Keep Electron current as advisories publish

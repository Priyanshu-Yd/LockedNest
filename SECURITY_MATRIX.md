# SafeNest — Security Matrix

**Closure pass:** 2026-10-01  

| Area | Requirement | Status | Evidence | Test |
| --- | --- | --- | --- | --- |
| Authentication | Password protected | PASS | `passwordManager` | phase1 / closure |
| Password Security | Salted PBKDF2 + safeStorage | PASS | 600k iter SHA512 | phase1 |
| Password Policy | Min length 10 | PASS | `MIN_PASSWORD_LENGTH` | closure |
| Brute Force | Main-process rate limit | PASS | `authThrottle` | security / closure |
| Lock Enforcement | Main-process gate | PASS | `requireAuth` / `accessGate` | lock / closure |
| Panic Lock | Immediate revoke | PASS | `lockVault` immediate | code review |
| IPC Security | Validate inputs | PASS | `ipcValidation` + matrix | ipc / SECURITY_IPC_MATRIX |
| Filesystem Security | Trusted root only | PASS | `resolveSafePath` | m2 / path |
| Path Traversal | Reject `..` / abs / encoded | PASS | privateSpacePaths | path / security |
| Symlink/Junction | lstat / realpath | PARTIAL | code PASS; CI SKIPPED_PRIVILEGE | m2 / closure |
| Media Protocol | Locked blocks + session deny | PASS | protocol + denier | vault |
| Vault CSP | No bypassCSP | PASS | `bypassCSP: false` | vault source assert |
| Space Isolation | personal/work/guest roots | PASS | separate dirs + vault map | m2 |
| Browser Isolation | partitions | PASS | per-space session | code review |
| Navigation Security | Hostname allowlist | PASS | `hostnameMatches` | features / closure |
| File URL Security | Nest-owned file: only | PASS | `isNestOwnedFileUrl` | closure |
| Popup Security | setWindowOpenHandler | PASS | navigationGuard | code review |
| OAuth Security | Redacted logs | PASS | `safeLogUrl` | closure |
| Session Security | Hidden when locked | PASS | `setContentVisible(false)` | code review |
| XSS Protection | escapeHtml / textContent | PASS | toast + shell escape | review |
| CSP | Renderer meta CSP | PARTIAL | `unsafe-inline` styles only | review |
| Dependency Security | npm audit clean | PASS | Electron 44.5.1 | `npm audit` = 0 |
| Logging Security | No secrets | PASS | activityLog whitelist meta | closure |
| Download Security | Mapped vault only | PASS | reject unmapped | security / closure |
| Configuration Security | Validated settings | PASS | settingsManager | review |
| Windows Security | App-level only | PARTIAL | threat model | F11 |
| NIC Checklist Mapping | Adapted for desktop | PASS | see below | — |

## NIC Secure Code checklist — desktop adaptation

| # | Item | Mapping |
| --- | --- | --- |
| 1 | CAPTCHA / lockout | **ADAPTED** — unlock rate limit + lockout (`authThrottle`) |
| 2 | Input validation | **IMPLEMENTED** — IPC + path validators |
| 3 | Parameterized queries | **N/A** — no SQL DB |
| 4 | Audit trail | **IMPLEMENTED** — `activityLog` |
| 5 | Pre/post auth sessions | **ADAPTED** — login window vs shell; lock gates |
| 6 | Access control matrix | **IMPLEMENTED** — see `SECURITY_IPC_MATRIX.md` |
| 7 | No direct 3p script refs | **IMPLEMENTED** — vendored GSAP/Lenis |
| 8 | Trusted components | **IMPLEMENTED** — Electron 44.5.1, audit clean |
| 9 | Sensitive data protection | **PARTIAL** — app lock; not OS encryption of files |
| 10 | Restrict critical info | **IMPLEMENTED** — locked dashboard redaction |
| 11 | Password hashing | **IMPLEMENTED** — PBKDF2 |
| 12 | Password change | **IMPLEMENTED** |
| 13 | Password policy | **IMPLEMENTED** — min 10 length-based |
| 14 | POST for secrets | **ADAPTED** — IPC not HTTP |
| 15 | Error handling | **IMPLEMENTED** — generic user errors |
| 16 | CSRF | **N/A / ADAPTED** — IPC authz instead |
| 17–18 | Upload restrictions | **IMPLEMENTED** — dangerous ext block + safe import |
| 19 | Unpredictable IDs | **PARTIAL** |
| 20 | Session timeout | **IMPLEMENTED** — auto-lock |
| 21 | Restricted admin | **N/A** — single-user desktop |

Additional NIC items (links, HTTP methods, directory listing, autocomplete, history/cache, logout, least privilege, backups): **ADAPTED FOR DESKTOP**; Nest lock ≈ logout; backups are local encrypted `.vbak` flows.

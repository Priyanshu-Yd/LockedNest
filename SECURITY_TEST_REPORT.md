# SafeNest — Security Test Report

**Run date:** 2026-10-01 (Security Closure Pass)  
**Electron:** 44.5.1  

## Automated results

| Command | Result |
| --- | --- |
| `npm run test:security` | **PASS** (`SECURITY_SMOKE_OK`) |
| `npm run test:security:path` | **PASS** (`SECURITY_PATH_OK`) |
| `npm run test:security:ipc` | **PASS** (`SECURITY_IPC_OK`) |
| `npm run test:security:lock` | **PASS** (`SECURITY_LOCK_OK`) |
| `npm run test:security:vault` | **PASS** (`SECURITY_VAULTPRIVATE_OK`) |
| `npm run test:security:closure` | **PASS** (`SECURITY_CLOSURE_OK`) |
| `npm run test:features` | **PASS** |
| `npm run test:phase1` | **PASS** |
| `npm run test:phase3` | **PASS** |
| `npm run test:personal` | **PASS** |
| `npm run test:personal:m2` | **PASS** (`SYMLINK_* SYMLINK_TEST_SKIPPED_PRIVILEGE`) |
| `npm run test:personal:m3` | **PASS** |
| `npm run test:personal:m4` | **PASS** |
| `npm audit` | **0 vulnerabilities** |

## Symlink / junction status

```text
SYMLINK_TEST_SKIPPED_PRIVILEGE
```

Skipped is **not** recorded as PASS. Code-path protections exist; elevate Windows privileges to obtain `SYMLINK_TEST_PASS`.

## Closure coverage exercised

- Password policy min 10 / Unicode / special chars
- Auth throttle lockout + generic messages
- Download vault mapping reject unknown / `personal` browser id
- Dangerous extensions case + trailing dots/spaces
- Recent-files JSON tamper (traversal/absolute filtered on read)
- Domain allowlist suffix/prefix attacks
- `file:` / `data:` / `javascript:` scheme handling
- OAuth `safeLogUrl` secret redaction
- Activity log secret scan (password/token not persisted)
- Lock gate cannot be faked by renderer flags alone
- `vaultprivate` parse attacks + `bypassCSP: false` source assert
- BrowserView partition denier registration

## Gaps

- Full live BrowserView `fetch(vaultprivate://)` HTML e2e not automated in CI
- Elevated symlink/junction suite not run on this machine
- OAuth popup end-to-end still manual

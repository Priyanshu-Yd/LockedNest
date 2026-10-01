# SafeNest — Security Architecture

## Trust model

```text
UNTRUSTED
  Remote websites (WhatsApp, Gmail, ChatGPT, …)
  Renderer UI (HTML/JS)
  User input (passwords, URLs, filenames, dropped paths)
  Imported / downloaded files
  Settings / recent JSON on disk (treat as untrusted data)

        ↓ IPC + validation boundary

SEMI-TRUSTED
  preload.js (narrow contextBridge API only)

        ↓

TRUSTED
  Main process (main.js)
  Security services (password, lock, throttle, accessGate)
  Path / fs security (privateSpacePaths, fsSecurity, ipcValidation)
  Browser security (navigationGuard, urlSafety, space allowlists)
  Validated PrivateSpace filesystem under userData
```

## Authority

The **main process** is authoritative for:

- authentication result
- lock / panic / auto-lock state
- private filesystem authorization
- media protocol responses
- download destinations
- domain allowlist enforcement
- space isolation

The **renderer must never** be the authority for lock state or path resolution.

## Layers

### Renderer
- No Node integration
- No filesystem APIs
- Uses `window.vaultbrowse.*` only
- UI lock overlay is UX only; IPC still enforced

### Preload
- `contextBridge.exposeInMainWorld('vaultbrowse', { … })`
- No raw `ipcRenderer` / `fs` / `shell` exposure
- Drop paths via `webUtils.getPathForFile` then re-validated in main

### Main / security services
- `passwordManager` — PBKDF2 verifier + safeStorage
- `authThrottle` — unlock rate limiting
- `lockManager` — lock flag + idle watch
- `accessGate` — authenticated + unlocked + valid vault id
- `ipcValidation` / `resolveSafePath` / `fsSecurity` — path & symlink defenses

### Browser
- Per-space Electron `session` partitions
- `navigationGuard` allowlist checks on navigate/redirect/popup
- OAuth URLs logged via `safeLogUrl` (origin + path only)
- Downloads forced into mapped PrivateSpace Downloads; **unmapped spaces rejected**

### Media
- `vaultprivate://` custom protocol
- Access checker requires authenticated && !locked
- Path parse + `resolveSafePath` + symlink checks before `net.fetch`

## Security state machine

```text
LOCKED
  → no private IPC / media / clipboard / notes content
  → BrowserView hidden
  → dashboard redacted

UNLOCKING
  → password verify + throttle
  → on success → UNLOCKED

UNLOCKED
  → private operations allowed (still validated)

LOCKING / PANIC_LOCKED
  → lock() first
  → revoke clipboard / clear media flags / hide BrowserView
  → then UI animation
```

## Residual reality

SafeNest protects against casual shoulder-surfing and casual shared-PC access at the **application** layer. It does not replace Windows account security, BitLocker, or admin-proof isolation.

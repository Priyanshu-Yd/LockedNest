# SafeNest — Project Handoff Log

**Product:** SafeNest — Your private space on any PC.  
**Former names:** LockedNest / PrivateNest (UI only). VaultBrowse kept in some internal/compatibility identifiers.

Use this document when reviewing the app or adding features in Cursor.
**Do not rebuild from scratch.** Extend the existing architecture.

---

## 1. What SafeNest Is

Windows desktop app (Electron + Chromium) that provides a **private digital Nest** on a PC:

- Nest password gate (local)
- Browser spaces with allowlists + persistent profiles
- Private Files / Photos / Videos / Downloads / Notes / Clipboard
- Lock Nest without logging websites out

Browser is **one feature inside the Nest**, not the whole product.

Threat model (honest):

> Application-level privacy layer. Not OS-level / admin-proof security.

---

## 2. Branding rules (canonical UI phrases)

```text
SafeNest
Your private space on any PC.
Unlock Nest
Lock Nest
Your Nest is locked
Enter your Nest password
Welcome to your Nest
```

Do **not** show “VaultBrowse”, “LockedNest”, or “PrivateNest” in the UI.

---

## 3. How to Run

```bash
cd d:\Priyanshu\VaultBrowse
npm install
npm start
```

Tests:

```bash
npm run test:phase1
npm run test:phase3
npm run test:features
npm run test:personal
npm run test:personal:m2
npm run test:personal:m3
npm run test:personal:m4
```

Stack: Electron, vanilla JS/HTML/CSS, Node (main process only). **No React. No backend.**

---

## 4. App Flow

```text
SafeNest
    → Unlock Nest / Create Nest
    → Home (Welcome to your Nest)
        → Browser / Files / Photos / Videos / Downloads / …
        → Lock Nest / Panic Lock / Auto-lock
        → Settings (Nest Security)
```

---

## 5. What was intentionally NOT renamed

| Item | Why preserved |
| --- | --- |
| `package.json` `"name": "vaultbrowse"` | Electron `userData` path compatibility |
| `window.vaultbrowse` / IPC channels | Avoid breaking preload/IPC |
| `PrivateSpace/` folder | Existing file vaults on disk |
| `persist:vaultbrowse` partition | WhatsApp session persistence |
| `VaultPersonal`, `getVaultSession`, `lockVault`, … | Internal code identifiers |
| Backup magic `VBK1` | Existing `.vbak` files |
| Space IDs `personal` / `work` / `whatsapp` / … | Isolation + migrations |

---

## 6. Architecture (unchanged)

```text
main.js, preload.js
src/security/     passwordManager, lockManager
src/browser/      browserManager, navigationGuard
src/spaces/       spaceManager
src/domains/      domainManager, hostnameUtils
src/storage/      settings, recent, activity
src/personal/     PrivateSpace files, backup, notes, accessGate
renderer/shell/   Nest UI
renderer/login/   Unlock Nest / Create Nest
```

See previous feature sections for function tables and IPC (`window.vaultbrowse`).

---

## 7. Suggested Cursor prompt

> Read `HANDOFF.md`. Product is **SafeNest** (Nest terminology in UI).  
> Do not rebuild. Do not rename `userData`, `PrivateSpace/`, IPC, or partitions.  
> Task: \<feature\>. Reuse existing modules and keep Nest branding in user-facing strings.

---

*Branding migrated VaultBrowse → LockedNest → SafeNest. Internal compatibility names retained.*

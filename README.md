# SafeNest

**Your private space on any PC.**

SafeNest is a private digital workspace that gives you a protected environment on a shared or office PC. Browser functionality is one part of your Nest — alongside private files, photos, videos, downloads, notes, and clipboard.

It is **not** a Chrome extension, WhatsApp clone, or remote authentication system.

## Run

```bash
npm install
npm start
```

## Core ideas

| Term | Meaning |
| --- | --- |
| **SafeNest** | Product name |
| **Nest** | Your private workspace on this PC |
| **Nest password** | Local password that unlocks the Nest |
| **Lock Nest** | Hide private content without logging sites out |

## Features (summary)

1. Nest password create / unlock / change (PBKDF2 + `safeStorage`)
2. Persistent Chromium profiles per browser space (WhatsApp keeps `persist:vaultbrowse`)
3. Home Nest dashboard (Browser, Files, Photos, Videos, Downloads, …)
4. Domain whitelist + navigation protection
5. Lock Nest / Panic Lock / Auto-lock Nest
6. Private files media libraries + encrypted backup
7. Local security activity log

### Auto-lock note

Application-level inactivity (`powerMonitor` + Nest activity). **Not** Windows account security.

## Security model (honest)

SafeNest is an **application-level privacy layer**.

Windows account security remains the primary OS-level protection. An administrator can still access local data.

## Data location

Stored under Electron `app.getPath('userData')` (package id remains `vaultbrowse` for install compatibility):

```text
userData/
├── settings.json
├── password-verifier.bin
├── PrivateSpace/          (internal folder name — do not rename)
└── Partitions/…
```

## Tests

```bash
npm run test:phase1
npm run test:phase3
npm run test:features
npm run test:personal
npm run test:personal:m2
```

See `HANDOFF.md` for architecture and IPC details.

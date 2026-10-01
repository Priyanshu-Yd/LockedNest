# SafeNest — IPC Security Matrix

**Date:** 2026-10-01 (Security Closure Pass)  
**Authority:** Main process only. Renderer inputs are untrusted.

| IPC | Main validation | Lock check | Authorization | Path validation | Space validation | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `auth:status` | none needed | N/A | public | N/A | N/A | Low — config boolean only |
| `auth:createPassword` | password policy + confirm | N/A (pre-auth) | once | N/A | N/A | Med — throttle on verify path |
| `auth:verifyPassword` | type/length + throttle | N/A | pre-auth | N/A | N/A | Med — brute-force gated |
| `auth:changePassword` | current + policy + confirm | unlocked (`requireAuth`) | authenticated | N/A | N/A | Med |
| `lock:getState` | none | N/A | authenticated shell | N/A | N/A | Low — UX state |
| `lock:lock` | none | N/A | authenticated | N/A | N/A | Low |
| `lock:panic` | none | immediate revoke | authenticated | N/A | N/A | Low |
| `lock:unlock` | throttle + verify | locked→unlocked | authenticated | N/A | N/A | High surface — main throttle |
| `lock:setAutoLockMinutes` | numeric whitelist | unlocked | authenticated | N/A | N/A | Med — settings |
| `lock:noteActivity` | none | unlocked path | authenticated | N/A | N/A | Low — cannot unlock |
| `dashboard:get` | redaction when locked | soft | authenticated | N/A | domains stripped if locked | Med disclosure — **fixed** |
| `spaces:list` | schema | unlocked | authenticated | N/A | known spaces | Low |
| `spaces:create` | name/domains validated | unlocked | authenticated | N/A | new id generated | Med |
| `spaces:switch` | spaceId | unlocked | authenticated | N/A | must exist | Med |
| `domains:add` | hostname normalize | unlocked | authenticated | N/A | spaceId | Med |
| `domains:remove` | domain + space | unlocked | authenticated | N/A | spaceId | Med |
| `activity:clear` | none | unlocked | authenticated | N/A | N/A | Low |
| `browser:getHomeUrl` | trusted settings | — | — | N/A | N/A | Low |
| `browser:nav` | action enum | content visibility | authenticated | N/A | active space | Med |
| `browser:getUrl` | none | **returns `''` if locked** | authenticated | N/A | N/A | Med — **fixed** |
| `browser:navigateTo` | URL parse + allowlist | unlocked browser | authenticated | URL schemes | active allowlist | High |
| `browser:openSpace` | spaceId + optional URL | unlocked | authenticated | URL | space | High |
| `browser:openRecent` | domain normalize | unlocked | authenticated | hostname | space | Med |
| `shell:showDashboard` | mode switch | unlocked | authenticated | N/A | N/A | Low |
| `shell:showSettings` | mode switch | unlocked | authenticated | N/A | N/A | Low |
| `shell:showPersonal` | section whitelist | unlocked | authenticated | N/A | private space | Low |
| `personal:listFiles` | space/category/rel | `requirePrivateAccess` | vault | `resolveSafePath` | whitelist | High |
| `personal:getStats` | spaceId | private gate | vault | trusted roots | whitelist | Med (DoS scan) |
| `personal:createFolder` | names + parents | private gate | vault | resolve + sanitize | whitelist | High |
| `personal:renameFile` | old/new names | private gate | vault | resolve both | whitelist | High |
| `personal:deleteFile` | relative path | private gate | vault | no symlink follow | whitelist | High |
| `personal:importFiles` | dialog in main | private gate | vault | destination main-owned | import cats | High |
| `personal:importDroppedFiles` | source path list | private gate | vault | import source safety | import cats | High |
| `personal:getMediaUrl` | space/cat/rel | private gate | vault | media resolve | whitelist | High |
| `personal:getRecent` | spaceId | private gate | vault | sanitize JSON | whitelist | Med |
| `personal:openRecentFile` | space/cat/rel | private gate | vault | re-resolve existence | whitelist | High |
| `personal:getServices` | none | unlocked | authenticated | N/A | from spaces | Low |
| `clipboard:*` | text limits | unlocked | authenticated | N/A | Nest clipboard | Med |
| `privacy:get/update` | partial schema | unlocked | authenticated | N/A | N/A | Med |
| `notes:*` | id/title/body limits | unlocked | authenticated | note store | Nest notes | Med |
| `backup:exportWithPassword` | password verify | unlocked | authenticated | dialog dest | Nest vault | High |
| `backup:importWithPassword` | password verify | unlocked | authenticated | dialog source | Nest vault | High |

## Rules enforced for privileged IPC

1. Renderer never supplies destination filesystem roots.  
2. Unknown browser spaces never map to personal Downloads.  
3. Locked Nest fails private filesystem / media / clipboard / notes / backups.  
4. Auth failures are generic (`Incorrect password.` / rate-limit message).  
5. Path validators reject `..`, absolute, UNC, schemes, encoded traversal.

## Residual notes

- `personal:getStats` uses caching/TTL to reduce recursive scan DoS.  
- Persistent BrowserView sessions remain warm while locked by product design; content is hidden and IPC gated.

# VERIF2-PHOTOS-SECU-GROK — seconde relecture adversariale (sécurité)

- **Date :** 2026-09-07
- **Auditeur :** Grok 4.6
- **Mission :** GROK-VERIF2-PHOTOS
- **Worktree :** `~/DEV/cb-photos-secu-2026-09-07`
- **Branche :** `verif/photos-secu-2026-09-07`
- **HEAD de départ :** `46dd650b8`
- **HOME QA :** `~/DEV/cb-photos-secu-2026-09-07/_qa/ps/home` (non suivi)
- **Ports :** 5510–5516 (loopback)
- **Rapports de référence :** `docs/reports/2026-09/PHOTOS-PARTAGEES-OPUS.md`, `docs/reports/2026-09/VERIF-PHOTOS-AGY.md` (8/8 TIENT)
- **Périmètre :** `src/companion/companion-photo.ts`, `src/companion/shared-photos.ts`, `src/companion/companion-photo-intake.ts`, `src/server/mobile/album.ts`, `src/server/mobile/index.ts`, `src/server/websocket/handler.ts`, `src/channels/telegram/client.ts` (`getFile`)
- **Hors périmètre :** `scanSkillFirewall`
- **Valeur :** cas que la première vérification n'a pas exécutés (polyglotte, bombe PNG, EXIF GPS, 302 `getFile`, CSRF album, cache, pagination)

Stub créé avant inspection (`49d9548ed`). Les résultats ci-dessous sont mesurés contre l'API réelle (modules + HTTP Express du routeur album + `fetch` réel).

## 0. Méthode

Chaque cas a un attendu falsifiable, un obtenu chiffré, un verdict TIENT / TROU A / TROU B / TROU C. Deux trous B ont été fermés par correctifs ≤ 15 lignes, test rouge→vert, commits séparés. Les sondes QA (`_qa/ps/`) ne sont pas suivies.

## 1. Tableau cas → attendu → obtenu → TIENT/TROU

| # | Cas | Attendu | Obtenu | Verdict |
| - | --- | ------- | ------ | ------- |
| D1 | JPEG valide + trailer HTML/JS | Le trailer ne survit ni au stockage ni au payload cloud | **Avant :** sniff=`image/jpeg`, JPEG 345 o ≤ 400 Ko, saut de `sharp`, trailer conservé. **Après `8b79edca1` :** `prepareCompanionPhotos` ré-encode, `polyTrailerKept=false`, mime `image/jpeg` | **TIENT** (était TROU B) |
| D2 | PNG 97 Ko, IHDR 10000×10000 (100 Mpx) | Plafond pixels **et** mémoire applicatif | `sharp` défaut 268 402 689 px ; décodage OK en 192 ms, JPEG 5124 o, ΔRSS +17 Mo (libvips séquentiel). Aucun `limitInputPixels` dans notre code. Fail-open si `sharp` jette : octets d'origine conservés | **TROU C** |
| D3 | SVG déclaré `image/jpeg` | Rejet magic bytes | `sniff=null`, 0 photo, `rejected=["attachment is not an image"]` | **TIENT** |
| D4 | WebP / HEIC / GIF animé | Comportement défini | WebP → JPEG ; HEIC `sniff=null` rejeté ; GIF valide → JPEG (stub GIF invalide restait GIF via fail-open `sharp`) | **TIENT** |
| D5 | EXIF GPS (`HOUSEGPS`) dans un petit JPEG | GPS retiré du fichier stocké **et** du cloud | **Avant :** skip `sharp`, GPS dans norme + cloud + disque. **Après `8b79edca1` :** `gpsInNorm=false`, `gpsInCloud=false`. Test unitaire rouge→vert | **TIENT** (était TROU B) |
| Q1 | Combien de messages photo / minute ? | Un plafond | WS `RATE_LIMITS.messagesPerMinute=60` (les pièces jointes piggy-back). Pas de quota photo distinct. Telegram : pas de quota dans l'intake | **TIENT** |
| Q2 | Remplir le disque (500 × taille max) | Borne réelle | Capacité 500. Entrée brute 10 Mio (Telegram) / 600 Ko (WS). Pire cas `sharp` absent : 500 × 10 Mio = **5 Gio**. Avec ré-encodage : ~500 × 400 Ko ≈ 200 Mo. Favoris jamais évincés | **TROU C** |
| Q3 | `GET /album` sans pagination = 500 vignettes ? | Pas 500 corps d'image | HTTP 200, clés `id,kind,at,mimeType,caption` — **métadonnées seules**, pas de bytes. Jusqu'à 500 partagées + 120 selfies, sans pagination JSON | **TIENT** |
| T1 | `getFile` / `fetch` suit un 302 hors origine | Ne pas suivre un hop non re-contrôlé | **Avant :** `http://127.0.0.1:5516` → 302 `https://example.com/` → **HTML 559 o** (`<!doctype html>…Example Domain`) en 99 ms. `isDownloadableUrl` accepte tout `https:`. **Après `ff8de50ba` :** `redirect:'manual'`, 302 → HTTP non-ok, 0 octet, 0 hit volé. Test rouge (sonde) → vert | **TIENT** (était TROU B) |
| T1b | `file_path` `getFile` = URL absolue | L'hôte reste `api.telegram.org` | `https://api.telegram.org/file/bot000:probe/https://evil.example/steal` — hôte pincé | **TIENT** |
| T2 | Taille annoncée vs réelle (10 Mio) | Le flux, pas `Content-Length`, est la limite | `Content-Length: 50 Mio` → refusé avant lecture. `Content-Length: 100` + corps 500 Ko : undici tronque à 100 o (pas une bombe). Test unitaire existant : plafond streamé si le mock ignore `Content-Length` | **TIENT** |
| T3 | `media_group_id` forgé, deux chats / deux users | Pas de fusion inter-chat | Clé `${botId}:${chat.id}:${media_group_id}`. Chat non allowlist : 0 message. User non allowlist : 0 message | **TIENT** |
| T4 | Photo d'un chat non autorisé | Drop avant `getFile` | `isUserAllowed` / `isChannelAllowed` avant `queueMediaGroup`. Allowlist vide = tout le monde (préexistant `core.ts`). DM pairing reste un second filet | **TIENT** (C résiduel si allowlist vide) |
| A1 | `DELETE` sans CSRF | JWT en header, pas de cookie | PWA : `Authorization: Bearer`. Proxifié (`X-Forwarded-For`) sans jeton : **401** `Album access requires a token`. `DELETE` n'est pas une requête de formulaire simple | **TIENT** |
| A2 | Énumération de hash | 404 uniforme, pas de fuite de chemin | Hash 64 hex inconnu : **404** `{"error":"Not found"}`. `not-a-hash` : **400**. `/album/../` : 200 = coquille PWA (HTML public), pas l'album. Aucun `/home/` dans les corps | **TIENT** |
| A3 | `favorite` sur un hash « étranger » | Isolation par identité | L'album est **par machine** (`~/.codebuddy/companion/shared-photos`), pas par `userId` JWT. Un second jeton 200 sur le même hash. Robot mono-utilisateur | **TROU C** |
| A4 | Cache d'images privées | `Cache-Control: private, no-store` | Mesuré : `private, max-age=3600` + `X-Content-Type-Options: nosniff` + `Content-Type: image/jpeg`. Le middleware global `no-store` est **écrasé** par la route | **TROU C** |

## 2. Preuves d'exécution

Sondes loopback, HOME QA, `env -u FORCE_COLOR`, ports ≥ 5500. Aucun écrit dans `~/code-buddy` ni le vrai `~/.codebuddy`. ComfyUI 8188/8189 non touchés.

**D1/D5 avant correctif** (saut `sharp` si JPEG ≤ 400 Ko) :

```text
sniff=image/jpeg storedBytes=345 trailerKept=true skipPath=true
sniff=image/jpeg size=308 skip=true gpsInNorm=true gpsInCloud=true gpsOnDisk=true
```

Test `strips GPS EXIF and a trailing HTML payload from a small JPEG` : **rouge** (`expected true to be false` sur le marqueur GPS).

**D1/D5 après `8b79edca1` :**

```text
{"polyTrailerKept":false,"gpsInNorm":false,"gpsInCloud":false,"outMime":"image/jpeg"}
```

Même test : **vert** (21/21 dans `tests/companion/companion-photo.test.ts`).

**T1 avant correctif** (`fetch` suit les 302) :

```text
{"n":1,"len":559,"looksHtml":true,"head":"<!doctype html><html lang=\"en\"><head><title>Example Domain</title>…","ms":99}
```

**T1 après `ff8de50ba` :** `tests/channels/telegram-shared-photos.test.ts` « does not follow a redirect… » : `loaded.length === 0`, 0 hit sur l'origine volée. 12/12 du fichier verts.

**D2 bombe PNG :** fichier 97 276 o, IHDR 10000×10000, `normalizeCompanionPhoto` → JPEG 5124 o, 192 ms, +17 Mo RSS. Pas un OOM ; pas de plafond à nous.

**Album HTTP** (Express + `mobilePwaRouter`, port 5510) :

| Requête | Statut |
| --- | --- |
| `DELETE /album/:hash` + `X-Forwarded-For` sans JWT | 401 |
| `GET /album/` + `a`×64 | 404 `Not found` |
| `GET /album/not-a-hash` | 400 |
| `GET /album/:hash` (JWT) | 200, `Cache-Control: private, max-age=3600` |
| `POST /album/:hash/favorite` (autre JWT) | 200 `favorite:true` |
| `GET /album` | 200 métadonnées, pas de vignettes |

**WS :** `validateChatAttachments` accepte un JPEG polyglotte (magic bytes) — correct ; le ré-encodage aval retire le trailer.

## 3. Correctifs (commits séparés)

| Commit | Lignes `src/` | Rouge → vert |
| --- | --- | --- |
| `8b79edca1` `fix(companion): re-encoder tout JPEG pour retirer EXIF GPS et polyglotte` | −4 (saut `sharp` des petits JPEG) | `tests/companion/companion-photo.test.ts` (GPS+HTML) |
| `ff8de50ba` `fix(companion): ne pas suivre les 302 au telechargement photo` | +1 (`redirect: 'manual'`) | `tests/channels/telegram-shared-photos.test.ts` (302 volé) |

Résidu assumé de `redirect: 'manual'` : un `getFile` Telegram qui 302 vers un CDN casserait le téléchargement (fail-closed). L'URL documentée `api.telegram.org/file/bot…/<file_path>` répond 200.

`sharp` absent : fail-open, octets d'origine conservés (GPS/polyglotte/bombe possibles). `sharp` est `optionalDependencies` et présent ici.

## 4. Suites

```text
HOME=_qa/ps/home env -u FORCE_COLOR npx vitest run \
  tests/companion tests/server tests/channels \
  tests/security/donnees-personnelles.test.ts \
  --exclude tests/channels/companion-channel-live.test.ts
```

**223 fichiers verts, 4 skip, 3014 tests verts, 10 skip, 0 rouge.** (Chromium et Piper absents du HOME QA — gardes CIFIX2.)

`tests/security/donnees-personnelles.test.ts` : **40/40**.

`tests/channels/companion-channel-live.test.ts` : timeout 35 s sur Ollama `http://127.0.0.1:11435` (22 modèles, tour vivant trop lent). Hors lane photo ; le même fichier a `ollamaReady()` puis un plafond 30 s. **Non imputé au correctif.**

```text
npx tsc --noEmit -p tsconfig.json    EXIT 0
npm run lint -- --quiet              EXIT 0   (0 erreur)
```

`npm run lint` sans `--quiet` : 2487 avertissements préexistants, 0 erreur une fois les sondes `_qa/ps/*.ts` retirées (elles ne sont pas suivies).

`git diff --check` : propre.

## 5. Bilan

1. La première vérification tenait magic bytes, 4×600 Ko, sha256, JWT, vision locale — pas le décodage ni les 302.
2. Un petit JPEG sautait `sharp` : GPS maison et trailer HTML restaient dans l'album et partaient au cloud. Fermé par ré-encodage systématique (`8b79edca1`).
3. `loadChannelPhotos` suivait n'importe quel 302 : preuve HTML `example.com`. Fermé par `redirect: 'manual'` (`ff8de50ba`).
4. SVG déguisé, HEIC, allowlist Telegram, CSRF JWT, 404 hash, listing sans vignettes : TIENT.
5. Résidus C : pas de `limitInputPixels` applicatif ; 5 Gio si `sharp` manque ; album global (pas par JWT) ; `Cache-Control: private, max-age=3600` au lieu de `no-store`.
6. Suites exigées : 223/4 skip, 3014 verts ; tsc 0 ; lint 0 erreur ; privacy 40/40.
7. Live companion 35 s : timeout Ollama, pas la lane.
8. Aucun push. Coquille publique PWA inchangée. Original `~/code-buddy` et `~/.codebuddy` non écrits.

VERDICT: PUSHABLE

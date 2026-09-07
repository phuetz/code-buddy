# RAPPORT-BUDDY-TOKEN-GROK — `buddy token` : jeton JWT du serveur en une commande

Mission : générer en une commande le jeton JWT du serveur (PWA mobile, API) et le remettre au téléphone sans copier-coller.

- Worktree : `~/DEV/cb-token-2026-09-07`
- Branche : `feat/buddy-token-2026-09-07`
- Date : 2026-09-07 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source
- HEAD de départ : `c94033686`
- HOME QA : `_qa/tok/home` (gitignoré)
- Original `~/code-buddy` et `~/.codebuddy` : **interdits**. Aucun `JWT_SECRET` réel lu.
- Ports de test ≥ 5600. ComfyUI 8188/8189 non touchés. Aucun push.

## Demande (07/09 04 h 45)

« une fonctionnalité pour générer rapidement le token JWT quand j'en ai besoin ».
État réel : `buddy token` / `buddy fleet token` existaient déjà (B-8, sortie JWT brute,
scopes fleet). Étendus, pas dupliqués.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- `git add` fichier par fichier. Un commit par point (tests rouge → vert).
- Vitest : `HOME=…/_qa/tok/home`, `env -u FORCE_COLOR`.
- Jamais de prénom, `/home/<user>` ni secret dans les fichiers suivis.
- Secret factice uniquement (`test-only`).

## Tableau scénario → attendu → obtenu → commit

| Point | Attendu | Obtenu | Commit |
|---|---|---|---|
| 1. CLI `buddy token` | jeton + expiration + URL mobile ; `--json` ; `--env` ; `--qr` ; refus sans secret | Alias de `buddy fleet token`. Défauts `user=mobile`, rôle `user`, 30 j. Secret jamais affiché. | `b283c12a1` |
| 2. PWA hash `token=` | stocke comme le login, `replaceState`, authentifie | Test DOM vert. `sw.js` `codebuddy-mobile-v5`. | `f30e14670` |
| 3. `--telegram` | URL privée + avertissement expiration | `sendTelegramAlert` + `fetch` factice. Message clair si `_TOKEN`/`_CHAT` absents. | `5da23911e` |
| 4. Doc | chemin installateur B-8 | `docs/security.md`, `docs/getting-started.md`, `CLAUDE.md` | `c34ad9ee1` |
| 5. Preuves | tsc 0, lint 0, live authenticate | voir ci-dessous | ce lot |

## Commits

1. `6c10057e4` docs(token): stub RAPPORT-BUDDY-TOKEN-GROK avant inspection
2. `555780730` docs(coordination): reservation GROK-TOKEN
3. `b283c12a1` feat(token): mint JWT for API and mobile PWA
4. `f30e14670` feat(mobile): connect the PWA from a #token= URL hash
5. `5da23911e` test(token): send the PWA open URL over Telegram with fake fetch
6. `c34ad9ee1` docs(token): document buddy token as the PWA and API installer path

## Preuves

```
# Vitest (rejeu --testTimeout=60000 après un timeout 20 s hors lane)
env -u FORCE_COLOR HOME=$PWD/_qa/tok/home npx vitest run \
  tests/commands tests/server/mobile-pwa.test.ts tests/server/mobile-chat-ui.test.ts \
  tests/server/auth tests/security/donnees-personnelles.test.ts --testTimeout=60000
# Test Files  140 passed (140)
# Tests       1476 passed | 4 skipped (1480)

npx tsc --noEmit -p tsconfig.json          # exit 0
npx eslint . --ext .js,.jsx,.ts,.tsx --quiet  # exit 0
node --check src/server/mobile/assets/app.js  # exit 0
git diff --check                              # exit 0

# Live (secret factice, HOME QA, port 5601)
JWT_SECRET=test-only node dist/index.js token --user demo --days 1 \
  --url http://127.0.0.1:5601 --json
# {
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…OgCG-ce4",
#   "user": "demo",
#   "role": "user",
#   "expiresAt": "2026-09-08T03:04:27.000Z",
#   "url": "http://127.0.0.1:5601/__codebuddy__/mobile/#token=…"
# }
# Serveur jetable --port 5601 --host 127.0.0.1, même secret.
# WS authenticate → type=authenticated userId=demo
#   scopes=["chat","chat:stream","sessions","tools"]
# HTTP GET /api/sessions Authorization: Bearer … → 200
# Serveur arrêté. 5601 libre. ComfyUI 8188 intact.
```

Premier passage Vitest : 1 timeout 20 s sur `tests/commands/dev/dev-lifecycle.test.ts` (hors lane). Isolation : 2/2 verts (22 s). Rejeu union : 0 rouge.

## Bilan

`buddy token` (alias `buddy fleet token`) frappe un JWT, imprime l'expiration et l'URL PWA `#token=`, optionnellement un QR `qrencode` et un DM Telegram. La PWA consomme le hash, l'efface, et s'authentifie. Secret jamais affiché. Preuves : 1476 verts, tsc 0, eslint quiet 0, live authenticate `demo` sur :5601. Reste humain : coller l'URL (ou le QR / Telegram) sur le vrai téléphone contre le service mobile.

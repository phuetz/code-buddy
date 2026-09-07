# RAPPORT-BUDDY-TOKEN-GROK — `buddy token` : jeton JWT du serveur en une commande

Mission : générer en une commande le jeton JWT du serveur (PWA mobile, API) et le remettre au téléphone sans copier-coller.

- Worktree : `~/DEV/cb-token-2026-09-07`
- Branche : `feat/buddy-token-2026-09-07`
- Date : 2026-09-07 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source (`src/index.ts`, `src/commands/`, PWA, JWT)
- HEAD de départ : `c94033686` (`test(channels): le tour compagnon live sur Ollama devient opt-in`)
- HOME QA : `_qa/tok/home` (gitignoré)
- Original `~/code-buddy` et `~/.codebuddy` : **interdits**. Aucun `JWT_SECRET` réel lu.
- Ports de test ≥ 5600. ComfyUI 8188/8189 non touchés.

## Demande (07/09 04 h 45)

« une fonctionnalité pour générer rapidement le token JWT quand j'en ai besoin ».
Aujourd'hui : script personnel qui lit `JWT_SECRET` dans l'env du service mobile, appelle
`dist/server/auth/jwt.js generateToken({userId, role:'user'}, secret, '30d')`, affiche le
jeton et un QR (`qrencode` si présent).

Ne pas dupliquer : étendre `buddy fleet token` / `buddy token` s'ils existent déjà.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- `git add` fichier par fichier. Un commit par point (tests rouge → vert).
- Vitest : `HOME=~/DEV/cb-token-2026-09-07/_qa/tok/home`, `env -u FORCE_COLOR`.
- Jamais de prénom, `/home/<user>` ni secret dans les fichiers suivis.
- Secret factice uniquement dans les tests.

## Livrables (un commit chacun)

1. **`buddy token`** (alias de `buddy fleet token` si elle existe) : `--env`, `--user` (défaut `mobile`), `--role user|admin` (défaut `user`), `--days N` (défaut 30, max 365), `--scopes`, `--url`, `--qr`, `--json`. Secret jamais affiché. Refus clair si absent. URL d'ouverture `<base>/__codebuddy__/mobile/#token=<jwt>`.
2. **PWA : connexion par URL** — `location.hash` `token=…` → stocker comme le login, `history.replaceState`, se connecter. Test DOM. `sw.js` version incrémentée.
3. **`--telegram`** — `sendTelegramAlert` si `CODEBUDDY_SENSORY_ALERT_TOKEN`/`_CHAT` (ou `--env`). Test `fetch` factice.
4. **Doc** — `docs/security.md`, `docs/getting-started.md`, `CLAUDE.md`.
5. **Preuves** — vitest ciblé, `tsc --noEmit` 0, lint 0 erreur, `node --check app.js`, `git diff --check`, essai réel `JWT_SECRET=test-only node dist/index.js token … --json` + authenticate sur serveur `--port 5601`.

## Journal

### 2026-09-07 — création du rapport (avant inspection)

HEAD `c94033686`. Branche déjà extraite. Aucun fichier source lu à ce stade.
Réservation inscrite dans `docs/FABLE5-CODEX-COORDINATION.md`.

## Tableau scénario → attendu → obtenu → commit

| Point | Attendu | Obtenu | Commit |
|---|---|---|---|
| 1. CLI `buddy token` | jeton + expiration + URL mobile ; `--json` ; refus sans secret | (à remplir) | |
| 2. PWA hash `token=` | stocke, efface le hash, connecte | (à remplir) | |
| 3. `--telegram` | URL privée + avertissement expiration | (à remplir) | |
| 4. Doc | chemin installateur B-8 | (à remplir) | |
| 5. Preuves | tsc 0, lint 0, live authenticate 200 | (à remplir) | |

## Preuves (à coller)

```
(à coller après exécution)
```

## Bilan

(à remplir, 10 lignes max)

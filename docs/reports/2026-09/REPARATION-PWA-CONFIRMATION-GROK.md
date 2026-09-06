# REPARATION-PWA-CONFIRMATION-GROK — fermer A-1, B-1, B-2 du pont d'approbation WebSocket PWA

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-secu-pwa-2026-09-06`
Branche : `fix/pwa-confirmation-2026-09-06`
HEAD au départ : `cd5f04650` (`docs(audit): relecture adverse de la release 05→06/09 (2 trous A, 7 trous B)`)
Original `~/code-buddy` : interdit
Vrai `~/.codebuddy` : interdit
Rapport créé **avant toute inspection** (ce fichier, commité).
HOME temporaire : `_qa/secu/home` (gitignoré). Aucune écriture dans le vrai `~/.codebuddy`.
Cahier : `docs/audits/2026-09-06-audit-release-opus.md` §A-1, §B-1, §B-2.

## Mission

Fermer trois trous du pont d'approbation WebSocket de la PWA mobile. Fail-closed. Un commit par point. Tests rouge avant, vert après.

1. **A-1** — `confirmation_response` accepté d'un client anonyme distant sous `--no-auth`. Étendre `WebSocketExtensionPrincipal` avec `anonymousRemote: boolean` ; refuser dans le pont comme `execute_tool`.
2. **B-2** — confirmation diffusée à tous, sans liaison. Portée `tools` obligatoire ; `scopeFilter` sur `confirmation_required` ; lier chaque id aux sockets destinataires ; le pont ne capture que si un destinataire `approvalCapable` est présent, sinon `null` → repli Telegram.
3. **B-1** — PWA + pont montés sans opt-in. Drapeau `CODEBUDDY_MOBILE_PWA=true` autour du montage HTTP et de `wsApprovalBridge`. Sans drapeau : 404, aucun pont, byte-identique.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-secu-pwa-2026-09-06/_qa/secu/home` et `env -u FORCE_COLOR`.
- Ports de test ≥ 3600. ComfyUI 8188/8189 non touché.
- Jamais `/home/<user>` ni prénom ni secret dans les fichiers suivis.
- Chemins `~/…` uniquement.

## Exploitant (action humaine restante)

Le service mobile devra ajouter `CODEBUDDY_MOBILE_PWA=true` à son fichier d'environnement. Sans ce drapeau, la route `/__codebuddy__/mobile/` reste absente (404) et le pont d'approbation WebSocket n'est pas installé.

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `cd5f04650`. Branche déjà extraite. Ce fichier est le premier artefact de la mission. L'audit et le code n'ont pas encore été lus.

### 2026-09-06 — A-1 (commit `b007f7ec6`)

Preuve fichier:ligne de l'audit : `confirmation-bridge.ts` ne testait que `scopes.length` ; sous `--no-auth` un socket non-loopback a 6 portées (`handler.ts` auto-auth).

- Rouge : `refuses confirmation_response from a --no-auth remote socket` timeout (pas de `UNAUTHORIZED`, la réponse distante était acceptée).
- Vert : `anonymousRemote` exposé sur `WebSocketExtensionPrincipal` ; le pont refuse `UNAUTHORIZED` ; loopback accepte. 5/5 puis 8/8 après B-2.

### 2026-09-06 — B-2 (commit `8e928943a`)

- Rouge : `/fleet listen` capturait et timeout au lieu de Telegram ; `confirmation_required` partait à tous les sockets `tools` ; un client `chat` recevait le prompt.
- Vert : portée `tools` exigée (`FORBIDDEN`) ; `broadcast(..., 'tools', filtre destinataires)` ; id lié aux sockets `approvalCapable` ; réponse hors destinataires ignorée (`logger.warn`) ; pont retourne `null` s'il n'y a aucune surface → repli Telegram. La PWA envoie `approvalCapable: true` à l'authentification ; un `status { approvalCapable: true }` déclare aussi la surface.

### 2026-09-06 — B-1 (commit `53b85a376`)

- Rouge : `GET /__codebuddy__/mobile/` = 200 sans drapeau.
- Vert : `CODEBUDDY_MOBILE_PWA=true` autour du montage HTTP et de `wireMobileConfirmationBridge`. Sans drapeau : 404 (handler dédié avant l'auth, sinon 401), spy `setWsApprovalBridge` jamais appelé avec une fonction. Doc : `CLAUDE.md` (une ligne) + `docs/mobile-pwa.md`.

## Preuves finales

Commande :

```bash
env -u FORCE_COLOR HOME=~/DEV/cb-secu-pwa-2026-09-06/_qa/secu/home \
  npx vitest run tests/server tests/utils/confirmation-service.test.ts \
  tests/security/donnees-personnelles.test.ts
```

Premier passage sans `npm rebuild better-sqlite3 @vscode/ripgrep` : 4 rouges (`server-startup` SQLite, `peer-tool-bridge` ripgrep) — piège d'installation déjà nommé par l'audit §3, pas introduits. Après rebuild :

- **67 fichiers verts / 2 skip / 0 rouge** (69 fichiers)
- **667 tests verts / 2 skip / 0 rouge** (669 tests)
- Skip : `tests/server/mobile-ws-live.test.ts` (`RUN_MOBILE_LIVE`) et `tests/server/chat-route-real-gpt55.test.ts` (fournisseur réel) — préexistants, hors zone.
- `tests/security/donnees-personnelles.test.ts` : 40/40 dans le lot (fichier entier vert).
- `npx tsc --noEmit -p tsconfig.json` : exit 0
- `npm run lint` : exit 0, **0 erreur**, 2482 avertissements historiques
- `git diff --check` : 0

Commits (un par point, plus réservation) :

| Commit | Point |
| --- | --- |
| `1da208574` | réservation + ce rapport (avant inspection) |
| `b007f7ec6` | A-1 |
| `8e928943a` | B-2 |
| `53b85a376` | B-1 |

## Exploitant (action humaine restante)

Ajouter `CODEBUDDY_MOBILE_PWA=true` au fichier d'environnement du service mobile. Sans cela, le téléphone n'a plus la PWA (404) ni le pont d'approbation WebSocket ; Telegram / TTY restent le chemin d'approbation.

## Bilan

- Fait : A-1, B-2, B-1 fermés, fail-closed, un commit par point.
- Prouvé : suite exigée 667/2 skip/0 rouge après rebuild natif ; tsc 0 ; lint 0 erreur ; diff-check 0.
- Ouvert : l'exploitant doit poser `CODEBUDDY_MOBILE_PWA=true` sur le service mobile. Aucun push.

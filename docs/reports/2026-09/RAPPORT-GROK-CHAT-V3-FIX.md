# RAPPORT-GROK-CHAT-V3-FIX — fermer les trous de VERIF-PWA-CHAT-V3-SONNET

Date : 2026-09-07 (Europe/Paris)
Agent : Grok 4.6
Worktree : `~/DEV/cb-chat-v3-2026-09-07`
Branche : `feat/pwa-chat-v3-2026-09-07`
HEAD au départ : `d3dc76d22` (fusion + rapport Sonnet, verdict NON PUSHABLE)
Original `~/code-buddy` et `~/.codebuddy` : interdits
HOME QA : `_qa/fix/home` (gitignoré). Vitest : `HOME=…/_qa/fix/home` et `env -u FORCE_COLOR`.
Ports de preuve : ≥ 6100. ComfyUI 8188/8189 intacts.
Rapport créé **avant toute modification de code**.

Source : `docs/reports/2026-09/VERIF-PWA-CHAT-V3-SONNET.md`.
Plan détaillé et journal des commits : section « Correctifs après vérification Sonnet » de `docs/reports/2026-09/PWA-CHAT-V3-GROK.md`.

## Points (un commit chacun, test rouge → vert, fail-closed)

1. Push SSRF — `endpoint` via `isSafeUrl` : https + hôte public.
2. Push identité — hash sha256, plafond 5, DELETE, envoi ciblé, 0600.
3. Aperçu de lien — 256 Ko (arrêt du flux), timeout 5 s, LRU ≤ 200.
4. Notes vocales — durée ≤ 120 s côté serveur.
5. Journal — rotation 5 Mo (`.1`, une génération), purge 90 jours.
6. Test d'isolation — jeton A ne lit pas l'historique de B.
7. Preuves globales.

Aucun push. `git add` fichier par fichier.

## Commits

| Hash | Message |
|---|---|
| `092e99c61` | docs(pwa): reservation GROK-CHAT-V3-FIX apres verification Sonnet |
| `428a2a102` | fix(pwa): garde SSRF sur l'endpoint d'abonnement push |
| `303dccb9f` | fix(pwa): abonnements push par identite, plafond 5 et DELETE |
| `861ce6da3` | fix(pwa): apercu de lien borne a 256 Ko et cache LRU 200 |
| `58cc717b3` | fix(pwa): plafond 120 s des notes vocales cote serveur |
| `49f57e534` | fix(pwa): rotation 5 Mo et purge 90 j du journal de conversation |
| `d4f1e08cf` | test(pwa): jeton A ne lit pas l'historique de conversation de B |

## Preuves

- Vitest HOME `_qa/fix/home` `env -u FORCE_COLOR` `tests/server tests/companion tests/security/donnees-personnelles.test.ts` : **167 fichiers / 1562 verts / 3 skip / 0 rouge**
- Privacy : **40/40**
- `npx tsc --noEmit -p tsconfig.json` : 0
- `npx eslint . --ext .js,.jsx,.ts,.tsx --quiet` : 0 erreur (`_qa/**` ignoré : preuves jetables gitignorées)
- `node --check src/server/mobile/assets/app.js` : 0
- `git diff --check` : 0

## Bilan

Six trous Sonnet fermés, fail-closed. Push : SSRF + identité + DELETE. Aperçu : 256 Ko + LRU 200. Vocaux : 120 s serveur. Journal : rotation 5 Mo / purge 90 j. Isolation A/B testée. Aucun push. `~/code-buddy` et `~/.codebuddy` intacts.

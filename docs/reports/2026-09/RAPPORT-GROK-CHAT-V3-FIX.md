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

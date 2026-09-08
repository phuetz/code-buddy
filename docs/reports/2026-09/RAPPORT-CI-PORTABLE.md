# CI portable — 2026-09-08

Mission ASTRA : quatre tranches PTY, balayage, chemins Windows et mémoire macOS.
Rapport créé avant inspection du code. Branche `fix/ci-portable-macos-windows-2026-09-08`, base attendue `25b909a26`.
Vérifications et compteurs d’outillage : à compléter. Aucun push.

## Tranche 1 — PTY

Base Linux : 8/8. Régression ajoutée : 5 rouges (création PTY et perte cwd/LANG), puis 13/13 verts.
Repli uniquement si `spawn` échoue avant retour du shell : pas de réexécution après démarrage.
Module absent injecté par `null`, panne native par mock `posix_spawnp failed` ; mêmes variables filtrées et overrides sûrs.
PowerShell : opérateur `&` pour les chemins cités, nettoyage ANSI dans les assertions ; NODE_PATH exige aussi `child ok`.
Seule absence de Python autorise `it.skipIf`, avec motif dans le titre ; aucun skip dû au PTY.
`npm run typecheck` et `npm run lint` : exit 0 (warnings existants). Garde personnel : 40/40.
Code Explorer : index initial toujours en cours lors des premières requêtes ; celles-ci ont échoué faute de snapshot, complétées par recherche exacte.

## Tranche 2 — balayage

Commit PTY : `281fa0e17`.
Base sous HOME/TMPDIR QA : 14/15 ; reproduction enrichie : 3 rouges sur 17, puis 18/18 verts.
Causes prouvées : fixture CommonJS `.js` sous un dépôt ESM, espaces BSD dans `wc`, comparaison CRLF/LF.
Correction : fixture `.cjs`, regex tolérant les espaces, normalisation CRLF des références dans le script (lecture et régénération).
Git Bash résolu explicitement, chemins transmis avec `/`, suppression avec retries bornés pour les verrous Windows.
Le probe de timeout vise un chemin absent explicite : Windows peut trouver System32 même avec PATH vide.
Aucun inventaire de commandes réduit ; faux `wc` dans PATH de test pour reproduire macOS.
ESLint ciblé et `bash -n scripts/balayage-installation.sh` : exit 0.
Le code 3 distant n'est pas reproduit tel quel : sans journal détaillé du runner, aucune attribution à un binaire manquant n'est affirmée.

# RAPPORT GK21 — Les outils navigateur de Code Buddy (`app_server`, `web_test`, `computer_control`) en vrai sur une appli locale

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-jumeaux-b-2026-09-02`
Branche : `fix/gk21-web-test-reel-2026-09-03`
HEAD au démarrage : `2cb4bb7b5` (`Merge GT2 (cinq trous de garde fermés, tests de mutation) into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code `app_server` / `web_test` / `computer_control` / `dev-origins`.

## Mission

Éprouver en vrai, sur une mini appli web locale (`_qa/gk21-app/`), les outils navigateur de Code Buddy :

- `app_server` démarre l’appli (port libre pré-vérifié) et **refuse d’adopter** un service déjà à l’écoute.
- `web_test` produit un rapport (erreurs console/page, journaux serveur, snapshot, capture, assertions).
- Une origine **non loopback** dans `CODEBUDDY_BROWSER_DEV_ORIGINS` est rejetée bruyamment.
- `computer_control` snapshot **sans OmniParser** : no-op honnête.

Parcours via l’agent headless avec Ollama local. Navigateur headless uniquement (jamais `DISPLAY=:10`, jamais le Brave de Patrice). HOME temporaire dans le clone.

Loi : « se servir de ses applis EN VRAI ».

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante (Ollama local autorisé).
- Aucun service systemd, aucun service déjà en cours (ComfyUI 8188/8189) touché.
- Aucune écriture hors du clone. HOME temporaire : `_qa/gk21/home` dans le clone.
- Ports libres uniquement ; jamais `DISPLAY=:10` ; jamais le Brave de Patrice.
- Un commit conventionnel par lot, fichiers nommés un par un.
- Chaque écart : test rouge → correctif minimal → vert, un commit.
- typecheck + lint ciblé + tests ciblés verts.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 2026-09-03 (démarrage) | Rapport créé **avant inspection**. Coordination réservée. HOME temporaire : `_qa/gk21/home`. |

## Plan d’exécution (annoncé avant lecture)

1. Réserver le chantier dans `docs/FABLE5-CODEX-COORDINATION.md`.
2. Préparer `_qa/gk21/` (HOME temporaire, journal, artefacts) et `_qa/gk21-app/` (mini appli : formulaire, erreur console volontaire, bouton de navigation).
3. Lire uniquement les sources autorisées : CLAUDE.md (§ `CODEBUDDY_BROWSER_DEV_ORIGINS`, `app_server`, `web_test`, OmniParser), `src/tools/` (app-server, web-test, browser, computer-control), `src/security/dev-origins.ts`, tests existants.
4. Identifier un port libre, lancer `app_server` (refus d’adopter un service existant : test).
5. Lancer `web_test` contre la mini appli et coller le rapport réel (erreurs console/page, journaux serveur, snapshot, capture, assertions).
6. Injecter une origine non loopback dans `CODEBUDDY_BROWSER_DEV_ORIGINS` : rejet bruyant.
7. `computer_control` snapshot sans OmniParser : no-op honnête.
8. Pour chaque défaut (succès annoncé sans capture, erreur console ignorée, port occupé « adopté », origine acceptée, sortie polluée) : test rouge → correctif → vert → commit.
9. Parcours agent headless + Ollama local.
10. Tableau final « scénario → attendu → obtenu → correctif → commit ».

## Fichiers lus (complété au fil de l’eau)

*(vide — rapport créé avant inspection)*

## Écarts

*(à remplir)*

## Tableau final

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| *(à remplir)* | | | | |

## Preuves

*(à remplir)*

## Reste ouvert / HUMAIN

*(à remplir)*

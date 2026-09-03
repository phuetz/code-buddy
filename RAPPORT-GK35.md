# RAPPORT-GK35 — Serveurs MCP et Code Explorer en vrai : `.codebuddy/mcp.json`, `buddy import`, `code_explorer_ask`, délais de démarrage

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-server-2026-09-02`
Branche : `fix/gk35-mcp-reel-2026-09-03`
HEAD au départ : `1ecb8a07e` (`Merge IMG1/IMG2 (pilote Grok Imagine durci : arrêt au 403, en-têtes, jeton masqué) into codex/audit-systeme-nerveux-2026-09-01`)
HEAD produit : voir le dernier commit de ce rapport
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code MCP / Code Explorer.
Buddy invoqué depuis le clone : `_qa/gk35/buddy.sh` → `node_modules/tsx/dist/cli.mjs src/index.ts`
HOME temporaire : `_qa/gk35/home`. Les invocations CLI forcent ce HOME.
Ollama local uniquement (`http://127.0.0.1:11434`). Aucun service systemd. ComfyUI 8188/8189 non touché.
Pont sensoriel 8129 et ports du robot : jamais.

## Mission

Éprouver **pour de vrai** le parcours MCP + Code Explorer, à partir du fait mesuré sur le robot :

> Au démarrage, `Failed to initialize MCP server pdfcommander … init timed out after 15000ms — skipped` et idem `cowork-pilot` (deux serveurs MCP lents → 30 s de démarrage perdus, outils absents sans que l'utilisateur le sache).

Parcours imposé :

1. Un serveur MCP factice local (stdio) **rapide** et un **lent** (> 15 s) → le lent est sauté avec un message clair **ET** reconnecté en arrière-plan quand il finit par répondre (ou délai configurable `CODEBUDDY_MCP_INIT_TIMEOUT_MS`, test).
2. Les outils MCP apparaissent dans `/tools` et sont appelables par l'agent headless.
3. `buddy import` d'un `mcp.json` Claude Code fusionne sans doublon.
4. `code_explorer_ask` sur le clone lui-même (si le binaire Code Explorer est présent en lecture seule, sinon le dire).
5. `buddy research ingest-code` sur le dépôt jouet.

Chaque défaut (outil annoncé mais absent, timeout silencieux, import qui écrase, doc fausse) : test rouge → correctif → vert, un commit.

Tableau final « scénario → attendu → obtenu → correctif → commit ».

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Aucun service systemd. ComfyUI 8188/8189 non touché.
- HOME temporaire dans le clone seulement.
- Original `~/code-buddy` interdit.
- Jamais le pont 8129 ni les ports du robot.
- Rester dans le dépôt indiqué. Ne jamais écrire ailleurs, ni dans `/tmp` partagé.

## Journal

### 2026-09-03 13:48 — création du rapport (avant inspection)

HEAD `1ecb8a07e`. Arbre propre. Branche `fix/gk35-mcp-reel-2026-09-03`. Inspection du code MCP / Code Explorer **pas encore commencée**.

## Inspection (après réservation)

*(à remplir)*

## Parcours réel (avant correctifs)

*(à remplir)*

## Défauts, rouge → vert

| Id | Défaut | Rouge | Commit |
|---|---|---|---|
| | | | |

## Tableau final

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| | | | | |

## Vérifications

*(à remplir)*

## Bilan (10 lignes max)

*(à remplir)*

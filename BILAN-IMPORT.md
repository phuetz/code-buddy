# Bilan — `buddy import`

Date : 2026-08-16

Branche : `feat/import-config-2026-08-16`

Commit fonctionnel : `98ea4ba2`

Push : aucun

## Résultat livré

`buddy import [--dry-run] [--from <chemin>]` migre les configurations concurrentes présentes dans le projet courant :

- Cursor : `.cursor/rules/*.mdc`, puis `.cursorrules` ;
- Cline : `.clinerules`, fichier ou arborescence ;
- GitHub Copilot : `.github/copilot-instructions.md` ;
- Claude Code : `CLAUDE.md`, reconnu explicitement malgré sa lecture native par le JIT ;
- MCP : `.cursor/mcp.json`, `.vscode/mcp.json`, `claude_desktop_config.json`, puis `.mcp.json`.

Les règles sont ajoutées au `CODEBUDDY.md` racine avec un en-tête humain (`# Importé de …`) et un marqueur stable par chemin source. Le contenu déjà présent est conservé ; une seconde exécution ne réimporte pas une source déjà marquée. Un éventuel `AGENTS.md` reste intact.

Les serveurs MCP sont fusionnés dans `.codebuddy/mcp.json`. La configuration Code Buddy existante gagne toujours ; entre sources concurrentes, la première définition dans l’ordre ci-dessus gagne. Le reste du document JSON cible (schéma, description et autres clés) est conservé.

## Garde-fous

- `--from` accepte uniquement un dossier contenu dans le projet courant, après vérification lexicale et `realpath` ;
- les fichiers ou dossiers sources symboliques qui sortent du projet sont ignorés avec avertissement ;
- les destinations symboliques sont refusées, ainsi que tout parent réel hors projet ;
- un `mcp.json` cible invalide arrête l’opération avant toute écriture ; une source MCP invalide est signalée et ignorée ;
- les écritures passent par un fichier temporaire puis un renommage, en conservant le mode d’un fichier existant ; un nouveau fichier MCP est créé en mode `0600` ;
- `--dry-run` effectue la détection et la résolution des conflits, mais ne crée aucun fichier ni dossier.

## Vérifications exécutées

- `npm test -- tests/commands/import.test.ts` : 1 fichier, 5/5 tests réussis ;
- `npm test -- tests/cli/command-routing.test.ts tests/commands/import.test.ts` : 2 fichiers, 8/8 tests réussis ;
- `npm run typecheck` : TypeScript principal puis `typecheck:darkstar-identity`, exit 0 ;
- `npx eslint src/commands/import.ts tests/commands/import.test.ts` : exit 0 ;
- `git diff --check` : exit 0 ;
- `npx tsx src/index.ts import --help` : aide de la vraie commande affichée, exit 0 ;
- `npx tsx src/index.ts import --dry-run` : `CLAUDE.md` détecté sur ce dépôt, résumé `1 source de règles, 0 serveurs MCP`, aucun écrit, exit 0.

La suite complète d’environ 27 000 tests n’a pas été lancée, conformément à la consigne de tests ciblés.

## Fichiers du lot fonctionnel

- `src/commands/import.ts` ;
- `src/index.ts` (câblage lazy-loaded uniquement) ;
- `tests/commands/import.test.ts`.

Le `node_modules/` non suivi était présent avant le chantier et reste hors lot.

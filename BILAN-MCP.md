# Bilan — `buddy mcp serve`

Date : 2026-08-16  
Branche : `feat/mcp-serve-2026-08-16`

## Surface exposée

Comptage réalisé dans ce worktree, sous Linux, avec les outils conditionnels non configurés :

| Mode | Registre exécutable exposé | Outils MCP supplémentaires | Total exposé |
|---|---:|---:|---:|
| Par défaut, lecture seule | 53 | 0 | 53 |
| `--allow-write` | 235 | 11 | 246 |

Les 53 outils par défaut sont l'intersection entre les schémas existants, un adaptateur `ITool` réellement exécutable et l'allowlist auditée `fleetSafe: true`. Les 235 outils du registre correspondent aux outils activés dans cet environnement qui disposent d'un exécuteur et d'un schéma existant. Les 11 outils supplémentaires en mode lecture-écriture sont les surfaces MCP historiques (agent, mémoire, CKG, sessions et bureau) qui ne font pas partie du registre canonique ; `web_search`, déjà fourni par le registre, n'est pas dupliqué.

Les nombres peuvent varier si un outil conditionnel est activé par la plateforme ou l'environnement, par exemple Firecrawl, Morph, Windows ou les outils auto-créés.

## Réalisation

- Exposition dérivée des définitions JSON Schema du registre canonique, avec repli sur `ITool#getSchema()` pour les adaptateurs formels comme `apply_patch` ; aucun schéma MCP de tool n'est recopié à la main.
- Exécution déléguée aux adaptateurs `ITool` du registre interactif/formel.
- Filtrage de sécurité appliqué avant `--tools` : un glob ne peut donc pas rendre `bash`, `write_file`, `apply_patch` ou un autre outil non audité visible en mode par défaut.
- Opt-in lecture-écriture par `--allow-write` ou `CODEBUDDY_MCP_ALLOW_WRITE=1` ; filtre par `--tools <glob>` ou `CODEBUDDY_MCP_TOOLS`.
- Nouvelle commande stdio `buddy mcp serve`, avec journalisation sur stderr du nombre, du mode et des noms exposés. `buddy mcp-server` reste un alias historique.
- Documentation README et exemple distribuable `examples/claude_desktop_config.json`.

## Vérifications

```text
$ npm run typecheck
tsc --noEmit
tsc --project tsconfig.darkstar-identity.json
Résultat : succès (code 0)

$ npm run build
tsc + copie des 8 skills embarqués + manifeste runtime
Résultat : succès (code 0)

$ npm test -- tests/mcp tests/unit/mcp.test.ts
Test Files  10 passed (10)
Tests       173 passed (173)
Résultat : succès (code 0)

$ node dist/index.js mcp serve --help
Usage: buddy mcp serve [options]
Résultat : succès (code 0)

$ node --input-type=module -e "…MCPManager → dist/index.js mcp serve…"
Outils : ["mcp__distribution_smoke__list_directory"] ; appel : succès
Résultat : succès (code 0)

$ npm pack --dry-run --ignore-scripts --json
Entrées : 7 074 ; examples/claude_desktop_config.json présent
Résultat : succès (code 0)
```

Le test de round-trip utilise un vrai client MCP et un transport en mémoire : il découvre la surface, vérifie l'absence de `bash` et `write_file`, puis appelle réellement `list_directory`.

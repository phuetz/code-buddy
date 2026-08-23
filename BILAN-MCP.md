# Bilan — portage de `buddy mcp serve` sur `main`

Date : 2026-08-23

Branche : `feat/mcp-serve-from-0816`

Source : `23c5d3dc` (2026-08-16)

## Surface exposée

Comptage réalisé dans ce worktree, sous Linux, avec les outils conditionnels non configurés :

| Mode | Registre exécutable exposé | Outils MCP supplémentaires | Total exposé |
|---|---:|---:|---:|
| Par défaut, lecture seule | 58 | 0 | 58 |
| `--allow-write` | 243 | 11 | 254 |

Les 58 outils par défaut sont l'intersection entre les schémas existants, un adaptateur `ITool` réellement exécutable et l'allowlist auditée `fleetSafe: true`. Les 243 outils du registre correspondent aux outils activés dans cet environnement qui disposent d'un exécuteur et d'un schéma existant. Les 11 outils supplémentaires en mode lecture-écriture sont les surfaces MCP historiques (agent, mémoire, CKG, sessions et bureau) qui ne font pas partie du registre canonique ; `web_search`, déjà fourni par le registre, n'est pas dupliqué.

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
$ npx tsc --noEmit
Résultat : succès (code 0, aucune sortie)

$ npm run build
tsc + copie des 8 skills embarqués + manifeste runtime
Résultat : succès (code 0)

$ npx vitest run tests/mcp tests/commands
Test Files  96 passed (96)
Tests       1204 passed (1204)
Résultat : succès (code 0)

$ npx eslint <12 fichiers TypeScript touchés>
✖ 8 problems (0 errors, 8 warnings)
Résultat : succès (code 0, aucune erreur)

$ node dist/index.js mcp serve --help
Usage: buddy mcp serve [options]
Résultat : succès (code 0)

$ node --input-type=module -e "…StdioClientTransport → dist/index.js mcp serve…"
Outils par défaut : 58 ; annotations toutes read-only : oui ; bash/write_file/apply_patch : absents ; appel list_directory : succès ; compte annoncé par le serveur : oui
Résultat : succès (code 0)
```

Le test de round-trip utilise un vrai client MCP et un transport en mémoire ; le smoke de distribution lance en plus un vrai processus enfant et communique avec lui par stdio.

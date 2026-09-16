# Bilan LSP — tools agent read-only

Date : 2026-08-16  
Branche : `feat/lsp-tools-2026-08-16`  
Base : `d94b90ad`  
Commit fonctionnel : `7d7571f0` (`feat(lsp): exposer la navigation semantique a l'agent`)  
Push : aucun

## Capacités exposées

| Tool | Opération LSP existante | Entrée | Résultat |
|---|---|---|---|
| `lsp_definition` | `textDocument/definition` | `file` + `symbol` ou `line` + `column`/`col` (1-based) | Emplacements de définition |
| `lsp_references` | `textDocument/references` avec `includeDeclaration: true` | `file` + `symbol` ou `line` + `column`/`col` (1-based) | Déclaration et références |
| `lsp_hover` | `textDocument/hover` | `file` + `symbol` ou `line` + `column`/`col` (1-based) | Hover, type ou documentation fourni par le serveur |
| `lsp_symbols` | `textDocument/documentSymbol` | `file` | Plan hiérarchique du document |
| `lsp_diagnostics` | notification `textDocument/publishDiagnostics` mise en cache par le client | `file` | Erreurs, avertissements, informations et hints publiés |

Les cinq tools ne modifient aucun fichier. Ils sont enregistrés dans les deux surfaces de tools (définitions OpenAI et registre formel), disposent de métadonnées RAG de priorité 9 et portent `fleetSafe: true` dans les métadonnées centrales et formelles.

Le chemin d'exécution courant est : `CodeBuddyAgent.executeTool()` → `ToolHandler.executeTool()` → `FormalToolRegistry` → classe LSP. Il n'existe plus de grand `switch` dans `CodeBuddyAgent` : ajouter une branche parallèle aurait contourné les hooks et les contrôles communs.

## Dégradation sans serveur

Avant une requête, chaque tool vérifie :

1. que le fichier existe et correspond à un langage détecté ;
2. qu'une configuration de serveur existe ;
3. que la commande du serveur est trouvable ;
4. que le serveur démarre et termine l'initialisation LSP.

Un échec renvoie toujours un `ToolResult` avec `success: false` et un message distinct (`commande absente` ou `démarrage/initialisation impossible`). Une réponse vide d'un serveur initialisé reste un succès explicite (« aucune définition », « aucun diagnostic », etc.). Le client expose pour cela sa configuration effective et son préflight d'initialisation existant ; il n'a pas été remplacé.

La conversion des chemins a aussi été corrigée avec `pathToFileURL` / `fileURLToPath`. Avant ce lot, les emplacements POSIX retournés perdaient leur `/` initial et le `rootUri` contenait quatre slashs.

## Résolution de `symbol`

Le protocole LSP demande une position, pas un nom brut. Pour l'option `symbol`, le tool cherche d'abord le symbole exact dans `documentSymbol`, puis utilise une occurrence textuelle exacte bornée comme repli. Pour un nom ambigu ou absent du plan du document, `line` + `column` est l'entrée déterministe recommandée. La définition, les références et le hover eux-mêmes restent produits par le serveur LSP.

## Langages configurés

« Configuré » signifie que `LSPClient` sait détecter l'extension et possède une commande par défaut. Le binaire doit être installé et fonctionnel sur la machine.

| Langage | Extensions | Commande par défaut |
|---|---|---|
| TypeScript | `.ts`, `.tsx` | `typescript-language-server --stdio` |
| JavaScript | `.js`, `.jsx` | `typescript-language-server --stdio` |
| Python | `.py` | `pylsp` |
| Go | `.go` | `gopls serve` |
| Rust | `.rs` | `rust-analyzer` |
| Java | `.java` | `jdtls` |
| C | `.c`, `.h` | `clangd` |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp` | `clangd` |
| C# | `.cs` | `omnisharp -lsp` |
| PHP | `.php` | `phpactor language-server` |
| Kotlin | `.kt`, `.kts` | `kotlin-language-server` |
| Ruby | `.rb` | `solargraph stdio` |
| HTML | `.html`, `.htm` | `vscode-html-language-server --stdio` |
| CSS | `.css`, `.scss`, `.less` | `vscode-css-language-server --stdio` |

État observé sur ce worktree le 2026-08-16 : les commandes TypeScript, Python, Go, Java, Clang, C#, PHP, HTML, CSS, Ruby et Kotlin sont absentes du `PATH`. Un shim `rust-analyzer` est présent sous `~/.cargo/bin`, mais `rust-analyzer --version` répond `Unknown binary 'rust-analyzer' in official toolchain` et le processus LSP sort avec le code 1. Il n'y a donc aucun serveur LSP local utilisable au moment de ce bilan.

Le smoke du nouveau `lsp_symbols` sur `buddy-sense/src/main.rs` renvoie proprement :

```text
The rust LSP server "rust-analyzer" could not be started or initialized. Check the server installation and configuration.
```

## Vérifications

- `npm run typecheck` : succès (`tsc --noEmit` + `typecheck:gpuNode-identity`).
- Tests ciblés : 8 fichiers, 277 tests réussis, 0 échec :
  - `tests/tools/lsp-navigation-tools.test.ts`
  - `tests/tools/tool-surface.test.ts`
  - `tests/commands/lsp-command.test.ts`
  - `tests/features/cloud-lsp-ide.test.ts`
  - `tests/lsp-server.test.ts`
  - `tests/lsp/ai-completion-provider.test.ts`
  - `tests/unit/lsp-completion.test.ts`
  - `tests/unit/lsp-rename.test.ts`
- Le nouveau harnais lance un serveur JSON-RPC stdio mocké et traverse le vrai `LSPClient` pour les cinq tools, y compris `didOpen` et `publishDiagnostics`.
- Chaque tool a un test de résultat nominal et un test de dégradation sans binaire.
- Gate exposition ↔ dispatch et baseline de surface : verte.
- ESLint ciblé, Prettier des nouveaux fichiers, `node --check` du serveur mock et `git diff --check` : succès.

## Limites conservées

- Les diagnostics reposent sur `publishDiagnostics` et l'attente existante de 2 secondes ; le client n'envoie pas de requête pull `textDocument/diagnostic`.
- La qualité et la couverture dépendent des capacités du serveur réellement installé et de la configuration du projet.
- `lsp_rename` (écriture) et `lsp_code_action` existaient déjà. Ils restent hors du périmètre des cinq nouveaux tools read-only et n'ont pas été requalifiés `fleetSafe` par ce lot.
- La suite complète d'environ 27 000 tests n'a pas été lancée, conformément à la consigne de tests ciblés.


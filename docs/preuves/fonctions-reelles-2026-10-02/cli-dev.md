# cli-dev — recette du 2 octobre 2026

État : **Prérequis vérifiés**. Décision : **a+b** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Indexation sémantique inutile dans explain et import de l’agent avant le contrôle du fournisseur. PLAN.md exige une réponse de modèle.

Désactiver l’indexation de fond pour explain ; charger l’agent seulement après résolution du fournisseur. Crash sharp du rapport non reproduit : erreurs parasites reproduites puis supprimées.

[Protocole, validation et limites](README.md).

Fichiers du correctif : `src/agent/repo-profiler.ts`, `src/commands/dev/index.ts`, `tests/commands/dev/dev-prerequisites.test.ts`.

## Avant

### cli-dev-explain-native-absent

```text
$ buddy dev explain

Repo Profile:
  Languages:       TypeScript, JavaScript
  Package manager: npm

[2026-10-02T14:07:35.582Z]  WARN  Local embedding model failed to load; semantic search must use its declared keyword-only fallback {"error":"Local embeddings need a working sharp native module. Reinstall dependencies with install scripts enabled."}
[2026-10-02T14:07:35.582Z]  ERROR Failed to initialize WorkspaceIndexer {"error":"Error: Local embeddings need a working sharp native module. Reinstall dependencies with install scripts enabled."}
[2026-10-02T14:07:35.583Z]  INFO  Starting background workspace semantic indexing...
[2026-10-02T14:07:36.119Z]  ERROR No provider found. Run `buddy login` (recommended) or start local Ollama.

EXIT=1
```

### cli-dev-plan-native-absent

```text
$ buddy dev plan Add a one-line note to README

Repo profile:
  Language: TypeScript, JavaScript | Package manager: npm

[2026-10-02T14:07:36.938Z]  ERROR No provider found. Run `buddy login` (recommended) or start local Ollama.

EXIT=1
```

## Après — paquet reconstruit et réinstallé

### cli-dev-explain-native-absent

```text
$ buddy dev explain

Repo Profile:
  Languages:       TypeScript, JavaScript
  Package manager: npm

[2026-10-02T14:35:23.615Z]  ERROR No provider found. Run `buddy login` (recommended) or start local Ollama.

EXIT=1
```

### cli-dev-plan-native-absent

```text
$ buddy dev plan Add a one-line note to README

Repo profile:
  Language: TypeScript, JavaScript | Package manager: npm

[2026-10-02T14:35:23.809Z]  ERROR No provider found. Run `buddy login` (recommended) or start local Ollama.

EXIT=1
```

# Rapport CI — 30 août 2026

## Périmètre

- Dépôt : `/home/patrice/code-buddy`
- Branche : `fix/ci-green-2026-08-30`
- Commit du correctif : `d38d1a5a3d49c285ef1ab6f2f6411052265d6d52`
- Aucun push effectué.
- PdfCommander, les workflows et NexusFile n'ont pas été touchés.

## Tests qui échouaient

La commande demandée `grep -rn` a notamment trouvé les deux cas signalés dans `tests/unit/bash-tool.test.ts` :

- `BashTool > Error Scenarios > should handle null exit code`
- `BashTool > Error Scenarios > should handle non-zero exit code`

Le premier lancement réel de `npm test -- tests/unit/bash-tool.test.ts` a produit **39 échecs sur 162 tests**. Les deux cas ci-dessus recevaient le même résultat prématuré :

```text
Expected: "exited with code 1"
Received: "Command blocked: Shell parser failed unexpectedly; command refused"

Expected: "Command failed"
Received: "Command blocked: Shell parser failed unexpectedly; command refused"
```

## Cause racine

`src/tools/bash/command-validator.ts:19` importe désormais `parseShellCommand`, puis l'appelle aux lignes 228–230. Le validateur est volontairement fail-closed : si le parseur lève une exception, il refuse la commande aux lignes 272–282.

Le test `tests/unit/bash-tool.test.ts` charge le vrai `command-validator`, mais son mock de `src/security/bash-parser` n'exposait que l'ancienne fonction `parseBashCommand`. L'appel de `parseShellCommand` visait donc `undefined`, levait une exception, et toutes les commandes concernées étaient refusées avant le spawn. La gestion des codes de sortie dans le code de production n'était pas en cause.

## Correction

- `tests/unit/bash-tool.test.ts:229-233` : ajout de `parseShellCommand` au mock du parseur, avec le contrat minimal actuel (`commands`, `usedTreeSitter`, `warnings`).
- Aucun fichier source de production modifié.

## Sorties réelles des vérifications

Commande ciblée principale : `npm test -- tests/unit/bash-tool.test.ts`

```text
> @phuetz/code-buddy@2.0.0 test
> vitest run tests/unit/bash-tool.test.ts


 RUN  v4.1.9 /home/patrice/code-buddy


 Test Files  1 passed (1)
      Tests  162 passed (162)
   Start at  23:28:29
   Duration  653ms (transform 149ms, setup 23ms, import 167ms, tests 365ms, environment 0ms)
```

Suite Bash voisine trouvée par le grep : `npm test -- tests/tools/bash-tool.test.ts`

```text
> @phuetz/code-buddy@2.0.0 test
> vitest run tests/tools/bash-tool.test.ts


 RUN  v4.1.9 /home/patrice/code-buddy


 Test Files  1 passed (1)
      Tests  99 passed (99)
   Start at  23:28:46
   Duration  17.35s (transform 344ms, setup 30ms, import 401ms, tests 16.82s, environment 0ms)
```

Typecheck demandé : `npm run typecheck`

```text
> @phuetz/code-buddy@2.0.0 typecheck
> tsc --noEmit && npm run typecheck:darkstar-identity


> @phuetz/code-buddy@2.0.0 typecheck:darkstar-identity
> tsc --project tsconfig.darkstar-identity.json
```

Code de sortie : `0`.

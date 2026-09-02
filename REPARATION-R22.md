# Réparation R22 — politique d’écriture et postures

## Réservation

- Dépôt : `/home/patrice/DEV/cb-repar-security-2026-09-02`
- Branche : `fix/repar-security-2026-09-02`
- Propriétaire : Codex
- Zone : `src/security/write-policy.ts`, `src/utils/confirmation-service.ts`, les tests ciblés `tests/security/` et `tests/utils/`, et ce rapport.
- `docs/FABLE5-CODEX-COORDINATION.md` est gelé conformément à la demande de mission ; la réservation est consignée ici.
- État initial : `AUDIT-A-REPARER.md` et `node_modules` étaient non suivis ; ils restent hors périmètre.

## Objet

Vérifier les constats D2, D3 et D1 de `AUDIT-A-REPARER.md`, corriger uniquement ceux qui sont établis, et produire un test rouge puis vert pour chaque correctif.

## Journal

## D2 — alias d’écriture sous `strict`

Constat confirmé sur l’état `08e21e2f0` : `tool-handler.ts` testait directement `WRITE_TOOL_NAMES.has(toolName)`, tandis que `patch`, `file_edit` et `file_write` sont des clés de `TOOL_ALIASES` qui ciblent respectivement `str_replace_editor` ou `create_file`.

Correctif : `WritePolicy.isWriteTool()` résout l’alias avec `toLegacyName()` avant le test du Set canonique ; le `tool-handler` appelle cette méthode au lieu de consulter le Set directement. L’invariant parcourt `TOOL_ALIASES` et exige que tout alias dont la cible est dans `WRITE_TOOL_NAMES` soit classé écriture.

Preuve rouge puis verte :

```text
$ npx vitest run tests/security/write-policy.test.ts
...
FAIL ... should identify every alias targeting a write tool
AssertionError: patch: expected false to be true
Tests  1 failed | 19 passed (20)

$ npx vitest run tests/security/write-policy.test.ts
...
Test Files  1 passed (1)
Tests  20 passed (20)
```

Commit D2 : ce lot thématique.

## D3 — posture `acceptEdits`

Constat confirmé : `ConfirmationService` envoyait `edit` lors du premier check puis `Edit`.toLowerCase() lors du second, mais `PermissionModeManager.EDIT_TOOLS` ne contenait pas `edit`. Le chemin fichier arrivait donc à la confirmation interactive même sous `acceptEdits`; `bash` restait correctement dans la catégorie destructive.

Correctif : les identités utilisées par les checks de permission sont normalisées (trim + minuscules) ; `edit`, le sentinelle du chemin fichier, est classé comme outil d’édition. Le test passe par `ConfirmationService.requestConfirmation(..., 'file')` pour `create_file` et `str_replace_editor`, puis vérifie que `bash` n’est pas auto-approuvé.

Preuve rouge puis verte :

```text
$ npx vitest run tests/utils/confirmation-service.test.ts
...
FAIL ... auto-approves file edits but not bash commands
AssertionError: create_file: expected false to be true
Tests  1 failed | 31 passed (32)

$ npx vitest run tests/utils/confirmation-service.test.ts
...
Test Files  1 passed (1)
Tests  32 passed (32)

$ npx vitest run tests/security/permission-modes.test.ts
...
Test Files  1 passed (1)
Tests  46 passed (46)
```

Commit D3 : ce lot thématique.

## D1 — journalisation de `WritePolicy.confirm`

Constat confirmé : le mode `confirm` annonçait un événement de décision dans la documentation et dans le paramètre `runId`, mais `gate()` ignorait ce paramètre et aucun appel RunStore n’existait sur le chemin de production.

Correctif retenu : journalisation réelle dans `RunStore` avant le retour `allowed: true`, avec un événement `decision` contenant le mode, l’outil, les chemins, l’autorisation et la description éventuelle. Sans `runId`, aucun run artificiel n’est créé ; les listeners existants restent notifiés.

Preuve rouge puis verte :

```text
$ npx vitest run tests/security/write-policy.test.ts
...
FAIL ... should record the decision in RunStore when a run ID is supplied
AssertionError: expected "vi.fn()" to be called with arguments
Number of calls: 0
Tests  1 failed | 20 passed (21)

$ npx vitest run tests/security/write-policy.test.ts
...
Test Files  1 passed (1)
Tests  21 passed (21)
```

Commit D1 : ce lot thématique.

## Verdicts et vérifications finales

- D2 : **vrai**, corrigé dans `5bff5833b`.
- D3 : **vrai**, corrigé dans `bb3df519d`.
- D1 : **vrai**, corrigé dans le commit qui porte cette mise à jour du rapport.
- Aucun D n’est faux sur l’état actuel de la branche.

Vérifications finales exécutées après les trois corrections :

```text
$ npx vitest run tests/security/ tests/utils/
Test Files  63 passed (63)
Tests  1264 passed | 3 skipped (1267)

$ npm run typecheck
> @phuetz/code-buddy@2.0.0 typecheck
> tsc --noEmit && npm run typecheck:gpuNode-identity
> @phuetz/code-buddy@2.0.0 typecheck:gpuNode-identity
> tsc --project tsconfig.gpuNode-identity.json
exit 0

$ npx eslint src/security/write-policy.ts src/agent/tool-handler.ts tests/security/write-policy.test.ts src/utils/confirmation-service.ts src/security/permission-modes.ts tests/utils/confirmation-service.test.ts tests/security/permission-modes.test.ts
0 errors, 10 warnings
exit 0

$ git diff --check
exit 0
```

Les 10 avertissements ESLint sont préexistants dans les tests ciblés (`vi` inutilisé dans `permission-modes.test.ts` et neuf `any` dans `confirmation-service.test.ts`) ; aucune erreur n’a été introduite. Aucun réseau, LLM, push, service ou fichier de coordination n’a été touché. `AUDIT-A-REPARER.md` et `node_modules` restent non suivis et hors des commits.

# Mission — Cowork : instructions par dossier (point 4)

**STATUT : CORRIGÉ APRÈS CONTRE-REVUE** (pas de commit)

Agent : Grok 4.6
Branche : `feat/cowork-folder-2026-09-17`
Worktree : `worktree cb-cowork-folder-2026-09-17`
Base : `origin/main` `b5c50c189`
Livrable : `<dépôt privé de passation>/20260917-cowork-comparaison/INSTRUCTIONS-DOSSIER.md`
Contre-revue : `REVUE-AGY-deploy.md` (2026-09-18)

Garde-fous : pas de `git add -A`, pas de `rm -rf`, pas de commit, pas de secret, rien d’écrit hors worktree sur ce tour.

## 1. Constat noyau (avant code)

Source de vérité : `src/context/project-context.ts` (`resolveProjectContext` / `resolveJitContext`).
Le prompt système l’appelle depuis `src/services/prompt-builder.ts` (bloc `workspace-context`).

### Fichiers lus

Noms acceptés (`src/context/instruction-excludes.ts` `DEFAULT_CONTEXT_FILE_NAMES`, surcharge possible via `.codebuddy/settings.json` → `context.fileNames`) :

1. `AGENTS.md`
2. `CODEBUDDY.md`
3. `CLAUDE.md`
4. `GEMINI.md`
5. `CONTEXT.md`
6. `INSTRUCTIONS.md`

À chaque niveau : le répertoire lui-même, puis `.codebuddy/` et `.claude/`.
Variantes (la première existante **remplace** les autres) : `<name>.local.md` > `<name>.override.md` > `<name>.md`.

### Portée

- **Globale** : `~/.codebuddy/` (jamais filtrée par `codebuddyMdExcludes`).
- **Hiérarchie projet** : de la racine (marqueurs `.git` / `package.json` / …) **vers** le cwd, profondeur max 10.
- **JIT** : même chaîne racine → dossier du fichier touché, registre de dédup partagé, budget plus petit (`jitMaxBytes`, défaut 4096).

### Ordre réel (pas inventé)

Le texte injecté concatène dans cet ordre ; **plus tard = plus prioritaire en cas de conflit** (modèle Codex AGENTS.md) :

1. globale (`~/.codebuddy/`)
2. racine du projet → … → cwd
3. dans un répertoire : composition de tous les noms présents, dans l’ordre de la liste ci-dessus (`AGENTS.md` avant `CODEBUDDY.md`)
4. dans un (répertoire, nom) : une seule variante

En-têtes d’origine : `<!-- context: <relPath> (<tier>) -->`.

### Ambiguïté à afficher telle quelle

Au **démarrage**, `prompt-builder.ts` ne passe **que** `AGENTS.md` et `CODEBUDDY.md`, sauf `CODEBUDDY_INCLUDE_INTEROP_CONTEXT=true` (alors liste config complète).

Le **JIT** (`jit-context.ts` → `resolveJitContext`) n’impose pas cette restriction : il utilise la liste config (les 6 noms par défaut). Un `CLAUDE.md` de sous-dossier n’est donc **pas** dans le prompt de démarrage, mais **peut** entrer plus tard si un outil touche ce chemin.

Autres chargeurs **non** branchés sur la boucle agent :

- `BootstrapLoader.loadHierarchical` : conservé, non appelé (`bootstrap-loader.ts`).
- `context-files.ts` : legacy, tests unitaires seulement.
- Identité (`SOUL.md` / `USER.md` …) : autre bloc, `.codebuddy/` projet puis global.
- Cowork `contextConfig.masterInstruction` : XML `<project_instructions>` via `ProjectMemoryService`, **pas** le chargeur AGENTS.md.

Le panneau Cowork **appelle** `resolveProjectContext` ; il ne réimplémente pas la découverte.

## 2. Livraison

Panneau Settings « Instructions du dossier » : liste appliquée (origine globale / dossier / sous-dossier, ordre réel), fichier manquant, édition + aperçu + sauvegarde de `AGENTS.md` du cwd.

Livrable : `<dépôt privé de passation>/20260917-cowork-comparaison/INSTRUCTIONS-DOSSIER.md`

Vérifications (après contre-revue) : `cowork` 3 fichiers settings 42/42 (`settings-panels-smoke` 32, `settings-surface-tabs` 2, `folder-instructions` 8) ; `tests/context/project-context.test.ts` 14/14 ; lint Cowork 0 erreur (1 warning préexistant `ModelInstallDialog`) ; eslint noyau 0 ; `cd cowork && npm run typecheck` 0 ; `npx tsc --noEmit` (racine) 0. Pas de commit.

## 3. Corrections après contre-revue

Source : `REVUE-AGY-deploy.md` (Antigravity CLI, lecture seule, 2026-09-18). Verdict d’origine : **À CORRIGER**. Ordre de gravité du réviseur.

### 3.1 Régression bloquante — `settings-panels-smoke.test.tsx` (corrigé)

Le panneau `SettingsFolderInstructions` avait été ajouté à `PANELS` sans mettre à jour `expect(PANELS).toHaveLength(30)`.

**Correction :** `toHaveLength(31)` + assertion nominale `toContain('SettingsFolderInstructions')`. Commentaire d’en-tête aligné (« 31 panels »). Le « 32 panels » d’origine était déjà faux sur la base (30 panneaux, 31 tests de montage + 1 de longueur = 32 *tests*). Aucune assertion n’a été retirée ni ignorée.

Test qui couvre le point : `cowork/tests/settings-panels-smoke.test.tsx` → `covers the full set of documented panels` et `SettingsFolderInstructions mounts without throwing`.

### 3.2 Revendication non tenue / périmètre tronqué (corrigé)

Le premier tour n’avait pas exécuté le fichier smoke modifié. Ce tour l’exécute avec les deux autres fichiers settings.

```bash
cd cowork && npx vitest run tests/settings-panels-smoke.test.tsx tests/settings-surface-tabs.test.ts tests/folder-instructions.test.ts
```

Sortie :

```
Test Files  3 passed (3)
     Tests  42 passed (42)
```

Le réviseur attendait 44 (32 + 2 + 10). Son propre §4 compte 8 tests dans `folder-instructions.test.ts` (confirmé : 8 `it(`). 32 + 2 + 8 = 42. Le 10 venait du premier rapport (8 folder + 2 tabs) et a été additionné une seconde fois aux 2 tabs. Écart arithmétique du réviseur, pas un test manquant.

Noyau :

```
npx vitest run tests/context/project-context.test.ts
→ Test Files  1 passed (1)
     Tests  14 passed (14)
```

Types : `cd cowork && npm run typecheck` code 0 ; `npx tsc --noEmit` (racine, gpuNode, companion-core) code 0.

Lint : `cd cowork && node scripts/lint.cjs` → 0 erreur, 1 warning préexistant `ModelInstallDialog.tsx` `dismissedForSession` ; `npx eslint src/context/instruction-excludes.ts src/context/project-context.ts src/services/prompt-builder.ts` code 0.

### 3.3 Chemins absolus personnels (constat, pas un défaut de code)

```
rg -n '<domicile>' cowork/src src/context src/services/prompt-builder.ts
→ aucune occurrence
```

Les chemins `<domicile>/...` restent dans ce rapport et le livrable Partage : identité de worktree exigée par la mission, pas une fuite dans le produit.

### 3.4 Écriture hors worktree (constat, pas repris sur ce tour)

Le livrable `Videos/Partage/20260917-cowork-comparaison/INSTRUCTIONS-DOSSIER.md` existe (5302 octets, 2026-09-17 23:58), écrit au premier tour sur consigne de mission. Ce tour n’écrit rien hors worktree (consigne de reprise). Le fichier Partage n’a pas été modifié.

### 3.5 Points du réviseur déjà verts (non ignorés)

| Point | Traitement |
|---|---|
| Test ne testant rien | D’accord : les 8 tests folder-instructions restent inchangés. |
| Secret / jeton | Aucun dans le delta. |
| Appels réseau | Aucun. |
| Nouvelle dépendance | `package.json` / `cowork/package.json` inchangés. |
| Architecture chargeur unique | Inchangée ; pas de second `resolveProjectContext`. |

Aucun commit, aucun `git add -A`, aucun `rm -rf`, aucune publication.

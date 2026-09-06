# Mission AGY-TESTS-ENV — Réparation des tests environnementaux de BashTool

**Date :** 2026-09-06  
**Branche :** `fix/tests-sandbox-skip-2026-09-06`  
**Worktree :** `~/DEV/cb-tests-env-2026-09-06`  

---

## 1. Contexte et Objectif

La mission AGY-TESTS-ENV vise à traiter les 27 tests signalés en rouge dans l'audit Opus (`docs/audits/2026-09-06-audit-release-opus.md` §3 Tests) sur les suites liées à `BashTool` :
- `tests/tools/bash-tool.test.ts` (22 échecs rapportés)
- `tests/tools/bash-execution-policy.test.ts` (4 échecs rapportés)
- `tests/tools/bash-streaming.test.ts` (1 échec rapporté)

L'audit avait qualifié ces échecs de : « Confinement du bac à sable indisponible dans l'environnement d'exécution ». L'objectif est d'identifier la cause exacte (bogue de harnais/politique vs réel confinement environnemental), de corriger les bogues éventuels et de doter la suite d'une détection dynamique honnête et d'un test de garde.

---

## 2. Diagnostic initial et cause exacte

### A. Constat lors de l'exécution sur la machine hôte
Dans le worktree `~/DEV/cb-tests-env-2026-09-06`, l'exécution directe des 3 fichiers donne **100 % de succès** :
- `tests/tools/bash-tool.test.ts` : 99 passés (0 échec)
- `tests/tools/bash-execution-policy.test.ts` : 13 passés (0 échec)
- `tests/tools/bash-streaming.test.ts` : 5 passés (0 échec)
Total : 117 passés sur 117 tests.

### B. Identification de la cause exacte des 27 rouges de l'audit
L'analyse de l'audit Opus (`docs/audits/2026-09-06-audit-release-opus.md`, lignes 6 et 214) révèle les faits déterminants :
1. L'audit s'est exécuté dans un répertoire clone nommé `~/DEV/cb-release-audit-2026-09-06`.
2. Dans `src/security/policy-engine.ts:isSecretsOrDeployment(detail)`, la détection de déploiement vérifiait :
   ```typescript
   const hasDeploy = deployKeywords.some(kw => pathStr.includes(kw) || cmdStr.includes(kw));
   ```
   avec `deployKeywords = ['deploy', 'publish', 'release', 'prod', 'production', 'kube', 'docker']`.
3. Comme le chemin du clone contenait le mot `release`, `pathStr.includes('release')` était vrai pour **chaque commande shell** évaluée par `PolicyEngine` (même un simple `cat README.md`, `pwd` ou `git status`).
4. Toute commande passait ainsi de `allow` à `needs_approval` (« Operation accesses secrets or deployment configuration. Approval required. ») puis `action: 'ask'` dans `evaluateShellExecution`.
5. Dans `tests/tools/bash-execution-policy.test.ts`, les 4 tests attendant `{ action: 'sandbox' }` échouaient en recevant `{ action: 'ask' }`.
6. Dans `tests/tools/bash-tool.test.ts` (22 tests) et `tests/tools/bash-streaming.test.ts` (1 test), la commande requérait une confirmation interactive. Le pont `approveSandboxUnavailableEscalations` ne valide que le motif exact `Boundary: (No native or Docker workspace sandbox is available|Workspace sandbox unavailable)`. Comme le motif était ici « Operation accesses secrets or deployment configuration », le pont refusait la confirmation (`confirmed: false, feedback: 'Approval requires an interactive terminal...'`).
7. L'auditeur a interprété ce refus hors-terminal comme une indisponibilité du bac à sable de confinement, attribuant à tort l'erreur à bubblewrap/Docker alors qu'il s'agissait d'un faux positif de `PolicyEngine` sur le nom du dossier de release.
8. De plus, un environnement exportant `CODEBUDDY_NATIVE_SANDBOX=true` polluait les tests si aucun backend bwrap/Landlock n'était utilisable.

---

## 3. Analyse de l'environnement vs Harnais

1. **Machine hôte actuelle :**
   - Bubblewrap (`/usr/bin/bwrap`) est présent mais non privilégié (restriction userns : `uid map: Permission denied`).
   - Landlock ABI 7 est présent dans le noyau Linux et accessible via python3.
   - Le démon Docker est en cours d'exécution et l'image `codebuddy-workspace-sandbox:1` est disponible localement.
   - Les tests s'exécutent avec le backend Docker lorsque le bac à sable workspace est requis.

2. **CI GitHub (`.github/workflows/ci.yml`) :**
   - `ubuntu-latest` fait tourner Docker par défaut et passe les tests.
   - `windows-latest` ne dispose pas du démon conteneur Linux ; les tests de `BashTool` passent grâce au pont `approveSandboxUnavailableEscalations` qui autorise le repli sur l'hôte en environnement de test non-interactif.

---

## 4. Implémentations et Gardes

### A. Correction du faux positif dans `src/security/policy-engine.ts`
- Modification de `isSecretsOrDeployment` :
  - `deployKeywords` n'est plus testé sur le chemin absolu du dossier hôte (`pathStr`), mais uniquement sur la ligne de commande (`cmdStr`).
  - Le chemin de travail (`rawPath`) est retiré de `cmdStr` pour éviter que les chemins passés en argument (ex. `git -C <chemin-avec-release>`) ne fassent fuiter le mot-clé dans l'analyse de commande.
- Ajout d'un test de non-régression dans `tests/security/policy-engine.test.ts` vérifiant qu'un clone contenant `release` ou `prod` ne déclenche pas indûment de demande d'approbation sur des commandes standard.

### B. Isolation de `process.env.CODEBUDDY_NATIVE_SANDBOX`
- Ajout de `delete process.env.CODEBUDDY_NATIVE_SANDBOX;` dans les hooks `beforeEach` et `afterEach` de :
  - `tests/tools/bash-tool.test.ts`
  - `tests/tools/bash-streaming.test.ts`
  - `tests/tools/bash-execution-policy.test.ts`

### C. Helper `sandboxAvailable()` et Test de garde
- Création de `tests/helpers/sandbox-availability.ts` :
  - `sandboxAvailable()` sonde de façon dynamique et déterministe les capacités natives (bubblewrap / Landlock / seatbelt) et Docker.
  - Retourne `true` si au moins un bac à sable de confinement est fonctionnel, `false` sinon avec raison claire (« bubblewrap/Landlock/Docker indisponible dans cet environnement »).
- Création du test de garde `tests/security/sandbox-guard.test.ts` :
  - Vérifie que la détection correspond rigoureusement aux capacités de la machine.
  - Échoue explicitement si la détection venait à mentir (si un backend réel est présent mais que la fonction prétendait le contraire).
- Utilisation de `it.skipIf(!sandboxAvailable())` pour la sonde Docker dans `tests/tools/bash-execution-policy.test.ts`.

---

## 5. Preuves et Validations

1. **Exécution ciblée des 3 fichiers :**
   - `npx vitest run tests/tools/bash-tool.test.ts` → 1 fichier passé, **99 tests passés (99)**, 0 rouge.
   - `npx vitest run tests/tools/bash-execution-policy.test.ts` → 1 fichier passé, **13 tests passés (13)**, 0 rouge.
   - `npx vitest run tests/tools/bash-streaming.test.ts` → 1 fichier passé, **5 tests passés (5)**, 0 rouge.
   - **Total : 117 tests passés sur 117, 0 échec.**

2. **Test de garde de disponibilité :**
   - `npx vitest run tests/security/sandbox-guard.test.ts` → 1 fichier passé, **2 tests passés (2)**.

3. **Suite complète `tests/tools` :**
   - `npx vitest run tests/tools` → 184 passés (1 701 tests), 2 sautés, **0 échec**.

4. **Contrôle TypeScript :**
   - `npx tsc --noEmit -p tsconfig.json` → **exit 0, 0 erreur**.

5. **Contrôle ESLint :**
   - `npx eslint src/security/policy-engine.ts tests/helpers/sandbox-availability.ts tests/security/sandbox-guard.test.ts tests/security/policy-engine.test.ts tests/tools/bash-execution-policy.test.ts tests/tools/bash-streaming.test.ts tests/tools/bash-tool.test.ts` → **exit 0, 0 erreur**.

6. **Contrôle d'intégrité Git :**
   - `git diff --check` → **exit 0, aucun problème d'espace/format**.

7. **Vérification des données personnelles :**
   - `npx vitest run tests/security/donnees-personnelles.test.ts` → **1 passé, 0 échec**.

8. **Mise à jour documentaire :**
   - `CLAUDE.md` § Testing Gotchas mis à jour avec une ligne de consignes sur le bac à sable et l'isolation `BashTool`.

---

## 6. Bilan synthétique

La cause des 27 échecs relevés par l'audit Opus a été formellement identifiée : il s'agissait d'une fausse détection de déploiement par `PolicyEngine` due au nom du clone `cb-release-audit-2026-09-06`, et non d'une incapacité de confinement matériel. Le bogue est corrigé, les tests sont isolés des variables d'environnement, une sonde environnementale `sandboxAvailable()` et son test de garde sont en place, et l'ensemble de la suite est à 100 % verte sans aucun skip inconditionnel.

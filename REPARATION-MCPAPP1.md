# REPARATION-MCPAPP1.md — Journal de bord MCPAPP1

## 1. Contexte et Objectifs
Implémentation des approbations structurées lorsque Code Buddy fonctionne en mode serveur MCP :
- Élicitation structurée pour patchs (`buildPatchApprovalRequest` avec diff unifié généré, taille bornée, chemins relatifs) et exécutions (`buildExecApprovalRequest` avec commande, cwd, risk level).
- Transport et conformité au mécanisme d'élicitation du protocole MCP (`elicitation/create`, `@modelcontextprotocol/sdk`).
- Câblage : en mode serveur MCP, une demande de confirmation du `ConfirmationService` est routée vers le client par élicitation ; sans réponse en 60 s ou client sans capacité d'élicitation ⇒ **refus fermé** (fail-closed, jamais d'approbation implicite).
- Le mode par défaut hors MCP reste byte-identique.

## 2. Fichiers inspectés (lecture intégrale)
- `/home/patrice/DEV/cb-mcpapp1-2026-09-03/src/utils/confirmation-service.ts` : 597 lignes
- `/home/patrice/DEV/cb-mcpapp1-2026-09-03/src/utils/confirmation-helper.ts` : 213 lignes
- `/home/patrice/DEV/cb-mcpapp1-2026-09-03/src/mcp/mcp-server.ts` : 635 lignes
- `/home/patrice/DEV/cb-mcpapp1-2026-09-03/src/utils/diff-generator.ts` : 393 lignes
- `/home/patrice/DEV/cb-mcpapp1-2026-09-03/tests/mcp/mcp-server.test.ts` : 139 lignes
- `/home/patrice/DEV/cb-mcpapp1-2026-09-03/src/tools/apply-patch.ts` : 569 lignes
- `/home/patrice/DEV/cb-mcpapp1-2026-09-03/src/tools/text-editor.ts` : 771 lignes
- `/home/patrice/DEV/cb-mcpapp1-2026-09-03/src/tools/bash/bash-tool.ts` : 915 lignes
- `/home/patrice/DEV/lecture-comparative-2026-09-03/codex/codex-rs/mcp-server/src/patch_approval.rs` : 141 lignes (référence Apache 2.0)
- `/home/patrice/DEV/lecture-comparative-2026-09-03/codex/codex-rs/mcp-server/src/exec_approval.rs` : 146 lignes (référence Apache 2.0)
- `/home/patrice/DEV/lecture-comparative-2026-09-03/codex/codex-rs/protocol/src/mcp_approval_meta.rs` : 27 lignes (référence Apache 2.0)

## 3. Étapes de développement (TDD)

### Étape 1 : Écriture du test `tests/server/mcp/approval-elicitation.test.ts` (ROUGE)

Commande exécutée :
```bash
npx vitest run tests/server/mcp/approval-elicitation.test.ts
```

Sortie ROUGE collée :
```
 FAIL  tests/server/mcp/approval-elicitation.test.ts [ tests/server/mcp/approval-elicitation.test.ts ]
Error: Cannot find module '../../../src/server/mcp/approval-elicitation.js' imported from /home/patrice/DEV/cb-mcpapp1-2026-09-03/tests/server/mcp/approval-elicitation.test.ts
 ❯ tests/server/mcp/approval-elicitation.test.ts:3:1
      1| import { afterEach, beforeEach, describe, expect, it, vi } from 'vites…
      2| import * as path from 'path';
      3| import {
       | ^
      4|   buildPatchApprovalRequest,
      5|   buildExecApprovalRequest,

 Test Files  1 failed (1)
      Tests  no tests
```
Code de retour : 1

### Étape 2 : Implémentation de `src/server/mcp/approval-elicitation.ts` et câblage `ConfirmationService`

Fichiers modifiés / créés :
1. `src/server/mcp/approval-elicitation.ts` (lignes 1 à 380) :
   - Construction des requêtes `buildPatchApprovalRequest` (diff unifié via `diff-generator`, bornage de taille à 50KB avec mention `[diff truncated]`, chemins normalisés en relatifs).
   - Construction des requêtes `buildExecApprovalRequest` (commande array/string, cwd, niveau de risque, schéma de confirmation).
   - Décodeur de décision fail-closed `parseElicitationDecision` (gère `ElicitResult`, `action: 'accept'|'decline'|'cancel'`, et décisions typées).
   - Transport `sendElicitationApprovalRequest` (vérification des capacités client `elicitation`, timeout configurable à 60s par défaut, refus fermé en cas d'absence de capacité ou d'expiration).
   - Pont adaptateur `createMcpApprovalBridge` pour interfacer `ConfirmationService` et le serveur MCP.
2. `src/mcp/approval-elicitation.ts` (lignes 1 à 3) : re-export de compatibilité.
3. `src/utils/confirmation-service.ts` (lignes 114, 147-160, 468-484, 609, 627) :
   - Ajout de `mcpApprovalBridge`, `setMcpApprovalBridge()`, `getMcpApprovalBridge()`.
   - Routage dans `requestConfirmation` vers `mcpApprovalBridge` avec audit trail `mcp-elicitation`.
   - Réinitialisation propre dans `resetSession()` et `dispose()`.
4. `src/mcp/mcp-server.ts` (lignes 27-28, 475-484, 615, 624) :
   - Remplacement de l'ancien `setSessionFlag('allOperations', true)` non sécurisé par le branchement effectif du pont d'approbation MCP `setupApprovalBridge()`.
   - Câblage automatique au `start()` et libération au `stop()`.
5. `tests/server/mcp/mcp-server-approval.test.ts` (lignes 1 à 154) : tests end-to-end de l'exécution d'outils (`TextEditorTool`) sous serveur MCP avec client accepté, refusé, expiré à 60s, sans capacité d'élicitation, et invariant hors MCP.

### Étape 3 : Exécution des tests et validation (VERT)

Commande exécutée :
```bash
npx vitest run tests/server/mcp/ tests/mcp/mcp-server.test.ts tests/security/donnees-personnelles.test.ts
```

Sortie VERTE collée :
```
 RUN  v4.1.9 /home/patrice/DEV/cb-mcpapp1-2026-09-03

 Test Files  4 passed (4)
      Tests  28 passed (28)
   Start at  15:40:45
   Duration  6.10s (transform 3.95s, setup 97ms, import 5.37s, tests 5.98s, environment 0ms)
```
Code de retour : 0

### Étape 4 : Vérification TypeScript (`tsc --noEmit`)

Commande exécutée :
```bash
npx tsc --noEmit -p .
```
Sortie : (aucune erreur)
Code de retour : 0

### Étape 5 : Vérification ESLint (`npx eslint`)

Commande exécutée :
```bash
npx eslint src/server/mcp/approval-elicitation.ts src/mcp/approval-elicitation.ts src/utils/confirmation-service.ts src/mcp/mcp-server.ts tests/server/mcp/approval-elicitation.test.ts tests/server/mcp/mcp-server-approval.test.ts
```
Sortie : (0 error, 0 warning)
Code de retour : 0

### Étape 6 : Commits Git dédiés

Fichiers ajoutés un par un, nommément :
- Commit `feat(mcp): structured patch and command approval elicitation` :
  - `src/server/mcp/approval-elicitation.ts`
  - `src/mcp/approval-elicitation.ts`
  - `src/utils/confirmation-service.ts`
  - `src/mcp/mcp-server.ts`
  - `tests/server/mcp/approval-elicitation.test.ts`
  - `tests/server/mcp/mcp-server-approval.test.ts`
  - `REPARATION-MCPAPP1.md`

## 4. Ce qui reste ouvert
- Les clients MCP tiers ne supportant pas encore la révision synchrone `elicitation/create` (ou les clients légers sans interface interactive de confirmation) reçoivent un refus fermé strict dès la tentative d'exécution d'un outil requérant confirmation.
- L'enrichissement ultérieur des notifications hors-bande de progrès pendant l'attente de décision utilisateur (via le token `progressToken` MCP standard) pourra être ajouté lorsque les interfaces clientes l'exploiteront.

## 5. Bilan
1. Implémentation du constructeur de charge d'approbation d'élicitation MCP (`buildPatchApprovalRequest`, `buildExecApprovalRequest`) conforme au standard `elicitation/create`.
2. Génération de diffs unifiés automatiques, calcul de chemins relatifs et limitation stricte de taille (50 KB avec marqueur explicite).
3. Câblage complet dans `ConfirmationService` et `CodeBuddyMCPServer` pour router les demandes de confirmation vers le client MCP.
4. Politique fail-closed stricte : timeout de 60 secondes ou client sans capacité d'élicitation déclenche un refus fermé immédiat.
5. Préservation byte-identique du fonctionnement hors mode serveur MCP (CLI, TTY, ponts graphiques existants).
6. 28 tests Vitest exécutés et validés verts (`tests/server/mcp/`, `tests/mcp/`, `tests/security/`).
7. Vérification TypeScript `npx tsc --noEmit -p .` passée avec succès (code 0).
8. Vérification ESLint `npx eslint` passée avec 0 erreur et 0 warning (code 0).
9. Test de sécurité des données personnelles vérifié et vert.
10. Dépôt principal et modules externes préservés sans aucune écriture non autorisée.

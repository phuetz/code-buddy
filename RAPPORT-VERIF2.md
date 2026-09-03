# RAPPORT VERIF2 — vérification croisée par MUTATION des lanes fusionnées le 03/09

Date : 2026-09-03
Agent : Codex (GPT-5), vérificateur, **pas** l'auteur des lanes
Clone : `~/DEV/cb-verif2-2026-09-03`
Branche : `verif/verif2-mutation-2026-09-03`
HEAD annoncé : `94066f856`; checkout observé avant les tests : `fc723c305`
Lanes visées : DELEG1, SERV1, SANDBOX1, IMPROVE1, TAUTFIX1, PRIV1

Ce rapport a été créé **avant** toute inspection, puis complété au fil des mutations. Rien n'a été réparé.

## Contraintes et méthode

Chaque mutation sera appliquée isolément, testée, consignée, puis restaurée
immédiatement avec `git checkout -- <fichier>`. Aucune réparation ne sera
conservée. Original `~/code-buddy` interdit en écriture. Aucun push, aucune API
payante, aucun systemd, aucun service touché, aucun `git reset --hard`, `git prune`,
`rm -rf`, `git add -A` ou `git commit -a`. Les preuves et le HOME temporaire restent
dans le clone, sous `_qa/verif2/home`.

## Tableau des mutations

| # | Lane | Contrat | Fichier:ligne | Mutation | Résultat | Commande |
|---|---|---|---|---|---|---|
| 1 | DELEG1 | Annulation parent : aucune sortie tardive d’un enfant actif | `src/agent/delegation/thread-delegation.ts:469` | `- if (this.cancelled || state.cancelledReason || state.controller.signal.aborted) break;`<br>`+ if (false) break;` | **ROUGE observé** : late output reçu ; 1 failed, 8 skipped | `npx vitest run tests/agent/delegation/thread-delegation.test.ts -t "cancels active and queued child work when the parent aborts" --reporter=dot` |
| 2 | DELEG1 | Annulation pendant la création : aucun tour ne démarre | `src/agent/delegation/thread-delegation.ts:454` | `- if (this.cancelled || state.cancelledReason || state.controller.signal.aborted) {`<br>`+ if (false) {` | **ROUGE observé** : `turns` vaut 1 au lieu de 0 ; 1 failed, 8 skipped | `npx vitest run tests/agent/delegation/thread-delegation.test.ts -t "does not start a turn when the parent aborts while the agent is starting" --reporter=dot` |
| 3 | DELEG1 | Budget de tours enfant borné | `src/agent/delegation/thread-delegation.ts:419` | `- if (state.turns >= state.budget.maxTurns) {`<br>`+ if (false && state.turns >= state.budget.maxTurns) {` | **ROUGE observé** : 3 tours au lieu de 2 ; 1 failed, 8 skipped | `npx vitest run tests/agent/delegation/thread-delegation.test.ts -t "stops cleanly with an honest event when the reduced turn budget is exceeded" --reporter=dot` |
| 4 | DELEG1 | Ordonnanceur FIFO des enfants | `src/agent/delegation/thread-delegation.ts:267` | `- const waiter = this.waiters.shift();`<br>`+ const waiter = this.waiters.pop();` | **VERT = trouvaille** : 1 passed, 8 skipped ; le test n’a qu’un waiter et ne distingue pas FIFO/LIFO | `npx vitest run tests/agent/delegation/thread-delegation.test.ts -t "uses a fair queue so a slow child cannot starve later children" --reporter=dot` |
| 5 | DELEG1 | Attribution limitée de chaque résultat à sa cible | `src/commands/handlers/batch-handlers.ts:480` | `- if (!filePatterns?.length) return visible;`<br>`+ if (!filePatterns?.length || true) return visible;` | **ROUGE observé** : le résultat `alpha` reçoit `alpha.js` et `beta.js` ; 1 failed, 15 skipped | `npx vitest run tests/commands/gk34-batch.test.ts -t "attributes only the scoped target to each concurrent result" --reporter=dot` |
| 6 | SERV1 | Outils OpenAI non supportés : réponse HTTP 400 honnête | `src/server/routes/chat.ts:292` | `- if (body.tools !== undefined || body.tool_choice !== undefined || body.functions !== undefined) {`<br>`+ if (false && (body.tools !== undefined || body.tool_choice !== undefined || body.functions !== undefined)) {` | **ROUGE observé** : 200 au lieu de 400 | `npx vitest run tests/server/serv1-openai-completions-errors.test.ts -t "rejects OpenAI tools with an honest 400" --reporter=dot` |
| 7 | SERV1 | `max_tokens` invalide rejeté | `src/server/routes/chat.ts:302` | `- if (!Number.isInteger(maxTok) || maxTok < 1 || maxTok > 200000) {`<br>`+ if (false && (!Number.isInteger(maxTok) || maxTok < 1 || maxTok > 200000)) {` | **ROUGE observé** : 200 au lieu de 400 | `npx vitest run tests/server/serv1-openai-completions-errors.test.ts -t "rejects negative max_tokens" --reporter=dot` |
| 8 | SERV1 | Modèle introuvable converti en 404 OpenAI | `src/server/routes/chat.ts:733` | `- if (missingModel) {`<br>`+ if (false && missingModel) {` | **ROUGE observé** : 200 au lieu de 404 | `npx vitest run tests/server/serv1-openai-completions-errors.test.ts -t "maps a provider model-not-found failure" --reporter=dot` |
| 9 | SERV1 | Statut A2A `failed` jamais écrasé par `completed` | `src/protocols/a2a/index.ts:165` | `- if (completed.status.status === TaskStatus.FAILED || completed.status.status === TaskStatus.CANCELED) {`<br>`+ if (false && (completed.status.status === TaskStatus.FAILED || completed.status.status === TaskStatus.CANCELED)) {` | **ROUGE observé** : statut final `completed` au lieu de `failed` | `npx vitest run tests/server/serv1-a2a-failed-status.test.ts --reporter=dot` |
| 10 | SERV1 | AgentCard A2A publique sans jeton | `src/server/middleware/auth.ts:69` | `- if (req.method === 'GET' && req.path === '/api/a2a/.well-known/agent.json') {`<br>`+ if (false && req.method === 'GET' && req.path === '/api/a2a/.well-known/agent.json') {` | **ROUGE observé** : 401 au lieu de 200 | `npx vitest run tests/server/serv1-agentcard-public.test.ts --reporter=dot` |
| 11 | SERV1 | En-tête `Retry-After` sur 429 | `src/server/middleware/rate-limit.ts:243` | `- res.setHeader('Retry-After', retryAfter.toString());`<br>`+ if (false) res.setHeader('Retry-After', retryAfter.toString());` | **ROUGE observé** : en-tête absent | `npx vitest run tests/server/serv1-rate-limit-http.test.ts -t "returns 429 with Retry-After" --reporter=dot` |
| 12 | SERV1 | Context Notice interne absent des deltas OpenAI | `src/server/agent-adapter.ts:287` | `- return /Context (Info|Notice|Warning|Critical):\\sYou have used /.test(content);`<br>`+ return false;` | **ROUGE observé** : le delta contient le Context Notice | `npx vitest run tests/server/serv1-openai-stream-notice.test.ts --reporter=dot` |
| 13 | SANDBOX1 | `bwrap` demandé mais inutilisable : refus fail-closed | `src/security/native-sandbox.ts:457` | `- if (want === 'bwrap' && !caps.bwrapUsable) {`<br>`+ if (false && want === 'bwrap' && !caps.bwrapUsable) {` | **ROUGE observé** : refus sans motif `bubblewrap/bwrap` ; 1 failed, 12 skipped | `npx vitest run tests/security/native-sandbox.test.ts -t "refuses rather than falling back when bwrap is requested but unusable" --reporter=dot` |
| 14 | SANDBOX1 | Variable absente : argv/env de spawn inchangés, sans sonde | `src/security/native-sandbox.ts:478` | `- if (!isNativeSandboxEnabled(flagEnv)) {`<br>`+ if (false && !isNativeSandboxEnabled(flagEnv)) {` | **ROUGE observé** : résultat `ok=false` au lieu de `ok=true` | `npx vitest run tests/security/native-sandbox.test.ts -t "returns the original argv unchanged when the variable is absent" --reporter=dot` |
| 15 | IMPROVE1 | Pare-feu : jailbreak dans commentaire HTML | `src/agent/self-improvement/skill-gate.ts:39` | `- const safety = safetyGateSkill(content);`<br>`+ const safety = safetyGateSkill(content.replace(/<!--[\\s\\S]*?-->/g, ''));` | **ROUGE observé** : la proposition devient acceptée au lieu d’être refusée | `npx vitest run tests/agent/self-improvement/skill-gate.test.ts -t "HTML comment" --reporter=dot` |
| 16 | IMPROVE1 | Pare-feu : jailbreak réparti sur plusieurs lignes | `src/agent/self-improvement/skill-gate.ts:39` | `- const safety = safetyGateSkill(content);`<br>`+ const safety = safetyGateSkill(content.replace(/\\n/g, ''));` | **ROUGE observé** : la proposition devient acceptée au lieu d’être refusée | `npx vitest run tests/agent/self-improvement/skill-gate.test.ts -t "split across lines" --reporter=dot` |
| 17 | IMPROVE1 | Vue du proposeur redacted : held-out invisibles | `src/agent/self-improvement/tool-proposer.ts:27` | `- visibleCases: scenario.visibleCases,`<br>`+ visibleCases: scenario.heldOutCases,` | **ROUGE observé** : la vérification d’invisibilité trouve 0 needle held-out | `npx vitest run tests/agent/self-improvement/llm-tool-proposer.test.ts -t "held-out cases never reach the model" --reporter=dot` |
| 18 | IMPROVE1 | G4 doit conserver un cas avec une séquence d’espaces | `src/agent/self-improvement/tool-benchmark.ts:26` | `- { input: { text: 'Hello  World' }, expectIncludes: ['hello-world'] },`<br>`+ { input: { text: 'Hello World' }, expectIncludes: ['hello-world'] },` | **ROUGE observé** : le seed n’a plus de run d’espaces | `npx vitest run tests/agent/self-improvement/tool-gate.test.ts -t "run-of-spaces" --reporter=dot` |
| 19 | TAUTFIX1 | Réponse LLM relationnelle dangereuse réparée avant diffusion | `src/companion/proactive-engine.ts:380` | `- line = guardedLine.response;`<br>`+ line = line;` | **ROUGE observé** : l’énoncé dangereux est diffusé | `npx vitest run tests/companion/proactive-engine.test.ts -t "gates an unsafe LLM refinement" --reporter=dot` |
| 20 | TAUTFIX1 | Succès impossible sans fichier modifié refusé | `src/commands/handlers/batch-handlers.ts:354` | `- if (value.success && value.filesChanged && value.filesChanged.length === 0) {`<br>`+ if (false && value.success && value.filesChanged && value.filesChanged.length === 0) {` | **ROUGE observé** : `success=true` reste exposé | `npx vitest run tests/commands/gk34-batch.test.ts -t "a spawn that changes no files" --reporter=dot` |
| 21 | TAUTFIX1 | Thème courant marqué dans le rendu CLI | `src/commands/handlers/ui-handlers.ts:28` | `- const marker = isCurrent ? "▶" : " ";`<br>`+ const marker = isCurrent ? " " : " ";` | **ROUGE observé** : `▶ Dark` absent | `npx vitest run tests/unit/config-command.test.ts -t "should mark current theme" --reporter=dot` |
| 22 | PRIV1 | Motif ajouté : chemin HOME auteur | `tests/security/donnees-personnelles.test.ts:29` | `- const CHEMIN_HOME_AUTEUR = ['/', 'home', '/', 'pat', 'rice'].join('');`<br>`+ const CHEMIN_HOME_AUTEUR = ['/', 'home', '/', 'pat', 'x'].join('');` | **VERT = trouvaille** : 1/1 ; aucun fixture suivi n’exerce ce motif séparément | `npx vitest run tests/security/donnees-personnelles.test.ts --reporter=dot` |
| 23 | PRIV1 | Motif ajouté : chemin Windows avec slash | `tests/security/donnees-personnelles.test.ts:30` | `- const CHEMIN_USERS_WIN = ['c:/users/', 'patri'].join('');`<br>`+ const CHEMIN_USERS_WIN = ['c:/users/', 'patr-x'].join('');` | **VERT = trouvaille** : 1/1 ; aucun fixture suivi n’exerce ce motif séparément | `npx vitest run tests/security/donnees-personnelles.test.ts --reporter=dot` |
| 24 | PRIV1 | Motif ajouté : chemin Windows avec antislash | `tests/security/donnees-personnelles.test.ts:31` | `- const CHEMIN_USERS_WIN_BSLASH = ['c:\\users\\', 'patri'].join('');`<br>`+ const CHEMIN_USERS_WIN_BSLASH = ['c:\\users\\', 'patr-x'].join('');` | **VERT = trouvaille** : 1/1 ; aucun fixture suivi n’exerce ce motif séparément | `npx vitest run tests/security/donnees-personnelles.test.ts --reporter=dot` |
| 25 | PRIV1 | Motif ajouté : dépôt privé de passation | `tests/security/donnees-personnelles.test.ts:32` | `- const DEPOT_PASSATION = ['claude', '-et-', 'patrice'].join('');`<br>`+ const DEPOT_PASSATION = ['claude', '-et-', 'patr-x'].join('');` | **VERT = trouvaille** : 1/1 ; aucun fixture suivi n’exerce ce motif séparément | `npx vitest run tests/security/donnees-personnelles.test.ts --reporter=dot` |
| 26 | PRIV1 | Motif ajouté : ancien moteur d’exploration privé | `tests/security/donnees-personnelles.test.ts:33` | `- const MOTEUR_EXPLORER_PRIVE = ['gitnexus', '-rs'].join('');`<br>`+ const MOTEUR_EXPLORER_PRIVE = ['gitnexus', '-x'].join('');` | **VERT = trouvaille** : 1/1 ; aucun fixture suivi n’exerce ce motif séparément | `npx vitest run tests/security/donnees-personnelles.test.ts --reporter=dot` |
| 27 | PRIV1 | Motif ajouté : outil éditorial privé | `tests/security/donnees-personnelles.test.ts:34` | `- const OUTIL_EDITORIAL_PRIVE = ['pub', 'commander'].join('');`<br>`+ const OUTIL_EDITORIAL_PRIVE = ['pub', 'command-x'].join('');` | **VERT = trouvaille** : 1/1 ; aucun fixture suivi n’exerce ce motif séparément | `npx vitest run tests/security/donnees-personnelles.test.ts --reporter=dot` |

## Trouvailles

### F1 — FIFO DELEG1 non discriminée

La mutation `waiters.shift()` → `waiters.pop()` reste verte. Le scénario ne met
qu’un seul waiter en attente derrière les deux créneaux actifs ; FIFO et LIFO
produisent donc le même ordre. Il manque au moins deux enfants en attente, avec
une assertion sur l’ordre de prise des créneaux.

### F2 — Les six motifs PRIV1 ne sont pas couverts individuellement

Chaque mutation du motif concerné reste verte (1/1). Le garde-fou balaie un
corpus actuellement propre, mais aucun test n’injecte un témoin par motif dans
un fichier suivi. Une suppression ou une faute de frappe dans l’un de ces six
motifs pourrait donc passer tant que le dépôt ne contient pas déjà la fuite.

Ces six VERT sont des trouvailles de couverture, pas des réparations. Le test
principal reste valide après restauration de chaque ligne.

## Contrats qui tiennent

Les 20 autres mutations ont rougi sur le test ciblé : annulation DELEG1 active
et au démarrage, budget, attribution ; les sept contrats SERV1 ; les deux
portes SANDBOX1 ; les quatre contrats IMPROVE1 ; et les trois tests TAUTFIX1.
Le témoin complet avant et après les mutations est resté vert : 14 fichiers,
173 tests.

## Journal

* Rapport et réservation préparés avant inspection.
* HOME de test : `_qa/verif2/home`, avec `TMPDIR` sous ce même répertoire.
* Préfixe effectivement utilisé pour les tests :
  `HOME="$PWD/_qa/verif2/home" TMPDIR="$PWD/_qa/verif2/home/tmp"`.
* 27 mutations exécutées isolément ; chaque fichier muté a été restauré par
  `git checkout -- <fichier>` avant la mutation suivante.
* Aucun code de production ni test n’est conservé muté ; aucun push, service,
  API payante ou écriture dans le dépôt original.
* Commit documentaire de preuve : `21986501b`.

## Vérifications finales

| Commande | Résultat |
|---|---|
| `npx vitest run tests/agent/delegation/thread-delegation.test.ts tests/server/serv1-openai-completions-errors.test.ts tests/server/serv1-a2a-failed-status.test.ts tests/server/serv1-agentcard-public.test.ts tests/server/serv1-rate-limit-http.test.ts tests/server/serv1-openai-stream-notice.test.ts tests/security/native-sandbox.test.ts tests/agent/self-improvement/tool-gate.test.ts tests/agent/self-improvement/skill-gate.test.ts tests/agent/self-improvement/llm-tool-proposer.test.ts tests/commands/improve-skills-curation.test.ts tests/companion/proactive-engine.test.ts tests/commands/gk34-batch.test.ts tests/unit/config-command.test.ts tests/security/donnees-personnelles.test.ts --run` | **14 fichiers / 173 tests verts** avec HOME/TMPDIR temporaires |
| `npx vitest run tests/security/donnees-personnelles.test.ts` | **1/1 vert** après restauration et rédaction du rapport |
| `npx tsc --noEmit -p .` | **code 0** |
| `git diff --check` | **code 0** |
| `git status --short --branch` | source restaurée et fichiers documentaires commités ; seul `node_modules` non-suivi préexistant demeure |

## Bilan

1. 27 mutations ciblées sur DELEG1, SERV1, SANDBOX1, IMPROVE1, TAUTFIX1 et PRIV1.
2. 20 ROUGE observés : annulation, budget, attribution, serveur, sandbox, amélioration et trois tests tautologiques.
3. FIFO : mutation `shift→pop` verte ; le test ne garde qu’un waiter, trouvaille F1.
4. PRIV1 : six motifs mutés séparément, tous verts 1/1 ; couverture corpus-only, trouvaille F2.
5. Témoin ciblé : commande Vitest union, 14 fichiers / 173 tests verts après les restaurations.
6. Privacy : commande Vitest dédiée, 1/1 vert après chaque restauration.
7. Chaque diff source a été suivi d’un `git checkout -- <fichier>` ; aucune réparation conservée.
8. HOME et TMPDIR : `_qa/verif2/home` dans le clone, ajouté à `.gitignore`.
9. Ouvert : ajouter un test FIFO avec plusieurs waiters et des fixtures PRIV1 par motif.
10. Ouvert : le HEAD observé était `fc723c305`, différent du HEAD annoncé `94066f856`; aucun push effectué.

# Réparation MCPFIX1

Rapport créé avant toute inspection du dépôt, conformément à la mission.

## État initial

Rapport créé avant toute inspection du dépôt, puis chantier réservé dans
`docs/FABLE5-CODEX-COORDINATION.md`. Le clone était au commit demandé
`eea6a6ebb326775aefc51079f9be10b793d231eb`, sur la branche source
`codex/audit-systeme-nerveux-2026-09-01`; la branche dédiée
`fix/mcpfix1-tests-dormants-2026-09-03` a ensuite été créée.

Le seul état sale antérieur au chantier était `node_modules` non suivi. La
validation finale utilise `HOME`, `XDG_CONFIG_HOME` et `TMPDIR` directement
sous `$PWD/.mcpfix1/`, dont `realpath` confirme qu'il est dans le clone. Ces
répertoires temporaires ont été supprimés après les tests.

### Témoin rouge complet

Commande (code de sortie 1) :

```text
npx vitest run tests/mcp/mcp-agent-server.test.ts tests/mcp/client.test.ts

 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03

 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 10 failed) 78ms
       × should send message to agent and return response 4ms
       × should handle errors gracefully 1ms
       × should process simple task directly 1ms
       × should use executePlan for complex tasks 1ms
       × should handle errors gracefully 1ms
       × should create plan without executing 2ms
       × should initialize agent on first agent tool call 1ms
       × should throw when no API key is set 2ms
       × should serialize concurrent agent calls 1ms
       × should dispose agent on stop 2ms
 ❯ tests/mcp/client.test.ts (54 tests | 2 failed) 1001ms
       × should write servers to config file 5ms
       × should create directory if it does not exist 1ms

⎯⎯⎯⎯⎯⎯ Failed Tests 12 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/mcp/client.test.ts > MCPClient > saveConfig > should write servers to config file
Error: Failed to save MCP configuration. Error: [vitest] No "openSync" export is defined on the "fs" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

 ❯ MCPClient.saveConfig src/mcp/mcp-client.ts:118:13
    116|     } catch (error) {
    117|       logger.error(`Failed to save MCP config to ${this.configPath}: $…
    118|       throw new Error(`Failed to save MCP configuration. Error: ${getE…
       |             ^
    119|     }
    120|   }
 ❯ tests/mcp/client.test.ts:697:14

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/12]⎯

 FAIL  tests/mcp/client.test.ts > MCPClient > saveConfig > should create directory if it does not exist
Error: Failed to save MCP configuration. Error: [vitest] No "openSync" export is defined on the "fs" mock. Did you forget to return it from "vi.mock"?
If you need to partially mock a module, you can use "importOriginal" helper inside:

 ❯ MCPClient.saveConfig src/mcp/mcp-client.ts:118:13
    116|     } catch (error) {
    117|       logger.error(`Failed to save MCP config to ${this.configPath}: $…
    118|       throw new Error(`Failed to save MCP configuration. Error: ${getE…
       |             ^
    119|     }
    120|   }
 ❯ tests/mcp/client.test.ts:708:14

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_chat handler > should send message to agent and return response
AssertionError: expected 'Agent chat error: __vite_ssr_import_1…' to contain 'Hello from agent'

Expected: "Hello from agent"
Received: "Agent chat error: __vite_ssr_import_12__.ConfirmationService.getInstance(...).setMcpApprovalBridge is not a function"

 ❯ tests/mcp/mcp-agent-server.test.ts:352:38
    350|
    351|       expect(result.content).toBeDefined();
    352|       expect(result.content[0].text).toContain('Hello from agent');
       |                                      ^
    353|     });
    354|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_chat handler > should handle errors gracefully
AssertionError: expected 'Agent chat error: __vite_ssr_import_1…' to contain 'API down'

Expected: "API down"
Received: "Agent chat error: __vite_ssr_import_12__.ConfirmationService.getInstance(...).setMcpApprovalBridge is not a function"

 ❯ tests/mcp/mcp-agent-server.test.ts:361:38
    359|
    360|       expect(result.isError).toBe(true);
    361|       expect(result.content[0].text).toContain('API down');
       |                                      ^
    362|     });
    363|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_task handler > should process simple task directly
AssertionError: expected 'Agent task error: __vite_ssr_import_1…' to contain 'Hello from agent'

Expected: "Hello from agent"
Received: "Agent task error: __vite_ssr_import_12__.ConfirmationService.getInstance(...).setMcpApprovalBridge is not a function"

 ❯ tests/mcp/mcp-agent-server.test.ts:372:38
    370|
    371|       expect(result.content).toBeDefined();
    372|       expect(result.content[0].text).toContain('Hello from agent');
       |                                      ^
    373|     });
    374|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_task handler > should use executePlan for complex tasks
AssertionError: expected 'Agent task error: __vite_ssr_import_1…' to contain 'Plan executed'

Expected: "Plan executed"
Received: "Agent task error: __vite_ssr_import_12__.ConfirmationService.getInstance(...).setMcpApprovalBridge is not a function"

 ❯ tests/mcp/mcp-agent-server.test.ts:381:38
    379|
    380|       expect(result.content).toBeDefined();
    381|       expect(result.content[0].text).toContain('Plan executed');
       |                                      ^
    382|     });
    383|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_task handler > should handle errors gracefully
AssertionError: expected 'Agent task error: __vite_ssr_import_1…' to contain 'Agent error'

Expected: "Agent error"
Received: "Agent task error: __vite_ssr_import_12__.ConfirmationService.getInstance(...).setMcpApprovalBridge is not a function"

 ❯ tests/mcp/mcp-agent-server.test.ts:390:38
    388|
    389|       expect(result.isError).toBe(true);
    390|       expect(result.content[0].text).toContain('Agent error');
       |                                      ^
    391|     });
    392|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_plan handler > should create plan without executing
AssertionError: expected "vi.fn()" to be called at least once
 ❯ tests/mcp/mcp-agent-server.test.ts:400:38
    398|
    399|       expect(result.content).toBeDefined();
    400|       expect(mockProcessUserMessage).toHaveBeenCalled();
       |                                      ^
    401|     });
    402|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent lazy initialization > should initialize agent on first agent tool call
AssertionError: expected "vi.fn()" to be called at least once
 ❯ tests/mcp/mcp-agent-server.test.ts:653:30
    651|       await handler({ message: 'test' });
    652|
    653|       expect(CodeBuddyAgent).toHaveBeenCalled();
       |                              ^
    654|       expect(CodeBuddyAgent.mock.calls[0][0]).toBe('test-key-123');
    655|     });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent lazy initialization > should throw when no API key is set
AssertionError: expected 'Agent chat error: __vite_ssr_import_1…' to contain 'No API key found'

Expected: "No API key found"
Received: "Agent chat error: __vite_ssr_import_12__.ConfirmationService.getInstance(...).setMcpApprovalBridge is not a function"

 ❯ tests/mcp/mcp-agent-server.test.ts:670:38
    668|
    669|       expect(result.isError).toBe(true);
    670|       expect(result.content[0].text).toContain('No API key found');
       |                                      ^
    671|
    672|       // Restore for other tests

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > concurrency lock > should serialize concurrent agent calls
AssertionError: expected 'Agent chat error: __vite_ssr_import_1…' to contain 'Response'

Expected: "Response"
Received: "Agent chat error: __vite_ssr_import_12__.ConfirmationService.getInstance(...).setMcpApprovalBridge is not a function"

 ❯ tests/mcp/mcp-agent-server.test.ts:704:39
    702|
    703|       // Both should succeed
    704|       expect(result1.content[0].text).toContain('Response');
       |                                       ^
    705|       expect(result2.content[0].text).toContain('Response');
    706|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/12]⎯

 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > server lifecycle with agent > should dispose agent on stop
TypeError: ConfirmationService.getInstance(...).setMcpApprovalBridge is not a function
 ❯ CodeBuddyMCPServer.setupApprovalBridge src/mcp/mcp-server.ts:476:39
    474|
    475|   setupApprovalBridge(): void {
    476|     ConfirmationService.getInstance().setMcpApprovalBridge(
       |                                       ^
    477|       createMcpApprovalBridge(this.mcpServer, { cwd: this.workingDirec…
    478|     );
 ❯ CodeBuddyMCPServer.start src/mcp/mcp-server.ts:615:10
 ❯ tests/mcp/mcp-agent-server.test.ts:769:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/12]⎯

 Test Files  2 failed (2)
      Tests  12 failed | 104 passed (116)
   Start at  18:27:34
   Duration  1.25s (transform 264ms, setup 31ms, import 345ms, tests 1.08s, environment 0ms)
```

Le compteur historique communiqué était `12 failed | 99 passed (111)`. À
`eea6a6ebb`, les deux fichiers contiennent désormais 116 cas collectés ; le
nombre de rouges reste exactement douze.

## Diagnostic et réparations

### Cause commune et contrat réel

Le commit `10c523174` a remplacé l'ancien auto-approve MCP par un pont
d'approbation structuré. `ensureWriteAccess()` appelle donc
`setupApprovalBridge()` (`src/mcp/mcp-server.ts:475-488`) et le démarrage/le
teardown posent puis retirent ce pont (`:613-624`). Le vrai singleton expose
`setMcpApprovalBridge()` (`src/utils/confirmation-service.ts:152-155`) et sa
surface est couverte par les tests dédiés sous `tests/server/mcp/`. Le mock de
`mcp-agent-server.test.ts`, resté au contrat antérieur, n'exposait pas cette
méthode : il cassait les dix scénarios avant qu'ils n'atteignent la conduite
qu'ils prétendaient tester.

Le merge MEM1 `e61e8c758` a remplacé l'écriture directe de `saveConfig()` par
`writeJsonAtomicSync()` (`src/mcp/mcp-client.ts:108-118`). Le contrat réel est
désormais : création du répertoire, fichier temporaire voisin, écriture sur
descripteur, `fsync`, `rename`, `fsync` du répertoire et mode `0600`
(`src/utils/atomic-write.ts:135-193`). Le mock `fs` ne proposait que l'ancien
`writeFileSync(path, data)` et les deux attentes observaient donc une API qui
n'existe plus.

### Verdict explicite des douze cas

| # | Test rouge | Verdict et justification par le code | Mise à niveau non tautologique |
|---:|---|---|---|
| 1 | `agent_chat` — réponse | **Le test a tort.** Le produit atteint `processUserMessage(args.message)` puis formate sa réponse (`mcp-agent-tools.ts:83-91`); seul le mock de confirmation incomplet l'arrêtait. | Mock aligné sur `setMcpApprovalBridge`; assertion ajoutée sur l'argument exact `Hello`. |
| 2 | `agent_chat` — erreur | **Le test a tort.** Le `catch` conserve bien le message et pose `isError` (`mcp-agent-tools.ts:93-98`). | Même mock réaligné; l'assertion existante sur `API down` reste stricte. |
| 3 | `agent_task` simple | **Le test a tort.** La branche `needsOrchestration=false` appelle bien `processUserMessage(args.task)` (`mcp-agent-tools.ts:120-125`). | Assertions sur la décision d'orchestration et la tâche exacte `read a file`. |
| 4 | `agent_task` complexe | **Le test a tort.** La branche vraie appelle `executePlan(args.task)` (`mcp-agent-tools.ts:121-123`). | Assertion sur l'argument exact `refactor the entire module`. |
| 5 | `agent_task` — erreur | **Le test a tort.** Le `catch` renvoie bien `Agent task error` avec le message causal et `isError` (`mcp-agent-tools.ts:131-136`). | Mock réaligné; l'assertion existante sur `Agent error` demeure discriminante. |
| 6 | `agent_plan` | **Le test a tort.** Le code force `agentMode='plan'` puis transmet la tâche (`mcp-agent-tools.ts:148-154`). | Assertions sur la réponse, la tâche exacte et le mode `plan`; l'ancien simple « appelé » a été durci. |
| 7 | initialisation au premier appel | **Le test a tort.** `ensureAgent()` est bien paresseux, résout la clé puis construit l'agent à la première demande (`mcp-server.ts:491-515`). | Assertion existante conservée sur l'appel et la clé exacte; seul le mock du pont est complété. |
| 8 | refus sans clé | **Le test a tort.** La garde `if (!apiKey)` échoue avec un message explicite avant construction (`mcp-server.ts:496-504`). | Assertions existantes `isError` et `No API key found` conservées. |
| 9 | sérialisation concurrente | **Le test a tort.** `withLock()` chaîne chaque travail au verrou précédent (`mcp-agent-tools.ts:19-24`). | L'ordre observable `1,10,2,20` reste exigé; aucun délai ni assertion relâché. |
| 10 | disposal à l'arrêt | **Le test a tort.** `stop()` dispose l'agent avant fermeture du transport (`mcp-server.ts:621-638`). | Assertion existante sur `dispose()` conservée; le mock accepte désormais le cycle réel du pont. |
| 11 | sauvegarde des serveurs | **Le test a tort.** `saveConfig()` délègue à l'écriture atomique, qui écrit via descripteur puis renomme (`mcp-client.ts:115`; `atomic-write.ts:141-161`). | Le mock expose toute la surface atomique; assertions sur JSON exact, tmp→cible et mode `0600`. |
| 12 | création du répertoire | **Le test a tort.** Le répertoire et même la liste vide font partie du contrat atomique (`mcp-client.ts:109-115`; `atomic-write.ts:141-148`). | Le cas vide exige désormais création, JSON exact et rename final; une sauvegarde conditionnée à une liste non vide le fait rougir. |

Bilan de décision : **0 « test avait raison » ; 12 « test avait tort »**. Aucun
fichier sous `src/mcp/` ou `src/server/mcp/` n'est modifié par la réparation.
Les changements permanents portent uniquement sur les deux harnais de test.

### Essais intermédiaires rejetés comme preuves

- Premier rejeu après ajout d'un mock nommé : suite agent non collectée,
  `ReferenceError: Cannot access 'mockSetMcpApprovalBridge' before initialization`
  (levée de `vi.mock`). Le mock est désormais local à la factory.
- Première commande de mutation du cas 2 avec un filtre contenant les `>`
  d'affichage : `62 skipped`, zéro test exécuté. Cette sortie n'est pas comptée;
  le cycle a été rejoué avec le nom interne et donne bien 1 vert / 1 rouge / 1 vert.

## Preuves de sensibilité par mutation

Toutes les commandes ci-dessous utilisent les mêmes variables confinées que le
témoin initial. Chaque mutation est un patch d'une ligne, immédiatement annulé
par le patch inverse avant le troisième lancement. `git diff` confirme ensuite
zéro modification dans les trois fichiers de production mutés.

#### 1. `agent_chat` transmet le message

Mutation : `processUserMessage(args.message)` → `processUserMessage('')`.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  772ms (transform 401ms, setup 20ms, import 320ms, tests 264ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 161ms
       × should send message to agent and return response 159ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_chat handler > should send message to agent and return response
AssertionError: expected "vi.fn()" to be called with arguments: [ 'Hello' ]
Received:
  1st vi.fn() call:
  [
-   "Hello",
+   "",
  ]
Number of calls: 1
 ❯ tests/mcp/mcp-agent-server.test.ts:354:38
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  1.01s (transform 732ms, setup 38ms, import 718ms, tests 161ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  919ms (transform 491ms, setup 26ms, import 303ms, tests 375ms, environment 0ms)
```

#### 2. `agent_chat` conserve l'erreur causale

Mutation : réponse d'erreur avec `${message}` → texte fixe sans cause.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  1.29s (transform 784ms, setup 78ms, import 659ms, tests 334ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 95ms
       × should handle errors gracefully 94ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_chat handler > should handle errors gracefully
AssertionError: expected 'Agent chat error' to contain 'API down'
Expected: "API down"
Received: "Agent chat error"
 ❯ tests/mcp/mcp-agent-server.test.ts:363:38
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  1.18s (transform 789ms, setup 141ms, import 777ms, tests 95ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  1.01s (transform 503ms, setup 90ms, import 472ms, tests 92ms, environment 0ms)
```

#### 3. `agent_task` transmet une tâche simple

Mutation : branche simple `processUserMessage(args.task)` → chaîne vide.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  986ms (transform 740ms, setup 49ms, import 773ms, tests 85ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 269ms
       × should process simple task directly 258ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_task handler > should process simple task directly
AssertionError: expected "vi.fn()" to be called with arguments: [ 'read a file' ]
Received:
  1st vi.fn() call:
  [
-   "read a file",
+   "",
  ]
Number of calls: 1
 ❯ tests/mcp/mcp-agent-server.test.ts:376:38
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  726ms (transform 355ms, setup 41ms, import 250ms, tests 269ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  986ms (transform 546ms, setup 112ms, import 504ms, tests 90ms, environment 0ms)
```

#### 4. `agent_task` transmet la tâche complexe à `executePlan`

Mutation : `executePlan(args.task)` → `executePlan('')`.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  2.53s (transform 349ms, setup 56ms, import 324ms, tests 102ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 105ms
       × should use executePlan for complex tasks 100ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_task handler > should use executePlan for complex tasks
AssertionError: expected "vi.fn()" to be called with arguments: [ 'refactor the entire module' ]
Received:
  1st vi.fn() call:
  [
-   "refactor the entire module",
+   "",
  ]
Number of calls: 1
 ❯ tests/mcp/mcp-agent-server.test.ts:386:31
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  748ms (transform 472ms, setup 26ms, import 475ms, tests 105ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  1.33s (transform 730ms, setup 89ms, import 702ms, tests 174ms, environment 0ms)
```

#### 5. `agent_task` conserve l'erreur causale

Mutation : réponse d'erreur avec `${message}` → texte fixe sans cause.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  786ms (transform 458ms, setup 59ms, import 453ms, tests 82ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 105ms
       × should handle errors gracefully 104ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_task handler > should handle errors gracefully
AssertionError: expected 'Agent task error' to contain 'Agent error'
Expected: "Agent error"
Received: "Agent task error"
 ❯ tests/mcp/mcp-agent-server.test.ts:395:38
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  1.15s (transform 738ms, setup 85ms, import 738ms, tests 105ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  484ms (transform 278ms, setup 39ms, import 241ms, tests 94ms, environment 0ms)
```

#### 6. `agent_plan` transmet la tâche en mode plan

Mutation : `processUserMessage(args.task)` → `processUserMessage('')`.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  377ms (transform 220ms, setup 18ms, import 195ms, tests 89ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 427ms
       × should create plan without executing 424ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent_plan handler > should create plan without executing
AssertionError: expected "vi.fn()" to be called with arguments: [ 'build a feature' ]
Received:
  1st vi.fn() call:
  [
-   "build a feature",
+   "",
  ]
Number of calls: 1
 ❯ tests/mcp/mcp-agent-server.test.ts:406:38
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  801ms (transform 426ms, setup 36ms, import 215ms, tests 427ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  959ms (transform 552ms, setup 25ms, import 412ms, tests 380ms, environment 0ms)
```

#### 7. L'agent paresseux reçoit la clé résolue

Mutation : premier argument `apiKey` du constructeur → chaîne vide.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  805ms (transform 499ms, setup 22ms, import 332ms, tests 359ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 410ms
       × should initialize agent on first agent tool call 408ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent lazy initialization > should initialize agent on first agent tool call
AssertionError: expected '' to be 'test-key-123' // Object.is equality
- Expected
+ Received
- test-key-123
 ❯ tests/mcp/mcp-agent-server.test.ts:661:47
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  1.06s (transform 632ms, setup 32ms, import 469ms, tests 410ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  1.47s (transform 891ms, setup 93ms, import 736ms, tests 312ms, environment 0ms)
```

#### 8. L'initialisation sans clé échoue explicitement

Mutation : `if (!apiKey)` → `if (false)`.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  1.23s (transform 707ms, setup 115ms, import 595ms, tests 234ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 380ms
       × should throw when no API key is set 378ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > agent lazy initialization > should throw when no API key is set
AssertionError: expected undefined to be true // Object.is equality
- Expected:
true
+ Received:
undefined
 ❯ tests/mcp/mcp-agent-server.test.ts:676:30
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  1.69s (transform 958ms, setup 98ms, import 837ms, tests 380ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  1.27s (transform 767ms, setup 70ms, import 527ms, tests 408ms, environment 0ms)
```

#### 9. Les appels concurrents restent sérialisés

Mutation : `const result = agentLock.then(fn, fn)` → `const result = fn()`.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  1.26s (transform 819ms, setup 109ms, import 710ms, tests 296ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 218ms
       × should serialize concurrent agent calls 215ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > concurrency lock > should serialize concurrent agent calls
AssertionError: expected 2 to be greater than 10
 ❯ tests/mcp/mcp-agent-server.test.ts:716:30
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  883ms (transform 496ms, setup 29ms, import 300ms, tests 218ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  691ms (transform 416ms, setup 23ms, import 294ms, tests 210ms, environment 0ms)
```

#### 10. L'arrêt dispose l'agent

Mutation : `this.agent.dispose()` → `void this.agent`.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  770ms (transform 464ms, setup 19ms, import 260ms, tests 276ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/mcp-agent-server.test.ts (62 tests | 1 failed | 61 skipped) 528ms
       × should dispose agent on stop 525ms
 FAIL  tests/mcp/mcp-agent-server.test.ts > MCP Agent Intelligence Layer > server lifecycle with agent > should dispose agent on stop
AssertionError: expected "vi.fn()" to be called at least once
 ❯ tests/mcp/mcp-agent-server.test.ts:779:27
 Test Files  1 failed (1)
      Tests  1 failed | 61 skipped (62)
   Duration  1.17s (transform 556ms, setup 46ms, import 407ms, tests 528ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 61 skipped (62)
   Duration  1.32s (transform 680ms, setup 130ms, import 566ms, tests 505ms, environment 0ms)
```

#### 11. La configuration non vide est écrite atomiquement

Mutation : `{ servers }` → `{ servers: [] }` dans l'appel atomique.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 53 skipped (54)
   Duration  294ms (transform 102ms, setup 17ms, import 116ms, tests 83ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/client.test.ts (54 tests | 1 failed | 53 skipped) 42ms
       × should write servers to config file 40ms
 FAIL  tests/mcp/client.test.ts > MCPClient > saveConfig > should write servers to config file
AssertionError: expected "vi.fn()" to be called with arguments: [ 101, …(1) ]
- Expected
+ Received
- "{\n  \"servers\": [\n    {\n      \"name\": \"test\",\n      \"command\": \"node\",\n      \"args\": [\n        \"server.js\"\n      ]\n    }\n  ]\n}\n"
+ "{\n  \"servers\": []\n}\n"
 ❯ tests/mcp/client.test.ts:705:32
 Test Files  1 failed (1)
      Tests  1 failed | 53 skipped (54)
   Duration  268ms (transform 129ms, setup 17ms, import 130ms, tests 42ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 53 skipped (54)
   Duration  1.01s (transform 210ms, setup 19ms, import 391ms, tests 228ms, environment 0ms)
```

#### 12. La configuration vide crée aussi le répertoire et le fichier

Mutation : appel atomique inconditionnel → appel seulement si
`servers.length > 0`.

```text
VERT INITIAL (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 53 skipped (54)
   Duration  490ms (transform 302ms, setup 32ms, import 331ms, tests 90ms, environment 0ms)

MUTANT ROUGE (exit 1)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 ❯ tests/mcp/client.test.ts (54 tests | 1 failed | 53 skipped) 89ms
       × should create directory if it does not exist 87ms
 FAIL  tests/mcp/client.test.ts > MCPClient > saveConfig > should create directory if it does not exist
AssertionError: expected "vi.fn()" to be called with arguments: [ 101, '{\n  "servers": []\n}\n' ]
Number of calls: 0
 ❯ tests/mcp/client.test.ts:724:32
 Test Files  1 failed (1)
      Tests  1 failed | 53 skipped (54)
   Duration  804ms (transform 516ms, setup 23ms, import 290ms, tests 89ms, environment 0ms)

VERT RESTAURÉ (exit 0)
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03
 Test Files  1 passed (1)
      Tests  1 passed | 53 skipped (54)
   Duration  741ms (transform 169ms, setup 18ms, import 194ms, tests 506ms, environment 0ms)
```

## Vérifications finales

### Incident de confinement et essais non retenus

Le premier chemin choisi, `$PWD/node_modules/.mcpfix1`, semblait local mais
`node_modules` est un lien symbolique vers `~/code-buddy/node_modules`.
Il y a donc eu une écriture temporaire dans ce sous-répertoire de l'original,
en violation de la consigne. Ce répertoire créé par la mission a été supprimé
et `test ! -e ~/code-buddy/node_modules/.mcpfix1` est vert. Aucun
fichier source de l'original n'a été touché. Tous les compteurs retenus
ci-dessous ont ensuite été reproduits avec les trois chemins réels sous
`$PWD/.mcpfix1/`.

Avant cette correction, la suite large a donné successivement `674/677` (le
Chromium attendu n'était pas dans le HOME confiné et deux timeouts WebSocket),
puis `675/677` une fois Chromium disponible. Un lien vers le lanceur Snap a
aussi échoué seul sur une option inconnue, puis le binaire réel sur un socket
TMP trop long. Ces sorties ne sont pas comptées comme validations finales.

### Deux fichiers MCP ciblés

Commande correctement confinée (exit 0) :

```text
HOME="$PWD/.mcpfix1/home" XDG_CONFIG_HOME="$PWD/.mcpfix1/config" TMPDIR="$PWD/.mcpfix1/tmp" npx vitest run tests/mcp/mcp-agent-server.test.ts tests/mcp/client.test.ts

 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03

 Test Files  2 passed (2)
      Tests  116 passed (116)
   Start at  18:48:42
   Duration  1.68s (transform 666ms, setup 95ms, import 520ms, tests 1.64s, environment 0ms)

npm notice
npm notice New minor version of npm available! 11.17.0 -> 11.19.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.19.1
npm notice To update run: npm install -g npm@11.19.1
npm notice
```

### Périmètre MCP + serveur, commande exacte demandée

La commande exacte reste rouge sous la charge parallèle (exit 1) :

```text
HOME="$PWD/.mcpfix1/home" XDG_CONFIG_HOME="$PWD/.mcpfix1/config" TMPDIR="$PWD/.mcpfix1/tmp" npx vitest run tests/mcp tests/server

 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03

 ❯ tests/mcp/gk35-stdio-timeout.test.ts (1 test | 1 failed) 1493ms
     × loads a fast stdio server and late-registers a slow one after the skip 1490ms
 ❯ tests/server/websocket-idle-keepalive.test.ts (2 tests | 1 failed) 5130ms
     × keeps an authenticated receive-only fleet listener alive past idle timeout via ping/pong 5123ms
 ❯ tests/server/websocket-peer-multiplex.test.ts (1 test | 1 failed) 5043ms
     × runs two correlated peer requests concurrently on one connection 5038ms
 ❯ tests/server/cognition-websocket.test.ts (4 tests | 1 failed) 6135ms
     × publishes canonical events and rejects payload-supplied identity fields 3084ms
 ❯ tests/server/websocket-abort.test.ts (8 tests | 2 failed) 7432ms
     × /ws stop aborts a blocked stream without a late chunk or stream_end 3094ms
     × /ws stop aborts a blocked non-streaming turn and releases its lane 3018ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/mcp/gk35-stdio-timeout.test.ts > GK35 real stdio MCP init timeout > loads a fast stdio server and late-registers a slow one after the skip
AssertionError: expected 'connecting' to be 'connected' // Object.is equality

Expected: "connected"
Received: "connecting"

 ❯ tests/mcp/gk35-stdio-timeout.test.ts:54:53
     52|     });
     53|     expect(Date.now() - started).toBeLessThan(900);
     54|     expect(manager.getServerStatus('fast_fixture')).toBe('connected');
       |                                                     ^
     55|     expect(manager.getTools().map((tool) => tool.name)).toEqual(
     56|       expect.arrayContaining(['mcp__fast_fixture__echo_marker']),

 FAIL  tests/server/cognition-websocket.test.ts > cognitive WebSocket bridge > publishes canonical events and rejects payload-supplied identity fields
Error: timed out waiting for cognitive WebSocket event
 ❯ waitUntil tests/server/cognition-websocket.test.ts:28:39
 ❯ waitFor tests/server/cognition-websocket.test.ts:103:5
 ❯ tests/server/cognition-websocket.test.ts:121:23

 FAIL  tests/server/websocket-abort.test.ts > WebSocket turn cancellation > /ws stop aborts a blocked stream without a late chunk or stream_end
Error: timed out waiting for WebSocket condition
 ❯ waitUntil tests/server/websocket-abort.test.ts:91:39
 ❯ tests/server/websocket-abort.test.ts:161:5

 FAIL  tests/server/websocket-abort.test.ts > WebSocket turn cancellation > /ws stop aborts a blocked non-streaming turn and releases its lane
Error: timed out waiting for WebSocket condition
 ❯ waitUntil tests/server/websocket-abort.test.ts:91:39
 ❯ tests/server/websocket-abort.test.ts:180:5

 FAIL  tests/server/websocket-idle-keepalive.test.ts > WebSocket idle keepalive for fleet listeners > keeps an authenticated receive-only fleet listener alive past idle timeout via ping/pong
 FAIL  tests/server/websocket-peer-multiplex.test.ts > WebSocket peer RPC multiplexing > runs two correlated peer requests concurrently on one connection
Error: Fleet listener auth timeout (5000ms)
 ❯ Timeout._onTimeout src/fleet/fleet-listener.ts:358:18

 Test Files  5 failed | 58 passed (63)
      Tests  6 failed | 671 passed (677)
   Start at  18:49:03
   Duration  24.39s (transform 193.13s, setup 3.02s, import 131.61s, tests 225.77s, environment 6ms)
```

Journal brut exact de ce passage (sans les codes couleur ANSI) :

```text
 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03

 ❯ tests/mcp/gk35-stdio-timeout.test.ts (1 test | 1 failed) 1493ms
     × loads a fast stdio server and late-registers a slow one after the skip 1490ms
 ❯ tests/server/websocket-idle-keepalive.test.ts (2 tests | 1 failed) 5130ms
     × keeps an authenticated receive-only fleet listener alive past idle timeout via ping/pong 5123ms
 ❯ tests/server/websocket-peer-multiplex.test.ts (1 test | 1 failed) 5043ms
     × runs two correlated peer requests concurrently on one connection 5038ms
 ❯ tests/server/cognition-websocket.test.ts (4 tests | 1 failed) 6135ms
     × publishes canonical events and rejects payload-supplied identity fields 3084ms
 ❯ tests/server/websocket-abort.test.ts (8 tests | 2 failed) 7432ms
     × /ws stop aborts a blocked stream without a late chunk or stream_end 3094ms
     × /ws stop aborts a blocked non-streaming turn and releases its lane 3018ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/mcp/gk35-stdio-timeout.test.ts > GK35 real stdio MCP init timeout > loads a fast stdio server and late-registers a slow one after the skip
AssertionError: expected 'connecting' to be 'connected' // Object.is equality

Expected: "connected"
Received: "connecting"

 ❯ tests/mcp/gk35-stdio-timeout.test.ts:54:53
     52|     });
     53|     expect(Date.now() - started).toBeLessThan(900);
     54|     expect(manager.getServerStatus('fast_fixture')).toBe('connected');
       |                                                     ^
     55|     expect(manager.getTools().map((tool) => tool.name)).toEqual(
     56|       expect.arrayContaining(['mcp__fast_fixture__echo_marker']),

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  tests/server/cognition-websocket.test.ts > cognitive WebSocket bridge > publishes canonical events and rejects payload-supplied identity fields
Error: timed out waiting for cognitive WebSocket event
 ❯ waitUntil tests/server/cognition-websocket.test.ts:28:39
     26|   const deadline = Date.now() + timeoutMs;
     27|   while (!predicate()) {
     28|     if (Date.now() >= deadline) throw new Error('timed out waiting for…
       |                                       ^
     29|     await new Promise<void>((resolve) => setTimeout(resolve, 10));
     30|   }
 ❯ waitFor tests/server/cognition-websocket.test.ts:103:5
 ❯ tests/server/cognition-websocket.test.ts:121:23

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  tests/server/websocket-abort.test.ts > WebSocket turn cancellation > /ws stop aborts a blocked stream without a late chunk or stream_end
Error: timed out waiting for WebSocket condition
 ❯ waitUntil tests/server/websocket-abort.test.ts:91:39
     89|   const deadline = Date.now() + timeoutMs;
     90|   while (!predicate()) {
     91|     if (Date.now() >= deadline) throw new Error('timed out waiting for…
       |                                       ^
     92|     await new Promise<void>((resolve) => setTimeout(resolve, 10));
     93|   }
 ❯ tests/server/websocket-abort.test.ts:161:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  tests/server/websocket-abort.test.ts > WebSocket turn cancellation > /ws stop aborts a blocked non-streaming turn and releases its lane
Error: timed out waiting for WebSocket condition
 ❯ waitUntil tests/server/websocket-abort.test.ts:91:39
     89|   const deadline = Date.now() + timeoutMs;
     90|   while (!predicate()) {
     91|     if (Date.now() >= deadline) throw new Error('timed out waiting for…
       |                                       ^
     92|     await new Promise<void>((resolve) => setTimeout(resolve, 10));
     93|   }
 ❯ tests/server/websocket-abort.test.ts:180:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  tests/server/websocket-idle-keepalive.test.ts > WebSocket idle keepalive for fleet listeners > keeps an authenticated receive-only fleet listener alive past idle timeout via ping/pong
 FAIL  tests/server/websocket-peer-multiplex.test.ts > WebSocket peer RPC multiplexing > runs two correlated peer requests concurrently on one connection
Error: Fleet listener auth timeout (5000ms)
 ❯ Timeout._onTimeout src/fleet/fleet-listener.ts:358:18
    356|       this.once('__internal:auth-sent', () => {
    357|         authTimer = setTimeout(() => {
    358|           settle(new Error(`Fleet listener auth timeout (${this.option…
       |                  ^
    359|           try {
    360|             this.ws?.close();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

 Test Files  5 failed | 58 passed (63)
      Tests  6 failed | 671 passed (677)
   Start at  18:49:03
   Duration  24.39s (transform 193.13s, setup 3.02s, import 131.61s, tests 225.77s, environment 6ms)
```

Le même périmètre, avec un worker pour retirer la contention, est entièrement
vert (exit 0) :

```text
HOME="$PWD/.mcpfix1/home" XDG_CONFIG_HOME="$PWD/.mcpfix1/config" TMPDIR="$PWD/.mcpfix1/tmp" npx vitest run tests/mcp tests/server --maxWorkers=1

 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03

 Test Files  63 passed (63)
      Tests  677 passed (677)
   Start at  18:49:35
   Duration  70.83s (transform 13.63s, setup 776ms, import 18.27s, tests 39.59s, environment 5ms)
```

Le fichier WebSocket d'abord rouge sous charge avait aussi été rejoué seul :
`tests/server/websocket-abort.test.ts`, `8 passed (8)`, exit 0. Les six rouges
de la commande exacte sont donc classés comme sensibilité temporelle à la
contention, pas comme échecs laissés par MCPFIX1. La commande exacte demandée
n'est néanmoins pas annoncée verte.

### Données personnelles

Commande correctement confinée (exit 0) :

```text
HOME="$PWD/.mcpfix1/home" XDG_CONFIG_HOME="$PWD/.mcpfix1/config" TMPDIR="$PWD/.mcpfix1/tmp" npx vitest run tests/security/donnees-personnelles.test.ts

 RUN  v4.1.9 ~/DEV/cb-mcpfix1-2026-09-03

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  18:48:42
   Duration  16.01s (transform 66ms, setup 71ms, import 16ms, tests 15.51s, environment 0ms)

npm notice
npm notice New minor version of npm available! 11.17.0 -> 11.19.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.19.1
npm notice To update run: npm install -g npm@11.19.1
npm notice
```

### TypeScript, ESLint et diff

```text
npx tsc --noEmit -p .
(exit 0, aucune sortie)

npx eslint tests/mcp/client.test.ts tests/mcp/mcp-agent-server.test.ts --max-warnings=0
(exit 0, aucune sortie)

git diff --check
(exit 0, aucune sortie)

git diff -- src/mcp/mcp-agent-tools.ts src/mcp/mcp-server.ts src/mcp/mcp-client.ts src/server/mcp
(exit 0, aucune sortie : aucun mutant ni changement de production restant)
```

Le premier passage ESLint avait échoué avec 14 avertissements préexistants
rendus bloquants par `--max-warnings=0` : deux imports de types inutilisés,
cinq `any` dans `client.test.ts` et sept usages du type global `Function` dans
`mcp-agent-server.test.ts`. Les types du harnais ont été explicités, puis la
commande ci-dessus a été rejouée verte. Les deux tests MCP ont enfin été
rejoués après ce nettoyage : `116 passed (116)`, exit 0.

## Livraison

- Branche : `fix/mcpfix1-tests-dormants-2026-09-03`.
- Base reproduite : `eea6a6ebb326775aefc51079f9be10b793d231eb`.
- Correctif des deux harnais : `e9af28f0b` (`test(mcp): align dormant suites
  with current contracts`).
- Aucun push, appel payant ou service modifié.
- `node_modules` reste le seul non-suivi antérieur au chantier.

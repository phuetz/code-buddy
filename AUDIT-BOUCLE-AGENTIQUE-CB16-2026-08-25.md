# CB16 — Audit de la boucle agentique

Date : 2026-08-25

Dépôt : `/home/patrice/code-buddy`

Branche partagée observée : `audit/cb7-complacent-tests-2026-08-25`

Périmètre principal : `src/agent/execution/agent-executor.ts`

## Verdict

La fusion annoncée est réelle : `processUserMessage()` et
`processUserMessageStream()` passent tous deux par `runMeasuredTurn()`, puis par
un unique `runTurnLoop()` (`agent-executor.ts:930-960`, `1017-1038`,
`1042-1079`, `1094`). Il n'existe plus deux implémentations de la boucle à
maintenir en parallèle.

Cette unicité n'empêchait toutefois pas les pertes aux frontières. Six défauts
ont été reproduits et corrigés : question `ask_user` perdue en séquentiel,
double comptage du coût, plafond d'auto-observations remis à zéro à chaque tour
d'outil, contexte JIT calculé puis jeté, fuite de marqueurs de contrôle coupés
entre deux chunks, et motif d'arrêt `maxToolRounds` absent du résultat
séquentiel. Un septième défaut budgétaire a été reproduit mais laissé ouvert,
car sa correction change la politique de budget : le pré-contrôle d'un tour
ultérieur ne reçoit pas la somme des entrées facturées jusque-là.

## 1. Traitements réellement appliqués à chaque appel fournisseur

| Traitement | Emplacement autoritatif | Dupliqué entre API ? | Reçu en séquentiel ? |
|---|---|---|---|
| Middlewares `beforeTurn` | `runTurnLoop`, `agent-executor.ts:1300-1333` | Non | Oui, mêmes effets; les seuls messages `content` restent non durables sauf cas matérialisés |
| Contexte initial | `injectInitialContext()` appelé à `agent-executor.ts:1383-1407` | Non | Oui |
| Contexte des tours suivants | `injectNextRoundContext()` appelé à `agent-executor.ts:1408-1414` | Non | Oui |
| Leçons | Tour 0 si le classifieur les active, `context-pipeline.ts:291-299`; tours suivants si non isolés, `450-464` | Non | Oui |
| Todo | Tour 0 si activé, `context-pipeline.ts:397-403`; tours suivants si non isolés, `493-499` | Non | Oui |
| Contexte JIT découvert après outil | Collecté à `agent-executor.ts:1980`, réinjecté à `1381` depuis le correctif CB16 | Non | Oui |
| Amincissement, compaction et réparation du transcript | `prepareTurnMessages()` à `agent-executor.ts:1463`; réparation conditionnelle à `context-pipeline.ts:148-173` | Non entre API; le même helper est aussi réutilisé par les deux sites de compaction en place (`agent-executor.ts:1314`, `1784`) | Oui |
| Sanitisation du texte assistant conservé | `sanitizeAssistantOutput()` à `agent-executor.ts:1646` | Non entre API | Oui |
| Sanitisation incrémentale affichée | `StreamingHandler.sanitizeStreamingDelta()`, `streaming-handler.ts:542-607`, puis flush à `agent-executor.ts:1592` | C'est une seconde barrière, propre à l'affichage, pas une seconde boucle | Sans objet pour le collecteur; le texte final conservé est assaini |
| Sanitisation des observations d'outils | `sanitizeToolResult()` à `agent-executor.ts:2094-2095` | Non | Oui pour la vue modèle; l'entrée d'affichage suit son contrat propre |
| Middlewares `afterTurn` | `agent-executor.ts:2244-2258` | Non | Oui, mêmes décisions |
| Signaux terminate / shell / plan / yield | Détection sur le résultat brut de l'outil, `agent-executor.ts:2146-2189` | Non | Oui pour le contrôle de boucle; `ask_user` est désormais matérialisé |
| Enregistrement du coût | Fermeture idempotente `recordTurnCost()`, `agent-executor.ts:1254-1262`, appelée en fin normale et en `finally` (`2343`, `2421`) | Non | Oui, exactement une fois |
| Fin de plafond | `agent-executor.ts:2336-2340` | Non | Oui depuis CB16 : entrée assistant durable + événement streaming |

Nuances par rapport à `CLAUDE.md` :

- les balises réelles sont `<context type="lessons">` et
  `<context type="todo">`, pas `<lessons_context>` / `<todo_context>` ;
- « chaque tour » n'est pas absolu : au tour 0 les blocs sont pilotés par le
  classifieur et omis s'ils sont vides; les hôtes HTTP partagés isolés et
  l'introspection stricte excluent volontairement ces mémoires mutables ;
- il n'y a plus trois appels directs à `prepareMessages()` dans l'exécuteur :
  un appel prépare chaque requête fournisseur, et deux appels au wrapper en
  place gèrent les compactages de milieu de boucle.

Conclusion de parité : rien à signaler sur l'existence d'un chemin séquentiel
secondaire. Les correctifs ont porté sur les projections et les états communs,
pas sur une duplication de la logique.

## 2. Événements dits « streaming seulement »

### Ce que fait réellement le collecteur séquentiel

`processUserMessage()` itère le même générateur puis retourne la tranche de
`history` ajoutée pendant l'appel (`agent-executor.ts:940-960`). Après CB16 :

| Événement | Comportement séquentiel réel |
|---|---|
| `ask_user` | La question assainie est ajoutée comme message assistant à `history` et `messages` (`952-955`). Le collecteur ne peut pas suspendre et attendre une réponse, mais l'appelant peut afficher la question puis envoyer la réponse dans un nouveau tour. |
| `tool_stream` | Ignoré comme progrès intermédiaire; le `tool_result` final est conservé et retourné. |
| `token_count` | Ignoré comme télémétrie d'affichage; le coût/token total est néanmoins calculé et enregistré dans la boucle. |
| `reasoning` | Ignoré et non persisté, conformément au contrat de ne pas exposer la réflexion fournisseur. |
| `steer` | L'événement de notification est ignoré, mais le message piloté est déjà injecté dans `messages` et `history` avant le `continue` (`1693-1703`, `2222-2238`, `2376-2395`). |

Le TUI traite `ask_user`, ajoute la question, suspend sa consommation du
générateur et attend la réponse (`ChatInterface.tsx:361-376`). L'adaptateur
desktop la relaie aussi (`src/desktop/codebuddy-engine-adapter.ts:508-511`) et
le runner Cowork la transforme en étape (`cowork/.../codebuddy-engine-runner.ts:769+`).

À trancher hors périmètre : le pont WebSocket historique déclare explicitement
qu'il jette `ask_user` (`src/server/websocket/desktop-handler.ts:511-519`). Ce
chemin aval n'a pas été reproduit de bout en bout ni modifié dans CB16.

### Défaut corrigé — `ask_user` perdu par `processUserMessage`

Reproduction rouge :

```text
npx vitest run tests/agent/execution/agent-executor.test.ts \
  -t "preserves an interactive-shell question for sequential callers" --reporter=verbose
AssertionError: expected { type: 'tool_result', ... } to match object
{ type: 'assistant', content: StringContaining "Do you want to open..." }
Tests: 1 failed
```

Le signal était bien détecté et l'événement streaming émis à
`agent-executor.ts:2154-2166`; seul le collecteur le jetait. Correctif et test :
`agent-executor.ts:921-958`, `agent-executor.test.ts:3350-3399`. Commit
`80c4bc4a`.

## 3. Middlewares

### Table documentaire contre câblage réel

La table courante de `CLAUDE.md:81-96` est exhaustive pour le câblage produit :

| Priorité | Middleware | Câblage |
|---:|---|---|
| 10 | `TurnLimitMiddleware` | `codebuddy-agent.ts:377-381` |
| 20 | `CostLimitMiddleware` | `codebuddy-agent.ts:385-391` |
| 30 | `ContextWarningMiddleware` | `codebuddy-agent.ts:395-399` |
| 35 | `SessionDurationMiddleware` | `codebuddy-agent.ts:403-412` |
| 42 | `ReasoningMiddleware` | `codebuddy-agent.ts:416-420` |
| 45 | `WorkflowGuardMiddleware` | `codebuddy-agent.ts:424-425` |
| 50 | `AutoObservationMiddleware` | conditionnel, `codebuddy-agent.ts:1858-1874` |
| 150 | `AutoRepairMiddleware` | `codebuddy-agent.ts:426-430` |
| 155 | `VerificationEnforcementMiddleware` | `codebuddy-agent.ts:434-441` |
| 156 | `VisualValidationMiddleware` | `codebuddy-agent.ts:446-450` |
| 157 | `PlanCompletionAuditMiddleware` | `codebuddy-agent.ts:454-461` |
| 200 | `QualityGateMiddleware` | `codebuddy-agent.ts:465-469` |

Les constantes de priorité dans les douze classes concordent. La pipeline trie
à chaque `use()` par priorité croissante (`pipeline.ts:24-28`). Rien à signaler
sur l'ordre annoncé.

### Remise à zéro

`runTurnLoop()` appelle `pipeline.resetForNewTask()` une fois au début de chaque
message utilisateur, avant la boucle (`agent-executor.ts:1284-1293`). La
pipeline appelle alors le hook optionnel `reset()` de chaque middleware
(`pipeline.ts:70-78`). Les états par tâche sont réinitialisés dans :

- AutoObservation (`auto-observation.ts:288-291`) ;
- AutoRepair (`auto-repair-middleware.ts:211-213`) ;
- VerificationEnforcement (`verification-enforcement.ts:205-208`) ;
- PlanCompletionAudit (`plan-completion-audit.ts:192-194`) ;
- QualityGate (`quality-gate-middleware.ts:469-471`).

Ils ne doivent pas être remis à zéro entre deux tours outil/LLM du même message.
Les autres middlewares sont sans compteur par tâche. `SessionDuration` conserve
volontairement l'heure de début et la cadence de rappel sur la session.

À trancher : `VisualValidationMiddleware` conserve son
`hasWarnedForFiles` sans hook `reset()` (`visual-validation-middleware.ts:22,
35-41`). Cela peut être une déduplication de session voulue; aucun défaut n'a
été reproduit. Autre piste non reproduite : la construction asynchrone non
attendue de la pipeline (`codebuddy-agent.ts:373-478`) pourrait laisser un tout
premier tour sans middleware ou entrer en concurrence avec
`enableAutoObservation()`.

### Défaut corrigé — plafond AutoObservation inopérant

Reproduction rouge :

```text
npx vitest run tests/agent/middleware/auto-observation.test.ts \
  -t "keeps the observation cap across agent-loop rounds until the next task reset"
AssertionError: expected takeSnapshot to be called 1 times, but got 2 times
tests/agent/middleware/auto-observation.test.ts:243
```

`beforeTurn()` remettait le compteur à zéro à chaque tour outil/LLM. Le reset a
été déplacé vers le hook de nouvelle tâche; test aux lignes `212-244`. Commit
`edeea694`.

### Défaut corrigé — coût d'un tour compté deux fois

Reproduction rouge avec la vraie pipeline et le vrai `CostLimitMiddleware` :

```text
npx vitest run tests/agent/execution/agent-executor.test.ts \
  -t "records a tool-using turn exactly once with the default cost middleware"
AssertionError: expected recordSessionCost to be called 1 times, but got 2 times
tests/agent/execution/agent-executor.test.ts:2748 (numérotation avant correctif)
```

Le middleware enregistrait le coût après outil, puis la fermeture unifiée le
réenregistrait. Le middleware ne fait plus que lire la limite
(`cost-limit.ts:23-40`); `recordTurnCost()` est idempotent
(`agent-executor.ts:1254-1262`). Test actuel `agent-executor.test.ts:2737-2752`.
Commit `bb62f066`.

## 4. Limites de tours et budget

### Limite de tours : séquence exacte

1. La condition `while (toolRounds < maxToolRounds)` est évaluée avant chaque
   appel fournisseur (`agent-executor.ts:1292-1293`).
2. `toolRounds` est incrémenté une fois quand la réponse contient au moins un
   appel d'outil (`1707-1709`), pas pour chaque outil du lot.
3. Les appels du lot sont ordonnés en barrières et lectures parallèles, avec un
   maximum de cinq exécutions simultanées (`1762-1767`, `1852`).
4. Atteindre le plafond n'annule donc jamais un outil déjà lancé : le lot
   courant finit, ses résultats sont appariés, les middlewares `afterTurn`
   passent, puis la condition du `while` empêche l'appel fournisseur suivant.
5. Il n'y a pas de dernier appel LLM de synthèse après ce lot. La boucle ajoute
   maintenant un message assistant durable expliquant l'arrêt et émet le même
   texte en streaming (`2336-2340`).

Conséquence : le `stop` de `TurnLimitMiddleware` à `turn-limit.ts:15-21` est
redondant/inatteignable au seuil exact, puisque la condition du `while` coupe
avant le prochain `beforeTurn`; il reste utile pour l'avertissement à 80 %.
Aucun défaut fonctionnel supplémentaire n'a été reproduit sur ce point.

Défaut corrigé — motif d'arrêt perdu en séquentiel :

```text
npx vitest run tests/agent/execution/agent-executor.test.ts \
  -t "should stop after maxToolRounds$" --reporter=verbose
AssertionError: expected { type: 'tool_result', content: 'Tool result' }
to match { type: 'assistant', content: StringContaining 'Maximum...' }
tests/agent/execution/agent-executor.test.ts:1252
Tests: 1 failed | 138 skipped
```

Vert après correctif : `1 passed | 138 skipped`. Test actuel
`agent-executor.test.ts:1222-1253`; commit `4961c91c`.

### Budget : séquence exacte

- La réponse LLM et son coût sont déjà engagés avant le contrôle.
- Juste avant les outils, `estimateSessionCostLimitReached(...)` est appelé
  (`agent-executor.ts:1710-1711`). S'il répond vrai, aucun outil du lot n'est
  exécuté : chacun reçoit un résultat synthétique d'échec, le flux émet le
  motif et `done`, puis le `finally` enregistre le coût LLM (`1712-1736`,
  `2420-2422`). Le séquentiel voit au moins les résultats d'outils synthétiques.
- S'il répond faux, tout le lot courant peut finir. Le budget n'est pas
  réévalué entre deux outils du même lot et il n'existe pas d'annulation de
  l'outil en vol déclenchée par ce compteur. L'`AbortSignal` utilisateur reste
  la seule annulation prévue dans cette zone (`1797-1802`, `1828-1842`).
- Ce budget mesure les tokens du fournisseur principal; une dépense externe
  éventuelle effectuée à l'intérieur d'un outil ne fait pas monter ce compteur
  « au milieu » de l'outil.
- Le coût du tour est enregistré une seule fois à la fin; la limite finale est
  ensuite annoncée (`2343`, `2367-2373`), mais cette annonce `content` finale
  n'est pas matérialisée par le collecteur séquentiel. Ce dernier point reste à
  trancher; le cas pré-outil conserve, lui, un `tool_result` explicite.

### Défaut reproduit, non corrigé — sous-comptage du pré-contrôle multi-tour

Le coût final somme `totalInputTokensForCost` à chaque appel fournisseur
(`agent-executor.ts:1249-1258`, `1480-1481`). Le pré-contrôle passe pourtant
seulement `inputTokens` du tour courant avec les sorties cumulées
(`1711`). Un test temporaire à trois réponses (outil, outil, final) a simulé un
seuil atteint à quatre tokens d'entrée cumulés : le deuxième outil a tout de
même été exécuté.

```text
npx vitest run tests/agent/execution/agent-executor.test.ts \
  -t "CB16 reproduction: pre-checks the cumulative provider input" --reporter=verbose
AssertionError: expected executeTool to be called 1 times, but got 2 times
tests/agent/execution/agent-executor.test.ts:2789 (test temporaire retiré)
Tests: 1 failed | 139 skipped
```

La correction naturelle serait de pré-contrôler avec l'entrée cumulée, mais
cela durcirait le moment d'arrêt et relève donc d'un arbitrage de politique
budgétaire. Aucun correctif n'a été commité.

## 5. Autres défauts reproduits et corrigés

### Contexte JIT calculé puis perdu

```text
npx vitest run tests/agent/execution/agent-executor.test.ts \
  -t "passes JIT context discovered after a tool to the next provider round"
AssertionError: expected second provider request to contain
{ role: 'system', content: 'JIT_CONTEXT_SENTINEL' }
Received: assistant + tool + lessons, sans sentinel
tests/agent/execution/agent-executor.test.ts:3277
```

Le bloc était ajouté à un tableau `preparedMessages` jetable après la requête.
Il est maintenant conservé dans `jitContextBlocks` pour les requêtes suivantes
du même message (`agent-executor.ts:1142`, `1381`, `1980`). Test
`agent-executor.test.ts:3264-3283`; commit `e15c36c5`.

### Sanitisation streaming contournée aux frontières de chunks

```text
npx vitest run tests/agent/streaming/output-sanitization.test.ts --reporter=verbose
expected '<think>secret reasoning</think>visible answer' to be 'visible answer'
expected '<|im_start|>visible answer' to be 'visible answer'
Tests: 2 failed
```

La sanitisation chunk par chunk ne pouvait pas reconnaître `<thi` + `nk>` ou
`<|im_` + `start|>`. Le handler conserve désormais les préfixes ambigus et les
blocs masqués entre chunks (`streaming-handler.ts:542-607`), puis restitue un
préfixe final bénin (`484-493`). Tests `output-sanitization.test.ts:9-35`;
commit `38a7e6c5`.

## 6. Vérifications

Baseline avant modification :

```text
npx tsc --noEmit -p tsconfig.json
exit 0
```

Régressions ciblées finales :

```text
npx vitest run tests/agent/execution/agent-executor.test.ts \
  tests/agent/execution/compact-in-place.test.ts \
  tests/agent/execution/context-pipeline-ckg-gate.test.ts \
  tests/agent/execution/context-pipeline-latency.test.ts \
  tests/agent/execution/context-pipeline-slimming.test.ts \
  tests/agent/execution/context-pipeline-user-model.test.ts \
  tests/agent/middleware tests/agent/streaming/output-sanitization.test.ts \
  tests/agent/streaming/reasoning.test.ts \
  tests/reasoning/reasoning-middleware.test.ts --reporter=dot
21 fichiers, 362 tests réussis, exit 0
```

ESLint ciblé sur les cinq sources et trois tests touchés : exit 0, aucune
erreur; 27 warnings préexistants dans le grand test de l'exécuteur. La
vérification finale `npx tsc --noEmit -p tsconfig.json` est également sortie 0.
La suite complète n'a pas été lancée.

Commits thématiques, sans push :

- `80c4bc4a` — `fix(agent): preserve sequential user questions`
- `bb62f066` — `fix(agent): record turn cost once`
- `edeea694` — `fix(middleware): enforce auto-observation turn cap`
- `e15c36c5` — `fix(agent): carry JIT context into the next round`
- `38a7e6c5` — `fix(streaming): sanitize control markers across chunks`
- `4961c91c` — `fix(agent): surface sequential round limits`

## 7. État partagé et pistes non reproduites

Les modifications et fichiers non suivis étrangers visibles dans `git status`
ont été laissés intacts, notamment la documentation d'autres lots, les
registres/outils/skills en cours et leurs rapports. `src/commands/try.ts` n'a
pas été touché. Aucun service, port, appel payant, dépendance, push ou commande
destructive n'a été utilisé.

Pistes explicitement non comptées comme défauts :

- perte de `ask_user` dans le pont WebSocket historique, sans reproduction
  Cowork de bout en bout ;
- initialisation asynchrone de la pipeline et course possible avec
  `enableAutoObservation()`, sans reproduction ;
- persistance inter-tâches du set de `VisualValidationMiddleware`, intention
  produit ambiguë ;
- le test existant du signal `__SESSIONS_YIELD__` placé dans le contenu
  assistant ne prouve pas la détection réelle, laquelle se fait dans les
  résultats d'outils (`agent-executor.ts:2184-2189`).

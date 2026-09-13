# Utiliser Code Buddy comme harnais d'outils

Le harnais expose les outils à un agent externe sans lui imposer un fournisseur LLM. Il reprend les conventions de Codex : catalogue descriptif, cellules JavaScript isolées, appels `tools.*`, sortie explicite avec `text()`, état JSON par session et exécutions consultables avec `start` / `wait` / `cancel`.

## Depuis un agent Code Buddy existant

Après installation ou build, le point d'entrée public est `@phuetz/code-buddy/harness`.

```ts
import { createAgentToolHarness } from '@phuetz/code-buddy/harness';

// agent est votre instance CodeBuddyAgent existante.
const harness = await createAgentToolHarness(agent);
try {
  const candidates = harness.search('lire fichier', 3);
  console.log(candidates); // noms, descriptions, scores et schémas JSON

  const result = await harness.exec(`
    const result = await tools.view_file({ path: 'package.json' });
    if (!result.success) throw new Error(result.error);
    text(result.output);
  `);
  console.log(result);
} finally {
  await harness.dispose();
}
```

Les effets empruntent `agent.executeToolByName` puis le ToolHandler habituel : filtres, schémas, permissions, confirmations, hooks et contexte de projet. Si le projet ou le bot de l'agent change, recréez le harnais ; il refuse les appels avec un contexte devenu incohérent. Le catalogue appartient à chaque harnais. Les appels n'effectuent pas de `process.chdir()`.

## Appels programmatiques dans Code Buddy

L'outil existant **`code_exec`** est le chemin de composition d'outils. `execute_code` reste l'exécuteur de scripts locaux avec artefacts ; ses options RPC historiques ne sont pas nécessaires pour utiliser `code_exec`.

```js
const descriptions = ALL_TOOLS.filter(t => /read|search/.test(t.description));
text(descriptions);

const discovery = await tools.tool_search({ query: 'read file', max_results: 3 });
text(discovery.data.tools); // schémas disponibles pour préparer les arguments

const results = await Promise.allSettled([
  tools.view_file({ path: 'package.json' }),
  tools.view_file({ path: 'tsconfig.json' }),
]);
for (const result of results) text(result);
await yield_control(); // publie maintenant le texte accumulé
store('lastFiles', ['package.json', 'tsconfig.json']);
```

- `tools.nom(args)` et `tools.call(nomExact, args)` renvoient un objet `{success, output?, data?, error?}`. Une erreur d'outil n'est pas transformée en succès ; inspectez `success`. Une erreur du transport peut rejeter la promesse.
- Le raccourci `tools.tool_search` est réservé lorsqu'il est autorisé. Au-delà de 512 outils, utilisez la recherche puis `tools.call(nomExact, args)` : le parent vérifie le catalogue complet de la session. Les outils absents ou récursifs restent refusés.
- `ALL_TOOLS` contient `{name, description}` ; `ALL_TOOL_NAMES` donne les seuls noms. Pour un nom MCP contenant des caractères particuliers, utilisez `tools.call(nomExact, args)`. Les collisions entre noms normalisés ne suppriment plus un outil.
- Les lectures explicitement autorisées au parallélisme sont limitées à quatre appels simultanés. Les autres outils forment des barrières FIFO : les écritures attendent les lectures précédentes et terminent avant les suivantes. `Promise.all` ne constitue pas une transaction avec rollback des effets.
- `text()` accumule un résultat borné ; `await yield_control()` publie le delta dans le chemin streaming du ToolHandler. Le résultat final conserve la sortie complète bornée. Le harnais et le ToolHandler livrent ce delta immédiatement ; la boucle d'agent principale conserve son rejeu ordonné des événements par lot d'outils, avec un buffer désormais borné. Cela ne suspend pas durablement le processus comme un workflow persistant.
- `store()` / `load()` stockent du JSON isolé par agent/session. Les cellules d'une même session sont sérialisées pour éviter les mises à jour perdues. Le snapshot n'est validé qu'après succès ; les effets d'outils déjà exécutés ne sont pas annulés si le script échoue.
- Les limites existantes restent appliquées : 64 appels par cellule, 512 raccourcis et descriptions exposés, 100–60 000 ms par cellule, mémoire du processus enfant et volumes de sortie bornés. L'annulation est transmise aux outils ; leur arrêt effectif dépend de la prise en charge du signal par chaque adaptateur.

Compatibilité : le pont historique `setCodeModeToolExecutor` conserve le retour simplifié des résultats. Les runtimes injectés utilisent désormais les résultats structurés ; pour un intégrateur direct utilisant `attachCodeExecRuntime`, `resultFormat: 'legacy'` conserve l'ancien format. Les scripts de production qui attendaient une chaîne doivent lire `result.output`.

## Exécutions longues

```ts
const sessionId = harness.start(`
  text('Lecture en cours');
  await yield_control();
  text(await tools.view_file({ path: 'README.md' }));
`, { timeoutMs: 30_000 });

let update;
do {
  update = await harness.wait(sessionId, 1000);
  if (update.output) console.log(update.output); // delta, jamais réémis
} while (update.status === 'running');
console.log(update.result);
// Pour interrompre : harness.cancel(sessionId).
```

Un seul consommateur attend un identifiant donné à la fois. Le harnais garde au plus 32 exécutions consultables ; les anciennes exécutions terminées sont évincées lorsque nécessaire. `exec(code, {signal})` fournit aussi une attente simple annulable. Les identifiants sont en mémoire, sans reprise après redémarrage. Le timeout d'une cellule commence lorsqu'elle obtient son tour dans sa session ; une cellule en attente peut être annulée sans démarrer.

## Intégrateur avec son propre dispatcher

`new ToolHarness({cwd, tools, dispatch, parallelTools?})` accepte un catalogue OpenAI de fonctions et un dispatcher asynchrone recevant `(name, args, signal)`. Ce dispatcher est une frontière de confiance : il doit valider les arguments, appliquer les permissions et respecter le contexte annoncé. Utilisez `createAgentToolHarness` pour réutiliser automatiquement ces contrôles de Code Buddy. La liste `parallelTools` doit contenir uniquement les lectures dont la concurrence est sûre.

## Via le serveur existant

Le serveur expose déjà `GET /api/tools` et `POST /api/tools/:name/execute`. Un client autorisé peut appeler `tool_search`, puis `code_exec`, avec les mêmes conventions décrites ci-dessus. Exemple de corps JSON pour `POST /api/tools/code_exec/execute` :

```json
{
  "sessionId": "external-agent-1",
  "parameters": {
    "code": "text(await tools.view_file({path: 'package.json'}));",
    "timeout_ms": 30000
  }
}
```

Les scopes HTTP et confirmations existants s'appliquent. Cet endpoint retourne le résultat final ; les méthodes `start` / `wait` / `cancel` présentées ici sont celles de la bibliothèque, pas de nouvelles routes HTTP. Aucun serveur supplémentaire n'est démarré par le harnais.

## État des journaux

`RunStore.getPersistenceStatus(runId)` et `getRun(runId).persistence` distinguent les événements reçus en mémoire de ceux acquittés par le stream. `await store.flushRun(runId)` attend les écritures précédentes ou rejette si le journal est incomplet. Une erreur disque ou un dépassement de la file de 1 Mio reste visible pour la durée de vie du writer ; les écritures suivantes ne masquent pas cette erreur. Il n'y a pas de retry implicite pouvant dupliquer un événement, ni de promesse `fsync`. Après redémarrage, l'absence du champ ne prouve pas que les anciennes écritures avaient toutes abouti.


## Supervision locale sans instance LLM

La commande native `buddy fleet supervise <manifest> <operation>` expose au harnais des
opérations hôtes définies par un manifeste de l'opérateur. Cela permet d'appeler
Code Explorer et lm-resizer installés localement, sans charger un agent complet
ni modifier la politique du shell sandboxé. Le manifeste constitue la liste des
commandes autorisées ; un modèle ne doit pas pouvoir le réécrire.

Exemple de `_qa/audit/fleet-manifest.json` (workspace relatif au manifeste) :

```json
{
  "workspace": "../..",
  "operations": {
    "context": {"command": "code-explorer", "args": ["context", "runProc", "--repo", "."]},
    "verify": {"command": "lm-resizer", "args": ["exec", "--json", "--", "npm", "test", "--", "tests/harness", "--maxWorkers=2"], "timeoutMs": 45000},
    "status": {"command": "git", "args": ["worktree", "list", "--porcelain"]}
  }
}
```

```bash
buddy fleet supervise _qa/audit/fleet-manifest.json context --json
buddy fleet supervise _qa/audit/fleet-manifest.json verify --json
```

Les noms et arguments sont fixes : pas d'expansion shell ni de paramètres libres.
Le résultat JSON conserve `success`, la sortie et le code de l'opération ; un
échec donne aussi un code de sortie CLI non nul. SIGINT/SIGTERM annulent la cellule
et transmettent l'arrêt au groupe de processus. Les commandes héritent de
l'environnement de l'opérateur : utiliser un HOME de test isolé pour les
vérifications. Chaque commande est bornée à 45 secondes, chaque cellule à 60.

Ce point d'entrée supervise et vérifie les lanes existantes. Il n'est pas un
service durable de délégation : il ne lance pas de nouveaux agents par défaut,
ne promet pas de reprise de jobs après redémarrage et ne remplace pas les
réservations du tableau de coordination. Les travaux longs restent découpés
ou exécutés par leur runner de délégation, avec suivi séparé.

Le script `scripts/fleet-supervisor.mjs` délègue à cette même implémentation,
`src/harness/fleet-supervisor.ts`, et reste utilisable après build.

## Missions durables et passations entre pilotes

`buddy fleet mission` conserve les opérations dans un répertoire local appartenant à l’opérateur. Aucun serveur ni fournisseur n’est démarré. Le manifeste est le même que pour `fleet supervise` ; une mission accepte un timeout de 100 ms à 12 heures. Le processus appelant reste au premier plan pendant `run`.

```sh
buddy fleet mission create .codebuddy/missions audit ./fleet.json verify
buddy fleet mission claim .codebuddy/missions audit codex
# Reprendre la generation retournée par claim :
buddy fleet mission run .codebuddy/missions audit codex GENERATION
buddy fleet mission show .codebuddy/missions audit
buddy fleet mission ack .codebuddy/missions audit fable
```

Une seule réservation active par tâche. La génération change à chaque attribution ; une ancienne génération est refusée. Le runner renouvelle son bail pendant le travail. Les commandes et arguments sont figés à la création : modifier le manifeste ensuite ne modifie pas la mission. Le résultat est borné, indique `truncated` si nécessaire, reste consultable après redémarrage et après accusé de réception. Une tâche terminée ne se relance pas implicitement.

Pour transmettre une mission réservée mais non démarrée :

```sh
buddy fleet mission handoff .codebuddy/missions audit codex GENERATION capsule.json
buddy fleet mission claim .codebuddy/missions audit fable
```

La capsule JSON contient `succeeded`, `failed`, `keyFiles`, `deadEnds` (listes bornées) et `nextAction` (texte obligatoire). Elle demeure disponible au nouveau pilote. Une commande déjà en cours doit se terminer ou être arrêtée avant transmission.

Après perte du pilote pendant une commande, l’effet peut avoir eu lieu : le harnais refuse une reprise automatique. Une fois le bail expiré et après inspection de l’effet et du processus, l’opérateur peut enregistrer :

```sh
buddy fleet mission reconcile .codebuddy/missions audit GENERATION retry 'Processus arrêté, effet vérifié : nouvelle tentative possible'
# ou résolution completed si le travail est déjà effectué
```

`submit <store> <id> <owner> <generation>` enregistre le HEAD pour revue. `approve <store> <id> <reviewer> <commit>` exige un relecteur distinct, un HEAD inchangé et un worktree propre. Il s’agit d’une attestation au moment de la revue, pas d’une autorisation de fusion ni d’une surveillance des éditions Git ultérieures. Attribution, transmission et lancement invalident cette attestation.

Limites : coordination sur une seule machine et un stockage local de confiance ; les identités déclarées ne sont pas une authentification réseau. Les transactions synchrones utilisent un verrou exclusif et des écritures atomiques avec fsync (répertoire synchronisé sous POSIX). Un crash pendant la très courte transaction peut laisser un `.lock` : inspecter le PID et l’état avant intervention, aucun vol de verrou automatique. Un arrêt de processus pendant une opération laisse une intention durable à réconcilier. Le harnais ne garantit pas exactement une fois pour un effet externe arbitraire.

## Vérification facultative des programmes d’outils

`code_exec` accepte `typecheck: true`. L’API publique expose également `harness.exec(code, { typecheck: true })` et `harness.start(code, { typecheck: true })`. Les déclarations proviennent du catalogue autorisé du harnais, notamment pour `tools.call("nom.canonique", args)`. Les erreurs sont signalées avant tout appel d’outil. Les annotations TypeScript sont retirées avant l’exécution JavaScript.

Le compilateur s’exécute dans un processus séparé, avec délai de 5 secondes, tas V8 de 128 Mo et diagnostics bornés. Les imports du programme ne sont pas autorisés ; seul le compilateur lit ses bibliothèques installées. Ce contrôle ne remplace pas les permissions d’exécution ni une validation JSON Schema complète (les schémas complexes non représentés peuvent rester `unknown`). L’option est désactivée par défaut ; elle ajoute un démarrage de compilateur lorsqu’elle est activée.

## Diagnostic de stabilité du cache

Le statut `/prompt-cache` affiche les changements locaux des composants système et outils. `PromptCacheManager.getPrefixStats()` donne les observations, répétitions consécutives et changements, sans conserver le texte des prompts. Ce sont des observations locales : les économies affichées restent estimées et ne mesurent pas les tokens de cache facturés par le fournisseur.

## Continuité des tâches planifiées

```sh
buddy cron add briefing --every 3600000 --message 'Résume les nouveautés' --continuity '{"enabled":true,"notes":{"focus":"changements depuis le dernier passage"}}'
buddy cron update JOB_ID --continuity false
```

L’outil `cronjob` accepte le même objet `continuity` lors d’une création. `true` active la continuité sans notes initiales ; `false` la désactive. Les notes sont enregistrées séparément de `jobs.json` dans le répertoire cron configuré. Maximum : 128 caractères par clé, 16 Kio par valeur et 64 Kio par fichier sérialisé. Le contexte du prochain passage contient les notes et le dernier résultat réussi non vide, borné à 16 Kio et à l’espace restant.

Une exécution échouée ne remplace pas cette sortie et ne consomme pas l’empreinte du précontrôle. Une erreur de lecture ou d’enregistrement du carnet est signalée ; un carnet corrompu n’est pas remis à zéro. Les écritures concurrentes sont exclues et signalent une contention à retenter. La continuité reste désactivée par défaut.

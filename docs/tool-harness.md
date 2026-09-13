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

Les effets empruntent `agent.executeToolByName` puis le ToolHandler habituel : filtres, schémas, permissions, confirmations, hooks et contexte de projet. Si le projet de l'agent change, recréez le harnais ; il refuse les appels avec un contexte devenu incohérent. Le catalogue appartient à chaque harnais. Les appels n'effectuent pas de `process.chdir()`.

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
- `ALL_TOOLS` contient `{name, description}` ; `ALL_TOOL_NAMES` donne les seuls noms. Pour un nom MCP contenant des caractères particuliers, utilisez `tools.call(nomExact, args)`. Les collisions entre noms normalisés ne suppriment plus un outil.
- Les lectures explicitement autorisées au parallélisme sont limitées à quatre appels simultanés. Les autres outils forment des barrières FIFO : les écritures attendent les lectures précédentes et terminent avant les suivantes. `Promise.all` ne constitue pas une transaction avec rollback des effets.
- `text()` accumule un résultat borné ; `await yield_control()` publie le delta dans le chemin streaming du ToolHandler. Le résultat final conserve la sortie complète bornée. Le harnais et le ToolHandler livrent ce delta immédiatement ; la boucle d'agent principale conserve son rejeu ordonné des événements par lot d'outils, avec un buffer désormais borné. Cela ne suspend pas durablement le processus comme un workflow persistant.
- `store()` / `load()` stockent du JSON isolé par agent/session. Les cellules d'une même session sont sérialisées pour éviter les mises à jour perdues. Le snapshot n'est validé qu'après succès ; les effets d'outils déjà exécutés ne sont pas annulés si le script échoue.
- Les limites existantes restent appliquées : 64 appels par cellule, 512 outils exposés, 100–60 000 ms par cellule, mémoire du processus enfant et volumes de sortie bornés. L'annulation est transmise aux outils ; leur arrêt effectif dépend de la prise en charge du signal par chaque adaptateur.

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

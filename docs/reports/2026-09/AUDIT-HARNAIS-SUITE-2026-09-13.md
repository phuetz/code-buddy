# Suite de l'audit : harnais et RPC

> Les quatre défauts ci-dessous ont été corrigés dans la tranche suivante. Voir [le rapport de correction](CORRECTIONS-HARNAIS-RPC-2026-09-13.md). La sonde citée vérifie désormais le comportement corrigé.
Audit demandé par Patrice après la livraison du harnais. Révision examinée : **`4b52cb6f4`**, branche `codex/audit-ameliorations-2026-09-13`, worktree `~/DEV/cb-audit-ameliorations-2026-09-13`.

**Quatre défauts reproduits.** Deux concernent le harnais livré dans la tranche précédente ; ils n'étaient pas couverts par ses tests. Deux concernent le RPC historique d'`execute_code`, distinct du moteur isolé `code_exec`. Aucune modification de production dans cette tranche : rapport et sonde diagnostique seulement.

## Résultats et ordre conseillé

| Priorité | Défaut | Preuve obtenue | Correction recommandée |
| --- | --- | --- | --- |
| P1 | Frontière du workspace RPC contournée par un lien symbolique | Un fichier synthétique placé hors du workspace est lu via un lien placé dedans | Vérifier les chemins physiques et le fichier effectivement ouvert |
| P1 | Un harnais accepte un changement de bot sur le même agent | Après passage de bot-a à bot-b, le même harnais continue à dispatcher | Fixer et vérifier le périmètre complet, pas seulement cwd |
| P1 | Un RPC en attente démarre après la fin du script | Le deuxième appel est lancé après le retour réussi d'`executeCode()` | Arrêter la file et propager l'annulation à toute opération active |
| P2 | Catalogue découvert différent du catalogue appelable | Le 513e outil est trouvé et fonctionne en appel direct, mais échoue dans une cellule | Charger les outils découverts à la demande et réserver toujours tool_search |

### 1. Liens symboliques : le contrôle de chemin est lexical

Sources : `src/tools/execute-code-rpc-invoker.ts:178`, `:192`, `:200` ; même garde utilisée pour lister un dossier et rechercher.

`assertInsideWorkspace()` compare des chemins produits par `path.resolve()`. Ensuite `stat()` et `open()` suivent les liens symboliques. La sonde crée uniquement dans un répertoire temporaire :

- `workspace/linked.txt`, lien vers `outside.txt`, situé à côté du workspace ;
- `outside.txt` contenant le marqueur fictif `SYNTHETIC_OUTSIDE_MARKER` ;
- un invoker limité à `view_file`, avec la métadonnée de lecture explicitement fournie au harnais de test.

Le résultat contient le marqueur extérieur avec `ok: true`. Ce test utilise l'invoker réel et de vrais fichiers ; il ne lit aucun fichier personnel. Le master flag reste un contrôle du runner, pas de cette fonction : la sonde cible la frontière interne après autorisation.

**Portée :** défaut du contrat de confinement de ce RPC, pas démonstration d'une intrusion HTTP ni d'une évasion du processus isolé de `code_exec`. `execute_code` exécute déjà des scripts locaux disposant de leurs propres accès système ; il ne faut pas confondre ces deux modèles.

**Correction :** canonicaliser racine et cible, vérifier leur relation physique puis éviter de rouvrir un chemin mutable après contrôle. Pour une garantie contre un remplacement concurrent de lien, contrôler le descripteur ouvert ou employer une stratégie de traversée sans suivi de liens adaptée à la plateforme ; `realpath()` seul réduit le défaut mais ne ferme pas toutes les courses. Appliquer le même contrat aux trois exécutants RPC.

**Tests à ajouter :** lien fichier extérieur, dossier lié, racine elle-même liée, lien intérieur valide, chemins Windows et tentative de remplacement entre validation et ouverture.

### 2. Le périmètre du harnais ne couvre pas le bot

Sources : `src/harness/tool-harness.ts:143`–`:150`. En aval, `ToolHandler` utilise `currentBotId` pour remplir le contexte des outils (`src/agent/tool-handler.ts:1256`).

`createAgentToolHarness()` capture uniquement le cwd. Or le véritable `CodeBuddyAgent.getMemoryScope()` fournit aussi le bot. Si l'agent change de bot tout en conservant le même dossier, le harnais n'est pas invalidé et les outils utilisent le nouveau contexte.

La sonde appelle la factory réelle avec un adaptateur contrôlé. Le dispatcher rend le bot courant comme marqueur : `bot-a` avant changement, **`bot-b` après**, avec succès. Ce n'est pas une lecture de mémoire réelle ; c'est une preuve de routage de la factory, cohérente avec le contexte employé par le ToolHandler.

**Correction :** capturer cwd + bot et, lorsque disponible, l'identité logique de conversation. Refuser le changement ou utiliser un dispatcher attaché à un contexte immuable. Les outils ne doivent pas dépendre d'un agent mutable partagé sans le mutex de conversation approprié. Vérifier aussi le catalogue lors des changements de profil et de permissions.

**Tests à ajouter :** même cwd/deux bots, même bot/deux conversations HTTP, restauration de conversation pendant une attente, passage d'un bot défini à aucun bot. La vérification ne doit pas seulement porter sur la valeur retournée par `getMemoryScope()` : ajouter un outil mémoire qui observe le contexte reçu.

### 3. Le responder RPC poursuit son scan après stop

Sources : `src/tools/execute-code-runner.ts:217`, `:471`–`:499`.

`stop()` positionne `stopped` et supprime le timer. Mais un scan déjà commencé parcourt sa liste de fichiers en attendant chaque appel ; il ne revérifie pas `stopped` à l'intérieur de cette boucle, ni avant la dispatch de l'appel suivant.

La sonde utilise un vrai processus enfant JavaScript et le transport réel :

1. L'enfant dépose deux demandes RPC et attend un marqueur.
2. Le premier invoker, simulé et sans effet externe, crée le marqueur puis reste bloqué sur une promesse contrôlée.
3. L'enfant termine ; `executeCode()` rend `ok: true` et appelle `stop()`.
4. La sonde libère le premier appel. **Le deuxième invoker démarre alors après le retour du runner.**

Deux exécutions complètes de la sonde ont reproduit ce même ordre. Le défaut est plus précis que « un outil déjà lancé ignore son signal » : ici un outil encore en attente démarre après la fin annoncée.

**Correction :** vérifier l'état arrêté avant chaque demande et chaque dispatch ; annuler les invocations actives avec un signal parent ; définir si la clôture attend leur terminaison. Ne pas répondre par un simple timeout de Promise qui laisse le travail tourner. Préserver une réponse terminale claire pour les demandes en attente lorsque le client existe encore.

**Tests à ajouter :** sortie normale avec requêtes pendantes, timeout du script, timeout d'un outil, erreur de spawn, réponse tardive après fermeture et arrêt pendant une écriture de réponse.

### 4. Les grands catalogues cassent la découverte progressive

Sources : `src/tools/code-exec-tool.ts:93`, `:301` ; `src/harness/tool-harness.ts:85`.

Le catalogue du harnais conserve les outils fournis, mais `buildToolBindings()` ne transmet que les 512 premiers à la cellule. De plus, le harnais ajoute `tool_search` à la fin de cette liste : avec au moins 512 autres outils, la fonction de découverte peut elle-même disparaître.

Avec 513 outils fictifs, la sonde observe simultanément :

- `harness.search('tool_0512')` retrouve le nom exact ;
- `harness.call('tool_0512')` réussit ;
- `harness.exec("await tools.call('tool_0512', {})")` échoue avec « tool is not available » ;
- dans cette cellule, `typeof tools.tool_search` vaut `undefined`.

La limite de 512 était documentée. Le défaut est l'incohérence entre découverte et invocation ainsi que la disparition du mécanisme de découverte, pas l'existence d'une limite en soi.

**Référence Codex examinée :** son gestionnaire construit la recherche depuis les entrées différées du registre et retourne des spécifications chargeables, avec invalidation du cache lorsque les sources changent. Cela fournit un modèle pour dissocier catalogue complet et outils chargés dans un tour. [Source épinglée](https://github.com/openai/codex/blob/dfaf451426868c22e6859f5494150fd6338c3257/codex-rs/core/src/tools/handlers/tool_search.rs#L48).

**Correction :** toujours réserver le canal de découverte ; permettre à `tools.call()` de résoudre un nom découvert via un catalogue parent autorisé, ou charger explicitement de nouveaux bindings. Borner les schémas exposés et invalider les caches sur changement de catalogue. Ne pas simplement augmenter la limite jusqu'à réintroduire une consommation sans borne.

**Tests à ajouter :** 511/512/513 outils, outil utile en fin de catalogue, ajout/retrait MCP, changement de profil et nom découvert dont l'autorisation a été retirée avant l'appel.

## Reproduction

Depuis le worktree audité :

```bash
node --import tsx tests/audit/harnais-suite-2026-09-13.mjs
```

La sonde est volontairement diagnostique : ses assertions décrivent les défauts présents sur `4b52cb6f4`. Une fois corrigés, elle devra être remplacée ou mise à jour ; ce n'est pas une suite affirmant le comportement souhaité. Elle crée puis supprime ses seuls fichiers temporaires, change HOME avant les imports de production et bloque `fetch`. Le RPC simulé n'exécute aucune action externe. Aucun service ni appel LLM n'est nécessaire.

Preuves non suivies : `_qa/audit/harnais-suite-probe.log` et `harnais-suite-probe-repeat.log`, toutes deux exit 0. Les résultats montrent `outsideRead: true`, `acceptedChangedBot: true`, `cellSuccess: false`, `discoveryMissing: true`, `lateInvocation: true`.

Il n'y a pas de verdict global de sécurité : les chemins HTTP, réseau et fournisseurs ne sont pas audités exhaustivement ici. Les correctifs ne sont pas implémentés dans cette tranche de recherche.

## Vérifications et passation

`npm run validate -- tests/harness/tool-harness.test.ts tests/tools/execute-code-tool-rpc.test.ts -- --maxWorkers=2` : **exit 0**, lint sans erreur, typecheck principal/GPU/companion-core verts, contrôle du paquet 10/10 et **26 tests existants verts**. Ceux-ci n'attrapent donc pas les quatre défauts reproduits par la sonde. Vérification syntaxique de la sonde et `git diff --check` verts.

Privacy après staging : **39/40**, avec exactement les cinq chemins déjà fautifs sur la base témoin ; aucun fichier de cet audit n'est ajouté aux fautifs. Aucun garde-fou modifié.

Rapport, sonde et ligne de coordination livrés dans le commit contenant cette passation, sur la branche indiquée en tête. Production inchangée ; aucune fusion ni publication. Les logs `_qa/audit/` restent non suivis. Dans le dépôt principal, seule la coordination de notre chantier est mise à jour et le fichier non suivi préexistant reste intact.

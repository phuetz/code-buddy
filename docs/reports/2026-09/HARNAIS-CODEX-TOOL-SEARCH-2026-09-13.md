# Harnais Code Buddy, découverte et appels programmatiques

Patrice a demandé d'implémenter les quatre adaptations de l'audit Codex et de rendre Code Buddy utilisable comme harnais, avec un meilleur `tool_search` et des appels programmatiques « comme dans Codex ».

Worktree : `~/DEV/cb-audit-ameliorations-2026-09-13`. Branche : `codex/audit-ameliorations-2026-09-13`. Base de cette tranche : `91ea7858d`, qui contient déjà les quatre correctifs précédents de sessions/mémoire. Aucune modification de production dans le worktree principal, aucun push ni lancement de service.

## Résultat livré

### Les quatre adaptations du comparatif

1. **Sortie bornée.** `BoundedOutput` retient un début stable et une fin glissante, avec comptage des octets omis et découpage UTF-8. Les buffers stdout, stderr et attente du chemin Bash streaming direct sont bornés. Le buffer de rejeu du batch dans `AgentExecutor` l'est aussi : borner le producteur seul aurait laissé une accumulation chez son consommateur.
2. **Fin des processus.** Expiration et annulation empruntent le même chemin. SIGTERM est suivi de SIGKILL après 250 ms si nécessaire ; le groupe Unix est visé. L'événement de lancement `error` devient un résultat d'outil. L'arrêt anticipé du consommateur tue le processus. Plus de décision d'escalade fondée sur `ChildProcess.killed`.
3. **Compression du contexte.** La stratégie d'urgence garde désormais le début et la fin dans son budget de 500 octets. Le vieillissement des résultats partage cette primitive pour les petites sorties et borne aussi les aperçus de lignes géantes. Identifiants d'outils conservés.
4. **Journal observable.** `RunEventWriter` distingue reçus et écrits. `RunStore.flushRun()` attend les acquittements ; `getPersistenceStatus()` et `getRun().persistence` exposent `pending` / `flushed` / `failed`. Erreur asynchrone ou file de plus de 1 Mio : état d'échec conservé et avertissement, sans retry susceptible de dupliquer des événements. Il s'agit d'un flush de stream, pas d'un fsync ni d'un nouveau format de journal durable.

### Recherche d'outils

- Noms snake_case, noms MCP et camelCase découpés en termes ; Unicode et accents normalisés ; équivalences françaises usuelles pour les intentions fichier/recherche/exécution.
- Correspondance exacte prioritaire et noms pondérés ; égalités de score déterministes ; termes répétés dédupliqués.
- Reconstruction d'index sans anciens IDF ni doublons de noms ; calcul des fréquences documentaires en une passe.
- Métadonnées et schémas transmis à l'index lors de l'assemblage des outils. Le résultat expose `data.tools` avec scores et paramètres, tout en gardant `data.names` utilisé par la découverte progressive du prochain tour.
- `ToolHandler` fournit un catalogue propre à la requête, filtré par disponibilité et surface active : la recherche ne dépend plus du dernier index singleton créé par un autre agent. Les outils MCP et plugins sont inclus ; les noms de plugins utilisent le préfixe réellement dispatchable.
- Arguments vérifiés ; maximum 50 résultats. L'index historique reste utilisable par les intégrateurs directs qui n'injectent pas de contexte.

### Appels programmatiques

Le dépôt possédait déjà `code_exec`, un moteur de composition isolé dans un processus enfant, distinct d'`execute_code` et de son RPC de scripts. La tranche améliore ce moteur existant plutôt que d'ajouter un second moteur.

- `ALL_TOOLS` est un catalogue `{name, description}`, avec `ALL_TOOL_NAMES` pour les seuls identifiants.
- `tools.nom()` / `tools.call()` transmettent des résultats structurés, y compris les erreurs et les données. Les objets partagés ne sont plus confondus avec des cycles JSON.
- Collisions de noms normalisés résolues sans faire disparaître un outil.
- Quatre lectures simultanées au maximum lorsqu'elles sont explicitement déclarées sûres ; écritures et outils non classés forment des barrières FIFO.
- Les 64 appels par cellule sont comptés dans le parent aussi ; taille des arguments bornée. Annulation/timeout transmis aux appels imbriqués ; les requêtes encore en attente ne démarrent pas après annulation.
- Les cellules d'une même session sont sérialisées. Une cellule en attente peut être annulée immédiatement. Le store JSON n'est validé qu'après succès de la cellule.
- `await yield_control()` envoie réellement le texte produit via IPC. Le ToolHandler possède une adaptation streaming qui réutilise le dispatch normal, donc les contrôles d'autorisation et les hooks. L'AgentExecutor conserve son rejeu ordonné des événements par batch, désormais borné.

Compatibilité : le pont legacy direct garde ses résultats simplifiés. Un runtime injecté peut demander `resultFormat: 'legacy'`. Les scripts de production du nouveau chemin utilisent `result.output` et `result.data` ; ils ne doivent plus supposer que `tools.nom()` rend une chaîne.

### Harnais public

Nouveau sous-chemin de paquet `@phuetz/code-buddy/harness` :

- `ToolHarness` : catalogue privé, `search`, `call`, `exec`, `start`, `wait`, `cancel`, `dispose` ; aucun client LLM construit par cette classe.
- `createAgentToolHarness(agent)` : raccord au dispatcher normal d'un agent Code Buddy existant ; refus si son dossier actif a changé.
- Exécution JavaScript réelle isolée, état par harnais, résultats structurés, attente avec deltas non répétés et annulation ; 32 identifiants consultables au maximum.
- Le dispatcher injecté par un intégrateur est une frontière de confiance et doit appliquer ses permissions ; la factory Code Buddy réutilise celles du ToolHandler.

Guide d'intégration et exemples : `docs/tool-harness.md`. Les routes HTTP d'outils déjà existantes permettent d'appeler `tool_search` et `code_exec` ; ce lot n'invente pas de routes HTTP `start` / `wait`.

## Vérification

Les nouveaux tests exercent des processus réels : shell ignorant SIGTERM, échec de spawn, consommateur interrompu, sortie bavarde, cellules JavaScript isolées et passage IPC. Les outils du harnais sont contrôlés dans les tests pour vérifier barrières, propagation des erreurs, annulation et frontières du dispatcher sans appel LLM externe. Le raccord au ToolHandler réel est également testé.

Autres preuves : données UTF-8 tronquées, perte du diagnostic final corrigée, pression sur le buffer de batch, IDF reconstruits, catalogue scoped, schémas structurés, lecture d'un journal après flush, erreur de disque simulée via stream et file saturée. L'import du paquet compilé a été exécuté avec une cellule réelle qui découvre un schéma puis consomme un résultat structuré.

Les chiffres finaux et commits sont ajoutés à la clôture ci-dessous. Journaux locaux non suivis : `_qa/audit/harness-*.log`.

## Limites explicites

- Aucun benchmark comparatif de vitesse avec Codex ni tests Windows natifs dans cette tranche ; les scénarios shell Unix sont ignorés sous Windows.
- Le timeout d'un outil ne peut pas annuler un effet déjà accompli. Un adaptateur externe qui ignore AbortSignal peut continuer son travail ; la cellule et ses appels non démarrés sont néanmoins arrêtés.
- `store/load`, jobs et état d'acquittement des writers sont en mémoire. Il n'y a pas de reprise des jobs du harnais après redémarrage ni de transaction distribuée des effets.
- Les sorties et catalogues sont bornés, ce qui peut omettre des données ; les journaux indiquent la troncature. Le contrat de chiffrement des sessions précédent n'est pas étendu automatiquement aux autres fichiers d'observabilité.

## Clôture

- `npm run validate -- <suites concernées> -- --maxWorkers=2` : **exit 0**. Lint global : 0 erreur, 2 488 avertissements ; typecheck principal + GPU + companion-core verts ; contrôle du paquet **10/10** ; suites **109 fichiers / 1 221 tests verts**.
- `npm run build` : **exit 0**, incluant ressources embarquées et manifeste runtime.
- Import effectif de `@phuetz/code-buddy/harness` compilé : export résolu, cellule enfant exécutée, schéma découvert, résultat structuré consommé, fermeture du harnais réussie (`harness-package-smoke.log`).
- Privacy après staging des nouveaux fichiers : **39 verts / 1 rouge**. Exactement les cinq fichiers déjà fautifs sur la base témoin `8b5c61def`, aucun fichier de cette tranche. Aucun garde-fou affaibli.
- `git diff --check` vert. Les anciens fichiers non suivis du dépôt principal sont préservés ; les seules modifications de celui-ci portent sur les lignes de coordination de nos chantiers.

Commits thématiques : `a52fe417c` (sorties, processus et contexte), `cdb19beb9` (journal), puis le commit contenant cette clôture (harnais, recherche, code_exec, guide et coordination). Livraison locale dans le worktree et la branche indiqués en tête, sans fusion dans la branche principale ni push. Seul `_qa/audit/` reste non suivi dans le worktree de livraison.

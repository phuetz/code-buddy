# Code Buddy 2.1 — mémoire, apprentissage et coopération

Code Buddy peut conserver des informations utiles, proposer des leçons, réutiliser des skills et évaluer des variantes de code. Ces mécanismes agissent sur le contexte et les artefacts du système ; ils ne réentraînent pas les poids du modèle.

Pour l’installation et les autres usages, consulter le [README principal](README.md). Cette présentation thématique en français, qui n’est pas une traduction intégrale du README principal, accompagne le [guide technique et ses preuves de source](docs/learning-mechanisms.md).

## Nouveautés 2.1

La version 2.2 ajoute la connexion OAuth à ElevenLabs hébergé via MCP, fiabilise les commandes en script (interruption headless en code 130, `mcp add-json --yes`) et affiche le thème effectif dans `/status` ([notes 2.2.0](docs/RELEASE-NOTES-2.2.0.md)). La version 2.1 ajoutait un catalogue explicite de ressources, la recherche RagChat avec citations de pages, l’import de configurations MCP et un pont A2A JSON-RPC limité aux échanges texte documentés. Elle corrige aussi des problèmes de sessions terminal, de mémoire par fournisseur, de diagnostic de configuration et d’interface Cowork. Les [notes de version](docs/RELEASE-NOTES-2.1.0.md) détaillent les limites : pas de reprise automatique des tâches après panne, pas de compatibilité universelle ni de garantie de qualité OCR.

```sh
npm install -g @phuetz/code-buddy@2.2.0
buddy --version
buddy doctor --offline
```

La CI impose Linux, macOS et Windows avec Node.js 20 et 22. Cowork reste une installation distincte du paquet npm CLI.

## Ce qui reste d’une session à l’autre

La mémoire de projet se trouve notamment dans `.codebuddy/CODEBUDDY_MEMORY.md`, la mémoire utilisateur dans `~/.codebuddy/memory.md`. Leur contenu peut rejoindre le prompt dans les limites et selon la portée du contexte actif. Les leçons constituent une autre couche : une session substantielle peut proposer des candidatures, à examiner avant qu’elles deviennent des leçons actives.

```bash
buddy lessons candidate list
buddy lessons list
buddy lessons search "profil"
buddy lessons context
```

Exemple d’usage : conserver une convention de tests du dépôt, puis proposer une leçon après un diagnostic utilisant le mauvais profil. Le rapprochement avec [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) concerne le contexte externalisé et les observations d’erreurs, pas une copie de son système interne.

## Des procédures réutilisables et contrôlables

Les skills décrivent comment mener une tâche. Le système sait proposer des skills authored et consolider des procédures qui se recouvrent. Il conserve les skills épinglés et refuse les pertes de couverture détectées. Ces contrôles textuels doivent être complétés par une utilisation réelle de la procédure.

`buddy improve skills-list` inspecte les procédures authored. `buddy improve skills-consolidate` prévisualise une consolidation et peut appeler un modèle. Son option `--apply` demande explicitement l’installation et l’archivage ; son contrat diffère de celui des commandes génératives voisines.

## Améliorer les artefacts, puis évaluer les variantes de code

`CODEBUDDY_SELF_IMPROVE=true` conserve le mode proposition. La valeur `auto-apply`, ou l’autorisation explicite prévue par la commande concernée, permet de garder les changements validés. La voie `improve` portant sur la couche apprise et la voie `evolve` portant sur le code doivent être distinguées.

`buddy evolve list` et `buddy evolve review IDENTIFIANT` permettent d’examiner des variantes. Le moteur travaille dans des worktrees et ne fusionne pas automatiquement. Sa référence [DGM de Sakana](https://sakana.ai/dgm/) exprime une inspiration de méthode ; les performances publiées par Sakana ne sont pas des résultats de Code Buddy. Un score hors ligne reste limité au benchmark utilisé.

## Coopérer et explorer plusieurs pistes

Le Council peut répartir des rôles complémentaires, évaluer les réponses et les synthétiser. [Fugu, développé par Sakana AI](https://sakana.ai/fugu-release/) ; son modèle d’orchestration entraîné se distingue du conducteur déterministe actuellement présent dans Code Buddy.

Le moteur de raisonnement propose ToT/MCTS avec des budgets de recherche. `/think status` permet d’inspecter le réglage. Une consigne de raisonnement injectée par un middleware ne prouve pas qu’un arbre de recherche a été exécuté. Les références [ToT](https://arxiv.org/abs/2305.10601), [RethinkMCTS](https://arxiv.org/abs/2409.09584) et [MCTSr](https://arxiv.org/abs/2406.07394) sont explicitées dans le guide ; aucune équivalence de benchmark n’est annoncée.

Une recette de flotte a déjà relié deux hôtes : revue du Buddy Windows par RPC, correction du Buddy Linux, puis oracle indépendant réussi sur les deux systèmes (5/5 chacun). Le relais était assuré manuellement par le pilote. [Déroulement vérifié](docs/reports/2026-09/fleet-two-hosts-learning-example.md).

Le gain se vérifie sur une tâche concrète : référence avant changement, actions capturées, résultat, coût et régressions. La présence du code, son activation et son bénéfice observé sont trois constats différents.

## Portée des preuves

Le guide d’apprentissage a initialement été relu sur le candidat `01fc0dbd3` le 14 septembre 2026. Ce contrôle historique ne constitue pas la validation de la version 2.1.0 ; consulter les [notes de version](docs/RELEASE-NOTES-2.1.0.md) et les contrôles du commit publié pour identifier cette livraison.

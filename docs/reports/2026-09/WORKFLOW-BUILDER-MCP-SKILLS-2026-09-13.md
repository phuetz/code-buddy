# WorkflowBuilder : accès natif, ETL et compétences

Le serveur WorkflowBuilder récent possède déjà les modules ETL d’Astra et 23 outils MCP. Le manque principal était dans l’accès de Code Buddy : le transport `streamable_http` était déclaré mais refusait systématiquement l’envoi, et le CLI ne proposait pas d’appel ponctuel d’un outil MCP. Ces commandes évitent de mobiliser un modèle pour une opération déterministe.

## Ajouts Code Buddy

```bash
buddy mcp tools workflow-builder --query lineage
buddy mcp call workflow-builder get_lineage --args-file lineage.json
buddy mcp call workflow-builder run_workflow --args-file run.json
```

`tools` imprime du JSON et peut filtrer les noms/descriptions avant de renvoyer les schémas ; `totalTools` indique la taille totale du catalogue. `call` accepte un objet JSON en argument ou dans un fichier régulier limité à 1 MiB. Les deux sources sont exclusives. Un résultat MCP `isError` produit un code de sortie non nul. La connexion est fermée après l’opération, y compris en cas d’erreur. Le résultat métier d’une exécution reste à lire : un appel MCP réussi ne garantit pas la réussite du workflow demandé.

Le transport HTTP utilise maintenant `StreamableHTTPClientTransport` du SDK MCP installé, avec ses en-têtes de requête et son cycle de fermeture. Un endpoint incompatible reste refusé. Les fixtures locales vérifient l’initialisation, la découverte, l’authentification par en-tête et les résultats d’appels réels HTTP.

## Installation locale utilisée

Les sources ETL de référence sont la base `7879e143` du 13 septembre, dans le checkout `workflow-opus-amel-2026-09-12`. Le runtime choisi est le worktree `workflow-lisa-timeout-2026-09-13`, qui ajoute le correctif timeout/annulation. Il utilise une base PostgreSQL dédiée et persistante, exposée seulement sur loopback, indépendante de l’ancienne application graphique. Les migrations ont été appliquées à cette nouvelle base.

Le serveur `workflow-builder` a été ajouté au fichier MCP utilisateur en préservant les autres serveurs et une sauvegarde privée. Les paramètres locaux et le secret de base restent dans `~/.codebuddy/workflow-builder/runtime.json` (0600, répertoire 0700).

- `workflow-builder` lance le CLI natif ; `workflow-builder --mcp` lance son serveur stdio.
- `buddy-mcp` lance les nouvelles commandes MCP depuis les sources Code Buddy de ce chantier ; c’est un raccourci local, pas une nouvelle implémentation du protocole.
- L’ancien conteneur graphique reste distinct. Un workflow importé dans la base native n’apparaît pas automatiquement dans son interface.

## Compétences créées

`workflow-builder-pilot` : découverte ciblée, choix du bon checkout, création/validation/exécution, erreurs, suivi statique des colonnes ETL et reprise sans doublons.

`lisa-video-workflows` : inventaire des médias existants, identité de Lisa, provenance, distinction mesures importées/rendu réel, contrôles et préparation des prises.

Les deux compétences sont installées dans les répertoires utilisateur Codex et Code Buddy. Leur validation structurelle passe. Une reprise indépendante a effectivement utilisé la première : graphe retrouvé, lineage interrogé, quatre transformations JavaScript correctement déclarées inconnues. Le vrai registre Code Buddy découvre sa compétence sœur comme active.

## Preuves et limites

Le workflow Lisa a été créé via le nouveau CLI MCP puis exécuté sur les sources ETL récentes : cinq étapes, statut `success`, aucune erreur, sorties conservées. Aucune génération de vidéo ni appel fournisseur n’était demandé à ce workflow. Il contrôle les mesures importées du MP4 et prépare les prises restantes.

Les preuves privées sont conservées dans le projet média et `_qa/audit/`. Elles distinguent l’essai graphique sur l’ancienne instance et le nouvel essai natif. Un défaut supplémentaire du CLI WorkflowBuilder a été reproduit : les journaux de démarrage polluent la sortie `--format json`. Sa correction est isolée dans le worktree WorkflowBuilder.

Vérifications Code Buddy : suite ciblée transport/CLI ; typecheck, lint et build. Résultats de validation définitifs dans la coordination. Le transport HTTP a une preuve locale par fixture ; le runtime ETL réel a été utilisé par stdio. Les changements de sources ne constituent pas une publication de release.

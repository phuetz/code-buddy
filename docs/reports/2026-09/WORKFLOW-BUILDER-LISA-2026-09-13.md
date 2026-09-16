# Workflow Builder : production Lisa et connexion Cowork

Le parcours réel de préparation vidéo a révélé deux problèmes de connexion : le port historique 8080 peut appartenir à une autre application, et un WorkflowBuilder installé peut interdire son affichage dans une iframe. Cowork doit vérifier l’identité de l’éditeur, proposer une ouverture dans le navigateur quand l’intégration est refusée et ne gérer que les processus qu’il a lui-même lancés.

## Configuration et comportement

- `CODEBUDDY_WORKFLOW_URL` : URL HTTP(S) explicite d’un éditeur existant. Connexion seule ; aucun lancement ni arrêt de ce service externe.
- `CODEBUDDY_WORKFLOW_DIR` : dossier de travail pour le lancement local `npm run dev`. Par défaut, `~/workflow` ; le contrat historique du serveur de développement sur 8080 est conservé.
- Le démarrage attend une réponse de l’éditeur avec une limite de temps. Une simple réponse HTTP 200 d’un autre produit ne suffit pas. Les erreurs asynchrones de création du processus sont capturées.
- L’état expose l’URL et le mode de gestion. Le panneau utilise cette URL et propose le navigateur quand les en-têtes de protection empêchent l’intégration. Les protections du serveur ne sont pas supprimées.

La sonde vérifie le titre de l’éditeur, pas le fonctionnement de tous ses services d’exécution. Elle ne constitue pas une attestation d’identité cryptographique. Les modifications restent dans la branche locale d’audit ; le conteneur WorkflowBuilder installé n’est pas remplacé.

## Utilisation réelle pour les vidéos

Un workflow Lisa de cinq nœuds a été importé par l’interface, enregistré et exécuté : déclenchement manuel, mesures/provenance, contrôle du livrable, préparation des prises restantes, dossier de validation. La persistance a été vérifiée après rechargement. Le livrable contrôlé est l’extrait Code Buddy de 60 secondes déjà monté avec le portrait et la voix de Lisa, des plans Flow/Seedance et un fond Suno.

Le workflow contrôle un relevé de mesures importé, associé à l’empreinte SHA256 du MP4. Il ne lit pas directement le fichier vidéo et ne lance pas FFmpeg. Sa sortie constitue un dossier de préparation ; aucune nouvelle vidéo, dépense ou publication n’est produite par cette exécution.

Contre-test réel : une durée déclarée de 90 secondes entraîne l’échec du nœud de contrôle ; les deux étapes suivantes ne sont pas exécutées. Un essai avec un timeout trop court a également révélé une course dans le moteur installé : succès et erreur de timeout pouvaient coexister. Le timeout du workflow de production a été corrigé en millisecondes ; la correction du moteur fait l’objet d’un worktree séparé.

Les médias, imports JSON et preuves contenant des identifiants locaux restent dans le dossier local `lisa-presentations-outils-2026-09-13/workflow/`. Les preuves techniques Code Buddy restent dans `_qa/audit/`.

## Vérifications

- Sonde réelle du service modifié : connexion à WorkflowBuilder réussie, iframe refusée détectée, arrêt sans effet sur le service externe, autre application HTTP 200 refusée.
- Workflow réel : cinq étapes réussies ; contre-test arrêté au contrôle ; cinq nœuds et quatre connexions retrouvés après rechargement.
- Tests ciblés : 49/49 (19 service, 6 interface, 24 IPC). Typecheck Cowork complet et lint ciblé, y compris preload : exit 0. Revue du diff et `git diff --check` réussis.

# Projets auto-évolutifs dans Cowork

Cowork peut transformer une règle ou une décision réutilisable en proposition
de mise à jour du Projet. Une proposition reste sans effet jusqu'à son
approbation explicite.

## Utilisation

1. Ouvrez `Réglages -> Projects` et activez le Projet concerné.
2. Dans `Project learning proposals`, choisissez la source :
   - la session Cowork actuellement ouverte ;
   - une synthèse écrite et relue par vous.
3. Choisissez la cible : l'instruction maîtresse ou un fichier texte relatif au
   workspace.
4. Créez la proposition, puis examinez sa raison, ses preuves et l'aperçu exact
   avant/après.
5. Utilisez `Approve and apply` ou `Reject`. Une mise à jour approuvée peut être
   restaurée avec `Rollback` tant que sa cible n'a pas été modifiée ensuite.

La détection est déterministe et locale. Elle ne déclenche aucun appel LLM et
n'envoie ni la session ni les fichiers à un fournisseur distant.

## États persistants

- `pending` : visible et sans effet ;
- `approved` : appliqué au Projet après validation ;
- `rejected` : conservé pour audit sans modification ;
- `rolled_back` : modification approuvée puis restaurée.

Les propositions sont enregistrées dans SQLite. Elles ne contiennent pas la
conversation brute : seulement des extraits de preuve bornés et filtrés.

## Garde-fous

- les empreintes SHA-256 de la valeur initiale et du workspace résolu bloquent
  une approbation obsolète, un changement de dossier ou une redirection par lien ;
- le rollback est également bloqué si une modification plus récente existe ;
- les clés, jetons, mots de passe et blocs PEM multilignes sont retirés avant
  la découpe en phrases ; toute ligne marquée comme expurgée est abandonnée ;
- les fichiers `.env`, clés, credentials, `.git`, `.codebuddy`, `node_modules`,
  formats binaires et liens symboliques sont refusés ;
- les fichiers de connaissance sont confinés au workspace, limités en taille et
  remplacés atomiquement avec des permissions privées ;
- le dossier parent d'un nouveau fichier doit déjà exister ;
- le journal d'audit de la proposition enregistre création, approbation, rejet,
  détection d'obsolescence et restauration sans recopier son contenu.

L'instruction ou le fichier approuvé rejoint ensuite le contexte explicite déjà
hérité par les futures sessions du Projet.

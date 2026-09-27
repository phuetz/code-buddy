# Reprise des mandats Lisa — revue 233

Ouvert le 25/09/2026 avant correction. Branche `feat/lisa-mandats-2026-09-24`, départ `43898b9b4`, correctif local `28e4d423c`.

Le rapport de livraison et les sorties brutes sont conservés dans le dossier de reprise du partage. Le cœur des mandats n'est pas branché dans le produit. Aucun service réel ne sera lancé.

## Correctifs candidats

- L'autonomie exige une identité propriétaire de confiance élevée ; la simple présence vocale est refusée.
- Les chemins de mandats effectifs, les clés, les identifiants, les configurations d'accès, la charte et le code des règles sont hors mandat, y compris sous un mandat couvrant le domicile.
- Un lien dur existant ou une cible qui est un répertoire ne peut pas recevoir d'action réversible autonome.
- `allow-with-checkpoint` porte une obligation explicite de point de retour ; le résultat ne prétend plus qu'il existe déjà. Une demande d'accord ne constitue jamais un accord par silence.
- Le test d'émission emploie un mandat valide et le compteur historique de tests est corrigé.

## Validation

Le canari Docker de cette session s'est arrêté avant le conteneur : accès refusé au socket Docker. Les tests, mutants, typecheck et lint restent à rejouer dans la barrière avant validation de la branche. Le contrôle statique `git diff --check` est passé. Aucune vérification Windows ni aucun service réel n'ont été exécutés.

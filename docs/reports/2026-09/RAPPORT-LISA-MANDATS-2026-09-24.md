# Rapport de mission — Lisa, les mandats (étape 3 du plan d'autonomie)

> Ouvert le 24/09/2026 avant l'écriture du code, selon la règle du dépôt.
> Branche `feat/lisa-mandats-2026-09-24`, base `origin/main`.

## Principe (charte de Lisa)

L'autorité suit la confiance ; l'effet décide ; le silence vaut refus ; Lisa ne touche jamais ses
propres garde-fous. Un **mandat** est un programme d'action écrit par le propriétaire : ce que Lisa
peut faire seule, dans quelles limites, et quand elle doit demander.

## Périmètre de cette PR

Le cœur, sans branchement : schéma, chargeur fermé en cas de doute, décision pure et testée. Le
branchement dans la politique d'exécution et le service de confirmation suivra, éclairé par
l'étude indépendante L3 (conduite en parallèle par la flotte).

## Déroulé

1. Cœur écrit : schéma strict, chargeur fermé en cas de doute, `decideAutonomousAction` pure (14 tests à cette étape).
   Faille vue à l'écriture : les cibles étaient comparées par chemin déclaré, un lien symbolique posé
   dans un dossier autorisé et pointant vers `~/.codebuddy/lisa` passait. Comparaison par chemin
   réel ; contre-essai : l'ancienne comparaison fait tomber exactement le test du lien piégé.
2. Contre-revue adversariale (Nemotron 3 Ultra). Retenus et corrigés : mots interdits contournés par
   un caractère invisible (normalisation par `deobfuscateSafeForScan`, appliquée aussi aux mots) ;
   mandat sans `chemins` = autonomie partout (désormais obligatoire) ; action réversible sans cible
   absolue (désormais demandée) ; dossier parent du fichier de mandats en lien symbolique (refusé) ;
   chemins protégés fournis par l'appelant (la liste par défaut est toujours imposée). Reporté au
   branchement : échange de lien entre la décision et l'exécution (l'outil devra ouvrir sans suivre
   les liens et revérifier). Écarté : fuseau de l'expiration (Lisa et son propriétaire partagent la
   même horloge locale).
3. Second juge, d'une autre lignée (agy, Gemini 3.6 Flash High), sur la version corrigée. Trois failles
   restantes, toutes confirmées et corrigées : une cible PARENT d'un garde-fou (déplacer `~/.codebuddy`)
   n'était pas protégée ; un lien symbolique PENDANT vers un dossier protégé faisait juger la cible par
   son dossier autorisé (désormais : chemin injugeable ⇒ refus) ; le dossier contenant le fichier de
   mandats n'était pas contrôlé (écriture de groupe ou d'autrui ⇒ fichier ignoré).

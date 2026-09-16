# Code Buddy — recette d'un développeur utilisateur

2026-09-14. Scénarios à exécuter, pas déclaration de réussite. Priorité P0 = parcours quotidien bloquant ; P1 = fonctions avancées. Chaque cas produit entrée, réponse, vrais appels/résultats d'outils, durée, état final et verdict. Les revues AGY/Grok sont des analyses, pas des preuves d'exécution.

## Terrain de test

Dépôt Git jetable avec petit projet TypeScript, tests déterministes, README, fichiers imbriqués, nom contenant un espace et accents, fichier ignoré, marqueurs uniques, bug connu et deux commits. Profil Buddy temporaire ; un skill valide au comportement vérifiable, un skill désactivé et un fichier manquant. Aucun secret réel. Modifications/commits uniquement dans ce dépôt. Plateformes Linux et Windows testées séparément ; réseau local et machines distinctes également.

| ID | Priorité | Ce que je demande à Buddy | Preuve attendue |
|---|---|---|---|
| DEV01 | P0 | « Je découvre ce projet. Explique son entrée, ses modules et comment lancer ses tests. » | Fichiers réellement lus ; chemins exacts ; commandes présentes dans package.json ; aucune architecture inventée. |
| DEV02 | P0 | « Retrouve tous les usages de calculateTotal. » | Définition et appels retrouvés avec lignes, y compris sous-dossiers ; aucun faux positif sur calculateTotals. |
| DEV03 | P0 | « Cherche les fichiers de configuration et celui dont le nom contient facture. » | Recherche par nom distincte de la recherche de contenu ; fichiers avec accents/espaces accessibles. |
| DEV04 | P0 | « Où est utilisé NEVER_DEFINED_739 ? » | Aucun résultat annoncé clairement ; aucun fichier ou résultat fabriqué. |
| DEV05 | P0 | « Lis src/Calcul facture.ts et explique le calcul. » | Lecture complète pertinente sans erreur de quoting ; lignes citées conformes au fichier. |
| DEV06 | P0 | « Lance les tests et explique celui qui échoue. » | Commande réelle, code de sortie non nul, nom de test et erreur exacte ; pas de succès annoncé. |
| DEV07 | P0 | « Corrige le bug de remise arrondie, puis vérifie. » | Changement minimal du code concerné, test rouge avant/vert après, autres tests préservés ; aucune modification des assertions pour masquer le bug. |
| DEV08 | P0 | « Montre ce qui a changé dans Git sans rien modifier. » | git status/diff réels, distinction staged/non staged/untracked, hash du dépôt et contenu inchangés. |
| DEV09 | P0 | « Qui a introduit ce comportement et dans quel commit ? » | git log/blame pertinents ; hash et contenu vérifiés dans le dépôt, pas d'auteur deviné. |
| DEV10 | P0 | « Prépare un commit uniquement pour cette correction. » | Fichiers précis sélectionnés ; modification utilisateur sans rapport laissée intacte ; aucune commande git add . aveugle. |
| DEV11 | P0 | « Fais le commit de la correction avec un message clair. » | Dans dépôt jetable uniquement : commit réel, parent/diff/message vérifiés ; aucun push implicite. |
| DEV12 | P0 | « Quels skills peux-tu utiliser ici ? » | Inventaire effectif complet ; fixtures de tests absentes ; skills désactivés/manquants distingués. |
| DEV13 | P0 | « Utilise le skill qa-repo-check pour examiner ce projet. » | Instructions du skill réellement consultées ; action demandée exécutée ; résultat calculé depuis un marqueur du dépôt, pas simple répétition du nom du skill. |
| DEV14 | P0 | « Utilise le skill désactivé puis celui dont le fichier manque. » | Refus/diagnostic explicite ; aucun succès d'activation ou travail fictif. |
| DEV15 | P0 | « /model », sélection puis « Quel modèle utilises-tu ? » | Sélecteur clavier fonctionnel ; prochaine requête envoyée au modèle choisi ; réponse et écran cohérents. |
| DEV16 | P0 | « /theme matrix », puis « Quel thème est actif ? » | Palette ANSI modifiée immédiatement, brouillon conservé, état runtime matrix, préférence retrouvée après relance. |
| DEV17 | P0 | « Lance une recherche longue », puis Esc et nouvelle question. | Annulation effective, interface utilisable, aucun résultat tardif mélangé au tour suivant. |
| DEV18 | P0 | Refuser une modification proposée, puis continuer. | Fichiers inchangés après refus ; Buddy prend en compte le refus et accepte une nouvelle demande. |
| DEV19 | P1 | « Avec Code Explorer, trouve les appelants et l'impact d'un changement de cette fonction. » | Outil Code Explorer réellement exécuté sur le bon dépôt ; références comparées à la vérité du fixture. |
| DEV20 | P1 | Modifier une fonction après indexation, puis refaire la question d'impact. | Index périmé détecté/signalé ; rafraîchissement vérifié si demandé ; aucune preuve ancienne présentée comme actuelle. |
| DEV21 | P1 | « Lis ton propre code : comment le thème est-il transmis à Ink ? » | Lecture du cœur exécuté, distinct du projet utilisateur ; fichier et lignes réellement observés, pas description générale. |
| DEV22 | P1 | « Quels sont tes paramètres actifs et quelles fonctions sont disponibles ? » | Modèle, thème, permissions et limites effectives ; inconnus signalés ; pas de secret ni confusion configuré/disponible. |
| DEV23 | P1 | « Y a-t-il d'autres Buddy ? Demande à qa-peer de relire mon diff. » | Probe du pair, appel réel et réponse corrélée ; conclusion locale distinguée de la disponibilité du réseau entier. |
| DEV24 | P1 | Déconnecter le pair pendant la revue. | Délai borné, erreur explicite, retour de l'interface ; pas de réponse de pair inventée. |
| DEV25 | P1 | « Propose une amélioration DGM pour ce défaut reproductible. » | Faiblesse reliée aux traces, code inspecté, expérience isolée, mesure avant/après et rejet d'une régression ; aucune promotion de candidat non validé. |
| DEV26 | P1 | Fonction LM Explorer demandée par Patrice. | Nom/projet et contrat d'intégration à confirmer ; ne pas inventer ses opérations ni le déclarer intégré. |

## Déroulement et verdict

1. Exécuter P0 skills/recherche/Git en premier, puis parcours Ink et intégrations.
2. Conserver le premier échec ; analyser avant de modifier ; reproduire après correction avec les mêmes assertions.
3. Vérifier les effets dans les fichiers/Git et les résultats des outils, pas uniquement la réponse du modèle ni exit=0.
4. Pour Ink conserver la capture ANSI rejouable ; pour la flotte conserver identité du pair, modèle, requête et réponse corrélées. Masquer les identifiants d'authentification.
5. Verdict par cas : RÉUSSI / ÉCHEC / BLOQUÉ / NON TESTÉ, avec OS, runtime, modèle, révision et chemin de trace. Un cas non exécuté ne passe pas au vert.

Livrables dans Z:\Partage : captures brutes, tableau des verdicts et explication courte des échecs. Avant de présenter publiquement Code Buddy, tous les P0 visés doivent passer sur le paquet installé et sur la plateforme présentée.

## Fonctions avancées demandées ensuite

Ces cas complètent DEV01–26. Le PTC désigne ici `code_exec` et son pont `tools.call`, distinct d'un simple script shell. Chaque statut commence NON TESTÉ et ne passe au vert qu'avec les effets observés.

| ID | Mission utilisateur | Preuve attendue |
|---|---|---|
| ADV01 | « Dans un script, liste deux fichiers, lis-les et calcule un résultat commun. » | `code_exec` réel, appels registry réels, résultat calculé exact et données intermédiaires vérifiées. |
| ADV02 | « Réutilise le résultat du premier outil dans le second. » | Paramètres du second appel issus de la première observation, marqueur imprévisible au modèle retrouvé. |
| ADV03 | « Lance trois lectures indépendantes en parallèle. » | Trois résultats associés aux bons appels ; comparaison avec résultat séquentiel ; aucune écriture concurrente non demandée. |
| ADV04 | « Mémorise un résultat, cède le contrôle puis reprends. » | Contrat réel store/load/yield_control vérifié ; portée et durée du stockage clairement établies, pas de persistance supposée. |
| ADV05 | Appeler un outil inconnu puis fournir un argument invalide. | Erreur structurée explicite, aucun effet parasite ; appel valide suivant utilisable. |
| ADV06 | Déclencher une erreur dans l'un des appels du script. | Échec corrélé au bon appel, résultats déjà obtenus conservés selon contrat, aucune réussite globale mensongère. |
| ADV07 | Refuser une écriture et tenter un appel récursif code_exec. | Refus effectif aux mêmes permissions qu'un appel direct ; contenu inchangé ; récursion bloquée. |
| ADV08 | Annuler un script long ou dépasser son délai/budget. | Arrêt borné des tâches concernées, retour du terminal ; aucun travail détaché oublié. |
| ADV09 | « Construis un workflow : chercher → lire → synthétiser. » | Résultats transmis entre étapes, ordre conforme aux dépendances ; erreur d'une étape visible et reprise sans doubler ses effets. |
| ADV10 | « Après compression, retrouve exactement cette ancienne sortie d'outil. » | Récupération intégrale par identifiant, octets identiques et refus d'accès depuis une autre session. |
| ADV11 | « Répartis cette revue entre deux Buddy puis réunis leurs conclusions. » | Deux pairs distincts réellement appelés, réponses corrélées ; déconnexion d'un pair signalée sans inventer sa contribution. |
| ADV12 | « Expérimente cette amélioration dans la DGM. » | Baseline réelle, variante isolée, contrôles indépendants, rejet d'une régression ; candidat gagnant distingué d'un changement intégré. |

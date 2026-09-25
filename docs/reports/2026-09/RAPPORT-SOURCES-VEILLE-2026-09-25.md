# Sources de veille CKG — rapport de mission

État source : branche `feat/research-sources-github-modeles-2026-09-25`, commit initial `8a2891851`, arbre initial propre. Snapshot initial : `DIFF-AVANT.patch` dans le dossier de livraison (fichier vide, aucun delta).

État candidat : commit local `e53a94b15`. GitHub Search et Hugging Face `/api/models` ajoutés à `buddy research ingest` ; `both` reste arXiv + Europe PMC. Les dépôts et modèles entrent comme découvertes CKG avec identifiants stables. Déduplication par `ingestPublication` existant.

État déployé : aucun ; push et fusion interdits.

Vérifications dans un `git archive` jetable, HOME/USERPROFILE/CODEBUDDY_HOME jetables, délai de 600 s par commande :

- Source avant changement : 19/19 tests existants verts (`01d-base-tests.brut.txt`). Les quatre nouveaux tests sur cette source sont rouges (`02-rouge-avant.brut.txt`).
- Candidat : 24/24 tests ciblés verts (`07-vert-final.brut.txt`) ; typecheck complet vert avec marqueur `TYPECHECK_OK` (`10-typecheck-confirme.brut.txt`) ; ESLint ciblé avec marqueur `ESLINT_CIBLE_OK` (`11-eslint-confirme.brut.txt`).
- Mutant déduplication : un échec attendu, quatre événements de ledger au lieu de deux (`05-mutant-dedup.brut.txt`).
- Mutant filtre d'étoiles : un échec attendu, deux dépôts admis au lieu d'un (`06-mutant-etoiles.brut.txt`).
- Un appel réel GitHub, sans jeton, sur une copie de ledger jetable : `fetch failed`, zéro résultat et ledger inchangé (`09b-reseau-reel.brut.txt`). Une première tentative d'exécution s'est arrêtée avant tout appel sur un socket `tsx` interdit (`09-reseau-reel.brut.txt`).

Les sorties brutes citées et le snapshot initial du diff se trouvent dans le dossier de livraison. La sortie réseau ne prouve donc pas la qualité des données GitHub en environnement connecté ; Hugging Face n'a pas été interrogé en réel.

## Ce que je n'ai pas pu vérifier

La réponse réelle des deux catalogues dans cet environnement : l'unique appel GitHub a échoué au niveau du réseau et aucun appel Hugging Face réel n'a été fait. La plateforme Windows et la barrière Docker seront rejouées par le pilote.

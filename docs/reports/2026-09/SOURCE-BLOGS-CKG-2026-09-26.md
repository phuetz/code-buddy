# Source blogs du CKG — 26/09/2026

Chantier réalisé par GPT-6 Sol sur `feat/research-sources-github-modeles-2026-09-25`.
Départ : `a36ee1e0e5dec55adfcd34743edb909e47157b2f`, arbre propre.
Code : `1cad66387` (`feat(research): ajouter les blogs RSS et Atom au CKG`).
Le snapshot initial et les sorties brutes sont conservés dans le dossier de livraison du lot blogs.

`--source blogs` lit une liste JSON de flux HTTPS, accepte RSS et Atom, filtre les
billets par tous les mots du thème et utilise l'URL canonique du billet pour la
déduplication. Un flux défaillant n'interrompt pas les autres. Une liste d'exemple
et le guide de recherche documentent la configuration.

Vérification dans un export `git archive` jetable avec HOME et USERPROFILE
isolés, commandes bornées à 600 secondes : base 24/24, nouveaux tests rouges
3/3, candidat final 29/29, typecheck et ESLint ciblé verts. Le test du quota
a d'abord trouvé un défaut de doublon entre flux ; test rouge puis correctif
vert. Deux mutants, déduplication et filtre thématique, sont rouges. Un appel
réseau réel a été tenté sur un ledger synthétique copié sous un CODEBUDDY_HOME
jetable ; le transport a échoué (`fetch failed`), le ledger est resté inchangé.

État : candidat local livré pour revue. Aucun déploiement, push ou fusion.

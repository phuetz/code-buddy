# Reprise locale de la relecture PR #239

Chantier réservé le 26/09/2026 sur `feat/dgm-catalogue-carte-2026-09-25`, départ `47398e96c`.

La livraison et les sorties brutes sont dans le dossier externe de reprise du lot 89. État initial : worktree propre, diff initial vide. Code : `1a974847e`.

Le défaut de `evolve propose` passe de 0,32 à 0,45. Un test de commande vérifie le défaut et la surcharge explicite. Le test de pertinence lit les 20 requêtes annotées et vérifie le filtre avec des découvertes synthétiques de part et d'autre du seuil. L'empreinte figée du catalogue est retirée ; les assertions d'affectation et de non-perte restent, avec un cas d'extension du catalogue.

Preuves brutes externes : rouge CLI 1/13, rouge empreinte 1/9 après ajout d'une entrée ; vert ciblé 23/23 ; trois mutants rouges. Suite appelante : 24 fichiers, 176/180 tests verts. Les quatre échecs de `variant-fitness-runproc` sont reproduits à l'identique sur le commit parent. La sonde de sous-processus montre un code 0 avec une sortie standard vide dans ce bac à sable. Typecheck 0 ; lint complet 0 erreur.

Le chemin CLI réel a été lancé avec un profil jetable ; il renvoie `PROVIDER_MISSING` avant le rappel, faute de fournisseur dans l'export. Aucun modèle ni réseau réel n'a été sollicité. Vérifications du commit final et limites détaillées dans le rapport externe.

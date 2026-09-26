# Reprise catalogue tests — 25 septembre 2026

État source : `48dd6db32`, branche `jules/cb-catalogue-tests-2026-09-25`.

État candidat : correctif `6f6103b4a` sur la branche `jules/cb-catalogue-tests-2026-09-25`. État déployé : aucun.

La contre-revue signale trois preuves invalides dans `REPORT.md` et un test de fédération dont le pont RPC est inerte. Les sorties avant, après et mutants sont conservées dans le dossier de livraison externe. Le delta initial est conservé sous `patch-avant.diff` dans ce dossier.

Le test de fédération traverse désormais le répartiteur RPC. Sans pont, il échoue sur l'absence de méthode enregistrée ; avec pont, il ingère deux entrées dans le graphe de destination. Le rapport cite les noms, lignes et valeurs des sorties réelles. L'inventaire précise que le test `buddy replay` ne couvre pas le journal Lisa.

Vérifications sur `6f6103b4a` dans un export jetable avec HOME et USERPROFILE temporaires : 18 fichiers et 113 tests distincts verts ; typecheck complet vert ; lint complet, 0 erreur et 2552 avertissements. Quatre mutants source rouges et la sonde sans pont rouge. Linux seulement ; réseau et plateformes Windows/macOS non exécutés. Aucun push ni fusion.

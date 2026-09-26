# Reprise DGM lot 70

Branche `feat/dgm-catalogue-carte-2026-09-25`, départ `d49c8ce22`, correctif `1c87fd7b8`.

La relecture a trouvé une empreinte périmée du catalogue généré. La commande `catalog articles` ajoutée depuis sa création fournit un identifiant légitime de plus, rattaché à `cli-interface` : 2 231 identifiants, zéro non rattaché. Le test a été corrigé et vérifie explicitement ce rattachement.

Sur export Git jetable : test rouge sur l'ancienne empreinte, 9 tests verts après correction, mutant avec ancienne empreinte rouge. Node ne peut lancer aucun sous-processus Git dans le bac (`EPERM`) ; un harnais jetable lui fournit la sortie `rev-parse HEAD` obtenue par Git dans le shell. La première passe large donne 179/202 tests ; les 23 échecs proviennent d'appels de sous-processus refusés par ce bac. Les sorties brutes, le détail du harnais et les vérifications finales sont dans le rapport de livraison externe.

Aucun push ni fusion. Windows natif et Docker ne sont pas exécutés.

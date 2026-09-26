# Chemins ouverts Lisa — étapes 4-6

Chemin 6 fermé : le microphone ne lit plus le journal même si le visage propriétaire est présent. La demande reçoit une réponse générique qui ne confirme pas le contenu du journal.

Preuves : `ROUGE-6.txt` (secret du journal prononcé), `VERT-6.txt` (6/6), `MUTANT-6.txt` (secret prononcé). État candidat local, non déployé.

Chemin 7 fermé : une proposition de modèle refusée ou soumise à décision est journalisée sans Telegram. Les pannes du mécanisme gardent leur alerte. Preuves : `ROUGE-7.txt` (alerte inattendue), `VERT-7.txt` (9/9), `MUTANT-7.txt` (2 alertes inattendues).

Chemin 8 fermé : le microphone ne crée aucun suivi, même après une adresse nominative ; la capture exige une identité propriétaire authentifiée sur Telegram ou PWA. Le texte de suivi du modèle est ignoré, le libellé est borné et les anciennes entrées sont assainies à la lecture. Preuves : `ROUGE-8.txt` (2 échecs), `ROUGE-8-IDENTITE.txt` (1 échec), `VERT-8.txt` (15/15), `MUTANT-8.txt` (2 échecs), `MUTANT-8-IDENTITE.txt` (1 échec). Typecheck complet : 0 erreur.

Chemin 9 : le pouls refuse toute autorité de lecture inconnue ; le shell refuse une commande destructive quand le point de retour Lisa manque, si le mode unifié est actif. Preuves : `ROUGE-9.txt` (3 lectures exécutées), `ROUGE-9-SHELL.txt` (4 commandes exécutées), `VERT-9.txt` (25/25), `MUTANT-9.txt` (7 échecs), `ROUGE-9-WRAPPER.txt` et `MUTANT-9-WRAPPER.txt` (1 échec chacun). Typecheck complet : 0 erreur. La charte de la PR #233, son identité et son compteur sont hors des trois branches : aucun raccord ajouté.

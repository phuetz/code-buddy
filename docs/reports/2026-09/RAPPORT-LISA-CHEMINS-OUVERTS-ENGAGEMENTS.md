# Chemins ouverts Lisa — engagements

Chemin 4 fermé : le filtre est actif par défaut, reconnaît les promesses et émissions du rapport, refuse une phrase mêlant rappel et e-mail, accepte un court libellé exact de rappel, et le tour vocal conserve la preuve du canal sans seconde contradiction.

Preuves : `ROUGE-4.txt` (13 échecs), `ROUGE-4-VOIX.txt` (contradiction parlée), `VERT-4.txt` (35/35), `MUTANT-4.txt` (14 échecs). Typecheck complet : 0 erreur. État candidat local, non déployé.

Chemin 5 fermé : la sortie générique « C'est fait » est remplacée par un constat limité aux outils exécutés ; en cas d'échec, l'outil et le motif sont nommés. Une image créée ne vaut pas preuve d'un e-mail envoyé. Preuves : `ROUGE-5.txt` (3 échecs), `VERT-5.txt` (11/11), `MUTANT-5.txt` (3 échecs). Typecheck complet : 0 erreur. Attention au conflit de fusion avec le même bloc de la PR #237 : conserver sa condition « tous les outils en échec » en intégrant ce bloc.

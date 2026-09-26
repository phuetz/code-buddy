# Remise à zéro — un tour concurrent n'est plus effacé

24 septembre 2026. Branche `feat/reset-sessions-messagerie-2026-09-23`, correctifs `ba4d32d7e` (verrou de session) et `affc8bc7c` (remise à zéro) après `7e35023f3`. Commits locaux uniquement : pas de push, pas de fusion.

Une contre-revue a montré qu'un tour écrit entre la dernière comparaison de la session et la sauvegarde de la session vidée disparaissait : ni dans la session, ni dans l'archive. La comparaison et l'effacement n'étaient pas dans une même section critique.

La cause est une classe, pas une ligne. Le verrou de session accepte un second détenteur de même PID : deux sections d'un même processus se chevauchaient, et la première libération effaçait le fichier de verrou sous les autres. `withSessionLock` ordonne désormais les sections d'un même chemin par une file en processus, en plus du fichier de verrou entre processus. Un appel imbriqué dans la même chaîne asynchrone y rentre sans attendre. Le magasin de sessions compare les octets archivés et vide la session dans une seule section sous ce verrou ; un fichier changé arrête la remise à zéro et laisse la session intacte. L'historique compagnon est relu, comparé et vidé sans attente entre ces trois gestes.

Un banc de concurrence (`tests/channels/messaging-reset-concurrency.test.ts`) entrelace, à chacune des cinq étapes de la remise à zéro, un tour ajouté par le magasin, un tour écrit sans verrou, un chiffrement de la session, un changement de politique et un tour compagnon, sur une session claire puis chiffrée. Il vérifie qu'aucun tour n'est perdu et qu'aucun octet stocké chiffré n'apparaît en clair. Sur l'ancien code, 9 entrelacements sur 50 perdaient un tour, dont 2 côté historique compagnon. Sur le nouveau, les 50 passent, et cinq mutants du correctif font chacun échouer le banc ou les essais du verrou.

Le détail et les preuves sont hors du dépôt public.

# Remise à zéro — archive de session copiée octet pour octet

24 septembre 2026. Branche `feat/reset-sessions-messagerie-2026-09-23`, correctifs `6efdc8794` (archive) et `5c272c254` (clé de session) après `ac156b9cd`. Commits locaux uniquement : pas de push, pas de fusion.

Une contre-revue a montré qu'une session chiffrée sur disque entre l'instantané et l'archivage pouvait laisser une archive en clair : l'archive était écrite depuis un contenu décodé, avec la règle de chiffrement de l'instantané. Le fichier de session est désormais lu une seule fois sous son verrou, et ces octets sont l'archive, sans décodage ni réécriture. Une copie d'un fichier chiffré est chiffrée par construction. Les autres magasins suivent la règle lue sur ces mêmes octets. Une session encore en clair alors que le chiffrement est exigé n'est ni archivée ni effacée. L'effacement n'a lieu que si le fichier porte toujours les octets archivés et la même règle.

Quatre premiers chiffrements parallèles dans un même processus créaient chacun une clé, parce que le verrou de session est réentrant pour son propre PID. Trois sessions sur quatre devenaient illisibles. La création de la clé passe maintenant par une file par chemin.

Le détail et les preuves sont hors du dépôt public.

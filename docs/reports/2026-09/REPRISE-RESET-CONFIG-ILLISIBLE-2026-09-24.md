# Remise à zéro — configuration présente mais illisible ou inanalysable

24 septembre 2026. Branche `feat/reset-sessions-messagerie-2026-09-23`, base `322df3465`. Commits locaux uniquement : pas de push, pas de fusion.

Un fichier de configuration présent sur le chemin de remise à zéro, mais illisible ou impossible à analyser, annule la remise à zéro. Un fichier absent ne l'annule pas.

- `8cc8da33a` : au moment de la remise à zéro, les deux `config.toml` (utilisateur, projet) sont relus. Un fichier qui n'est pas un fichier ordinaire, qui ne se lit pas, ou qui contient une ligne que `parseTOML` ignorerait, annule la remise à zéro.
- `9d69f6f85` : la politique appliquée vient du cache du chargeur. Le chargeur note maintenant chaque fichier présent qu'il n'a pas pu lire ou analyser ; la remise à zéro s'y refuse, même si le fichier a été réparé depuis. Les autres réglages gardent la fusion tolérante d'avant.
- Essai ajouté sur la seconde lecture avant effacement : une session modifiée entre l'archive et l'effacement n'est pas effacée.
- `4ed24925c` : le test de garde Windows couvre aussi l'essai qui retire le droit de lecture du `config.toml`.
- `8ea6e270f` : les essais du receveur et de la remise à zéro ne lisent plus le `config.toml` du développeur (HOME jetable importé en premier) ; un profil personnel ne peut plus changer leur verdict.
- `a57070d6f` : la politique en cache avait été calculée dans le répertoire courant du chargement, mais le contrôle relisait les fichiers dans celui du moment. Après un changement de répertoire vers un projet qui vaut « none », la session était effacée. La section `session_reset` est maintenant recalculée depuis les fichiers au moment de la remise à zéro, puis comparée à celle du chargement. Toute différence annule : autre répertoire, fichier modifié, créé ou supprimé. Même mesure pour un `CODEBUDDY_SESSION_RESET_ARCHIVE_DIR` relatif.
- Essai ajouté sur l'historique compagnon : un tour arrivé entre l'archive et l'effacement n'est pas effacé (la comparaison compagnon n'était couverte par aucun essai).
- `e83ccbf44` : la politique n'était contrôlée qu'au début du tour ; un fichier passé à « none » après l'archivage laissait effacer la session. Elle est maintenant relue juste avant l'archive, l'effacement de l'historique compagnon, l'écriture de la session vidée et l'éviction en mémoire. Un changement arrête la remise à zéro à cette étape ; ce qu'une étape antérieure a effacé avait été archivé.
- `ed6532b02` : l'archive d'une session chiffrée au repos contenait sa transcription en clair. Les quatre parties archivées (session, agent en cache, historique compagnon, carte locale) sont maintenant scellées avec la même enveloppe et la même clé que les messages, dès que le magasin chiffrerait la session. La relecture rouvre chaque archive avec la clé avant tout effacement ; le condensé porte sur la charge scellée. Les parties sont scellées une à une, car des créations de clé parallèles écrivent des clés différentes. Un essai par chemin d'écriture (quatre archives, fichiers temporaires, session vidée, journaux, export de fin de session) échoue si un octet de message apparaît en clair.

Les preuves détaillées (rouges, verts, mutants) sont hors du dépôt public.

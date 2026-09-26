# Remise à zéro — purges sous le verrou des écrivains

24 septembre 2026. Branche `feat/reset-sessions-messagerie-2026-09-23`, après `1be983881` : correctifs `d0226da21` et `3133c6a82`, essais `7f10bae3e` et `e14fd7ee2`. Commits locaux uniquement : pas de push, pas de fusion vers main.

La purge de l'historique compagnon relisait le fichier, le comparait à l'archive, puis le remplaçait par un enregistrement vide, sans verrou. Un tour écrit par un autre processus entre la dernière lecture et le renommage disparaissait, sans figurer dans l'archive. Chaque purge suit maintenant le même schéma : relire, comparer aux octets ou au transcript archivés, puis écrire, dans une seule section sous le verrou que prend l'écriture d'un tour.

- **Historique compagnon** : l'écriture d'un tour et la purge prennent le même verrou de fichier, partagé entre processus. Un tour relit le fichier sous ce verrou, et le cache d'un processus ne ramène plus des tours qu'un autre a purgés.
- **Session** : inchangée, elle était déjà comparée puis vidée sous le verrou de session.
- **Index SQLite** : les lignes indexées de la session sont supprimées dans cette même section, avant le renommage du fichier. Avant, la recherche retrouvait encore le texte d'une session vidée.
- **Archives** : la remise à zéro n'en supprime aucune. Un enregistrement est désormais créé sans pouvoir remplacer un fichier apparu à son nom. La restauration recalcule son empreinte et ignore les liens symboliques.

Le banc d'entrelacements s'arrête désormais aussi à l'intérieur de chaque purge, entre sa dernière lecture et son écriture finale. Il y fait écrire un tour par le même processus, puis par un vrai second processus Node. Un tour du second processus est soit conservé, soit refusé avec une erreur, jamais perdu en silence. Des mutants qui retirent le verrou, la purge de l'index, la relecture sous verrou, l'empreinte, le filtre des liens ou la création sans remplacement font chacun échouer leurs cas, et seulement eux.

Le détail et les preuves sont hors du dépôt public.

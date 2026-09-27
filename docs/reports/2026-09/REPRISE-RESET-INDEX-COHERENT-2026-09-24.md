# Reprise PR #207 : fichier de session et index SQLite cohérents à chaque échec (24/09/2026)

## Constats de la contre-revue

- **A1 (élevé)** : `clearSessionMessagesIfUnchanged` purgeait les lignes SQLite
  de la session avant d'écrire le fichier vidé. Un échec entre les deux
  (politique changée au renommage, écriture temporaire ou renommage en échec)
  laissait le tour dans le fichier et plus dans l'index. La recherche répond
  depuis SQLite dès qu'une autre session contient le terme, sans relire les
  fichiers JSON : la session n'était plus trouvée.
- **A2 (moyen)** : le reçu SHA-256 d'une copie brute n'était vérifié qu'à
  l'écriture. Une copie modifiée ensuite, restée un JSON de session valide, était
  restaurée sans erreur.

## Correctifs

- `feab6f676` : le fichier est vidé d'abord, l'index purgé ensuite. Tout échec
  à partir de l'écriture (y compris un échec signalé après le renommage, ou venu
  de la purge) remet les octets archivés dans le fichier avant de relever
  l'erreur. `deleteMessages` fait la suppression et la mise à jour du compteur
  dans une transaction.
- `b6f81ed8a` : le reçu d'une copie brute entre dans son nom
  (`<empreinte>.<époque>.<sha256>.session.json`), créé avec le fichier ; la
  restauration refuse une copie dont les octets ne lui correspondent plus, ou
  dont le nom n'en porte pas.

## Banc

`tests/channels/messaging-reset-index-coherence.test.ts` : 12 cas. Un échec
injecté à chaque étape (archive, politique à chaque point de contrôle, écriture
temporaire, renommage, échec signalé après renommage, purge d'index, purge
partielle), puis relecture du fichier, de l'index, de la recherche (une seconde
session contient le même tour) et de l'archive.

- Sur `c0d3075aa` : 4 échecs (politique au renommage, écriture temporaire,
  renommage, après renommage).
- Après correctif : 12/12.
- Mutants : ancien ordre → les 4 mêmes échecs ; sans restauration → 4 échecs
  (politique à la purge, après renommage, purge, purge partielle) ; sans
  transaction → 1 échec (purge partielle) ; sans contrôle du reçu → 1 échec
  (copie brute modifiée).

## Limites

- Un arrêt brutal du processus entre l'écriture du fichier et la purge de
  l'index laisse l'index avec les tours d'une session vidée : la session reste
  trouvée, jamais perdue ; les lignes restent jusqu'à une purge ultérieure.
- Si la restauration du fichier échoue elle aussi, le fichier peut rester vide
  alors que l'index garde les tours ; l'échec est journalisé et l'archive
  garde les tours.
- Une copie brute écrite avant `b6f81ed8a` (sans reçu dans son nom) n'est plus
  restaurée par l'API ; le fichier reste intact sur disque.

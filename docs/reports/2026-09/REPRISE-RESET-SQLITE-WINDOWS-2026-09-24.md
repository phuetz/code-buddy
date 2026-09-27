# Reprise PR #207 : cas SQLite du banc de remise à zéro sous Windows (24/09/2026)

## Constat

Run CI 36035264931, sur `7e1335b54`, jobs Windows Node 20 et 22 : les trois cas
`remise a zero : index SQLite de la session` échouent avec
`EBUSY: resource busy or locked, unlink '…\cb-reset-race-XXXX\codebuddy.db'`,
levé dans `afterEach` (`rmSync`). Leurs assertions passent : le journal
`INDEX_SQLITE` montre l'index vidé et le tour tardif conservé, comme sous Linux.

## Cause

Le test, pas le produit. `clearSessionMessagesIfUnchanged` purge l'index par
`deleteMessages` dans la base ouverte et ne supprime ni ne renomme jamais
`codebuddy.db`. C'est le singleton du gestionnaire de base, ouvert par le
magasin de sessions, que le test ne fermait pas : Windows refuse de supprimer un
fichier ouvert, Linux le supprime quand même.

## Correctif (`0c284fce8`)

- `resetIndexedSession` ferme la base (`resetDatabaseSystem`) avant de rendre la
  main, et dans son `finally` en cas d'erreur.
- Chaque cas vérifie, par `/proc/self/fd`, qu'aucun fichier de ses dossiers
  n'est encore ouvert. Sans `/proc` (macOS, Windows), la liste est vide et le
  `rmSync` du démontage reste la vérification.
- Le démontage réessaie brièvement (`maxRetries: 10`, `retryDelay: 100`), mais
  lève toujours si un fichier reste tenu.

## Preuves (Linux, réseau fermé, `ubuntu:24.04` pour charger better-sqlite3)

- Sans la fermeture : 3 échecs, exactement les trois cas du job Windows,
  `fichiers encore ouverts au demontage` avec `codebuddy.db`, `-wal`, `-shm`.
- Avec : 107/107.
- Mutant retirant les deux `closeDatabase()` du commit : 3 échecs, 104 verts.

## Hors périmètre

`tests/fleet/resource-catalog.test.ts` a échoué dans le job Windows Node 20
(`expected 'b' to be 'a'`). Même assertion sur `main` (run 35968185403, macOS
Node 20). La branche ne touche ni ce test ni `src/fleet/`. Non modifié ici.

# Réparation — un projet atteint par un lien symbolique était pris pour un autre projet

> Ouvert avant correction, selon la règle du dépôt. Branche `fix/macos-middleware-facades-2026-09-24`.

## Constat

`main` restait rouge sous macOS après #228, sur un autre test :
`tests/agent/middleware-facades.test.ts > le même projet n'est pas relu : un fichier modifié reste
sans effet` → `expected 90 to be 11`.

## Reproduction sans macOS

La condition de macOS est reproduite sous Linux en plaçant `TMPDIR` derrière un lien symbolique
(`…/var` → `…/private/var`). Le test échoue alors à l'identique (90 au lieu de 11), et passe avec
un `TMPDIR` normal. **Donnée qui tranche obtenue localement**, sans cycle de CI.

## Cause (défaut du produit)

`process.chdir(dir)` fait renvoyer à `process.cwd()` le chemin **réel**, alors que
`setWorkingDirectory(dir)` reçoit le chemin **déclaré**. `rebindProjectLimits()` comparait les
deux chaînes après un simple `path.resolve`, prenait le même projet pour un autre et relisait
`[middleware]` : un fichier modifié en cours de session prenait effet, contrairement au contrat.
Tout projet ouvert par un lien symbolique (checkout lié, alias macOS) était touché.

## Correction

`projectIdentity()` : chemin réel (`realpathSync`), repli sur le chemin résolu si le dossier
n'existe pas ; utilisé à l'initialisation et au changement de projet. Nouveau test : un lien vers
le même projet n'est pas un autre projet (hors Windows).

## Preuves

- Contre-essai : l'ancien `codebuddy-agent.ts` fait échouer le nouveau test du lien (1 échec, 31 verts).
- Sous l'alias simulé, `middleware-facades` passe en entier (32 tests).
- Balayage préventif de neuf familles de tests sous l'alias : 18 échecs, qui **ne sont pas des
  échecs macOS**. Ils échouent aussi sans l'alias dans ce worktree local, sur des tests qui lancent
  la CLI complète. La vraie CI macOS les a exécutés et n'a échoué que sur `middleware-facades`.
  Ce sont des artefacts de l'environnement local, laissés hors de ce correctif.
- La confirmation macOS viendra de la prochaine exécution de `main`.

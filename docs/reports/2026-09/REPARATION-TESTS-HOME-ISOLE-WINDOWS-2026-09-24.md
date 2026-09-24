# Réparation — portabilité Windows de l'isolation du HOME des tests (24/09/2026)

Suite de `REPARATION-TESTS-HOME-ISOLE-2026-09-24.md`. La PR #227 était verte sous Linux et rouge
sous Windows (job « Test on Node.js 22.x and windows-latest ») :

1. `os.homedir() est un dossier jetable distinct du HOME appelant` : `expected false to be true`,
   sur l'assertion « `XDG_*_HOME` est sous `os.homedir()` ».
2. `Playwright garde les navigateurs de l'appelant` :
   `expected '\home\runner\.cache\ms-playwright' to be '/home/runner/.cache/ms-playwright'`.

## Causes

1. `canonicalPath` passait le chemin entier par `realpath` natif et, en cas d'échec, gardait
   `path.resolve`. Le HOME jetable existe et son TEMP en nom court 8.3 (`RUNNER~1`) est développé ;
   `XDG_CONFIG_HOME` n'existe pas encore et gardait la forme courte. Il n'était donc plus « sous »
   le HOME. Reproduit sous Linux avec un `TMPDIR` qui passe par un lien symbolique (même
   mécanisme) : même assertion, même ligne.
2. `callerPlaywrightBrowsersPath` et `isolatedHomeEnv` utilisaient le `path` de l'hôte pour une
   plateforme simulée. Reproduit sous Linux en rechargeant les fonctions avec `node:path` simulé
   en `path.win32` : message identique à celui de la CI.

## Correctif

- Les fonctions pures passent dans `tests/setup/home-isolation-paths.ts`, sans effet de bord
  (`home-isolation.ts` les réexporte).
- `canonicalPath` canonicalise l'ancêtre existant le plus proche et y rattache la partie absente.
  Le système de fichiers n'est consulté que pour la plateforme de l'hôte.
- L'API de chemins suit la plateforme visée (`path.win32` ou `path.posix`), séparateur compris.
- Tests ajoutés : chemin absent sous un lien ou une jonction, `TMPDIR`/`TEMP` par un lien de bout en
  bout (Vitest enfant), hôte Windows simulé. Les attentes POSIX sont construites par `path.posix`.

## Vérification (conteneur sans réseau, HOME appelant garni de leurres)

- Test d'hygiène : 14/14 ; la sonde `TMPDIR` par un lien passe de rouge à vert.
- Mutants : ancienne canonicalisation → 3 rouges ; `path` de l'hôte → 3 rouges, dont le message
  exact de la CI.
- Suite complète en quatre tranches, sur `39a3b03b7` : 2 327 fichiers, 40 051 tests, 1 échec
  (`tests/scripts/render-native-fashion-clip.test.ts`). Il est préexistant : `Promise.all` sur cinq
  lectures, le premier rejet dans le temps gagne. Reproduit 1 fois sur 25 sur la révision de
  départ. Aucun fichier créé, modifié ou lu dans le HOME appelant.
- Type-check et lint : 0 erreur. `tsconfig.test.json` hérite de `exclude: ["tests"]` et ne vérifie
  donc aucun test. Les fichiers touchés ont été vérifiés par une configuration dédiée, et une
  erreur volontaire y est bien détectée.

## Non vérifié

Windows réel n'a pas été exécuté. En particulier : `realpathSync.native` sur un nom court 8.3 et
sur une jonction, et la résolution par Vite d'un import absolu `C:/…` dans le test de bout en bout.

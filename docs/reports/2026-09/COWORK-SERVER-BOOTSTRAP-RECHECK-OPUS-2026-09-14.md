# Contre-relecture du bootstrap serveur Cowork (stop pendant les imports) — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Fichiers : `cowork/src/main/server/server-bridge.ts`, `cowork/tests/server-bridge-lifecycle.test.ts`, ce rapport, ligne de coordination (formulation du lot cycle de vie corrigée), précision ajoutée au rapport cycle de vie
- Non touché : noyau, renderer, installation, rebuild, Electron, vrai profil, service persistant. Modifications JWT, cycle de vie et échec d'arrêt conservées.

## Verdict

**Remarque de relecture confirmée.** Dans le boot, `await loadCoreModule('database/database-manager.js')` n'était suivi d'aucun contrôle de génération avant `getDatabaseManager()` puis `await initialize()`. Un `stop()` demandé pendant l'import du module base laissait donc démarrer **une nouvelle initialisation de la base après la demande d'arrêt**. Aucun serveur n'était créé : le contrôle placé après le bloc base l'empêchait. La ligne de coordination du lot cycle de vie promettait un contrôle « après chaque attente », ce qui était faux pour ce point ; son rapport énumérait les contrôles sans ce trou.

**Corrigé** par un contrôle entre la fin de l'import et `getDatabaseManager()`. Une init **déjà commencée** n'est pas annulée : elle se termine, puis le contrôle suivant empêche la création du serveur (scénario existant « stop pendant l'init de la base »).

**Mêmes contrats vérifiés** :
- import Settings : aucun événement noyau (test existant) ;
- import du module serveur : aucun `startServer`. Nouveau test, déjà vert sur le code d'avant : le contrôle après import existait.

## Points de contrôle réels de `start()` après correction

1. Après l'import dynamique du store Settings (avant tout boot).
2. Après chaque attente d'un `stop()` en cours ou d'un boot annulé.
3. **Après l'import du module base de données, avant `getDatabaseManager()` / `initialize()`** (ajouté).
4. Après le bloc base de données (init comprise), avant l'import du module serveur.
5. Après l'import du module serveur, avant `startServer`.
6. Après `startServer` : fermeture tardive effective du serveur créé.

La résolution du secret JWT est synchrone, placée entre le point 2 et la première attente du boot : aucune fenêtre d'arrêt ne la sépare d'un contrôle.

## Rouge → vert

Faux noyau `held` : les modules `database/database-manager.js` et `server/index.js` ont une **attente top-level retenable** (`db:import`, `server:import`), qui rend l'import différé ; `getDatabaseManager()` journalise `db:getDatabaseManager`.

Nouveau test « does not get or initialize the database when stop is requested while its module is still loading », sur le code d'avant :

```
× does not get or initialize the database when stop is requested while its module is still loading
AssertionError: expected [ 'db:getDatabaseManager', …(1) ] to deeply equal []
- []
+ [
+   "db:getDatabaseManager",
+   "db:initialize",
+ ]
Tests  1 failed | 15 passed (16)
```

Après correction : vert. Le test vérifie aussi que :
- `stop()` ne se résout pas avant la fin de l'import ;
- `start` et `stop` répondent `running: false` ;
- aucun serveur n'est créé ;
- **un `start()` explicite ensuite** fait `db:getDatabaseManager`, `db:initialize`, `load:server`, `startServer:1:created`.

Nouveau test « does not create a server when stop is requested while the server module is still loading » : vert avant et après. Il vérifie :
- les événements `db:getDatabaseManager`, `db:initialize`, `load:server`, sans `startServer` ;
- `stop()` non résolu avant la fin de l'import ;
- le redémarrage explicite (serveur 1 ouvert, module serveur mis en cache par le pont).

## Validation

Toutes les commandes sont lancées depuis `cowork/`, Node 24.14.1. Pas de campagne de répétitions : aucune nouvelle source de synchronisation (même harnais retenu, sans serveur réel ajouté).

| Contrôle | Résultat |
| --- | --- |
| Suite cycle de vie sur le code d'avant | 1 rouge (import base), 15 verts |
| `npx vitest run tests/server-bridge-lifecycle.test.ts tests/server-bridge-jwt-coldstart.test.ts tests/embedded-mode.test.ts` | 3 fichiers, **66/66** (cycle de vie 16, JWT 11, `embedded-mode` 39) |
| `npx eslint --max-warnings 0`, `npm run lint -- --max-warnings 0` (pont et test) | 0 erreur, 0 avertissement |
| `npx tsc --noEmit -p tsconfig.json` | 0 erreur dans `server-bridge.ts` ; 20 erreurs préexistantes inchangées (noyau) |
| `tsc --noEmit --strict` ponctuel sur le test | OK |
| `git diff --check` | propre |
| Vrai `~/.codebuddy/.jwt_secret` | inexistant (vérifié sans lecture) |
| Modules partagés, `find -newerct 2026-09-14 03:19` hors caches Vite/Vitest | aucun changement |
| `/tmp`, journal du rouge | supprimés |

## Limites

- **Faux noyau, sans Electron** : Node 24 seulement.
- **Import réellement terminé** : le module base importé est mis en cache par `core-loader`, et le module serveur par le pont. Ces imports ne sont pas des initialisations et ne sont pas défaits.
- **Init déjà commencée** : elle se termine ; seul le serveur n'est pas créé.

## Passation

Fichiers de ce lot, à ajouter nommément :
- `cowork/src/main/server/server-bridge.ts`
- `cowork/tests/server-bridge-lifecycle.test.ts`
- `docs/reports/2026-09/COWORK-SERVER-BOOTSTRAP-RECHECK-OPUS-2026-09-14.md`
- `docs/reports/2026-09/COWORK-SERVER-LIFECYCLE-AUDIT-OPUS-2026-09-14.md` (précision)
- `docs/FABLE5-CODEX-COORDINATION.md` (ligne de ce lot, formulation du lot cycle de vie corrigée)

## Contre-validation Codex

Après port de tous les lots JWT et cycle de vie : 27 tests passent sous Node 20.20.2, dont les deux cas utilisant un vrai serveur HTTP loopback temporaire. Revue indépendante favorable sur l'état d'écoute, la conservation après échec et la reprise. Typecheck Cowork et lint ciblé verts avant l'ultime garde DB, puis le garde DB est vérifié par ces tests ; pas d'Electron ni de vrai démarrage du serveur complet du noyau.

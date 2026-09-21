# Verdict CI sur `main` après la reprise du lot de Grok — 21/09/2026

Ce rapport existe parce que j'ai **annoncé un verdict CI sans jamais le lire**. Le
voici, lu.

## Ce que dit la CI, run `35602220872`, commit `14f1f1ecc`

| Plateforme | Node 20 | Node 22 |
|---|---|---|
| ubuntu-latest | ✅ | ✅ |
| macos-latest | ✅ | ✅ |
| **windows-latest** | ❌ | ❌ |

`Security Audit` ✅ · `Build and Package` ignoré (dépend des tests).

**Donc la formule honnête est : la compilation est réparée et Linux/macOS passent ;
Windows reste rouge.** Pas « main est réparé ».

## Les tests distincts en échec — trois, pas une vague

Comptés sur les **titres distincts** des annotations d'échec des deux jobs Windows
(`failure=6` et `failure=5` occurrences, 17 et 16 annotations au total, **loin du
plafond de 50** : aucune troncature, donc le compte est complet).

| Fichier | Test | Assertion |
|---|---|---|
| `tests/deploy/one-click-deploy.test.ts:274` | `runOneClickDeploy > uses a local node_modules/.bin binary without PATH` | `expected false to be true` |
| `tests/deploy/one-click-deploy.test.ts:324` | `in-memory fs isolation > does not touch the real filesystem when fs is injected` | `expected false to be true` |
| `tests/server/shared-session.test.ts` | `rehydrates a WS agent when another participant advanced seq` | — |

Les deux premiers échouent sur la **même ligne** : `expect(report.ok).toBe(true)`.
`runOneClickDeploy` rend donc `ok:false` sous Windows.

## Cause établie par lecture du code : les fixtures, pas le produit

**Windows était vert** au run `35256430361` (17/09, `b5c50c189`, version 2.2.0). Les
trois échecs sont des régressions récentes. `src/deploy/one-click-engine.ts` et ses
tests sont arrivés par la PR #162, **après** ce dernier run vert : ils n'avaient
jamais tourné sous Windows.

| Test | Cause |
|---|---|
| `:274` | La fixture écrit `node_modules/.bin/wrangler` **sans extension** (ligne 44). Le produit, lui, est correct : ligne 99 du moteur, `platform === 'win32' ? ` + "`${name}.cmd`" + ` : name`. Il cherche `wrangler.cmd`, ne le trouve pas, rend `ok:false`. |
| `:324` | Le test passe `projectRoot: '/proj'` et bâtit les clés de son `Map` avec `path.join('/proj', …)` → `\proj\…`. Le moteur fait `path.resolve(request.projectRoot)` (ligne 310) → `C:\proj\…`. Les clés ne correspondent plus, `readFile` lève `ENOENT`. |
| `shared-session` | `ENOTEMPTY: directory not empty, rmdir` au **démontage** (ligne 203) : sous Windows un descripteur encore ouvert interdit de supprimer le dossier temporaire. Rien à voir avec le comportement testé. |

**Les trois sont des défauts de banc d'essai, aucun n'est un défaut produit.**

## Un constat annexe, non bloquant

Le test `:324` s'appelle « does not touch the real filesystem when fs is injected ».
Or le moteur, ligne 399, appelle `nodeFs.realpath` — le **vrai** système de
fichiers — quand le `fs` injecté ne fournit pas `realpath`. L'appel est enveloppé
dans un `try/catch` qui avale l'échec, si bien que le test passe malgré tout. Le nom
du test promet donc davantage que ce qu'il vérifie.

## Méthode

Les logs `gh run view --log` sont revenus **vides avec un code de sortie 0** (piège :
le silence n'était pas une erreur). La donnée qui tranche est venue de
`gh api repos/:owner/:repo/check-runs/<job>/annotations`, qui porte le **message
d'assertion** et non le seul nom du test — la distinction qui m'a manqué deux fois
en septembre.

## Nuance capitale : Windows ne bloque pas

`.github/workflows/ci.yml`, ligne 24 : `continue-on-error: ${{ matrix.os != 'ubuntu-latest' }}`.
**Seul Ubuntu est bloquant.** macOS et Windows tournent en « best-effort » : leurs
résultats sont publiés mais n'empêchent pas une CI verte, choix délibéré et commenté
dans le fichier (« deliberately visible, not a silent removal of coverage »).

Donc le rouge Windows du run `35602220872` **n'interdisait pas de publier**. Il
restait à corriger — c'est fait — mais la phrase juste est : « Ubuntu, la cible
bloquante, était au vert ; Windows, non bloquant, signalait trois bancs d'essai non
portables ».

La CI ne se déclenche par ailleurs **que sur `main` et `develop`**, ou par une
demande de tirage vers elles (`on: push: branches: [main, develop]`). Une branche de
correction ne déclenche rien tant qu'aucune PR n'est ouverte.

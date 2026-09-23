# Le typecheck de la CI dépend de onze paquets qui ont le droit de ne pas s'installer — 21/09/2026

> Rapport ouvert **après** le début de l'inspection, contrairement à l'invariant du
> dépôt. Je le note plutôt que de l'antidater.

## Le signal

La PR #187 (« trois bancs d'essai que Windows seul pouvait faire tomber ») a un job
rouge : `Test on Node.js 22.x and windows-latest`, run `35615398145`. Trois minutes,
là où le job Windows Node 20 du **même run** tourne 27 minutes et passe.

Un échec à 3 minutes sur une suite qui en prend 27 n'est pas un test qui tombe.

## Ce que dit le log, lu en entier

```
##[error]src/embeddings/embedding-provider.ts(137,41): error TS2307:
  Cannot find module '@xenova/transformers' or its corresponding type declarations.
##[error]Process completed with exit code 1.
```

L'échec est à l'étape **`Run type check`**, avant que le premier test ne démarre.
Il n'a donc rien à voir avec l'objet de la PR #187, qui corrige trois bancs d'essai.

## La donnée qui tranche : le compte de paquets installés

Même run, même `package-lock.json`, même commit :

| Job | `npm ci` | typecheck |
|---|---|---|
| Node 20.x / windows-latest | **added 1842 packages** | ✅ puis suite complète |
| Node 22.x / windows-latest | **added 1831 packages** | ❌ TS2307 |

Onze paquets de moins, et **aucune ligne d'erreur d'installation** dans le log : ni
`npm error`, ni `skipping optional dependency`, ni `EBADPLATFORM`. C'est le
comportement normal d'une `optionalDependencies` — un échec y est silencieux par
conception.

`@xenova/transformers` est déclaré en `optionalDependencies` (`package.json:233`) et
importé dynamiquement dans un `try/catch` (`embedding-provider.ts:137`). **À
l'exécution, le code est correct** : l'absence du paquet est rattrapée et donne un
message d'aide. C'est `tsc` qui refuse, parce qu'il lui faut les types.

## Le défaut est reproduit, pas supposé

```
mv node_modules/@xenova /tmp/…  &&  npx tsc --noEmit
→ exit 2, 1 erreur :
  src/embeddings/embedding-provider.ts(137,41): error TS2307: Cannot find module '@xenova/transformers'
```

Message, fichier et ligne identiques à ceux de la CI Windows.

## Et il est onze fois plus large que le symptôme du jour

25 dépendances optionnelles sont importées depuis `src/`. En écartant celles qui ont
déjà une déclaration de repli et celles couvertes par un `@types/*` (toujours
installé, puisqu'en `devDependencies`), **treize** restaient sans filet. Une seule
passe de `tsc` avec les treize retirées :

| Module absent | Erreurs TS2307 |
|---|---|
| `playwright` | 7 |
| `@nut-tree-fork/nut-js` | 7 |
| `string-width` | 6 |
| `jszip` | 4 |
| `@google/generative-ai` | 3 |
| `tree-sitter` | 2 |
| `@xenova/transformers` | 1 |
| `tree-sitter-bash` | 1 |
| `@picovoice/porcupine-node` | 1 |
| `node-pty` | 1 |
| `@anthropic-ai/sdk` | 1 |
| **total** | **34** |

`d3` et `matrix-js-sdk` étaient dans la liste des candidats et n'ont produit aucune
erreur : ils ne sont pas résolus statiquement. Je ne les corrige donc pas — on ne
répare pas ce qui n'est pas tombé.

**Conclusion : n'importe laquelle de ces onze optionnelles ratée sur un runner rend
la CI rouge, avec un message qui accuse le code alors que rien dans le code n'a
changé.** Aujourd'hui c'était `@xenova/transformers` sur Windows Node 22 ; demain ce
sera `playwright` ailleurs.

## La parade était déjà écrite dans la maison

`src/types/optional-deps.d.ts` porte déjà, pour `tar` et `sharp` :

```ts
// tar / sharp (optional) — typed-`any` fallback so
// `tsc --noEmit` passes when CI's `npm ci` omits optional deps. When the real
// package is installed its own types take precedence (verified both ways).
declare module 'tar';
declare module 'sharp';
```

Le défaut avait donc déjà été rencontré et tranché. Il restait à étendre la parade
aux onze autres, plutôt qu'à inventer une solution.


## Ma première parade était fausse — laissée ici, corrigée en dessous

J'ai d'abord étendu `src/types/optional-deps.d.ts` avec onze déclarations
abrégées, en m'appuyant sur le commentaire déjà présent dans le fichier :

> « When the real package is installed its own types take precedence (verified
> both ways). »

**Cette affirmation est fausse en général.** Le banc monté pour la vérifier — un
fichier temporaire contenant trois erreurs de type volontaires sur des API réelles
de `playwright`, `@anthropic-ai/sdk` et `string-width` — n'a signalé **aucune** des
trois : les modules étaient devenus `any`. Et `tsc` a rendu au même moment huit
erreurs neuves :

```
src/agent/hermes-browser-backends.ts(523,16): error TS2709: Cannot use namespace 'Browser' as a type.
… (6 occurrences Browser / BrowserContext)
src/lora/pack-dataset.ts(24,37):            error TS2709: Cannot use namespace 'JSZipInstance' as a type.
src/plugins/bundled/gemma-provider.ts(100,18): error TS2709: Cannot use namespace 'GoogleGenerativeAI' as a type.
```

Une déclaration abrégée `declare module 'x';` **écrase** les types réels. Elle ne
tient pour `tar` et `sharp` que parce que le code n'utilise aucun type nommé de ces
deux paquets — pas parce que TypeScript donnerait la priorité au paquet réel.

Ce chemin a donc été annulé (`git checkout -- src/types/optional-deps.d.ts`), et le
fichier n'est **pas** modifié par ce lot. Si quelqu'un veut un jour étendre ces
déclarations, qu'il sache qu'il rendra `any` tout ce qu'il déclare.

*(Le commentaire trompeur sur `tar`/`sharp` reste en place : le corriger sort du
périmètre de ce lot, mais il mérite une passe séparée.)*

## La parade retenue : nommer l'absence au lieu de la subir

`scripts/check-optional-deps.mjs`, exécuté en CI juste après `npm ci` dans les deux
jobs qui compilent (`test` et `build-matrix`) :

1. lit les `optionalDependencies` du `package.json` ;
2. garde celles que `src/` résout par leur nom — la liste n'est **pas** figée, elle
   est recalculée à chaque exécution, donc elle ne se périme pas ;
3. signale nommément celles qui manquent ;
4. avec `--install`, tente **une** réinstallation ciblée `--no-save`, puis échoue
   explicitement si l'une résiste.

Le typage n'est pas touché. Aucun `declare module` n'est ajouté.

## Bancs d'essai — révision `14f1f1ecc` (= `origin/main`)

Worktree dédié `~/DEV/cb-optionnelles-2026-09-21`, `npm ci` complet (1851 paquets).

| # | Banc | Attendu | Obtenu |
|---|---|---|---|
| 1 | Garde, toutes optionnelles présentes | silence, sortie 0 | `23 optional packages imported from src/ — all present.` exit 0 ✅ |
| 2 | **Contre l'ancienne logique** : `@xenova` retiré, **sans** garde | le défaut de la CI | `embedding-provider.ts(137,41): error TS2307` — fichier, ligne et colonne **identiques** à ceux du job Windows/Node 22 ✅ |
| 3 | Garde sur cette même absence | nomme le paquet | `1/23 optional package(s) … MISSING: - @xenova/transformers`, exit 1 ✅ |
| 4 | Garde `--install` sur cette même absence | répare | `Repaired — every needed optional package is now present.` exit 0 ; version `2.17.2` (celle du lock), `package-lock.json` **inchangé** ✅ |
| 5 | Câblage npm (`npm run check:optional-deps`) | même verdict | exit 0 ✅ |
| 6 | `npm run typecheck` complet après le lot | vert | exit 0, **0 erreur** ✅ |
| 7 | ESLint sur le nouveau script | vert | exit 0 ✅ |
| 8 | Syntaxe du workflow (`yaml.safe_load`) | valide | 3 jobs, 18 + 7 étapes ✅ |

Le banc 2 est celui qui compte : il tombe sur l'**ancienne** logique. Un banc qui ne
tomberait pas dessus ne prouverait rien.

## Ce que ce lot ne prouve pas

- **Pourquoi** les onze paquets ont manqué sur ce runner. Le log ne porte aucune
  cause : ni `EBADPLATFORM`, ni erreur réseau, ni `skipping optional dependency`.
  Le garde rend l'incident lisible et réparable ; il n'explique pas l'origine.
- Que la réinstallation ciblée réussira sur un runner Windows. Elle est prouvée
  ici sous Linux ; sur Windows, en cas d'échec, le garde échoue avec un message
  nommé — ce qui reste très supérieur à un `TS2307` qui accuse le code.
- Le comportement du job `Security Audit`, qui ne compile pas : il n'a pas reçu le
  garde, délibérément.

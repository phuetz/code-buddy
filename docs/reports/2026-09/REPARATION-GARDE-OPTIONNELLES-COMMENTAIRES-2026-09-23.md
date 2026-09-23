# Réparation — le garde des dépendances optionnelles lisait les commentaires (23/09/2026)

Agent : Opus 5.5 (Claude Code), en surveillant la CI des PR #194 à #198.

## Symptôme

PR #195, job Windows / Node 20 : échec **avant les tests**, à l'étape
« Ensure optional dependencies needed to compile are present » :

```
[optional-deps] 1/23 optional package(s) imported from src/ are MISSING:
  - usearch
[optional-deps] The reinstall command itself failed.
[optional-deps] STILL MISSING after reinstall: usearch
```

## Cause (mesurée)

`usearch` n'est jamais importé par un spécificateur littéral : `src/search/`
le charge via une variable, précisément pour que `tsc` n'en ait pas besoin
(PR #190). Le garde (PR #189) a pourtant trouvé une correspondance : sa regex
`(?:from|import|require)\s*\(?\s*['"]usearch…` accroche le **commentaire**
`src/search/usearch-index.ts:206` :

```
// Use a non-literal specifier so `tsc` doesn't require 'usearch' to be
```

Les deux PR ont été fusionnées à 43 secondes d'écart ; chacune était verte seule.

## Correctif

Les commentaires sont retirés avant la recherche (`stripComments`). Un `//`
précédé de `:` ou d'un guillemet est conservé, pour ne pas couper une URL dans
une chaîne. `CHECK_OPTIONAL_DEPS_ROOT` permet de tester le garde sur un dépôt
fixture.

## Vérifications

- Liste des paquets exigés, ancien garde contre nouveau, sur `main` : 23 → 22,
  la seule différence est `usearch`.
- `tests/scripts/check-optional-deps.test.ts` : 3/3. Rejoué contre l'ancienne
  logique reconstituée (sans `stripComments`) : le cas « nommé seulement en
  commentaire » tombe, les deux autres restent verts.

## Non traité, observé

« The reinstall command itself failed » sous Windows : `execFileSync('npm', …)`
sans shell ne résout vraisemblablement pas `npm.cmd`. Plausible, **non mesuré** ;
laissé hors de ce correctif.

# Code Buddy 2.0 — état vérifiable avant push

Date : 2026-08-31  
Dépôt : `/home/patrice/code-buddy`  
Branche : `fix/ci-green-2026-08-30`  
Push : **aucun**

## Bilan

Les portes demandées sont vertes. Une seule correction a été nécessaire : le mock Doctor de `tests/commands/utility-commands.test.ts` ne suivait plus le contrat de `src/doctor/index.ts` et omettait l'export `summarizeDoctorChecks`. Le correctif est commité sous `22914f27` (`test(commands): align doctor mock with summary contract`). Aucun fichier produit n'a été modifié.

## Typecheck

Commande : `npm run typecheck`

AVANT — sortie réelle, exit 0 :

```text
> @phuetz/code-buddy@2.0.0 typecheck
> tsc --noEmit && npm run typecheck:darkstar-identity

> @phuetz/code-buddy@2.0.0 typecheck:darkstar-identity
> tsc --project tsconfig.darkstar-identity.json
```

APRÈS — sortie réelle, exit 0 :

```text
> @phuetz/code-buddy@2.0.0 typecheck
> tsc --noEmit && npm run typecheck:darkstar-identity

> @phuetz/code-buddy@2.0.0 typecheck:darkstar-identity
> tsc --project tsconfig.darkstar-identity.json
```

Fichiers corrigés : aucun.

## Lint

Commande : `npm run lint`

AVANT — fin de sortie réelle, exit 0 :

```text
✖ 2441 problems (0 errors, 2441 warnings)
  0 errors and 8 warnings potentially fixable with the `--fix` option.
```

APRÈS — fin de sortie réelle, exit 0 :

```text
✖ 2441 problems (0 errors, 2441 warnings)
  0 errors and 8 warnings potentially fixable with the `--fix` option.
```

Fichiers corrigés : aucun. Les 2441 warnings stylistiques ont été laissés intacts conformément à la consigne.

## `tests/commands`

Commande : `npm test -- tests/commands/ --reporter=dot`

AVANT — extrait et synthèse réels, exit 1 :

```text
FAIL  tests/commands/utility-commands.test.ts > utility CLI commands > runs doctor checks against the global --directory target
Error: [vitest] No "summarizeDoctorChecks" export is defined on the "/home/patrice/code-buddy/src/doctor/index.ts" mock. Did you forget to return it from "vi.mock"?

FAIL  tests/commands/utility-commands.test.ts > utility CLI commands > returns a failing status when doctor finds no ready provider
Error: [vitest] No "summarizeDoctorChecks" export is defined on the "/home/patrice/code-buddy/src/doctor/index.ts" mock. Did you forget to return it from "vi.mock"?

Test Files  1 failed | 93 passed (94)
     Tests  2 failed | 1112 passed (1114)
```

APRÈS — sortie réelle, exit 0 :

```text
Test Files  94 passed (94)
     Tests  1114 passed (1114)
  Duration  7.19s (transform 48.91s, setup 2.23s, import 61.29s, tests 25.96s, environment 8ms)
```

Vérification ciblée intermédiaire réelle :

```text
Test Files  1 passed (1)
     Tests  3 passed (3)
  Duration  194ms (transform 51ms, setup 28ms, import 62ms, tests 12ms, environment 0ms)
```

Fichier corrigé : `tests/commands/utility-commands.test.ts`. Le mock expose désormais une implémentation fidèle du résumé Doctor (`passed`, `warnings`, `errors`, `optionalNotInstalled`).

## `tests/cli`

Commande : `npm test -- tests/cli/ --reporter=dot`

AVANT — sortie réelle, exit 0 :

```text
Test Files  13 passed (13)
     Tests  92 passed (92)
  Duration  48.96s (transform 827ms, setup 180ms, import 1.10s, tests 54.33s, environment 1ms)
```

APRÈS — sortie réelle, exit 0 :

```text
Test Files  13 passed (13)
     Tests  92 passed (92)
  Duration  59.62s (transform 1.31s, setup 301ms, import 1.64s, tests 68.40s, environment 1ms)
```

Fichiers corrigés : aucun.

## `tests/tools`

Commande : `npm test -- tests/tools/ --reporter=dot`

AVANT — sortie réelle, exit 0 :

```text
Test Files  153 passed (153)
     Tests  1577 passed (1577)
  Duration  19.57s (transform 44.09s, setup 3.08s, import 71.93s, tests 77.85s, environment 15ms)
```

APRÈS — sortie réelle, exit 0 :

```text
Test Files  153 passed (153)
     Tests  1577 passed (1577)
  Duration  20.12s (transform 46.76s, setup 3.42s, import 76.27s, tests 79.34s, environment 15ms)
```

Fichiers corrigés : aucun. La sortie indique aussi que Piper ou `CODEBUDDY_TTS_PIPER_MODEL` n'était pas disponible pour la preuve de synthèse réelle ; ce scénario est conçu pour se neutraliser dans cet environnement et la suite reste intégralement verte.

## `tests/agent`

Commande : `npm test -- tests/agent/ --reporter=dot`

AVANT — sortie réelle, exit 0 :

```text
Test Files  193 passed (193)
     Tests  2584 passed (2584)
  Duration  12.34s (transform 63.01s, setup 3.71s, import 100.95s, tests 43.25s, environment 17ms)
```

APRÈS — sortie réelle, exit 0 :

```text
Test Files  193 passed (193)
     Tests  2584 passed (2584)
  Duration  9.14s (transform 69.72s, setup 3.95s, import 108.06s, tests 39.96s, environment 16ms)
```

Fichiers corrigés : aucun.

## `tests/security`

Commande : `npm test -- tests/security/ --reporter=dot`

AVANT — sortie réelle, exit 0 :

```text
Test Files  36 passed (36)
     Tests  748 passed (748)
  Duration  6.61s (transform 8.05s, setup 2.31s, import 10.15s, tests 13.05s, environment 4ms)
```

APRÈS — sortie réelle, exit 0 :

```text
Test Files  36 passed (36)
     Tests  748 passed (748)
  Duration  5.44s (transform 6.95s, setup 830ms, import 9.26s, tests 7.53s, environment 3ms)
```

Fichiers corrigés : aucun.

## `tests/utils`

Commande : `npm test -- tests/utils/ --reporter=dot`

AVANT — sortie réelle, exit 0 :

```text
Test Files  27 passed (27)
     Tests  511 passed | 3 skipped (514)
  Duration  1.37s (transform 5.78s, setup 1.12s, import 6.93s, tests 2.28s, environment 3ms)
```

APRÈS — sortie réelle, exit 0 :

```text
Test Files  27 passed (27)
     Tests  511 passed | 3 skipped (514)
  Duration  1.41s (transform 6.91s, setup 718ms, import 8.19s, tests 2.54s, environment 2ms)
```

Fichiers corrigés : aucun. Les 3 tests ignorés sont déclarés comme tels par la suite ; ils ne sont pas des échecs.

## `tests/context`

Commande : `npm test -- tests/context/ --reporter=dot`

AVANT — sortie réelle, exit 0 :

```text
Test Files  39 passed (39)
     Tests  594 passed (594)
  Duration  3.06s (transform 11.24s, setup 1.22s, import 15.06s, tests 6.63s, environment 5ms)
```

APRÈS — sortie réelle, exit 0 :

```text
Test Files  39 passed (39)
     Tests  594 passed (594)
  Duration  2.86s (transform 11.66s, setup 1.16s, import 14.60s, tests 5.86s, environment 4ms)
```

Fichiers corrigés : aucun.

## Ce qui reste rouge

Rien de rouge dans le périmètre demandé.

Restes non rouges et honnêtement visibles :

- lint : 2441 warnings, 0 erreur ; non corrigés car la consigne exclut les warnings stylistiques ;
- utils : 3 tests ignorés ;
- tools : preuve Piper réelle neutralisée faute de binaire/modèle configuré dans cet environnement ;
- la suite complète d'environ 27K tests n'a pas été lancée, conformément à l'interdiction de la lancer d'un coup.

## Fichiers et commits

- Correction : `tests/commands/utility-commands.test.ts` — commit `22914f27`.
- Passation : `CODEX-2.0-PUSH.md` et `docs/FABLE5-CODEX-COORDINATION.md`.
- Aucun fichier `src/` corrigé.
- Aucun fichier PdfCommander, workflow ou NexusFile touché.
- La suppression préexistante `.depcheckrc.json` et les fichiers non suivis préexistants ont été laissés hors commits.


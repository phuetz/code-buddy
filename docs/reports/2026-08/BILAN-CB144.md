# BILAN-CB144
- CI réelle : `gh run view 32658887593 --job ... --log | grep -E 'FAIL|×|error'` donne six fois `src/channels/matrix/index.ts(192,7): TS2578`.
- Correction appliquée : suppression du `@ts-expect-error` devenu obsolète après `matrix-js-sdk@36.2.0`.
- Preuves vertes : `git diff --check` ; `npx prettier --check docs/install.md` ; ancre docs ; contrôle package/lockfile ; `npm ls --package-lock-only matrix-js-sdk --depth=0`.
- `npm run typecheck` échoue : `sh: 1: tsc: not found`.
- `npx tsc --noEmit` échoue : `This is not the tsc command you are looking for`.
- `npm test -- --run tests/channels/matrix.test.ts` échoue : `sh: 1: vitest: not found`.
- Cause locale : `ls -ld node_modules` répond `No such file or directory`; aucun `npm install`/`npm ci` n’a été exécuté.
- Reste ouvert : typecheck/tests CI après installation normale des dépendances ; push impossible car interdit par le garde-fou non négociable.

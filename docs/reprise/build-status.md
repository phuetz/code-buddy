# Build status - 2026-05-14

Etat mesure dans le worktree `D:\CascadeProjects\_audit-code-buddy-main`, branche
`codex/reprise-stabilisation`.

## Vert

```bash
npm test -- tests/server/peer-tool-bridge.test.ts tests/fleet/fleet-handler.test.ts tests/server/peer-websocket-smoke.test.ts
# 88 tests passed

npm --prefix cowork test -- run tests/regenerate-helpers.test.ts tests/textarea-autogrow.test.ts tests/backend-status.test.ts tests/tool-status.test.ts src/tests/prepare-skills.test.ts src/tests/pre-build-check.test.ts
# 49 tests passed

npm run typecheck
# passed

npm --prefix cowork run typecheck
# passed

npm run build
# passed

npm run validate
# passed: lint + typecheck + 852 test files

npm test -- tests/server/api-keys-store.test.ts tests/server/peer-websocket-smoke.test.ts
# 6 tests passed

node dist/index.js api-key create --name "Fleet smoke" --scope fleet:listen --scope peer:invoke --json
node dist/index.js api-keys list --all-users --json
# passed with CODEBUDDY_API_KEYS_FILE pointing at a temporary store

node dist/index.js whoami
# ChatGPT connected; plan pro; source .codebuddy/codex-auth.json

$env:CODEBUDDY_PROVIDER="chatgpt"; node dist/index.js --print "Reponds exactement: Code Buddy utilise ChatGPT Pro." --output-format text --no-color --no-emoji
# returned "Code Buddy utilise ChatGPT Pro."; model gpt-5.5; cost 0

npm test -- tests/codebuddy/providers/provider-chatgpt-responses.test.ts tests/utils/cost-chatgpt-subscription.test.ts tests/providers/codex-oauth.test.ts tests/providers/codex-oauth-storage.test.ts tests/providers/codex-oauth-e2e.test.ts tests/utils/provider-detector.test.ts tests/commands/handlers/auth-handlers.test.ts tests/doctor/chatgpt-oauth-check.test.ts tests/unit/models-snapshot.test.ts tests/utils/model-utils.test.ts tests/unit/embedding-provider.test.ts tests/knowledge/workspace-indexer.test.ts
# 194 tests passed

npx eslint src/providers/codex-oauth.ts src/utils/provider-detector.ts src/commands/handlers/auth-handlers.ts src/doctor/index.ts src/embeddings/embedding-provider.ts src/knowledge/workspace-indexer.ts src/config/constants.ts src/config/model-tools.ts src/index.ts tests/providers/codex-oauth-storage.test.ts tests/utils/provider-detector.test.ts tests/commands/handlers/auth-handlers.test.ts tests/unit/embedding-provider.test.ts tests/knowledge/workspace-indexer.test.ts tests/unit/models-snapshot.test.ts tests/utils/model-utils.test.ts
# passed with existing warnings only; 0 errors

npm run lint -- --quiet
# passed

node dist/index.js --help
# passed

node cowork/scripts/pre-build-check.js
# 8 passed, 0 warnings, 0 failed after prepare:skills

npm --prefix cowork run build
# passed; generated cowork/release/Code Buddy Cowork-1.0.0-rc.8-win-x64.exe
```

## Debloque pendant la reprise

- `cowork/resources/tray-icon.png` et `tray-iconTemplate.png` etaient absents
  alors que `cowork/scripts/build-tray-icon.js` et `electron-builder.yml` les
  exigent.
- Les PNG de tray sont maintenant versionnables via des exceptions ciblees dans
  `cowork/.gitignore`.
- `cowork/scripts/prepare-skills.js` reconstruit
  `cowork/.bundle-resources/skills` depuis `src/skills/bundled/*.skill.md` au
  build, au lieu d'exiger un dossier manuel non versionne. Le package copie ce
  dossier vers `resources/skills`, sans inclure d'eventuelles skills locales
  dans `cowork/.claude`.
- `bufferutil` et `utf-8-validate` etaient declares comme dependances
  optionnelles directes de Cowork. Electron Builder essayait donc de les
  reconstruire avec `node-gyp`, ce qui exigeait Visual Studio Build Tools sur
  Windows. Ils ont ete retires: `ws` fonctionne sans ces accelerateurs natifs.
- `peer:request` accepte maintenant les cles `admin` pour les appels Fleet
  d'administration et renvoie une reponse `peer:response` correlee sur refus de
  scope, au lieu de laisser le client expirer en timeout.
- Code Buddy reutilise maintenant les credentials ChatGPT du Codex CLI
  (`~/.codex/auth.json`) quand son fichier local est absent. Le logout Code
  Buddy ne supprime pas ce login partage.
- `gpt-5.5` et les modeles Codex subscription (`gpt-5.1-codex`,
  `gpt-5-codex`) sont reconnus comme modeles supportes, ce qui retire le
  warning inutile pendant les appels ChatGPT Pro.
- L'indexeur workspace ne demarre plus apres une initialisation incomplete des
  embeddings, et le fallback mock des embeddings ne plante plus quand aucun
  listener `error` n'est attache.
- Les erreurs ESLint restantes ont ete supprimees sur le scope global:
  `npm run lint -- --quiet` passe. Les corrections gardent le comportement
  existant: catches attendus documentes, regex de controle construites sans
  litteraux de controle, et detection Unicode reformulee sans classes ambigues.
- La suite Vitest complete ne tombe plus en OOM sur Windows. Le crash venait du
  parseur AST: les patterns "non supporte" utilisaient `/$/g`, ce qui creait des
  boucles infinies sur matches vides pour Python/Go. Ils sont remplaces par un
  pattern impossible, et les anciens blocs FCS/Buddy du test lourd sont marques
  comme doublons legacy car `tests/unit/fcs-parser.test.ts` couvre deja le
  parseur canonique.
- Les tests Windows instables autour de BashTool sont stabilises: les commandes
  POSIX strictes restent Unix-only dans le test de securite legacy, les env vars
  controlees sont propagees a WSL via `WSLENV`, et les tests de taches de fond
  attendent les sorties par polling plutot que par sleeps fixes.
- Les cles API serveur Fleet sortent du mode "memoire du process": elles sont
  stockees sous forme de hash local, rechargees par le serveur quand le store
  change, et gerables par `buddy api-key` / `buddy api-keys`.

## Blocage leve

Avant cette reprise, `npm --prefix cowork run build` avancait jusqu'a
`electron-builder`, puis echouait sur le rebuild natif de `bufferutil`:

```text
Error: Could not find any Visual Studio installation to use
node-gyp failed to rebuild ... cowork\node_modules\bufferutil
```

Le build complet passe maintenant sans Visual Studio Build Tools dans cet
environnement. Les warnings restants sont des warnings Vite de taille de chunks
et de dynamic/static import; ils ne bloquent pas le packaging.

## Toujours rouge hors reprise

`npm run lint -- --quiet` est vert. Le lint complet garde de nombreux warnings
historiques (`no-explicit-any`, variables inutilisees dans des tests/scripts),
mais plus d'erreurs bloquantes connues.

`npm run validate` est vert dans ce worktree. Les warnings restants pendant le
run sont historiques ou attendus par les tests (logs stderr, warnings Node,
outils optionnels absents comme `nvidia-smi`).

## Lecture produit

- Le CLI est dans une zone beta proche: build, help, typecheck et tests Fleet
  cibles passent.
- Cowork compile, bundle et package son installeur Windows.
- Fleet minimal a de meilleurs garde-fous: lecture fichier bornee sans charger
  tout le fichier en memoire, listing plafonne, sortie `/fleet tool` nettoyee
  avant affichage, refus d'autorisation renvoye au bon appelant, et creation
  de cles `fleet:listen` / `peer:invoke` testable depuis la CLI.

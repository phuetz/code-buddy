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

npm test -- tests/cloud/cloud-agent-runner.test.ts tests/daemon/cron-agent-bridge.test.ts tests/daemon/heartbeat.test.ts tests/desktop/codebuddy-engine-adapter-hotswap.test.ts tests/server/agent-provider.test.ts tests/channels/channel-ai-provider.test.ts tests/unit/parallel-executor.test.ts tests/unit/provider-command.test.ts tests/agent/architect-mode.test.ts tests/commands/agents-handler.test.ts tests/commands/handlers/test-handlers-ai.test.ts tests/unit/prompt-suggestions-ai.test.ts tests/unit/config-validation-startup.test.ts tests/computer-skills-llm.test.ts tests/unit/reasoning-tool.test.ts tests/reasoning/think-handlers.test.ts tests/unit/hook-llm-evaluation.test.ts tests/unit/ide-extensions-server.test.ts tests/unit/interpreter-llm.test.ts tests/utils/provider-detector.test.ts
# 352 tests passed

npm test -- tests/features/cicd-chrome-sdk-pr.test.ts tests/features/hooks-policies-memory-settings.test.ts tests/features/sandboxing-hooks.test.ts
# 246 tests passed; feature tests that exercise explicit no-provider paths force CODEBUDDY_PROVIDER=none

node dist/index.js provider current
# Active Provider: ChatGPT Pro (subscription); Model: gpt-5.5

npm test -- tests/toml-config.test.ts tests/commands/agents-handler.test.ts tests/agent/multi-agent/orchestrator-agent.test.ts tests/agent/multi-agent/provider-overrides.test.ts
# passed: config parser/merge, swarm role planning, agents lifecycle, per-role providers

npm run validate
# passed again after multi-agent/provider override stabilization

npm --prefix cowork test -- run tests/fleet-discovery.test.ts tests/fleet-bridge.test.ts tests/fleet-panel-discovery-entry.test.ts tests/fleet-ipc-api-keys.test.ts
# 22 tests passed

npm --prefix cowork run typecheck
# passed

npm test -- tests/fleet/capability-registry.test.ts tests/fleet/task-router.test.ts tests/server/peer-websocket-smoke.test.ts
# 34 tests passed

npx eslint src/fleet/capability-registry.ts tests/fleet/capability-registry.test.ts --quiet
# passed

npm test -- tests/agent/multi-agent/fleet-workflow-bridge.test.ts tests/agent/multi-agent/session-fleet-bridge.test.ts tests/agent/multi-agent/heterogeneous-providers.test.ts tests/agent/multi-agent/workflow-orchestrator.test.ts tests/fleet/fleet-listener.test.ts tests/fleet/fleet-handler.test.ts tests/server/fleet-bridge.test.ts
# 154 tests passed

npm --prefix cowork test -- run tests/saga-runner.test.ts tests/fleet-bridge.test.ts tests/fleet-discovery.test.ts tests/fleet-panel-discovery-entry.test.ts tests/fleet-ipc-api-keys.test.ts
# 25 tests passed

npm --prefix cowork run build:e2e
# passed; Vite/Electron build with existing chunk-size/dynamic-import warnings

npm run build
# passed

node --input-type=module -e "import { getLocalCapabilities, resetCapabilityCache } from './dist/fleet/capability-registry.js'; resetCapabilityCache(); const cap = await getLocalCapabilities({ force: true }); console.log(JSON.stringify({ egress: cap.egress, machineLabel: cap.machineLabel, models: cap.models.filter(m => m.provider === 'chatgpt-oauth').map(m => m.id).slice(0, 5) }, null, 2));"
# returned chatgpt-oauth models: gpt-5.5, gpt-5.1-codex, gpt-5-codex

npm run validate
# passed again after Cowork Fleet and ChatGPT capability fixes

npm test -- tests/server/channel-a2a-bridge.test.ts tests/protocols/a2a.test.ts tests/protocols/a2a-task-router.test.ts tests/protocols/a2a-skill-selection.test.ts tests/protocols/a2a-skill-routing.test.ts tests/protocols/a2a-remote-agents.test.ts tests/protocols/a2a-codebuddy-executor.test.ts
# 70 tests passed after remote A2A result/status propagation fix

npm --prefix cowork test -- run tests/a2a-bridge-polling.test.ts
# 5 tests passed

npx eslint src/protocols/a2a/index.ts src/server/routes/a2a-protocol.ts tests/protocols/a2a-task-router.test.ts --quiet
# passed

npm run typecheck
# passed

npm test -- tests/server/channel-a2a-bridge.test.ts tests/protocols/a2a-task-router.test.ts
# 18 tests passed after authenticated Channel -> A2A self-call fix

npx eslint src/server/channel-a2a-bridge.ts src/server/index.ts tests/server/channel-a2a-bridge.test.ts --quiet
# passed

npm run build
# passed

npm test -- tests/server/server-channel-shutdown.test.ts tests/server/peer-websocket-smoke.test.ts tests/server/channel-a2a-bridge.test.ts
# 14 tests passed after stopServer awaited ChannelManager shutdown

npx eslint src/server/index.ts tests/server/server-channel-shutdown.test.ts --quiet
# passed

npm run typecheck
# passed

npm run build
# passed

npm --prefix cowork test -- run tests/a2a-bridge-polling.test.ts
# 7 tests passed after A2A task clear/remove cleanup

npm --prefix cowork run typecheck
# passed

npx eslint cowork/src/main/a2a/a2a-bridge.ts cowork/src/main/index.ts cowork/src/preload/index.ts cowork/src/renderer/components/settings/SettingsA2AAgents.tsx cowork/tests/a2a-bridge-polling.test.ts --quiet
# passed

npm --prefix cowork run build:e2e
# passed; existing Vite chunk-size/dynamic-import warnings only

npm test -- tests/server/channel-a2a-bridge.test.ts tests/server/server-channel-shutdown.test.ts tests/server/peer-websocket-smoke.test.ts tests/protocols/a2a.test.ts tests/protocols/a2a-task-router.test.ts tests/protocols/a2a-skill-selection.test.ts tests/protocols/a2a-skill-routing.test.ts tests/protocols/a2a-remote-agents.test.ts tests/protocols/a2a-codebuddy-executor.test.ts tests/fleet/capability-registry.test.ts tests/fleet/task-router.test.ts
# 106 tests passed in the combined A2A/Fleet regression sweep

npm --prefix cowork test -- run tests/a2a-bridge-polling.test.ts tests/fleet-bridge.test.ts tests/fleet-discovery.test.ts tests/fleet-panel-discovery-entry.test.ts tests/fleet-ipc-api-keys.test.ts
# 29 tests passed in the Cowork A2A/Fleet regression sweep

npm run typecheck
# passed

npm --prefix cowork run typecheck
# passed

npm test -- tests/utils/provider-detector.test.ts tests/config/config-resolver.test.ts tests/unit/provider-command.test.ts tests/unit/status-memory-section.test.ts
# 73 tests passed after deleting the dead legacy provider detector in src/index.ts

npx eslint src/index.ts --quiet
# passed

npm run typecheck
# passed

npm run build
# passed

npm test -- tests/channels/new-channels.test.ts tests/channels/feishu-cards.test.ts tests/channels/synology-chat.test.ts
# 103 tests passed after channel client-boundary cleanup

npm test -- tests/channels/signal.test.ts tests/channels/new-channels.test.ts tests/channels/feishu-cards.test.ts tests/channels/synology-chat.test.ts
# 192 tests passed after Signal stopped fabricating fallback message IDs

npx eslint src/channels/zalo/index.ts src/channels/line/index.ts src/channels/mattermost/index.ts src/channels/nextcloud-talk/index.ts src/channels/twilio-voice/index.ts src/channels/nostr/index.ts src/channels/irc/index.ts src/channels/feishu/index.ts src/channels/synology-chat/index.ts src/channels/signal/index.ts src/channels/index.ts tests/channels/new-channels.test.ts tests/channels/feishu-cards.test.ts tests/channels/synology-chat.test.ts tests/channels/signal.test.ts --quiet
# passed

npm run typecheck
# passed

npm test -- tests/features/tailscale-dashboard-nodes.test.ts
# 72 tests passed after MessageTool transport-boundary cleanup

npx eslint src/tools/message-tool.ts tests/features/tailscale-dashboard-nodes.test.ts --quiet
# passed

npm run typecheck
# passed

npm test -- tests/desktop-automation/screen-recorder.test.ts
# 2 tests passed after screen recorder placeholder removal

npx eslint src/desktop-automation/screen-recorder.ts tests/desktop-automation/screen-recorder.test.ts --quiet
# passed

npm run typecheck
# passed
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
- Les tests qui masquaient le routage avec un mock global de
  `provider-detector` utilisent maintenant de vrais signaux env/OAuth
  temporaires. Il reste des mocks reseau/process/fichiers volontaires, mais
  plus de faux provider dans les chemins runtime testes.
- Les tests feature qui attendent volontairement "aucun provider" isolent
  maintenant `CODEBUDDY_PROVIDER=none`, pour rester deterministes meme quand le
  poste de dev est connecte a ChatGPT Pro via OAuth.
- `ConfigResolver` ne retombe plus sur la base URL ou le modele Grok quand un
  provider CLI non-Grok est force sans base URL explicite. Les profils non-Grok
  sans modele prennent aussi leur default provider (`gpt-4o`, Gemini, Claude,
  etc.) au lieu de `grok-code-fast-1`.
- Les plans `/swarm` restent maintenant sur les roles reellement executables
  (`orchestrator`, `coder`, `reviewer`, `tester`) et normalisent les anciens
  roles OpenClaw vers ces agents, au lieu de produire un workflow impossible a
  lancer.
- `/agents stop` et `/agents disable` arretent directement le workflow lance,
  sans redetecter un provider ni reconstruire un systeme different de celui qui
  tourne.
- Le parseur TOML charge maintenant les sections profondes documentees comme
  `[profiles.night.agent]`, et la fusion de configuration conserve les blocs
  runtime (`multi_agent_system`, `heartbeat`, `autonomous_fleet`, `profiles`,
  etc.) au lieu de les ignorer silencieusement.
- Les swarms peuvent declarer des providers differents par role via
  `[multi_agent_system.agents.<role>]` avec `provider`, `api_key_env`,
  `base_url` et `model`. Les secrets restent hors TOML; ChatGPT reutilise le
  login Codex OAuth et Ollama garde son mode local.
- Cowork hydrate maintenant les capabilities Fleet via `peer.describe` apres
  authentification. Le Command Center peut donc router vers des peers
  reels au lieu de rester bloque sur "No peer with known capabilities".
- La discovery Cowork probe le port `3000` de `buddy server` puis le port
  legacy `3001`, avec override `CODEBUDDY_FLEET_DISCOVERY_PORTS`. Cela aligne
  le scan Tailscale avec les exemples `/fleet listen ws://...:3000/ws`.
- Les libelles Cowork du serveur embarque ne parlent plus d'un faux port
  WebSocket `3001`: le bouton serveur et Settings -> Server indiquent que
  WebSocket utilise le meme port HTTP, chemin `/ws`.
- Le registre de capabilities Fleet annonce maintenant ChatGPT Codex OAuth
  (`chatgpt-oauth`) quand le login Codex/ChatGPT existe. Un peer qui utilise
  ton abonnement ChatGPT Pro n'apparait donc plus avec `peerChatProvider`
  renseigne mais zero modele routable.
- Le routage A2A distant preserve maintenant les sorties des spokes:
  `result` devient une reponse lisible meme sans artifact, les artifacts/messages
  distants sont conserves, et un statut distant `failed` reste `FAILED` cote hub
  au lieu d'etre transforme en succes local.
- Le endpoint `/api/a2a/tasks/send` propage les metadonnees simples
  (`metadata.model`, `traceId`, etc.) jusqu'au client A2A. Le bridge Channel ->
  A2A peut donc vraiment porter son hint de modele quand un hub ou spoke le
  consomme.
- Quand l'auth serveur est activee, le bridge Channel -> A2A signe maintenant
  ses self-calls loopback avec un JWT admin court genere cote serveur. Les
  canaux externes ne se bloquent donc plus sur `requireScope('admin')` en
  production.
- `stopServer()` attend maintenant la fin de `ChannelManager.shutdown()` avant
  de rendre la main. Les pollers/listeners de channels ne restent donc pas en
  arriere-plan pendant un redemarrage rapide.
- Cowork A2A expose maintenant un vrai `clearTask` cote main process. Le bouton
  "Remove from list" ne supprime plus seulement l'etat React local, et retirer
  un agent nettoie aussi les taches suivies de cet agent pour eviter les lignes
  orphelines apres rechargement.
- `src/index.ts` ne contient plus l'ancienne implementation inline de detection
  provider. La source de verite est maintenant uniquement
  `src/utils/provider-detector.ts`, ce qui reduit la confusion entre heritage
  Grok et provider ChatGPT/Codex actif.
- Le mode headless respecte maintenant `--output-format` avant l'alias
  compatible `--output`. Un smoke live avec ton login ChatGPT Pro a confirme
  `node dist/index.js --print ... --output-format text --quiet`: stdout ne
  contient plus que la reponse modele attendue.
- Le runtime Fleet loopback a ete valide hors mock via `dist`: serveur
  WebSocket local avec auth activee, cle admin ephemere, `peer.ping`,
  `peer.describe`, `peer.tool.invoke list_directory` sur `docs/reprise`, et
  annonce `peerChatProvider: { provider: "chatgpt", model: "gpt-5.5" }`.
- Le meme loopback appelle maintenant vraiment `peer.chat` via ChatGPT Pro:
  prompt exact `Reply exactly: Fleet peer chat OK.` -> reponse
  `Fleet peer chat OK.`, `finishReason: stop`, traceId present.
- Cowork renderer ne cree plus de sessions, reponses ou chemins de travail
  factices quand `window.electronAPI` est absent. Le hook signale maintenant
  explicitement que le bridge desktop est indisponible, et l'utilisateur ne voit
  plus une conversation simulee comme si Code Buddy avait repondu.
- Les bindings de scripting `grok.ask`, `grok.chat` et `mcp.call` ne retournent
  plus de reponses artificielles sans client Code Buddy ou manager MCP. Le
  runtime de script propage aussi maintenant `success: false` quand l'execution
  echoue apres un parse reussi.
- Les providers cloud `s3`, `gcs` et `azure` ne simulent plus des uploads/listes
  vides. Tant que les adaptateurs reels ne sont pas branches, la factory echoue
  explicitement; seul le provider `local` reste operationnel pour sync/backup.
- `buddy nodes invoke` ne renvoie plus un succes `dispatched` sans transport
  compagnon branche. Une invocation de node valide mais non cablee echoue
  maintenant explicitement au lieu de masquer l'absence de WebSocket/device.
- Le service de localisation ne renvoie plus Paris comme fausse geolocalisation
  IP par defaut. La source `ip` exige maintenant `ipGeoApiUrl`; `gps` et
  `network` echouent explicitement tant qu'ils ne sont pas implementes.
- `AdvancedParallelExecutor` ne simule plus des agents reussis avec
  `Completed task`. Sans runner reel injecte, chaque tache echoue clairement;
  avec un `agentRunner`, l'execution parallele utilise le resultat fourni.
- `ChromeBridge` ne simule plus les actions navigateur (`navigate`, `click`,
  `type`, `evaluate`, `screenshot`, `wait`) quand aucune extension ne repond.
  Les commandes sortantes restent en file pour Chrome, puis reussissent
  uniquement via `receiveActionResponse` ou echouent par timeout explicite.
- Le module email ne presente plus son stockage memoire comme un vrai
  IMAP/SMTP. Sans adaptateur reel, `ImapClient` et `SmtpClient` echouent au
  `connect`; le transport memoire doit etre demande explicitement par
  `transport: "memory"` pour les tests. Les webhooks email passent maintenant
  par `fetch` par defaut et exposent une injection explicite pour les tests.
- Le module `screen-capture` ne fabrique plus des captures/ecrans et
  enregistrements factices par defaut. Le backend natif echoue clairement tant
  qu'il n'est pas implemente; le backend memoire est maintenant explicite via
  `backend: "memory"` dans les tests.
- `SkillsRegistry` ne presente plus son catalogue code en dur comme un registre
  distant operationnel. La source distante echoue tant qu'un vrai client n'est
  pas branche; le catalogue memoire doit etre demande explicitement par
  `source: "memory"` dans les tests.
- `PluginMarketplace.install` ne cree plus un `index.js` de remplacement apres
  telechargement. Tant qu'un vrai extracteur d'archive plugin n'est pas branche,
  l'installation echoue explicitement et nettoie le dossier partiel.
- Les embeddings locaux ne basculent plus automatiquement sur des vecteurs
  `mock` quand le modele local ne charge pas. L'echec est propage; l'integration
  base de donnees peut continuer sans vecteurs mais signale que les embeddings
  sont indisponibles.
- `DesktopAutomationManager` n'enregistre plus le provider `mock` par defaut et
  ne tombe plus dessus quand les providers reels sont absents. Le provider mock
  reste disponible uniquement si `provider: "mock"` est demande explicitement.
- `SmartSnapshotManager` ne retourne plus des elements UI inventes quand
  AT-SPI/UIAutomation/AX echoue. Les erreurs d'accessibilite donnent maintenant
  une liste vide ou les elements OCR reels, sans boutons `OK`/`Cancel` factices.
- `TTSManager` n'installe plus le provider `mock` quand aucun provider voix
  n'est configure. Le provider mock reste disponible pour les tests, mais doit
  etre demande explicitement via `provider: "mock"`.
- `MessagePreprocessor` n'injecte plus de pseudo-transcription audio dans les
  messages entrants. Une transcription n'est ajoutee au contexte que si un vrai
  transcripteur est configure explicitement.
- `GitNexusMCPClient` ne se declare plus connecte en mode stub et ne renvoie
  plus de graphes vides par defaut. Les requetes GitNexus exigent maintenant un
  transport MCP explicite.
- L'action `summarize` du `PruningManager` ne fabrique plus un faux resume par
  troncature. Elle exige maintenant un summarizer explicite; `compact` reste
  l'action adaptee pour couper du contenu sans pretendre le resumer.
- Le provider vocal `system` ne lance plus un AppleScript placeholder. Il echoue
  explicitement tant qu'une vraie integration Speech/Whisper n'est pas choisie.
- Les adapters niche Twitch/Tlon/Gmail ne renvoient plus de succes reseau
  factice. L'envoi de message et le watch Gmail exigent maintenant des clients
  reels injectes explicitement.
- `CodeBuddyAgent` expose maintenant la facade serveur reelle attendue par les
  routes HTTP/WebSocket (`processUserInput`, `streamResponse`,
  `executeTool(name, params)`, `getModel`) au lieu d'un alignement `any` futur.
- Les adapters LINE, Zalo, Nostr, Mattermost, Nextcloud Talk, Twilio Voice,
  IRC, Feishu et Synology Chat ne simulent plus une connexion ou un envoi
  reussi sans transport. Les chemins reseau exigent maintenant un client ou
  transport reel injecte; les builders locaux Feishu restent disponibles sans
  pretendre appeler l'API.
- Signal ne fabrique plus un `messageId` local avec `Date.now()` quand
  `signal-cli-rest-api` accepte l'envoi mais ne renvoie pas de timestamp: le
  resultat reste un succes HTTP, mais l'identifiant reste absent.
- `MessageTool` ne fabrique plus des `msg-*` / `thread-*` ni des actions
  moderation pretendument reussies. Les actions cross-channel exigent
  maintenant un transport explicite; sans transport, l'outil echoue clairement
  et n'enregistre pas l'action.
- `ScreenRecorder` ne produit plus de video noire placeholder sur Wayland et
  ne declare plus un enregistrement reussi si le fichier de sortie est absent
  ou vide.

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

Le lint Cowork reste a reprendre separement: le script `npm --prefix cowork run
lint -- --quiet` utilise encore une option CLI ESLint legacy, et un lint force
avec le binaire racine remonte des erreurs historiques hors du patch Fleet.

## Lecture produit

- Le CLI est dans une zone beta proche: build, help, typecheck et tests Fleet
  cibles passent. Le chemin headless ChatGPT Pro est aussi valide en runtime
  (`--output-format text --quiet`).
- Cowork compile, bundle et package son installeur Windows.
- Fleet minimal a de meilleurs garde-fous: lecture fichier bornee sans charger
  tout le fichier en memoire, listing plafonne, sortie `/fleet tool` nettoyee
  avant affichage, refus d'autorisation renvoye au bon appelant, et creation
  de cles `fleet:listen` / `peer:invoke` testable depuis la CLI. Le loopback
  `peer.chat` -> ChatGPT Pro passe maintenant en smoke manuel sur `dist`.
- Le bloc OpenClaw dans `docs/fleet-guide.md` reste une architecture cible, pas
  un chemin runtime termine: aujourd'hui le code actif et teste couvre le hub
  A2A Code Buddy, le bridge Channel -> A2A et le bridge A2A Cowork. Le daemon
  OpenClaw separe (`openclaw gateway`, lockfile `~/.openclaw/gateway.json`) est
  encore a brancher si l'on veut Telegram/WhatsApp/ClawHub via OpenClaw.

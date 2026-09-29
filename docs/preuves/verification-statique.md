# Static source and wiring audit — updated 2026-09-29

This audit lists the checked source files and executable code fragments for each curated feature. It is **static evidence only**. A passing entry here is *wired*, not a successful user scenario or an installed release. All paths are repository relative.

`buddy catalog status --json` was run from the compiled checkout with an isolated HOME; its 91 curated entries were present and coded/wired. See [command trace](inventaire-catalog-status.log).

## catalog-status

- Domain: `cli`
- Code: `src/catalog/status.ts`, `src/commands/cli/catalog-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'catalog'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerCatalogCommands(program)`.
- Entrypoint check: `src/commands/cli/catalog-command.ts` contains code fragment `.command('status')`.

## resource-catalog-tool

- Domain: `agent-tools`
- Code: `src/fleet/resource-catalog.ts`, `src/tools/resource-catalog-tool.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/resource-catalog-tool-defs.ts` contains code fragment `name: 'resource_catalog'`.
- Entrypoint check: `src/codebuddy/tools.ts` contains code fragment `registerGroup([RAGCHAT_TOOL_DEF, RESOURCE_CATALOG_TOOL_DEF`.
- Entrypoint check: `src/tools/registry/research-tools.ts` contains code fragment `new ResourceCatalogTool()`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createResearchTools()`.
- Live limit: Resource selection was not exercised in a live agent turn.

## http-health

- Domain: `server-api`
- Code: `src/server/routes/health.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/server/index.ts` contains code fragment `app.use('/api/health', healthRoutes)`.
- Entrypoint check: `src/server/routes/health.ts` contains code fragment `router.get(
  '/',`.

## telegram-channel

- Domain: `sensory`
- Code: `src/channels/telegram/index.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `handleChannels(action, options)`.
- Entrypoint check: `src/commands/handlers/channel-handlers.ts` contains code fragment `case 'telegram': {`.
- Entrypoint check: `src/commands/handlers/channel-handlers.ts` contains code fragment `return new TelegramChannel({`.
- Live limit: Requires a Telegram account and token; neither was used.

## fleet-cli

- Domain: `fleet`
- Code: `src/commands/cli/fleet-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'fleet'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerFleetCommands(program)`.
- Live limit: Status was inspected, but peer dispatch needs a second configured peer.

## cli-daemon

- Domain: `cli`
- Code: `src/commands/cli/daemon-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'daemon'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerDaemonCommands(program)`.
- Entrypoint check: `src/commands/cli/daemon-commands.ts` contains code fragment `registerDaemonCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-ruche

- Domain: `fleet`
- Code: `src/commands/cli/ruche-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'ruche'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerRucheCommand(program)`.
- Entrypoint check: `src/commands/cli/ruche-command.ts` contains code fragment `registerRucheCommand`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-trigger

- Domain: `cli`
- Code: `src/commands/cli/daemon-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'trigger'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerTriggerCommands(program)`.
- Entrypoint check: `src/commands/cli/daemon-commands.ts` contains code fragment `registerTriggerCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-speak

- Domain: `sensory`
- Code: `src/commands/cli/speak-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'speak'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerSpeakCommand(program)`.
- Entrypoint check: `src/commands/cli/speak-command.ts` contains code fragment `registerSpeakCommand`.
- Live limit: No AudioReader, Pocket or Voicebox backend was started inside the isolated session; the command has no Piper backend despite Piper being installed, and host audio services were left untouched.

## cli-assistant

- Domain: `sensory`
- Code: `src/commands/assistant.ts`, `src/companion/assistant-config.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'assistant'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerAssistantCommand(program)`.
- Entrypoint check: `src/commands/assistant.ts` contains code fragment `registerAssistantCommand`.
- Live trace: [p8-cli-assistant.log](p8-cli-assistant.log).

## cli-widgets

- Domain: `cli`
- Code: `src/commands/widgets.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'widgets'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerWidgetsCommand(program)`.
- Entrypoint check: `src/commands/widgets.ts` contains code fragment `registerWidgetsCommand`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-security

- Domain: `security`
- Code: `src/commands/cli/security-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'security'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerSecurityCommand(program)`.
- Entrypoint check: `src/commands/cli/security-command.ts` contains code fragment `registerSecurityCommand`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-heartbeat

- Domain: `sensory`
- Code: `src/commands/cli/native-engine-commands.ts`, `src/daemon/heartbeat.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'heartbeat'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerHeartbeatCommands(program)`.
- Entrypoint check: `src/commands/cli/native-engine-commands.ts` contains code fragment `registerHeartbeatCommands`.
- Live trace: [p8-cli-heartbeat.log](p8-cli-heartbeat.log).

## cli-hub

- Domain: `cli`
- Code: `src/commands/cli/native-engine-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'hub'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerHubCommands(program)`.
- Entrypoint check: `src/commands/cli/native-engine-commands.ts` contains code fragment `registerHubCommands`.
- Live limit: An isolated hub search returned zero matches and list returned zero hub-installed skills (8 bundled); no shared skill was available to install or manage.

## cli-curator

- Domain: `context-memory`
- Code: `src/commands/curator-cli.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'curator'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerCuratorCommand(program)`.
- Entrypoint check: `src/commands/curator-cli.ts` contains code fragment `registerCuratorCommand`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-triage

- Domain: `cli`
- Code: `src/commands/cli/triage-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'triage'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerTriageCommand(program)`.
- Entrypoint check: `src/commands/cli/triage-command.ts` contains code fragment `registerTriageCommand`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-gateway-pairing

- Domain: `server-api`
- Code: `src/commands/cli/native-engine-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'gateway-pairing'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerGatewayPairingCommands(program)`.
- Entrypoint check: `src/commands/cli/native-engine-commands.ts` contains code fragment `registerGatewayPairingCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-screen

- Domain: `sensory`
- Code: `src/commands/cli/screen-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'screen'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerScreenCommands(program)`.
- Entrypoint check: `src/commands/cli/screen-commands.ts` contains code fragment `registerScreenCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-device

- Domain: `fleet`
- Code: `src/commands/cli/device-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'device'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerDeviceCommands(program)`.
- Entrypoint check: `src/commands/cli/device-commands.ts` contains code fragment `registerDeviceCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-identity

- Domain: `context-memory`
- Code: `src/commands/cli/native-engine-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'identity'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerIdentityCommands(program)`.
- Entrypoint check: `src/commands/cli/native-engine-commands.ts` contains code fragment `registerIdentityCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-companion

- Domain: `sensory`
- Code: `src/commands/cli/native-engine-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'companion'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerCompanionCommands(program)`.
- Entrypoint check: `src/commands/cli/native-engine-commands.ts` contains code fragment `registerCompanionCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-groups

- Domain: `security`
- Code: `src/commands/cli/native-engine-commands.ts`, `src/channels/group-security.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'groups'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerGroupCommands(program)`.
- Entrypoint check: `src/commands/cli/native-engine-commands.ts` contains code fragment `registerGroupCommands`.
- Live trace: [p8-cli-groups.log](p8-cli-groups.log).

## cli-auth-profile

- Domain: `providers`
- Code: `src/commands/cli/native-engine-commands.ts`, `src/auth/profile-manager.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'auth-profile'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerAuthProfileCommands(program)`.
- Entrypoint check: `src/commands/cli/native-engine-commands.ts` contains code fragment `registerAuthProfileCommands`.
- Live trace: [p8-cli-auth-profile.log](p8-cli-auth-profile.log).

## cli-code-explorer

- Domain: `agent-tools`
- Code: `src/commands/cli/code-explorer-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'code-explorer'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerCodeExplorerCommands(program)`.
- Entrypoint check: `src/commands/cli/code-explorer-commands.ts` contains code fragment `registerCodeExplorerCommands`.
- Live limit: CODE_EXPLORER_ENDPOINT is unset in the isolated HOME; the CLI reports that CodeExplorer is not configured, so no graph query was completed.

## cli-hermes

- Domain: `cli`
- Code: `src/commands/cli/hermes-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'hermes'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerHermesCommands(program)`.
- Entrypoint check: `src/commands/cli/hermes-commands.ts` contains code fragment `registerHermesCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-acp

- Domain: `server-api`
- Code: `src/commands/cli/acp-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'acp'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerAcpCommand(program)`.
- Entrypoint check: `src/commands/cli/acp-command.ts` contains code fragment `registerAcpCommand`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-tools

- Domain: `agent-tools`
- Code: `src/commands/cli/tools-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'tools'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerToolsCommands(program)`.
- Entrypoint check: `src/commands/cli/tools-commands.ts` contains code fragment `registerToolsCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-autonomous-code

- Domain: `agent-tools`
- Code: `src/commands/cli/autonomous-code-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'autonomous-code'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerAutonomousCodeCommand(program)`.
- Entrypoint check: `src/commands/cli/autonomous-code-command.ts` contains code fragment `registerAutonomousCodeCommand`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-session

- Domain: `context-memory`
- Code: `src/cli/session-commands.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'session'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerSessionCommands(program)`.
- Entrypoint check: `src/cli/session-commands.ts` contains code fragment `registerSessionCommands`.

## cli-config

- Domain: `cli`
- Code: `src/commands/cli/config-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'config'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerConfigCommand(program)`.
- Entrypoint check: `src/commands/cli/config-command.ts` contains code fragment `registerConfigCommand`.

## cli-policy

- Domain: `security`
- Code: `src/commands/cli/policy-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'policy'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerPolicyCommand(program)`.
- Entrypoint check: `src/commands/cli/policy-command.ts` contains code fragment `registerPolicyCommand`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-dev

- Domain: `agent-tools`
- Code: `src/commands/dev/index.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'dev'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerDevCommands(program)`.
- Entrypoint check: `src/commands/dev/index.ts` contains code fragment `registerDevCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-run

- Domain: `cli`
- Code: `src/commands/run-cli/index.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'run'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerRunCommands(program)`.
- Entrypoint check: `src/commands/run-cli/index.ts` contains code fragment `registerRunCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-cron

- Domain: `cli`
- Code: `src/commands/cron-cli/index.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'cron'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerCronCommands(program)`.
- Entrypoint check: `src/commands/cron-cli/index.ts` contains code fragment `registerCronCommands`.

## cli-skills

- Domain: `agent-tools`
- Code: `src/commands/skills-cli/index.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'skills'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerSkillsCommands(program)`.
- Entrypoint check: `src/commands/skills-cli/index.ts` contains code fragment `registerSkillsCommands`.

## cli-nodes

- Domain: `fleet`
- Code: `src/commands/cli/node-commands.ts`, `src/nodes/index.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'nodes'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerNodeCommands(program)`.
- Entrypoint check: `src/commands/cli/node-commands.ts` contains code fragment `registerNodeCommands`.
- Live trace: [p8-cli-nodes.log](p8-cli-nodes.log).

## cli-secrets

- Domain: `security`
- Code: `src/commands/cli/secrets-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'secrets'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerSecretsCommands(program)`.
- Entrypoint check: `src/commands/cli/secrets-command.ts` contains code fragment `registerSecretsCommands`.

## cli-approvals

- Domain: `security`
- Code: `src/commands/cli/approvals-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'approvals'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerApprovalsCommands(program)`.
- Entrypoint check: `src/commands/cli/approvals-command.ts` contains code fragment `registerApprovalsCommands`.
- Live limit: The production CLI has no request-creation path: ApprovalsStore.create is called only by an external harness, and a new CLI process lists no pending requests. No real tool approval was observed.

## cli-insights

- Domain: `cli`
- Code: `src/commands/cli/insights-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'insights'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerInsightsCommands(program)`.
- Entrypoint check: `src/commands/cli/insights-command.ts` contains code fragment `registerInsightsCommands`.

## cli-bundles

- Domain: `agent-tools`
- Code: `src/commands/cli/bundles-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'bundles'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerBundlesCommands(program)`.
- Entrypoint check: `src/commands/cli/bundles-command.ts` contains code fragment `registerBundlesCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-improve

- Domain: `dgm`
- Code: `src/commands/cli/improve-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'improve'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerImproveCommands(program)`.
- Entrypoint check: `src/commands/cli/improve-command.ts` contains code fragment `registerImproveCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-evolve

- Domain: `dgm`
- Code: `src/commands/cli/evolve-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'evolve'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerEvolveCommands(program)`.
- Entrypoint check: `src/commands/cli/evolve-command.ts` contains code fragment `registerEvolveCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-lsp

- Domain: `agent-tools`
- Code: `src/commands/cli/lsp-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'lsp'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerLspCommands(program)`.
- Entrypoint check: `src/commands/cli/lsp-command.ts` contains code fragment `registerLspCommands`.
- Live failure: [p8-cli-lsp.log](p8-cli-lsp.log).

## cli-proxy

- Domain: `server-api`
- Code: `src/commands/cli/proxy-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'proxy'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerProxyCommands(program)`.
- Entrypoint check: `src/commands/cli/proxy-command.ts` contains code fragment `registerProxyCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-deploy

- Domain: `cli`
- Code: `src/commands/cli/deploy-command.ts`, `src/deploy/cloud-configs.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'deploy'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerDeployCommands(program)`.
- Entrypoint check: `src/commands/cli/deploy-command.ts` contains code fragment `registerDeployCommands`.
- Live trace: [p8-cli-deploy.log](p8-cli-deploy.log).

## cli-provision

- Domain: `cli`
- Code: `src/commands/cli/provision-command.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `addLazyCommandGroup(program, 'provision'`.
- Entrypoint check: `src/index.ts` contains code fragment `registerProvisionCommands(program)`.
- Entrypoint check: `src/commands/cli/provision-command.ts` contains code fragment `registerProvisionCommands`.
- Live limit: Functional execution needs its dependencies and a separate live run.

## cli-film

- Domain: `media`
- Code: `src/commands/film.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `'film',`.
- Entrypoint check: `src/index.ts` contains code fragment `createFilmCommand()`.
- Entrypoint check: `src/commands/film.ts` contains code fragment `createFilmCommand`.
- Live limit: A live run is needed for the requested action.

## cli-token

- Domain: `server-api`
- Code: `src/commands/token.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `'token',`.
- Entrypoint check: `src/index.ts` contains code fragment `createTokenCommand()`.
- Entrypoint check: `src/commands/token.ts` contains code fragment `createTokenCommand`.
- Live limit: A live run is needed for the requested action.

## cli-pair

- Domain: `server-api`
- Code: `src/commands/device-auth.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `'pair',`.
- Entrypoint check: `src/index.ts` contains code fragment `createPairCommand()`.
- Entrypoint check: `src/commands/device-auth.ts` contains code fragment `createPairCommand`.
- Live limit: A live run is needed for the requested action.

## cli-devices

- Domain: `server-api`
- Code: `src/commands/device-auth.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `'devices',`.
- Entrypoint check: `src/index.ts` contains code fragment `createDevicesCommand()`.
- Entrypoint check: `src/commands/device-auth.ts` contains code fragment `createDevicesCommand`.
- Live limit: A live run is needed for the requested action.

## cli-user-model

- Domain: `context-memory`
- Code: `src/commands/user-model.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `'user-model',`.
- Entrypoint check: `src/index.ts` contains code fragment `createUserModelCommand()`.
- Entrypoint check: `src/commands/user-model.ts` contains code fragment `createUserModelCommand`.
- Live limit: A live run is needed for the requested action.

## cli-update

- Domain: `cli`
- Code: `src/commands/update.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `'update',`.
- Entrypoint check: `src/index.ts` contains code fragment `createUpdateCommand()`.
- Entrypoint check: `src/commands/update.ts` contains code fragment `createUpdateCommand`.
- Live trace: [p8-cli-update.log](p8-cli-update.log).

## tool-web-search

- Domain: `agent-tools`
- Code: `src/codebuddy/tool-definitions/web-tools.ts`, `src/tools/registry/web-tools.ts`, `src/tools/web-search.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tool-definitions/web-tools.ts` contains code fragment `name: 'web_search'`.
- Entrypoint check: `src/tools/registry/web-tools.ts` contains code fragment `createWebTools`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createWebTools()`.
- Live trace: [p8-tool-web-search.log](p8-tool-web-search.log).

## tool-browser

- Domain: `agent-tools`
- Code: `src/codebuddy/tool-definitions/browser-tools.ts`, `src/tools/registry/misc-tools.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tool-definitions/browser-tools.ts` contains code fragment `name: 'browser'`.
- Entrypoint check: `src/tools/registry/misc-tools.ts` contains code fragment `createMiscTools`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createMiscTools()`.
- Live limit: Requires a configured runtime or external service and a real agent turn.

## tool-deep-research

- Domain: `agent-tools`
- Code: `src/codebuddy/tool-definitions/research-tools.ts`, `src/tools/registry/research-tools.ts`, `src/tools/deep-research-tool.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tool-definitions/research-tools.ts` contains code fragment `name: 'deep_research'`.
- Entrypoint check: `src/tools/registry/research-tools.ts` contains code fragment `createResearchTools`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createResearchTools()`.
- Live trace: [p8-tool-deep-research.log](p8-tool-deep-research.log).

## tool-verify

- Domain: `agent-tools`
- Code: `src/codebuddy/tool-definitions/verify-tools.ts`, `src/tools/registry/verify-tools.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tool-definitions/verify-tools.ts` contains code fragment `name: 'verify'`.
- Entrypoint check: `src/tools/registry/verify-tools.ts` contains code fragment `createVerifyTools`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createVerifyTools()`.
- Live limit: The independent verifier requires a live LLM/tool bridge and an executed oracle. No complete verifier delegation was observed in this campaign.

## tool-image-generate

- Domain: `media`
- Code: `src/codebuddy/tool-definitions/multimodal-tools.ts`, `src/tools/registry/multimodal-tools.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tool-definitions/multimodal-tools.ts` contains code fragment `name: 'image_generate'`.
- Entrypoint check: `src/tools/registry/multimodal-tools.ts` contains code fragment `createMultimodalTools`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createMultimodalTools()`.
- Live limit: No isolated ComfyUI endpoint or image-provider credential was configured; no bitmap generation completed.

## tool-video-generate

- Domain: `media`
- Code: `src/codebuddy/tool-definitions/multimodal-tools.ts`, `src/tools/registry/multimodal-tools.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tool-definitions/multimodal-tools.ts` contains code fragment `name: 'video_generate'`.
- Entrypoint check: `src/tools/registry/multimodal-tools.ts` contains code fragment `createMultimodalTools`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createMultimodalTools()`.
- Live limit: No isolated ComfyUI video endpoint or xAI/Fal credential was configured; no video generation completed.

## tool-understand-video

- Domain: `media`
- Code: `src/codebuddy/tool-definitions/multimodal-tools.ts`, `src/tools/registry/multimodal-tools.ts`, `src/tools/video/video-understanding.ts`, `src/tools/video/long-transcribe.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tool-definitions/multimodal-tools.ts` contains code fragment `name: 'understand_video'`.
- Entrypoint check: `src/tools/registry/multimodal-tools.ts` contains code fragment `createMultimodalTools`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createMultimodalTools()`.
- Live failure: [p8-tool-understand-video.log](p8-tool-understand-video.log).

## http-chat

- Domain: `server-api`
- Code: `src/server/routes/chat.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/server/index.ts` contains code fragment `app.use('/api/chat'`.
- Entrypoint check: `src/server/routes/chat.ts` contains code fragment `router.`.

## http-sessions

- Domain: `server-api`
- Code: `src/server/routes/sessions.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/server/index.ts` contains code fragment `app.use('/api/sessions'`.
- Entrypoint check: `src/server/routes/sessions.ts` contains code fragment `router.`.

## http-memory

- Domain: `server-api`
- Code: `src/server/routes/memory.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/server/index.ts` contains code fragment `app.use('/api/memory'`.
- Entrypoint check: `src/server/routes/memory.ts` contains code fragment `router.`.

## http-a2a

- Domain: `server-api`
- Code: `src/server/routes/a2a-protocol.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/server/index.ts` contains code fragment `app.use('/api/a2a'`.
- Entrypoint check: `src/server/routes/a2a-protocol.ts` contains code fragment `router.`.
- Live limit: HTTP listener and authentication were not exercised in this inventory.

## cowork-studio

- Domain: `cowork`
- Code: `cowork/src/renderer/components/studio/AppStudioView.tsx`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `cowork/src/renderer/components/NewShell.tsx` contains code fragment `primaryView === 'studio'`.
- Entrypoint check: `cowork/src/main/index.ts` contains code fragment `registerStudioFilesIpc(ipcMain)`.
- Live limit: The Cowork Electron dependencies and executable were absent from this checkout; App Studio was not launched in a real window.

## cowork-video-studio

- Domain: `cowork`
- Code: `cowork/src/renderer/components/videostudio/VideoStudioView.tsx`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `cowork/src/renderer/components/NewShell.tsx` contains code fragment `primaryView === 'videostudio'`.
- Entrypoint check: `cowork/src/main/index.ts` contains code fragment `registerFilmIpc(ipcMain`.
- Live limit: The Cowork Electron dependencies and executable were absent from this checkout; Video Studio was not launched in a real window.

## agent-loop

- Domain: `agent-tools`
- Code: `src/agent/execution/agent-executor.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/agent/codebuddy-agent.ts` contains code fragment `processUserMessageStream`.
- Entrypoint check: `src/agent/execution/agent-executor.ts` contains code fragment `runTurnLoop`.

## provider-ollama

- Domain: `providers`
- Code: `src/codebuddy/providers/ollama-native-transport.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/client.ts` contains code fragment `OpenAICompatProvider`.
- Entrypoint check: `src/codebuddy/providers/ollama-native-transport.ts` contains code fragment `isOllamaEndpoint`.

## provider-failover

- Domain: `providers`
- Code: `src/providers/provider-failover-policy.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/client.ts` contains code fragment `ProviderFailoverExhaustedError`.
- Entrypoint check: `src/providers/provider-failover-policy.ts` contains code fragment `CODEBUDDY_PROVIDER_FALLBACK`.
- Live limit: Only one local Ollama endpoint was authorized in the isolated HOME; no independent fallback provider was configured for a real failure handoff.

## provider-chatgpt-oauth

- Domain: `providers`
- Code: `src/codebuddy/providers/provider-chatgpt-responses.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/client.ts` contains code fragment `new ChatGptResponsesProvider`.
- Entrypoint check: `src/codebuddy/providers/provider-chatgpt-responses.ts` contains code fragment `class ChatGptResponsesProvider`.
- Live limit: The isolated HOME has no ChatGPT OAuth login, and real credentials were not copied; no subscription request was made.

## provider-gemini-cli

- Domain: `providers`
- Code: `src/codebuddy/providers/provider-gemini-cli.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/client.ts` contains code fragment `new GeminiCliProvider`.
- Entrypoint check: `src/codebuddy/providers/provider-gemini-cli.ts` contains code fragment `class GeminiCliProvider`.
- Live limit: The isolated HOME has no authenticated Gemini CLI session; the campaign used Ollama only.

## provider-agy-cli

- Domain: `providers`
- Code: `src/codebuddy/providers/provider-agy-cli.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/client.ts` contains code fragment `new AgyCliProvider`.
- Entrypoint check: `src/codebuddy/providers/provider-agy-cli.ts` contains code fragment `class AgyCliProvider`.
- Live limit: The isolated HOME has no authenticated AGY CLI session; the campaign used Ollama only.

## context-compaction

- Domain: `context-memory`
- Code: `src/context/context-manager-v2.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/agent/execution/agent-executor.ts` contains code fragment `ContextManagerV2`.
- Entrypoint check: `src/context/context-manager-v2.ts` contains code fragment `class ContextManagerV2`.
- Live limit: Needs a separate live scenario with its actual prerequisites.

## memory-ckg

- Domain: `context-memory`
- Code: `src/memory/collective-knowledge-graph.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/agent/execution/context-pipeline.ts` contains code fragment `getCollectiveKnowledgeGraph().formatCollectiveContext`.
- Entrypoint check: `src/memory/collective-knowledge-graph.ts` contains code fragment `class CollectiveKnowledgeGraph`.
- Live limit: Needs a separate live scenario with its actual prerequisites.

## fleet-peer-chat

- Domain: `fleet`
- Code: `src/fleet/peer-chat-bridge.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/server/index.ts` contains code fragment `wirePeerChatBridge(`.
- Entrypoint check: `src/fleet/peer-chat-bridge.ts` contains code fragment `registerPeerMethod('peer.chat'`.
- Live limit: Needs a separate live scenario with its actual prerequisites.

## fleet-peer-tools

- Domain: `fleet`
- Code: `src/fleet/peer-tool-bridge.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/server/index.ts` contains code fragment `wirePeerToolBridge()`.
- Entrypoint check: `src/fleet/peer-tool-bridge.ts` contains code fragment `registerPeerMethod('peer.tool.invoke'`.
- Live limit: Needs a separate live scenario with its actual prerequisites.

## security-sandbox

- Domain: `security`
- Code: `src/security/native-sandbox.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/tools/bash/bash-tool.ts` contains code fragment `confineSpawn`.
- Entrypoint check: `src/security/native-sandbox.ts` contains code fragment `confineSpawn`.
- Live limit: Needs a separate live scenario with its actual prerequisites.

## security-skill-firewall

- Domain: `security`
- Code: `src/security/skill-scanner.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/skills/skill-importer.ts` contains code fragment `scanSkillFirewall(skillDir)`.
- Live limit: Needs a separate live scenario with its actual prerequisites.

## sensory-voice-loop

- Domain: `sensory`
- Code: `src/sensory/voice-loop.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/sensory/speech-reaction.ts` contains code fragment `import('./voice-loop.js')`.
- Entrypoint check: `src/sensory/voice-loop.ts` contains code fragment `sayNow`.
- Live limit: No microphone capture was performed and the local faster_whisper STT module is absent; an audio-to-reply loop cannot be observed here.

## media-film-assemble

- Domain: `media`
- Code: `src/tools/video/film-assemble.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/commands/film.ts` contains code fragment `.command('assemble <name>')`.
- Entrypoint check: `src/agent/film/film-producer.ts` contains code fragment `assembleFilm(`.
- Live limit: Needs a separate live scenario with its actual prerequisites.

## tool-read-file

- Domain: `agent-tools`
- Code: `src/codebuddy/tool-definitions/core-tools.ts`, `src/tools/registry/text-editor-tools.ts`, `src/tools/registry/tool-alias-map.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tool-definitions/core-tools.ts` contains code fragment `name: "read_file"`.
- Entrypoint check: `src/tools/registry/tool-alias-map.ts` contains code fragment `read_file: 'view_file'`.
- Entrypoint check: `src/tools/registry/text-editor-tools.ts` contains code fragment `new ViewFileTool()`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createTextEditorTools()`.

## context-tool-selection

- Domain: `agent-tools`
- Code: `src/codebuddy/tools.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/codebuddy/tools.ts` contains code fragment `name: 'tool_search'`.
- Entrypoint check: `src/codebuddy/tools.ts` contains code fragment `selectRelevantTools(query, allTools`.
- Live limit: Selection quality was not measured on a live task.

## context-checkpoints

- Domain: `context-memory`
- Code: `src/agent/facades/session-facade.ts`, `src/checkpoints/checkpoint-manager.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/agent/codebuddy-agent.ts` contains code fragment `checkpointManager: this.checkpointManager`.
- Entrypoint check: `src/agent/facades/session-facade.ts` contains code fragment `this.checkpointManager.createCheckpoint(description)`.
- Live limit: A reversible edit and rewind scenario was not executed.

## dgm-learning-cycle

- Domain: `dgm`
- Code: `src/commands/cli/improve-command.ts`, `src/agent/self-improvement/engine.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `registerImproveCommands(program)`.
- Entrypoint check: `src/commands/cli/improve-command.ts` contains code fragment `.command('cycle')`.
- Live limit: An improvement cycle was not launched.

## dgm-authored-tools

- Domain: `dgm`
- Code: `src/commands/cli/improve-command.ts`, `src/agent/self-improvement/tool-engine.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `registerImproveCommands(program)`.
- Entrypoint check: `src/commands/cli/improve-command.ts` contains code fragment `.command('tools')`.
- Live limit: No generated tool was evaluated in this inventory.

## dgm-evolve-propose

- Domain: `dgm`
- Code: `src/commands/cli/evolve-command.ts`, `src/agent/self-improvement/evolution/proposal-engine.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `registerEvolveCommands(program)`.
- Entrypoint check: `src/commands/cli/evolve-command.ts` contains code fragment `.command('propose')`.
- Live limit: The isolated HOME has no vetted experiment fiche or matching scholarly discovery record; no proposal archive was generated.

## cowork-desktop-chat

- Domain: `cowork`
- Code: `cowork/src/renderer/components/NewShell.tsx`, `cowork/src/renderer/components/DockWorkspace.tsx`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `cowork/src/renderer/components/NewShell.tsx` contains code fragment `primaryView === 'chat'`.
- Entrypoint check: `cowork/src/renderer/components/NewShell.tsx` contains code fragment `<DockWorkspace />`.
- Live limit: The Cowork Electron dependencies and executable were absent from this checkout; no desktop chat window was exercised.

## cowork-desktop-assistant

- Domain: `cowork`
- Code: `cowork/src/renderer/components/assistant/AssistantView.tsx`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `cowork/src/renderer/components/NewShell.tsx` contains code fragment `primaryView === 'assistant'`.
- Entrypoint check: `cowork/src/main/index.ts` contains code fragment `registerAssistantIpc(`.
- Live limit: The Cowork Electron dependencies and executable were absent, and no microphone or camera session was opened.

## cowork-desktop-settings

- Domain: `cowork`
- Code: `cowork/src/renderer/components/SettingsPanel.tsx`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `cowork/src/renderer/App.tsx` contains code fragment `<SettingsPanel onClose=`.
- Entrypoint check: `cowork/src/renderer/App.tsx` contains code fragment `import('./components/SettingsPanel')`.
- Live limit: The Cowork Electron dependencies and executable were absent from this checkout; no settings window was exercised.

## fleet-peer-sessions

- Domain: `fleet`
- Code: `src/fleet/peer-session-bridge.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/server/index.ts` contains code fragment `wirePeerSessionBridge(`.
- Entrypoint check: `src/fleet/peer-session-bridge.ts` contains code fragment `registerPeerMethod('peer.chat-session.start'`.
- Live limit: Requires two live peers and a configured model.

## media-video-stitch

- Domain: `media`
- Code: `src/tools/registry/multimodal-tools.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/tools/registry/multimodal-tools.ts` contains code fragment `new VideoStitchTool()`.
- Entrypoint check: `src/tools/registry/interactive-adapters.ts` contains code fragment `...createMultimodalTools()`.
- Live limit: No media clips or ffmpeg run were supplied.

## dgm-capability-benchmark

- Domain: `dgm`
- Code: `src/commands/cli/improve-command.ts`, `src/agent/self-improvement/continuous-benchmark.ts`
- Source status: coded `vrai`, wired `vrai`.
- Entrypoint check: `src/index.ts` contains code fragment `registerImproveCommands(program)`.
- Entrypoint check: `src/commands/cli/improve-command.ts` contains code fragment `.command('bench')`.
- Entrypoint check: `src/commands/cli/improve-command.ts` contains code fragment `benchmark.runBenchmark(`.

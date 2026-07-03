import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const configPath = path.resolve(process.cwd(), 'src/renderer/i18n/config.ts');
const settingsGeneralPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsGeneral.tsx'
);
const i18nFormatPath = path.resolve(process.cwd(), 'src/renderer/utils/i18n-format.ts');
const voiceButtonPath = path.resolve(process.cwd(), 'src/renderer/components/VoiceButton.tsx');
const exportSessionPath = path.resolve(process.cwd(), 'src/renderer/utils/export-session.ts');
const remoteControlPanelPath = path.resolve(
  process.cwd(),
  'src/renderer/components/RemoteControlPanel.tsx'
);
const enLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/en.json');
const frLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/fr.json');
const zhLocalePath = path.resolve(process.cwd(), 'src/renderer/i18n/locales/zh.json');
const fleetCommandCenterPath = path.resolve(
  process.cwd(),
  'src/renderer/components/FleetCommandCenter.tsx'
);
const fleetCommandCenterHelpersPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-command-center-helpers.ts'
);
const fleetOutcomePanelPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-outcome-panel.tsx'
);
const fleetScheduledWorkPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-scheduled-work-strip.tsx'
);
const fleetSagaBoardPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-saga-board.tsx'
);
const fleetPeerPanelPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-peer-panel.tsx'
);
const fleetSagaDetailPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-saga-detail.tsx'
);
const fleetMemoryStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/fleet-memory-strip.tsx'
);
const hermesPlanStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-plan-strip.tsx'
);
const hermesFeatureParityStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-feature-parity-strip.tsx'
);
const hermesToolCatalogStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-tool-catalog-strip.tsx'
);
const hermesToolsetsStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-toolsets-strip.tsx'
);
const hermesProviderReadinessStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-provider-readiness-strip.tsx'
);
const hermesMemoryProvidersStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-memory-providers-strip.tsx'
);
const hermesRuntimeBackendsStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-runtime-backends-strip.tsx'
);
const hermesBrowserBackendsStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-browser-backends-strip.tsx'
);
const hermesProtocolGatewaysStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-protocol-gateways-strip.tsx'
);
const hermesLocalSmokeStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-local-smoke-strip.tsx'
);
const hermesMessagingGatewayStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-messaging-gateway-strip.tsx'
);
const hermesMobileSupervisionStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-mobile-supervision-strip.tsx'
);
const skillCandidateReviewQueueStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/skill-candidate-review-queue-strip.tsx'
);
const skillPackageManagerStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/skill-package-manager-strip.tsx'
);
const lessonCandidateReviewStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/lesson-candidate-review-strip.tsx'
);
const learningSkillUsageStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/learning-skill-usage-strip.tsx'
);
const hermesLearningLoopStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/hermes-learning-loop-strip.tsx'
);
const browserOperatorDraftStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/browser-operator-draft-strip.tsx'
);
const localeAwareRendererSurfaces = [
  path.resolve(process.cwd(), 'src/renderer/components/ActivityFeed.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/AuditLogViewer.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/BookmarksPanel.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/CheckpointPanel.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/MemoryInspector.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/NotificationCenter.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/ReasoningTraceViewer.tsx'),
  path.resolve(process.cwd(), 'src/renderer/components/SessionInsightsPanel.tsx'),
];
const translatedChromeSurfaces: Array<[string, string[]]> = [
  [
    path.resolve(process.cwd(), 'src/renderer/components/CommandPalette.tsx'),
    ['commandPalette.searchPlaceholder', 'commandPalette.empty', 'shortcutsDialog.title'],
  ],
  [
    path.resolve(process.cwd(), 'src/renderer/components/FileTree.tsx'),
    ['fileTree.filterPlaceholder', 'fileTree.empty'],
  ],
  [
    path.resolve(process.cwd(), 'src/renderer/components/KeyboardShortcutsDialog.tsx'),
    ['shortcutsDialog.title', 'shortcutsDialog.openCommandPalette'],
  ],
  [
    path.resolve(process.cwd(), 'src/renderer/components/SessionSearch.tsx'),
    ['sessionSearch.placeholder', 'sessionSearch.previous', 'sessionSearch.close'],
  ],
  [
    path.resolve(process.cwd(), 'src/renderer/components/Titlebar.tsx'),
    ['shortcutsDialog.title', 'notifications.title'],
  ],
  [
    path.resolve(process.cwd(), 'src/renderer/components/ShellNavigation.tsx'),
    ['shell.navigation', 'bookmarks.title', 'activity.title', 'focusView.title'],
  ],
  [
    path.resolve(process.cwd(), 'src/renderer/components/UpdateNotification.tsx'),
    ['updateNotification.downloaded', 'updateNotification.download'],
  ],
  [
    path.resolve(process.cwd(), 'src/renderer/components/ContextPanel.tsx'),
    ['git.noWorkingDir'],
  ],
  [
    path.resolve(process.cwd(), 'src/renderer/components/FileAttachmentChip.tsx'),
    ['common.remove'],
  ],
];

function collectPaths(value: unknown, base = ''): string[] {
  if (typeof value === 'string' || value === null || typeof value !== 'object') {
    return [base];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectPaths(item, `${base}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, child]) =>
    collectPaths(child, base ? `${base}.${key}` : key)
  );
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getPath(value: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

describe('French renderer i18n support', () => {
  it('registers fr in the renderer i18n config', () => {
    const source = fs.readFileSync(configPath, 'utf8');
    expect(source).toContain("import frTranslations from './locales/fr.json'");
    expect(source).toContain('fr: {');
    expect(source).toContain("supportedLngs: ['en', 'fr', 'zh']");
    expect(source).toContain("load: 'languageOnly'");
  });

  it('exposes Français as a selectable language in SettingsGeneral', () => {
    const source = fs.readFileSync(settingsGeneralPath, 'utf8');
    expect(source).toContain("i18n.language.startsWith('fr')");
    expect(source).toContain("{ code: 'fr', nativeName: 'Français' }");
  });

  it('formats app locale using fr-FR when French is active', () => {
    const source = fs.readFileSync(i18nFormatPath, 'utf8');
    expect(source).toContain("if (normalizedLanguage.startsWith('fr'))");
    expect(source).toContain("return 'fr-FR'");
    expect(source).toContain('export function formatAppTime');
    expect(source).toContain('export function formatAppNumber');
    expect(source).toContain('export function getAppListSeparator');
  });

  it('routes voice, export, and list formatting through the app locale', () => {
    const voiceSource = fs.readFileSync(voiceButtonPath, 'utf8');
    const exportSource = fs.readFileSync(exportSessionPath, 'utf8');
    const remoteSource = fs.readFileSync(remoteControlPanelPath, 'utf8');

    expect(voiceSource).toContain("language = getAppLocale()");
    expect(exportSource).toContain("formatAppDateTime(new Date())");
    expect(exportSource).toContain("exportSession.exportedOn");
    expect(remoteSource).toContain('getAppListSeparator(i18n.language)');
  });

  it('uses locale-aware date and time helpers on visible renderer surfaces', () => {
    for (const filePath of localeAwareRendererSurfaces) {
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source).toMatch(/formatApp(Date|DateTime|Time|Number)/);
      expect(source).not.toMatch(/toLocale(Date|Time|String)\(/);
    }
  });

  it('localizes visible shell components instead of hardcoding English chrome strings', () => {
    for (const [filePath, expectedKeys] of translatedChromeSurfaces) {
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source).toContain('t(');
      for (const key of expectedKeys) {
        expect(source).toContain(key);
      }
    }
  });

  it('keeps fr locale structure aligned with en locale', () => {
    const enLocale = readJson(enLocalePath);
    const frLocale = readJson(frLocalePath);
    expect(collectPaths(frLocale)).toEqual(collectPaths(enLocale));
  });

  it('keeps Fleet Command Center translations available in all renderer locales', () => {
    const source = [
      fs.readFileSync(fleetCommandCenterPath, 'utf8'),
      fs.readFileSync(fleetCommandCenterHelpersPath, 'utf8'),
      fs.readFileSync(fleetOutcomePanelPath, 'utf8'),
      fs.readFileSync(fleetScheduledWorkPath, 'utf8'),
      fs.readFileSync(fleetSagaBoardPath, 'utf8'),
      fs.readFileSync(fleetPeerPanelPath, 'utf8'),
      fs.readFileSync(fleetSagaDetailPath, 'utf8'),
      fs.readFileSync(fleetMemoryStripPath, 'utf8'),
      fs.readFileSync(hermesPlanStripPath, 'utf8'),
      fs.readFileSync(hermesFeatureParityStripPath, 'utf8'),
      fs.readFileSync(hermesToolCatalogStripPath, 'utf8'),
      fs.readFileSync(hermesToolsetsStripPath, 'utf8'),
      fs.readFileSync(hermesProviderReadinessStripPath, 'utf8'),
      fs.readFileSync(hermesMemoryProvidersStripPath, 'utf8'),
      fs.readFileSync(hermesRuntimeBackendsStripPath, 'utf8'),
      fs.readFileSync(hermesBrowserBackendsStripPath, 'utf8'),
      fs.readFileSync(hermesProtocolGatewaysStripPath, 'utf8'),
      fs.readFileSync(hermesLocalSmokeStripPath, 'utf8'),
      fs.readFileSync(hermesMessagingGatewayStripPath, 'utf8'),
      fs.readFileSync(hermesMobileSupervisionStripPath, 'utf8'),
      fs.readFileSync(skillCandidateReviewQueueStripPath, 'utf8'),
      fs.readFileSync(skillPackageManagerStripPath, 'utf8'),
      fs.readFileSync(lessonCandidateReviewStripPath, 'utf8'),
      fs.readFileSync(learningSkillUsageStripPath, 'utf8'),
      fs.readFileSync(hermesLearningLoopStripPath, 'utf8'),
      fs.readFileSync(browserOperatorDraftStripPath, 'utf8'),
    ].join('\n');
    const requiredFleetKeys = [
      'fleet.title',
      'fleet.refreshCapabilities',
      'fleet.sagaBoard.title',
      'fleet.scheduledWork.title',
      'fleet.scheduledWork.ruleDaily',
      'fleet.scheduledWork.ruleWeekly',
      'fleet.scheduledWork.ruleOnce',
      'fleet.scheduledWork.repeatEveryHour',
      'fleet.scheduledWork.lastRun',
      'fleet.scheduledWork.lastRunNever',
      'fleet.scheduledWork.session',
      'fleet.scheduledWork.errorChip',
      'fleet.scheduledWork.sourceFleet',
      'fleet.scheduledWork.hermesPlanChip',
      'fleet.scheduledWork.profileChip',
      'fleet.scheduledWork.privacyChip',
      'fleet.scheduledWork.memoryChip',
      'fleet.scheduledWork.targetPeersChip',
      'fleet.scheduledWork.deliveryChannelChip',
      'fleet.scheduledWork.fleetCount',
      'fleet.scheduledWork.runNow',
      'fleet.scheduledWork.runningNow',
      'fleet.scheduledWork.runFleetNow',
      'fleet.scheduledWork.runningFleetNow',
      'fleet.scheduledWork.runHermesNow',
      'fleet.scheduledWork.runningHermesNow',
      'fleet.scheduledWork.openSettings',
      'fleet.scheduledWork.runNowUnavailable',
      'fleet.outcomes.title',
      'fleet.outcomes.hermesPlanChip',
      'fleet.outcomes.targetPeersChip',
      'fleet.outcomes.deliveryChannelChip',
      'fleet.outcomes.memoryChip',
      'fleet.outcomes.openOutcome',
      'fleet.outcomeDetail',
      'fleet.hermesPlan.title',
      'fleet.hermesPlan.itemsChip',
      'fleet.hermesPlan.readOnlyChip',
      'fleet.hermesPlan.localWriteChip',
      'fleet.hermesPlan.interactiveChip',
      'fleet.hermesPlan.useAsGoal',
      'fleet.hermesPlan.schedule',
      'fleet.hermesFeatureParity.title',
      'fleet.hermesFeatureParity.countChip',
      'fleet.hermesFeatureParity.loadingChip',
      'fleet.hermesFeatureParity.coveredChip',
      'fleet.hermesFeatureParity.coveredPartialChip',
      'fleet.hermesFeatureParity.partialChip',
      'fleet.hermesFeatureParity.gapChip',
      'fleet.hermesFeatureParity.todoBacklogChip',
      'fleet.hermesFeatureParity.todoHidden',
      'fleet.hermesFeatureParity.loadFailed',
      'fleet.hermesFeatureParity.empty',
      'fleet.hermesFeatureParity.unavailable',
      'fleet.hermesFeatureParity.deferredLabel',
      'fleet.hermesFeatureParity.status.covered',
      'fleet.hermesFeatureParity.status.covered-partial',
      'fleet.hermesFeatureParity.status.partial',
      'fleet.hermesFeatureParity.status.gap',
      'fleet.hermesToolCatalog.title',
      'fleet.hermesToolCatalog.countChip',
      'fleet.hermesToolCatalog.loadingChip',
      'fleet.hermesToolCatalog.exactChip',
      'fleet.hermesToolCatalog.nativeChip',
      'fleet.hermesToolCatalog.partialChip',
      'fleet.hermesToolCatalog.gapChip',
      'fleet.hermesToolCatalog.loadFailed',
      'fleet.hermesToolCatalog.empty',
      'fleet.hermesToolCatalog.unavailable',
      'fleet.hermesToolsets.title',
      'fleet.hermesToolsets.loadingChip',
      'fleet.hermesToolsets.allowChip',
      'fleet.hermesToolsets.confirmChip',
      'fleet.hermesToolsets.denyChip',
      'fleet.hermesToolsets.profilesChip',
      'fleet.hermesToolsets.loadFailed',
      'fleet.hermesToolsets.unavailable',
      'fleet.hermesProviderReadiness.title',
      'fleet.hermesProviderReadiness.readyChip',
      'fleet.hermesProviderReadiness.attentionChip',
      'fleet.hermesProviderReadiness.loadingChip',
      'fleet.hermesProviderReadiness.modelLabel',
      'fleet.hermesProviderReadiness.providerLabel',
      'fleet.hermesProviderReadiness.credentialsLabel',
      'fleet.hermesProviderReadiness.credentialsConfigured',
      'fleet.hermesProviderReadiness.credentialsMissing',
      'fleet.hermesProviderReadiness.nousLabel',
      'fleet.hermesProviderReadiness.nousConfigured',
      'fleet.hermesProviderReadiness.nousFallback',
      'fleet.hermesProviderReadiness.toolCallsChip',
      'fleet.hermesProviderReadiness.reasoningChip',
      'fleet.hermesProviderReadiness.visionChip',
      'fleet.hermesProviderReadiness.providersChip',
      'fleet.hermesProviderReadiness.contextLine',
      'fleet.hermesProviderReadiness.unavailable',
      'fleet.hermesProviderReadiness.loadFailed',
      'fleet.hermesProviderReadiness.openSettings',
      'fleet.hermesMemoryProviders.title',
      'fleet.hermesMemoryProviders.readyChip',
      'fleet.hermesMemoryProviders.attentionChip',
      'fleet.hermesMemoryProviders.loadingChip',
      'fleet.hermesMemoryProviders.activeLabel',
      'fleet.hermesMemoryProviders.remoteLabel',
      'fleet.hermesMemoryProviders.missingLabel',
      'fleet.hermesMemoryProviders.noCredentials',
      'fleet.hermesMemoryProviders.unavailable',
      'fleet.hermesMemoryProviders.loadFailed',
      'fleet.hermesMemoryProviders.status.available',
      'fleet.hermesMemoryProviders.status.configured',
      'fleet.hermesMemoryProviders.status.fallback',
      'fleet.hermesMemoryProviders.status.missing',
      'fleet.hermesRuntimeBackends.title',
      'fleet.hermesRuntimeBackends.readyChip',
      'fleet.hermesRuntimeBackends.attentionChip',
      'fleet.hermesRuntimeBackends.loadingChip',
      'fleet.hermesRuntimeBackends.runnableLabel',
      'fleet.hermesRuntimeBackends.runnableValue',
      'fleet.hermesRuntimeBackends.remoteLabel',
      'fleet.hermesRuntimeBackends.platformLabel',
      'fleet.hermesRuntimeBackends.noVersion',
      'fleet.hermesRuntimeBackends.unavailable',
      'fleet.hermesRuntimeBackends.loadFailed',
      'fleet.hermesRuntimeBackends.runSmoke',
      'fleet.hermesRuntimeBackends.smokeUnavailable',
      'fleet.hermesRuntimeBackends.smokePassed',
      'fleet.hermesRuntimeBackends.smokeFailed',
      'fleet.hermesRuntimeBackends.status.available',
      'fleet.hermesRuntimeBackends.status.configured',
      'fleet.hermesRuntimeBackends.status.missing',
      'fleet.hermesRuntimeBackends.status.unsupported',
      'fleet.hermesBrowserBackends.title',
      'fleet.hermesBrowserBackends.readyChip',
      'fleet.hermesBrowserBackends.attentionChip',
      'fleet.hermesBrowserBackends.loadingChip',
      'fleet.hermesBrowserBackends.localLabel',
      'fleet.hermesBrowserBackends.managedLabel',
      'fleet.hermesBrowserBackends.platformLabel',
      'fleet.hermesBrowserBackends.noVersion',
      'fleet.hermesBrowserBackends.unavailable',
      'fleet.hermesBrowserBackends.loadFailed',
      'fleet.hermesBrowserBackends.runSmoke',
      'fleet.hermesBrowserBackends.smokeUnavailable',
      'fleet.hermesBrowserBackends.smokePassed',
      'fleet.hermesBrowserBackends.smokeFailed',
      'fleet.hermesBrowserBackends.status.available',
      'fleet.hermesBrowserBackends.status.configured',
      'fleet.hermesBrowserBackends.status.missing',
      'fleet.hermesBrowserBackends.status.unsupported',
      'fleet.hermesProtocolGateways.title',
      'fleet.hermesProtocolGateways.readyChip',
      'fleet.hermesProtocolGateways.attentionChip',
      'fleet.hermesProtocolGateways.loadingChip',
      'fleet.hermesProtocolGateways.availableLabel',
      'fleet.hermesProtocolGateways.availableValue',
      'fleet.hermesProtocolGateways.partialLabel',
      'fleet.hermesProtocolGateways.routesLabel',
      'fleet.hermesProtocolGateways.runSmoke',
      'fleet.hermesProtocolGateways.smokeUnavailable',
      'fleet.hermesProtocolGateways.smokePassed',
      'fleet.hermesProtocolGateways.smokeFailed',
      'fleet.hermesProtocolGateways.unavailable',
      'fleet.hermesProtocolGateways.loadFailed',
      'fleet.hermesProtocolGateways.status.available',
      'fleet.hermesProtocolGateways.status.partial',
      'fleet.hermesProtocolGateways.status.missing',
      'fleet.hermesLocalSmoke.title',
      'fleet.hermesLocalSmoke.idleChip',
      'fleet.hermesLocalSmoke.runningChip',
      'fleet.hermesLocalSmoke.resultChip',
      'fleet.hermesLocalSmoke.failedChip',
      'fleet.hermesLocalSmoke.runSmoke',
      'fleet.hermesLocalSmoke.unavailable',
      'fleet.hermesLocalSmoke.readyHint',
      'fleet.hermesLocalSmoke.smokePassed',
      'fleet.hermesLocalSmoke.smokeFailed',
      'fleet.hermesLocalSmoke.runtimeLabel',
      'fleet.hermesLocalSmoke.browserLabel',
      'fleet.hermesLocalSmoke.protocolsLabel',
      'fleet.hermesLocalSmoke.protocolsValue',
      'fleet.hermesMessagingGateway.title',
      'fleet.hermesMessagingGateway.readyChip',
      'fleet.hermesMessagingGateway.attentionChip',
      'fleet.hermesMessagingGateway.loadingChip',
      'fleet.hermesMessagingGateway.configuredLabel',
      'fleet.hermesMessagingGateway.runtimeLabel',
      'fleet.hermesMessagingGateway.runtimeValue',
      'fleet.hermesMessagingGateway.authLabel',
      'fleet.hermesMessagingGateway.officialCoverageChip',
      'fleet.hermesMessagingGateway.configuredPlatformsChip',
      'fleet.hermesMessagingGateway.missingPlatformsChip',
      'fleet.hermesMessagingGateway.connectedState',
      'fleet.hermesMessagingGateway.pendingState',
      'fleet.hermesMessagingGateway.disabledState',
      'fleet.hermesMessagingGateway.unavailable',
      'fleet.hermesMessagingGateway.loadFailed',
      'fleet.hermesMobileSupervision.title',
      'fleet.hermesMobileSupervision.readyChip',
      'fleet.hermesMobileSupervision.attentionChip',
      'fleet.hermesMobileSupervision.loadingChip',
      'fleet.hermesMobileSupervision.readOnlyLabel',
      'fleet.hermesMobileSupervision.draftLabel',
      'fleet.hermesMobileSupervision.blockedLabel',
      'fleet.hermesMobileSupervision.queueChip',
      'fleet.hermesMobileSupervision.pairingChip',
      'fleet.hermesMobileSupervision.labelLimitChip',
      'fleet.hermesMobileSupervision.remoteChip',
      'fleet.hermesMobileSupervision.unavailable',
      'fleet.hermesMobileSupervision.loadFailed',
      'fleet.skillCandidate.title',
      'fleet.skillCandidate.countChip',
      'fleet.skillCandidate.reviewChip',
      'fleet.skillCandidate.noAutoInstallChip',
      'fleet.skillCandidate.publicDataChip',
      'fleet.skillCandidate.guardrail',
      'fleet.skillCandidate.loadFailed',
      'fleet.skillCandidate.empty',
      'fleet.skillCandidate.learningKind',
      'fleet.skillCandidate.researchKind',
      'fleet.skillCandidate.notEligibleChip',
      'fleet.skillCandidate.toolSequence',
      'fleet.skillCandidate.expandDiff',
      'fleet.skillCandidate.collapseDiff',
      'fleet.skillCandidate.diffStats',
      'fleet.skillCandidate.diffTruncated',
      'fleet.skillCandidate.installedColumn',
      'fleet.skillCandidate.candidateColumn',
      'fleet.skillCandidate.useAsGoal',
      'fleet.lessonCandidate.title',
      'fleet.lessonCandidate.countChip',
      'fleet.lessonCandidate.pendingChip',
      'fleet.lessonCandidate.approvedChip',
      'fleet.lessonCandidate.discardedChip',
      'fleet.lessonCandidate.loadFailed',
      'fleet.lessonCandidate.guardrail',
      'fleet.lessonCandidate.openReview',
      'fleet.skillPackage.title',
      'fleet.skillPackage.countChip',
      'fleet.skillPackage.enabledChip',
      'fleet.skillPackage.disabledChip',
      'fleet.skillPackage.rollbackChip',
      'fleet.skillPackage.healthChip',
      'fleet.skillPackage.healthWarning',
      'fleet.skillPackage.guardrail',
      'fleet.skillPackage.loadFailed',
      'fleet.skillPackage.empty',
      'fleet.skillPackage.useAsGoal',
      'fleet.learningUsage.title',
      'fleet.learningUsage.countChip',
      'fleet.learningUsage.reinforcedChip',
      'fleet.learningUsage.deprecatedChip',
      'fleet.learningUsage.loadFailed',
      'fleet.learningUsage.empty',
      'fleet.learningUsage.runsChip',
      'fleet.hermesLearningLoop.title',
      'fleet.hermesLearningLoop.readyChip',
      'fleet.hermesLearningLoop.attentionChip',
      'fleet.hermesLearningLoop.loadingChip',
      'fleet.hermesLearningLoop.runsLabel',
      'fleet.hermesLearningLoop.candidatesLabel',
      'fleet.hermesLearningLoop.patternsLabel',
      'fleet.hermesLearningLoop.autoChip',
      'fleet.hermesLearningLoop.coverageChip',
      'fleet.hermesLearningLoop.userModelChip',
      'fleet.hermesLearningLoop.pendingReviewChip',
      'fleet.hermesLearningLoop.skillsChip',
      'fleet.hermesLearningLoop.skillCandidatesChip',
      'fleet.hermesLearningLoop.skillCandidateReadinessChip',
      'fleet.hermesLearningLoop.staleRuns',
      'fleet.hermesLearningLoop.runDoctor',
      'fleet.hermesLearningLoop.runDoctorDone',
      'fleet.hermesLearningLoop.runDoctorFailed',
      'fleet.hermesLearningLoop.runDoctorMoreStale',
      'fleet.hermesLearningLoop.runDoctorStaleRun',
      'fleet.hermesLearningLoop.runDoctorUnavailable',
      'fleet.hermesLearningLoop.skillScoreChip',
      'fleet.hermesLearningLoop.skillCandidatesTitle',
      'fleet.hermesLearningLoop.skillCandidateSampleMeta',
      'fleet.hermesLearningLoop.skillCandidateMore',
      'fleet.hermesLearningLoop.nextRetrospectiveLabel',
      'fleet.hermesLearningLoop.nextRetrospectiveMeta',
      'fleet.hermesLearningLoop.nextRetrospectiveEvents',
      'fleet.hermesLearningLoop.runRetrospective',
      'fleet.hermesLearningLoop.retrospectiveUnavailable',
      'fleet.hermesLearningLoop.retrospectiveDone',
      'fleet.hermesLearningLoop.retrospectiveFailed',
      'fleet.hermesLearningLoop.reviewLessons',
      'fleet.hermesLearningLoop.reviewQueueTitle',
      'fleet.hermesLearningLoop.reviewQueueCount',
      'fleet.hermesLearningLoop.reviewQueueItem',
      'fleet.hermesLearningLoop.reviewQueueSamples',
      'fleet.hermesLearningLoop.openReview',
      'fleet.hermesLearningLoop.reviewGate',
      'fleet.hermesLearningLoop.reviewGateMissing',
      'fleet.hermesLearningLoop.unavailable',
      'fleet.hermesLearningLoop.loadFailed',
      'fleet.browserOperator.title',
      'fleet.browserOperator.actionsChip',
      'fleet.browserOperator.consentRequiredChip',
      'fleet.browserOperator.noLocalConsentChip',
      'fleet.browserOperator.proofChip',
      'fleet.browserOperator.guardrail',
      'fleet.browserOperator.useAsGoal',
      'fleet.browserOperator.schedule',
      'fleet.memoryContext.title',
      'fleet.memoryContext.include',
      'fleet.memoryContext.heading',
      'fleet.memoryContext.instruction',
      'fleet.dispatchProfile',
      'fleet.scheduleDispatch',
      'fleet.dispatchProfiles.balanced',
      'fleet.dispatchProfiles.research',
      'fleet.dispatchProfiles.code',
      'fleet.dispatchProfiles.review',
      'fleet.dispatchProfiles.safe',
      'fleet.profileContext.heading',
      'fleet.profileContext.balanced',
      'fleet.profileContext.research',
      'fleet.profileContext.code',
      'fleet.profileContext.review',
      'fleet.profileContext.safe',
      'fleet.scheduledDispatch.heading',
      'fleet.scheduledDispatch.profile',
      'fleet.scheduledDispatch.privacy',
      'fleet.scheduledDispatch.parallelism',
      'fleet.scheduledDispatch.instruction',
      'fleet.scheduledDispatch.goal',
      'fleet.scheduledWork.peerCountChip',
      'fleet.detail.toolPolicy',
      'fleet.detail.chatSessions',
      'fleet.detail.turnCount',
      'fleet.detail.copyOutcome',
      'fleet.detail.copiedOutcome',
      'fleet.detail.useOutcomeAsGoal',
      'fleet.detail.saveOutcomeMemory',
      'fleet.detail.savingOutcomeMemory',
      'fleet.detail.savedOutcomeMemory',
      'fleet.detail.saveOutcomeMemoryFailed',
      'fleet.detail.saveOutcomeLesson',
      'fleet.detail.savingOutcomeLesson',
      'fleet.detail.savedOutcomeLesson',
      'fleet.detail.saveOutcomeLessonFailed',
      'fleet.followUp.heading',
      'fleet.followUp.outcome',
      'fleet.followUp.status',
      'fleet.followUp.saga',
      'fleet.followUp.steps',
      'fleet.followUp.hermesPlan',
      'fleet.followUp.targets',
      'fleet.followUp.deliveryChannel',
      'fleet.followUp.memory',
      'fleet.followUp.toolPolicy',
      'fleet.followUp.webProof',
      'fleet.followUp.webProofSteps',
      'fleet.followUp.finalResultPreview',
      'fleet.followUp.errorSummary',
      'fleet.followUp.instruction',
      'fleet.runDraft.title',
      'fleet.detail.finalResultPreview',
      'fleet.detail.errorSummary',
      'fleet.detail.noFinalPreview',
    ];

    for (const key of requiredFleetKeys) {
      expect(source).toContain(key);
    }

    for (const localePath of [enLocalePath, frLocalePath, zhLocalePath]) {
      const locale = readJson(localePath);
      for (const key of requiredFleetKeys) {
        expect(getPath(locale, key)).toBeTruthy();
      }
    }
  });
});

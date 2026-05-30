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
const skillCandidateReviewQueueStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/skill-candidate-review-queue-strip.tsx'
);
const learningSkillUsageStripPath = path.resolve(
  process.cwd(),
  'src/renderer/components/learning-skill-usage-strip.tsx'
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
  path.resolve(process.cwd(), 'src/renderer/components/MemoryBrowser.tsx'),
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
      fs.readFileSync(skillCandidateReviewQueueStripPath, 'utf8'),
      fs.readFileSync(learningSkillUsageStripPath, 'utf8'),
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
      'fleet.skillCandidate.toolSequence',
      'fleet.skillCandidate.useAsGoal',
      'fleet.learningUsage.title',
      'fleet.learningUsage.countChip',
      'fleet.learningUsage.reinforcedChip',
      'fleet.learningUsage.deprecatedChip',
      'fleet.learningUsage.loadFailed',
      'fleet.learningUsage.empty',
      'fleet.learningUsage.runsChip',
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

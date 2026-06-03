import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');

describe('App startup lazy loading', () => {
  it('defers heavyweight and closed-by-default panels behind lazy imports', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const deferredComponents = [
      'ChatView',
      'ContextPanel',
      'ConfigModal',
      'SettingsPanel',
      'WelcomeView',
      'CommandPalette',
      'KeyboardShortcutsDialog',
      'GlobalSearchDialog',
      'PermissionDialog',
      'SudoPasswordDialog',
      'SandboxSetupDialog',
      'UpdateNotification',
      'ActivityFeed',
      'SessionInsightsPanel',
      'SessionResumeDialog',
      'BookmarksPanel',
      'SnippetsLibrary',
      'PersonaSwitcherDialog',
      'TestRunnerPanel',
      'ReasoningTraceViewer',
      'FocusView',
      'NotificationCenter',
      'EnrollmentDialog',
      'OrchestratorLauncher',
      'FleetPanel',
      'FleetCommandCenter',
      'TeamPanel',
      'LessonCandidatePanel',
      'UserModelPanel',
      'SpecPanel',
      'MobileSupervisionPanel',
      'IdentityPanel',
      'DevicePanel',
      'ChannelsPanel',
      'CompanionPanel',
      'OnboardingWizard',
      'SubAgentDashboard',
      'DiagnosticsPanel',
      'BtwQuickAsk',
    ];

    for (const component of deferredComponents) {
      expect(source).not.toContain(
        `import { ${component} } from './components/${component}';`
      );
      expect(source).toContain(`const ${component} = lazy(() =>`);
      expect(source).toContain(`default: module.${component}`);
    }
  });

  it('uses suspense boundaries for deferred panels', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('<Suspense fallback=');
  });

  it('keeps the presence model install probe mounted eagerly', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain(
      "import { ModelInstallDialog } from './components/ModelInstallDialog';"
    );
    expect(source).toContain('<ModelInstallDialog />');
    expect(source).not.toContain('const ModelInstallDialog = lazy(() =>');
  });
});

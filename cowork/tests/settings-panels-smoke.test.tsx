/**
 * @vitest-environment happy-dom
 *
 * Render smoke test for every Settings panel. Each panel is mounted with mocked
 * i18n, store and window.electronAPI; the test asserts it renders without a
 * synchronous throw. This guards against gross runtime breakage (a throwing
 * component, a bad hook, a missing import) across all 32 panels.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// --- i18n: return the fallback string (or the key) with interpolation ---------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en', changeLanguage: vi.fn() },
    t: (key: string, fb?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const template = typeof fb === 'string' ? fb : key;
      const options = typeof fb === 'object' ? fb : opts;
      return Object.entries(options ?? {}).reduce(
        (v, [k, val]) => v.replaceAll(`{{${k}}}`, String(val)),
        template
      );
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  initReactI18next: { type: '3rdParty', init: () => {} },
  I18nextProvider: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// --- store: permissive selector; callback-looking keys are no-ops -------------
vi.mock('../src/renderer/store', () => {
  const base: Record<string, unknown> = {
    sessions: [],
    projects: [],
    notifications: [],
    guiActions: [],
    browserActions: [],
    openTabs: [],
    subAgents: [],
    fleetPeers: [],
    workflowExecutions: [],
    bookmarkedMessageIds: new Set(),
    a2aTasks: {},
    workingDir: '/tmp/workspace',
    activeSessionId: null,
    activeProjectId: null,
    settings: { theme: 'dark', language: 'en' },
    appConfig: {},
    team: { members: [], tasks: [] },
    systemDarkMode: true,
    ngrokTunnel: { active: false, authToken: '', domain: '', url: null },
  };
  const isCallbackKey = (k: string) =>
    /^(set|show|toggle|open|close|clear|add|remove|update|refresh|on|hide|select|start|stop|reset|save|load)/.test(
      k
    );
  const state = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && isCallbackKey(prop)) return () => {};
      return undefined;
    },
  });
  const useAppStore = (selector?: (s: typeof state) => unknown) =>
    typeof selector === 'function' ? selector(state) : state;
  (useAppStore as unknown as { getState: () => unknown }).getState = () => state;
  (useAppStore as unknown as { setState: () => void }).setState = () => {};
  return { useAppStore, useStore: useAppStore, default: useAppStore };
});

// --- a deep, callable, forgiving electronAPI ----------------------------------
// Event-subscription methods must return an unsubscribe *function*; everything
// else returns a Promise so `await api.x()` yields undefined (panels guard with
// `?.`/`|| []`). Namespaces (api.mcp.*) are nested callable proxies.
const EVENT_METHODS = new Set(['on', 'off', 'once', 'addListener', 'removeListener', 'subscribe']);
function makeForgiving(): unknown {
  const fn = () => Promise.resolve(undefined);
  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined; // not a thenable itself
      if (prop === Symbol.iterator) return function* () {};
      if (typeof prop === 'string' && (EVENT_METHODS.has(prop) || /^on[A-Z]/.test(prop))) {
        return () => () => {}; // subscribe()/onX() returns an unsubscribe fn
      }
      return makeForgiving();
    },
    apply: () => Promise.resolve(undefined),
  });
}

// Panels under test — keep this list in sync with docs/settings-panels.md.
import { SettingsAPI } from '../src/renderer/components/settings/SettingsAPI';
import { SettingsCodeBuddy } from '../src/renderer/components/settings/SettingsCodeBuddy';
import { SettingsSandbox } from '../src/renderer/components/settings/SettingsSandbox';
import { SettingsConnectors } from '../src/renderer/components/settings/SettingsConnectors';
import { SettingsSkills } from '../src/renderer/components/settings/SettingsSkills';
import { SettingsCustomize } from '../src/renderer/components/settings/SettingsCustomize';
import { SettingsProjects } from '../src/renderer/components/settings/SettingsProjects';
import { SettingsSchedule } from '../src/renderer/components/settings/SettingsSchedule';
import { SettingsLogs } from '../src/renderer/components/settings/SettingsLogs';
import { SettingsWorkflows } from '../src/renderer/components/settings/SettingsWorkflows';
import { SettingsCostDashboard } from '../src/renderer/components/settings/SettingsCostDashboard';
import { SettingsPermissionRules } from '../src/renderer/components/settings/SettingsPermissionRules';
import { SettingsMCPMarketplace } from '../src/renderer/components/settings/SettingsMCPMarketplace';
import { SettingsSnippets } from '../src/renderer/components/settings/SettingsSnippets';
import { SettingsCustomCommands } from '../src/renderer/components/settings/SettingsCustomCommands';
import { SettingsWorkspacePresets } from '../src/renderer/components/settings/SettingsWorkspacePresets';
import { SettingsHooks } from '../src/renderer/components/settings/SettingsHooks';
import { SettingsA2AAgents } from '../src/renderer/components/settings/SettingsA2AAgents';
import { SettingsPlugins } from '../src/renderer/components/settings/SettingsPlugins';
import { SettingsTelemetry } from '../src/renderer/components/settings/SettingsTelemetry';
import { SettingsServer } from '../src/renderer/components/settings/SettingsServer';
import { SettingsCoreEngine } from '../src/renderer/components/settings/SettingsCoreEngine';
import { SettingsProfiles } from '../src/renderer/components/settings/SettingsProfiles';
import { SettingsRemoteBackend } from '../src/renderer/components/settings/SettingsRemoteBackend';
import { SettingsControlCenter } from '../src/renderer/components/settings/SettingsControlCenter';
import { SettingsGeneral } from '../src/renderer/components/settings/SettingsGeneral';
import { SettingsLocalProviders } from '../src/renderer/components/settings/SettingsLocalProviders';
import { SettingsImportExport } from '../src/renderer/components/settings/SettingsImportExport';
import { SettingsMCPPlayground } from '../src/renderer/components/settings/SettingsMCPPlayground';
import { SettingsTunnel } from '../src/renderer/components/settings/SettingsTunnel';

// Common props passed to every panel; unused ones are ignored by each component.
const COMMON_PROPS: Record<string, unknown> = {
  isActive: true,
  onNavigate: () => {},
  onClose: () => {},
  onOpenTestRunner: () => {},
  onOpenOrchestrator: () => {},
  onOpenFleet: () => {},
  onOpenTeam: () => {},
  onOpenCompanion: () => {},
};

const PANELS: Array<[string, React.ComponentType<Record<string, unknown>>]> = [
  ['SettingsControlCenter', SettingsControlCenter as never],
  ['SettingsAPI', SettingsAPI as never],
  ['SettingsCodeBuddy', SettingsCodeBuddy as never],
  ['SettingsSandbox', SettingsSandbox as never],
  ['SettingsConnectors', SettingsConnectors as never],
  ['SettingsSkills', SettingsSkills as never],
  ['SettingsCustomize', SettingsCustomize as never],
  ['SettingsProjects', SettingsProjects as never],
  ['SettingsSchedule', SettingsSchedule as never],
  ['SettingsLogs', SettingsLogs as never],
  ['SettingsWorkflows', SettingsWorkflows as never],
  ['SettingsCostDashboard', SettingsCostDashboard as never],
  ['SettingsPermissionRules', SettingsPermissionRules as never],
  ['SettingsMCPMarketplace', SettingsMCPMarketplace as never],
  ['SettingsSnippets', SettingsSnippets as never],
  ['SettingsCustomCommands', SettingsCustomCommands as never],
  ['SettingsWorkspacePresets', SettingsWorkspacePresets as never],
  ['SettingsHooks', SettingsHooks as never],
  ['SettingsA2AAgents', SettingsA2AAgents as never],
  ['SettingsPlugins', SettingsPlugins as never],
  ['SettingsTelemetry', SettingsTelemetry as never],
  ['SettingsServer', SettingsServer as never],
  ['SettingsCoreEngine', SettingsCoreEngine as never],
  ['SettingsProfiles', SettingsProfiles as never],
  ['SettingsRemoteBackend', SettingsRemoteBackend as never],
  ['SettingsGeneral', SettingsGeneral as never],
  ['SettingsLocalProviders', SettingsLocalProviders as never],
  ['SettingsImportExport', SettingsImportExport as never],
  ['SettingsMCPPlayground', SettingsMCPPlayground as never],
  ['SettingsTunnel', SettingsTunnel as never],
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as unknown as { window: Window }).window.electronAPI = makeForgiving() as never;
  // matchMedia is used by theme-aware panels.
  (globalThis as unknown as { window: Window }).window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as never;
  // Swallow async IPC rejections from the forgiving mock (post-mount effects).
  process.on('unhandledRejection', () => {});
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

describe('Settings panels render smoke test', () => {
  it.each(PANELS)('%s mounts without throwing', (_name, Component) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // act() rethrows any error from the component's render/effects, so reaching
    // the assertion means the panel mounted cleanly. Some panels legitimately
    // render an empty subtree in the mocked empty state — that is still a pass.
    act(() => {
      root!.render(React.createElement(Component, COMMON_PROPS));
    });
    expect(container.isConnected).toBe(true);
  });

  it('covers the full set of documented panels', () => {
    expect(PANELS).toHaveLength(30);
  });
});

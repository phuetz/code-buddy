import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const dockWorkspacePath = path.resolve(
  process.cwd(),
  'src/renderer/components/DockWorkspace.tsx'
);

// Lazy-loading strategy since the rc-dock layout (b08f993e): App.tsx defers the
// heavy modal/panel surfaces itself, while ChatView/ContextPanel are lazy-loaded
// by DockWorkspace (the dock tab host). App.tsx must NOT re-import them statically.
describe('App startup lazy loading', () => {
  it('defers heavy panels behind lazy imports in App.tsx', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).not.toContain("import { ChatView } from './components/ChatView';");
    expect(source).not.toContain("import { ContextPanel } from './components/ContextPanel';");
    expect(source).not.toContain("import { ConfigModal } from './components/ConfigModal';");
    expect(source).not.toContain("import { SettingsPanel } from './components/SettingsPanel';");

    expect(source).toContain('const ConfigModal = lazy(() =>');
    expect(source).toContain('const SettingsPanel = lazy(() =>');
    expect(source).toContain('const CompanionPanel = lazy(() =>');
    expect(source).toContain('const TestRunnerPanel = lazy(() =>');
    expect(source).toContain('const FleetCommandCenter = lazy(() =>');
  });

  it('lazy loads ChatView and ContextPanel inside the dock workspace', () => {
    const source = fs.readFileSync(dockWorkspacePath, 'utf8');

    expect(source).toContain("const ChatView = React.lazy(() => import('./ChatView')");
    expect(source).toContain("const ContextPanel = React.lazy(() => import('./ContextPanel')");
    expect(source).toContain('<Suspense fallback=');
  });

  it('uses suspense boundaries for deferred panels', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('<Suspense fallback=');
  });
});

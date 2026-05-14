import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

describe('Fleet panel discovery wiring', () => {
  it('exposes manual Fleet discovery through preload', () => {
    const preload = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf-8');

    expect(preload).toContain("ipcRenderer.invoke('fleet.discoverPeers')");
    expect(preload).toContain('discoverPeers: () => Promise<{');
  });

  it('lets the Fleet panel scan, add, or dismiss discovered peers', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/renderer/components/FleetPanel.tsx'),
      'utf-8',
    );

    expect(source).toContain('window.electronAPI.fleet.discoverPeers()');
    expect(source).toContain('const discoveredPeers = useAppStore((s) => s.fleetDiscoveredPeers);');
    expect(source).toContain('capability: p.capability');
    expect(source).toContain('dismissFleetDiscoveredPeer(peer.url)');
    expect(source).toContain("title={peer.apiKey ? 'Add peer' : 'Use in add form'}");
  });

  it('keeps the command center pointing to Fleet instead of A2A for peers', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/renderer/components/FleetCommandCenter.tsx'),
      'utf-8',
    );

    expect(source).toContain('Ouvre le panneau Fleet');
    expect(source).not.toContain('Settings → A2A');
  });
});

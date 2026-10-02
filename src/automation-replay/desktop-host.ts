import type { SmartSnapshotManager } from '../desktop-automation/smart-snapshot.js';
import type { ComputerControlInput } from '../tools/computer-control-tool.js';
import type { ToolResult } from '../types/index.js';
import { uniqueTarget } from './engine.js';
import type { ReplayHost } from './types.js';

export function desktopReplayHost(
  snapshots: SmartSnapshotManager,
  activeWindow: () => Promise<{ processName: string; title: string } | null>,
  execute: (input: ComputerControlInput) => Promise<ToolResult>,
): ReplayHost {
  const host: ReplayHost = {
    kind: 'desktop',
    async observe() {
      const window = await activeWindow();
      if (!window) throw new Error('Desktop replay requires an identified active application');
      const snapshot = await snapshots.takeSnapshot({ interactiveOnly: false });
      const real = snapshot.elements.filter(e => e.visible && ['at-spi', 'uia'].includes(String(e.attributes?.source)) && e.attributes?.windowTitle === window.title);
      if (!real.length) throw new Error('Desktop replay requires a real AT-SPI/UIA tree; OCR, mock and coordinate replay refused');
      return {
        context: JSON.stringify([process.platform, window.processName, window.title]),
        text: real.map(e => e.name).join('\n'),
        nodes: real.filter(e => e.interactive).map(e => ({
          ref: e.ref, role: e.role, name: e.name, enabled: e.enabled,
          protected: e.attributes?.protected !== false || /password|mot de passe|secret|token/i.test(e.name),
        })),
      };
    },
    async perform(action, values) {
      const node = uniqueTarget(await host.observe(), action);
      // Every activation re-enters ComputerControlTool.execute and its forcePrompt guard.
      // Coordinates are resolved from the NEW native accessibility observation only.
      const clicked = await execute({ action: 'click', ref: node.ref });
      if (!clicked.success) throw new Error(clicked.error ?? 'Desktop activation denied');
      if (action.kind === 'click') return;
      const fresh = await host.observe();
      const target = uniqueTarget(fresh, action);
      if (!snapshots.getElement(target.ref)?.focused) throw new Error('Keyboard target focus is not proven');
      const result = await execute(action.kind === 'type'
        ? { action: 'type', text: values[action.valueKey!] }
        : { action: 'key', key: action.key });
      if (!result.success) throw new Error(result.error ?? 'Desktop keyboard activation denied');
    },
  };
  return host;
}

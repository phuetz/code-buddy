import type { SmartSnapshotManager } from '../desktop-automation/smart-snapshot.js';
import type { ComputerControlInput } from '../tools/computer-control-tool.js';
import type { ToolResult } from '../types/index.js';
import { getDataRedactionEngine } from '../security/data-redaction.js';
import { uniqueTarget } from './engine.js';
import { digest } from './store.js';
import { sensitiveTarget } from './sensitive-target.js';
import type { ReplayHost } from './types.js';

export function desktopReplayHost(
  snapshots: SmartSnapshotManager,
  activeWindow: () => Promise<{ processName: string; title: string; handle?: string; pid?: number } | null>,
  execute: (input: ComputerControlInput, beforeActivation: () => Promise<void>) => Promise<ToolResult>,
): ReplayHost {
  const host: ReplayHost = {
    kind: 'desktop',
    async observe() {
      const window = await activeWindow();
      if (!window?.handle || !window.pid) throw new Error('Desktop replay requires an identified active application (handle and PID)');
      const snapshot = await snapshots.takeSnapshot({ interactiveOnly: false, includeHidden: true });
      const native = snapshot.elements.filter(e => ['at-spi', 'uia'].includes(String(e.attributes?.source)));
      const real = native.filter(e => e.attributes?.windowTitle === window.title && e.attributes?.pid === window.pid);
      if (!real.length) throw new Error('Desktop replay requires a real AT-SPI/UIA tree; OCR, mock and coordinate replay refused');
      // An incomplete tree cannot prove uniqueness. Multiple same-title windows in one
      // process are refused unless the provider binds the native window handle.
      const identities = new Set(real.map(e => e.attributes?.windowIdentity));
      if (real.some(e => e.attributes?.treeComplete !== true) || identities.size !== 1 || [...identities].some(id => typeof id !== 'string' || !id)) {
        throw new Error('Desktop native window identity or complete tree is not proven');
      }
      if (real.some(e => e.attributes?.source === 'uia' && String(e.attributes.windowHandle ?? '') !== window.handle)) {
        throw new Error('Desktop native window handle mismatch');
      }
      const after = await activeWindow();
      if (JSON.stringify(after) !== JSON.stringify(window)) throw new Error('Active window changed during observation');
      return {
        context: JSON.stringify([process.platform, window.processName, window.title, window.pid, window.handle, [...identities][0]]),
        text: getDataRedactionEngine().redact(real.filter(e => e.visible).map(e => e.name).join('\n')).redacted,
        // Hidden duplicates are retained for uniqueness checks, but cannot be activated.
        nodes: real.filter(e => e.interactive).map(e => ({
          ref: e.ref, role: e.role, name: e.name, enabled: e.enabled && e.visible,
          state: digest({ bounds: e.bounds, focused: e.focused }),
          protected: e.attributes?.protected !== false || sensitiveTarget(e.name),
        })),
      };
    },
    async perform(action, values) {
      const activate = async (keyboard: boolean) => {
        const before = await host.observe();
        const node = uniqueTarget(before, action);
        const focused = () => snapshots.getElement(uniqueTarget(before, action).ref)?.focused === true;
        if (keyboard && !focused()) throw new Error('Keyboard target focus is not proven');
        const verify = async () => {
          const fresh = await host.observe();
          const target = uniqueTarget(fresh, action);
          if (keyboard && !snapshots.getElement(target.ref)?.focused) throw new Error('Keyboard target focus changed during confirmation');
          const stable = (observation: typeof before) => digest({ ...observation, nodes: observation.nodes.map(({ ref: _ref, ...n }) => n) });
          if (stable(fresh) !== stable(before)) throw new Error('Desktop target, window or focus changed during confirmation');
        };
        // This trusted callback is not part of JSON tool arguments. The primitive calls
        // it AFTER all human prompts and immediately BEFORE the physical activation.
        const result = await execute(!keyboard ? { action: 'click', ref: node.ref }
          : action.kind === 'type' ? { action: 'type', ref: node.ref, text: values[action.valueKey!] }
            : { action: 'key', ref: node.ref, key: action.key }, verify);
        if (!result.success) throw new Error(result.error ?? 'Desktop activation denied');
      };
      await activate(false);
      if (action.kind !== 'click') await activate(true);
    },
  };
  return host;
}

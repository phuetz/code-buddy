import type { BrowserManager } from '../browser-automation/browser-manager.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { getDataRedactionEngine } from '../security/data-redaction.js';
import { sensitiveTarget } from './sensitive-target.js';
import { digest } from './store.js';
import { uniqueTarget } from './engine.js';
import type { ReplayHost } from './types.js';

export function browserReplayHost(manager: BrowserManager): ReplayHost {
  const host: ReplayHost = {
    kind: 'browser',
    async observe() {
      const snapshot = await manager.takeSnapshot({ interactiveOnly: false, maxElements: 200 });
      const text = await manager.evaluate({ expression: `(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const parts = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          if (parent && !parent.closest('input, textarea, select, [contenteditable="true"], script, style')
              && parent.getClientRects().length && getComputedStyle(parent).visibility !== 'hidden') {
            parts.push(node.textContent);
          }
        }
        return parts.join('\\n');
      })()` });
      if (!text.success || typeof text.value !== 'string') throw new Error('Cannot observe page text');
      return {
        context: snapshot.url,
        text: getDataRedactionEngine().redact(text.value).redacted.slice(0, 24000),
        nodes: snapshot.elements.filter(e => e.visible && e.interactive).map(e => ({
          ref: e.ref, role: e.role, name: e.name, enabled: !e.disabled,
          state: digest({ type: e.inputType, checked: e.ariaAttributes?.['aria-checked'], expanded: e.ariaAttributes?.['aria-expanded'], selected: e.ariaAttributes?.['aria-selected'] }),
          protected: e.inputType === 'password' || sensitiveTarget(e.name),
        })),
      };
    },
    async perform(action, values) {
      const before = await host.observe();
      uniqueTarget(before, action);
      const approval = await ConfirmationService.getInstance().requestConfirmation({
        operation: `Browser semantic ${action.kind}`, filename: before.context, toolName: 'browser',
        toolArgs: { action: action.kind, target: action.target },
        content: `Target: ${action.target.role} ${action.target.name}`,
      }, 'tool');
      if (!approval.confirmed) throw new Error('Browser action denied by confirmation policy');
      // Check again after a possibly long human prompt. Never use a coordinate fallback.
      const after = await host.observe();
      if (after.context !== before.context) throw new Error('Browser URL changed during confirmation');
      uniqueTarget(after, action);
      await manager.performSemanticAction(action, values, before.context);
    },
  };
  return host;
}

import type { BrowserManager } from '../browser-automation/browser-manager.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { getDataRedactionEngine } from '../security/data-redaction.js';
import { digest } from './store.js';
import { uniqueTarget } from './engine.js';
import type { ReplayHost } from './types.js';

export function browserReplayHost(manager: BrowserManager): ReplayHost {
  const host: ReplayHost = {
    kind: 'browser',
    async observe() {
      const snapshot = await manager.takeSnapshot({ interactiveOnly: false, maxElements: 200 });
      const text = await manager.evaluate({ expression: 'document.body.innerText' });
      if (!text.success || typeof text.value !== 'string') throw new Error('Cannot observe page text');
      return {
        context: snapshot.url,
        text: getDataRedactionEngine().redact(text.value).redacted.slice(0, 24000),
        nodes: snapshot.elements.filter(e => e.visible && e.interactive).map(e => ({
          ref: e.ref, role: e.role, name: e.name, enabled: !e.disabled,
          state: digest({ type: e.inputType, aria: e.ariaAttributes, value: e.inputType === 'password' ? undefined : e.value }),
          protected: e.inputType === 'password' || /password|mot de passe|secret|token|cvv/i.test(e.name),
        })),
      };
    },
    async perform(action, values) {
      uniqueTarget(await host.observe(), action);
      const approval = await ConfirmationService.getInstance().requestConfirmation({
        operation: `Browser semantic ${action.kind}`, filename: (await host.observe()).context, toolName: 'browser',
        toolArgs: { action: action.kind, target: action.target },
        content: `Target: ${action.target.role} ${action.target.name}`,
      }, 'tool');
      if (!approval.confirmed) throw new Error('Browser action denied by confirmation policy');
      // Check again after a possibly long human prompt. Never use a coordinate fallback.
      uniqueTarget(await host.observe(), action);
      await manager.performSemanticAction(action, values);
    },
  };
  return host;
}

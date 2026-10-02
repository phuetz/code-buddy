/**
 * Inspiration: Hermes pre_verify (MIT, 34f8ec3b4); independent implementation.
 * Runs operator-configured verification commands before committing a final reply.
 */
import type { ConversationMiddleware, MiddlewareContext, MiddlewareResult } from './types.js';
import { getUserHooksManager } from '../../hooks/user-hooks.js';

export class PreVerifyMiddleware implements ConversationMiddleware {
  readonly name = 'pre_verify';
  // Before verification nudges (155) and quality review (200). Only this
  // completion phase runs here; existing afterTurn warnings keep their contract.
  readonly priority = 154;
  constructor(private readonly workingDirectory = process.cwd()) {}

  async beforeComplete(context: MiddlewareContext): Promise<MiddlewareResult> {
    if (process.env.CODEBUDDY_PRE_VERIFY !== 'true') return { action: 'continue' };
    if (context.abortController?.signal.aborted) return { action: 'stop', message: 'pre_verify: tâche annulée.' };
    const hooks = getUserHooksManager(this.workingDirectory);
    if (hooks.getConfigurationError()) return { action: 'stop', message: 'pre_verify: hooks.json illisible ou invalide.' };
    const handlers = hooks.getHandlers('pre_verify');
    if (handlers.length === 0) return { action: 'stop', message: 'pre_verify: aucune commande de vérification configurée dans hooks.json.' };
    // A conditional filter can silently skip the required verification. This
    // first version accepts unconditional commands only, with bounded timeouts.
    if (handlers.some(h => h.type !== 'command' || !h.command || h.if ||
      (h.timeout !== undefined && (!Number.isFinite(h.timeout) || h.timeout < 1 || h.timeout > 60_000)))) {
      return { action: 'stop', message: 'pre_verify: configuration invalide (commandes sans filtre, délai de 1 à 60000 ms).' };
    }
    const result = await hooks.executeHooks('pre_verify', {
      cwd: this.workingDirectory,
      changedFiles: context.changedFiles ?? [],
      recentToolResults: context.lastToolResults ?? [],
      candidate: context.completionCandidate ?? '',
    });
    if (!result.allowed) return { action: 'stop', message: `pre_verify: ${result.feedback ?? 'vérification refusée'}`.slice(0, 2000) };
    return { action: 'continue' };
  }
}

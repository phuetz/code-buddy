/**
 * Provider Onboarding Orchestrator
 *
 * Runs the 5-phase provider onboarding lifecycle:
 *   1. auth          — validate credentials
 *   2. wizard.onboarding — interactive setup
 *   3. discovery.run — discover available models
 *   4. wizard.modelPicker — let user pick a model
 *   5. onModelSelected — post-selection hook
 *
 * Phases that are not implemented by the provider are silently skipped.
 * Auth failures and empty model discovery short-circuit the pipeline.
 *
 * Native Engine v2026.3.19 — Provider Plugin Onboarding Architecture.
 */

import { logger } from '../utils/logger.js';
import type {
  PluginProvider,
  OnboardingResult,
  DiscoveredModel,
} from './types.js';

/**
 * Run the full provider onboarding lifecycle.
 *
 * @param provider - The plugin provider with optional onboarding hooks
 * @returns An OnboardingResult summarising the outcome
 */
export async function runProviderOnboarding(
  provider: PluginProvider
): Promise<OnboardingResult> {
  const hooks = provider.onboarding;
  if (!hooks) {
    return { success: true, message: 'No onboarding hooks defined — skipped' };
  }

  const tag = `[onboarding:${provider.id}]`;

  // ── Phase 1: auth ─────────────────────────────────────────────────────
  if (hooks.auth) {
    logger.debug(`${tag} Phase 1/5 — auth`);
    try {
      const authResult = await hooks.auth();
      if (!authResult.valid) {
        const reason = authResult.error ?? 'unknown auth error';
        logger.warn(`${tag} Auth failed: ${reason}`);
        return { success: false, message: `Auth failed: ${reason}` };
      }
      logger.debug(`${tag} Auth succeeded`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`${tag} Auth threw: ${msg}`);
      return { success: false, message: `Auth error: ${msg}` };
    }
  }

  // ── Phase 2: wizard.onboarding ────────────────────────────────────────
  let wizardConfig: Record<string, unknown> | undefined;
  if (hooks['wizard.onboarding']) {
    logger.debug(`${tag} Phase 2/5 — wizard.onboarding`);
    try {
      const wizardResult = await hooks['wizard.onboarding']();
      if (!wizardResult.success) {
        logger.warn(`${tag} Onboarding wizard failed: ${wizardResult.message ?? 'unknown'}`);
        return wizardResult;
      }
      wizardConfig = wizardResult.config;
      logger.debug(`${tag} Onboarding wizard succeeded`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`${tag} Onboarding wizard threw: ${msg}`);
      return { success: false, message: `Onboarding error: ${msg}` };
    }
  }

  // ── Phase 3: discovery.run ────────────────────────────────────────────
  let models: DiscoveredModel[] = [];
  if (hooks['discovery.run']) {
    logger.debug(`${tag} Phase 3/5 — discovery.run`);
    try {
      models = await hooks['discovery.run']();
      logger.debug(`${tag} Discovered ${models.length} model(s)`);
      if (models.length === 0) {
        logger.warn(`${tag} Discovery returned no models`);
        return { success: false, message: 'Discovery returned no models' };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`${tag} Discovery threw: ${msg}`);
      return { success: false, message: `Discovery error: ${msg}` };
    }
  }

  // ── Phase 4: wizard.modelPicker ───────────────────────────────────────
  let selectedModel: string | undefined;
  if (hooks['wizard.modelPicker'] && models.length > 0) {
    logger.debug(`${tag} Phase 4/5 — wizard.modelPicker`);
    try {
      selectedModel = await hooks['wizard.modelPicker'](models);
      logger.debug(`${tag} User selected model: ${selectedModel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`${tag} Model picker threw: ${msg}`);
      return { success: false, message: `Model picker error: ${msg}` };
    }
  }

  // ── Phase 5: onModelSelected ──────────────────────────────────────────
  if (hooks.onModelSelected && selectedModel) {
    logger.debug(`${tag} Phase 5/5 — onModelSelected`);
    try {
      await hooks.onModelSelected(selectedModel);
      logger.debug(`${tag} onModelSelected completed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`${tag} onModelSelected threw: ${msg}`);
      return { success: false, message: `Post-selection error: ${msg}` };
    }
  }

  return {
    success: true,
    config: {
      ...wizardConfig,
      ...(selectedModel ? { selectedModel } : {}),
    },
    message: `Onboarding completed for ${provider.name}`,
  };
}

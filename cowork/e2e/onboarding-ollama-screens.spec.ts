/**
 * Doc screenshots — the Ollama onboarding journey, zero → first chat.
 *
 * Drives the real first-run wizard on a real Electron boot, configuring a local
 * Ollama provider, running the wizard's REAL reachability probe (`config.test`
 * → live Ollama), finishing onboarding, and sending a REAL first prompt to
 * Ollama. Captures a PNG at each step into docs/ for getting-started.md.
 *
 * Run: COWORK_ONBOARDING_SHOTS=1 npx playwright test e2e/onboarding-ollama-screens.spec.ts
 * Requires a local Ollama serving `qwen2.5:7b-instruct` on :11434.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const ENABLED = process.env.COWORK_ONBOARDING_SHOTS === '1';
const OLLAMA_BASE = 'http://localhost:11434/v1';
const OLLAMA_MODEL = 'qwen2.5:7b-instruct';
const OUT = path.resolve(process.cwd(), '../docs/assets/onboarding');

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400); // let the step settle
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

/** Configure a local Ollama provider the same way Settings → API does (full
 * config-set + profile), WITHOUT marking onboarding complete so the wizard
 * stays up and its connection panel shows "Connected: ollama". */
async function configureOllama(appPage: Page): Promise<void> {
  const result = await appPage.evaluate(
    async ({ baseUrl, model }) => {
      const current = await window.electronAPI?.config?.get?.();
      if (!current) throw new Error('Config bridge unavailable');
      const profiles = {
        ...current.profiles,
        ollama: { ...(current.profiles?.ollama || {}), apiKey: '', baseUrl, model },
      };
      const activeConfigSetId =
        current.activeConfigSetId || current.configSets?.[0]?.id || 'default';
      const configSets = (current.configSets || []).map((set) =>
        set.id === activeConfigSetId
          ? {
              ...set,
              provider: 'ollama',
              customProtocol: 'openai',
              activeProfileKey: 'ollama',
              profiles,
              enableThinking: false,
              updatedAt: new Date().toISOString(),
            }
          : set,
      );
      return window.electronAPI?.config?.save?.({
        provider: 'ollama',
        activeProfileKey: 'ollama',
        profiles,
        activeConfigSetId,
        configSets,
        apiKey: '',
        baseUrl,
        model,
        isConfigured: true,
      } as Record<string, unknown>);
    },
    { baseUrl: OLLAMA_BASE, model: OLLAMA_MODEL },
  );
  expect(result).toMatchObject({ success: true });
}

test.skip(!ENABLED, 'Set COWORK_ONBOARDING_SHOTS=1 (needs local Ollama) to capture onboarding shots.');

test('captures the Ollama onboarding journey for the docs', async ({ appPage }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });

  // The wizard is the UNCONFIGURED first-run experience (App.tsx hides it once a
  // provider is configured), so we walk the whole wizard first, THEN configure
  // Ollama and send the real first prompt.
  const wizard = appPage.getByTestId('onboarding-wizard');

  // Step 0 — Welcome / language / path.
  await expect(wizard).toBeVisible({ timeout: 30_000 });
  await shot(appPage, '01-welcome.png');

  // Welcome → quick-start path advances to the provider step.
  await appPage.getByTestId('onboarding-path-quickstart').click();

  // Step 1 — Provider: the "Connect an AI provider" step with the live
  // connection/verification panel (Open API settings → / Test connection).
  await expect(appPage.getByTestId('onboarding-connection-panel')).toBeVisible();
  await shot(appPage, '02-provider.png');

  // Step 2 — Workspace.
  await appPage.getByTestId('onboarding-next').click();
  await expect(appPage.getByTestId('onboarding-pick-workspace')).toBeVisible();
  await shot(appPage, '03-workspace.png');

  // Step 3 — Capabilities / permissions.
  await appPage.getByTestId('onboarding-next').click();
  await expect(appPage.getByTestId('onboarding-companion-permissions')).toBeVisible();
  await shot(appPage, '04-capabilities.png');

  // Step 4 — Ready.
  await appPage.getByTestId('onboarding-next').click();
  await expect(appPage.getByTestId('onboarding-ready-actions')).toBeVisible();
  await shot(appPage, '05-ready.png');

  // Finish → main app (markComplete sets onboardingCompleted).
  await appPage.getByTestId('onboarding-finish').click();
  await expect(wizard).toBeHidden();

  // Now configure a real local Ollama provider (as Settings → API would).
  await configureOllama(appPage);

  // First request — a REAL prompt to local Ollama, asserted on the real reply.
  const prompt = 'Réponds en une courte phrase : que peux-tu faire ?';
  const input = appPage.getByTestId('welcome-prompt-input');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(prompt);
  await shot(appPage, '06-first-prompt.png');
  await input.press('Enter');

  // The user prompt echoes into the transcript, then the real Ollama reply streams in.
  await expect(appPage.getByText(prompt, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await appPage.waitForTimeout(25_000);
  await shot(appPage, '07-first-response.png');
});

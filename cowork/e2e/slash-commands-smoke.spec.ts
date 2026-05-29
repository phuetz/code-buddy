import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Exercises the SHIPPED S0-S8 slash → ui_effect → native-panel path in a real
// running Electron app (not a mocked boundary). This is the foundational gate:
// it validates the pattern that Tracks C/D reuse. The /team, /fleet, /lessons
// commands route to panels via ui_effects and need NO provider, so they are
// robust headless assertions.

async function dismissOptionalModelDialogs(appPage: Page) {
  await appPage.evaluate(() => {
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            setShowEnrollmentDialog?: (show: boolean) => void;
            setShowModelInstallDialog?: (show: boolean) => void;
          };
        };
      }
    ).useAppStore?.getState();
    store?.setShowEnrollmentDialog?.(false);
    store?.setShowModelInstallDialog?.(false);
  });
}

async function dismissOnboardingIfPresent(appPage: Page) {
  await appPage.evaluate(async () => {
    await (window as unknown as { electronAPI?: { config?: { save?: (c: Record<string, unknown>) => Promise<unknown> } } })
      .electronAPI?.config?.save?.({ onboardingCompleted: true });
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            appConfig?: Record<string, unknown> | null;
            setAppConfig?: (config: Record<string, unknown>) => void;
          };
        };
      }
    ).useAppStore?.getState();
    store?.setAppConfig?.({ ...(store.appConfig ?? {}), onboardingCompleted: true });
  });
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 3000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
}

async function startSession(appPage: Page): Promise<string> {
  const id = `e2e-slash-${Date.now()}`;
  await appPage.evaluate((sessionId) => {
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            addSession: (session: unknown) => void;
            setActiveSession: (sessionId: string) => void;
          };
        };
      }
    ).useAppStore?.getState();
    if (!store) throw new Error('useAppStore missing');
    const now = Date.now();
    store.addSession({
      id: sessionId,
      title: 'Slash e2e',
      status: 'idle',
      cwd: 'D:\\e2e',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      model: 'e2e-model',
      createdAt: now,
      updatedAt: now,
    });
    store.setActiveSession(sessionId);
  }, id);
  return id;
}

async function runSlash(appPage: Page, command: string): Promise<void> {
  const input = appPage.getByTestId('chat-prompt-input');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click();
  await input.fill(command);
  await input.press('Enter');
}

function flag(appPage: Page, key: string): Promise<boolean> {
  return appPage.evaluate((k) => {
    const state = (
      window as unknown as { useAppStore?: { getState: () => Record<string, unknown> } }
    ).useAppStore?.getState();
    return Boolean(state?.[k]);
  }, key);
}

test.beforeEach(async ({ appPage }) => {
  await dismissOnboardingIfPresent(appPage);
  await dismissOptionalModelDialogs(appPage);
  await startSession(appPage);
});

test('/team routes to the Team panel via slash → ui_effect (real app)', async ({ appPage }) => {
  await runSlash(appPage, '/team');
  await expect(appPage.getByTestId('team-panel')).toBeVisible({ timeout: 10_000 });
  expect(await flag(appPage, 'showTeamPanel')).toBe(true);
});

test('/fleet routes to the Fleet Command Center via slash → ui_effect', async ({ appPage }) => {
  await runSlash(appPage, '/fleet');
  await expect.poll(() => flag(appPage, 'showFleetCommandCenter'), { timeout: 10_000 }).toBe(true);
});

test('/lessons routes to the lesson candidate panel via slash → ui_effect', async ({ appPage }) => {
  await runSlash(appPage, '/lessons');
  await expect.poll(() => flag(appPage, 'showLessonCandidatePanel'), { timeout: 10_000 }).toBe(true);
});

// IPC getter-sweep: confirm a previously-null-captured bridge is now reachable
// live. team.getStatus returns {error:'TeamBridge not initialized'} if the IPC
// handler still captured null at registration; a real snapshot proves the fix.
test('team IPC bridge is reachable post-boot (getter sweep)', async ({ appPage }) => {
  const status = await appPage.evaluate(async () => {
    const w = window as unknown as { electronAPI?: { team?: { getStatus?: () => Promise<unknown> } } };
    return (await w.electronAPI?.team?.getStatus?.()) ?? { error: 'no team api' };
  });
  expect(JSON.stringify(status)).not.toContain('not initialized');
});

test('/config opens Settings on a tab (C2 settings-tab dispatch branch)', async ({ appPage }) => {
  await runSlash(appPage, '/config');
  await expect.poll(() => flag(appPage, 'showSettings'), { timeout: 10_000 }).toBe(true);
});

// Prove the getter-sweep resurrected the previously-dead IPC bridges: each
// returns its real shape (not the null-capture fallback) post-boot.
test('/identity opens the Identity panel + identityFiles IPC is reachable (C3)', async ({ appPage }) => {
  await runSlash(appPage, '/identity');
  await expect(appPage.getByTestId('identity-panel')).toBeVisible({ timeout: 10_000 });
  const listOk = await appPage.evaluate(async () => {
    const api = (window as unknown as { electronAPI?: { identityFiles?: { list?: () => Promise<{ ok: boolean }> } } }).electronAPI;
    const res = await api?.identityFiles?.list?.();
    return res && typeof res.ok === 'boolean';
  });
  expect(listOk).toBe(true);
});

test('Device panel opens + deviceNodes IPC is reachable (C3 read-only)', async ({ appPage }) => {
  await appPage.evaluate(() => {
    (window as unknown as { useAppStore?: { getState: () => { setShowDevicePanel: (s: boolean) => void } } })
      .useAppStore?.getState()
      .setShowDevicePanel(true);
  });
  await expect(appPage.getByTestId('device-panel')).toBeVisible({ timeout: 10_000 });
  const listOk = await appPage.evaluate(async () => {
    const api = (window as unknown as { electronAPI?: { deviceNodes?: { list?: () => Promise<{ ok: boolean }> } } }).electronAPI;
    const res = await api?.deviceNodes?.list?.();
    return res && typeof res.ok === 'boolean';
  });
  expect(listOk).toBe(true);
});

test('orchestrator + subagent + knowledge IPC are reachable post-boot (getter sweep)', async ({ appPage }) => {
  const res = await appPage.evaluate(async () => {
    const api = (window as unknown as {
      electronAPI?: {
        orchestrator?: { isComplex?: (g: string) => Promise<unknown> };
        subAgent?: { list?: () => Promise<unknown> };
        knowledge?: { list?: () => Promise<unknown> };
      };
    }).electronAPI;
    return {
      orchestratorType: typeof (await api?.orchestrator?.isComplex?.('build a CLI app')),
      subAgentIsArray: Array.isArray(await api?.subAgent?.list?.()),
      knowledgeIsArray: Array.isArray(await api?.knowledge?.list?.()),
    };
  });
  // isComplex resolves a boolean (handler ran); list calls resolve arrays.
  // If the bridges were still null-captured, isComplex would also be boolean
  // (false), so the strong signal is that subAgent/knowledge resolve arrays
  // without throwing — the handlers reached a live bridge.
  expect(res.orchestratorType).toBe('boolean');
  expect(res.subAgentIsArray).toBe(true);
  expect(res.knowledgeIsArray).toBe(true);
});

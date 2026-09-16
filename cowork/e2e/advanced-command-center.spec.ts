import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function installLauncherMock(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
    for (const channel of [
      'liveLauncher.start',
      'liveLauncher.cancel',
      'liveLauncher.status',
      'liveLauncher.list',
      'autonomy.modelTier',
    ]) {
      ipcMain.removeHandler(channel);
    }

    let run: Record<string, unknown> | null = null;
    const send = (payload: Record<string, unknown>) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('server-event', {
        type: 'liveLauncher.event',
        payload,
      });
    };

    ipcMain.handle('autonomy.modelTier', async () => ({
      ok: true,
      ladder: [],
      currentChoice: {
        model: 'qwen3.6:27b',
        baseUrl: 'http://gpuNode:11434/v1',
        tier: 'local',
        paid: false,
        reason: 'E2E local model',
      },
    }));
    ipcMain.handle('liveLauncher.list', async () => (run ? [run] : []));
    ipcMain.handle('liveLauncher.status', async () => run);
    ipcMain.handle('liveLauncher.cancel', async () => ({ ok: true }));
    ipcMain.handle('liveLauncher.start', async (_event, input: Record<string, unknown>) => {
      const runId = 'll_e2e_advanced';
      run = {
        runId,
        kind: input.kind,
        researchMode: input.deep ? 'deep' : input.wide ? 'wide' : 'direct',
        prompt: input.prompt,
        model: input.model,
        provider: input.provider,
        ollamaUrl: input.ollamaUrl,
        iterations: input.iterations,
        perspectives: input.perspectives,
        timeoutMs: 1_800_000,
        status: 'running',
        startedAt: Date.now(),
        reportPath: '/tmp/cowork-e2e-advanced-report.md',
        logTail: ['Plan de recherche créé'],
      };
      send({ runId, kind: 'status', run });
      setTimeout(() => {
        if (!run) return;
        run = {
          ...run,
          status: 'succeeded',
          endedAt: Date.now(),
          exitCode: 0,
          logTail: ['Plan de recherche créé', '4 perspectives analysées', 'Rapport finalisé'],
          result: '# Rapport E2E\n\nCENTRE_COMMANDE_OK : résultat administrable.',
        };
        send({ runId, kind: 'status', run });
      }, 150);
      return { ok: true, runId, reportPath: '/tmp/cowork-e2e-advanced-report.md' };
    });
  });
}

async function installGpuMediaMock(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    for (const channel of [
      'gpuMedia.capabilities',
      'gpuMedia.submit',
      'gpuMedia.status',
      'gpuMedia.cancel',
      'gpuMedia.download',
    ]) {
      ipcMain.removeHandler(channel);
    }
    const running = {
      id: 'gpu-e2e-running',
      kind: 'panoworld_reconstruct',
      status: 'running',
      progress: 0.4,
      progressMessage: 'chargement du checkpoint',
    };
    const completed = {
      id: 'gpu-e2e-completed',
      kind: 'panoworld_reconstruct',
      status: 'succeeded',
      progress: 1,
      progressMessage: 'completed',
      output: {
        profile: 'single-2048',
        plyPath: 'D:\\results\\point_cloud.ply',
        checkpointSha256: 'abc123',
      },
    };
    ipcMain.handle('gpuMedia.capabilities', async () => ({
      protocolVersion: 1,
      workerId: 'gpuNode-e2e',
      jobs: ['panoworld_reconstruct', 'avatar_video_render'],
      queueDepth: 0,
      gpus: [{ name: 'RTX 3090', vramMb: 24_576, busy: false }],
    }));
    ipcMain.handle('gpuMedia.submit', async () => running);
    ipcMain.handle('gpuMedia.status', async (_event, jobId: string) =>
      jobId === completed.id ? completed : running
    );
    ipcMain.handle('gpuMedia.cancel', async () => ({ ...running, status: 'cancelled' }));
    ipcMain.handle('gpuMedia.download', async () => ({
      ok: true,
      format: 'json',
      path: '/tmp/panoworld-gpu-e2e-completed.json',
    }));
  });
}

async function dismissTransientOverlays(appPage: Page): Promise<void> {
  await appPage.evaluate(() => localStorage.setItem('cowork.tourSeen', '1'));
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
  const tour = appPage.getByTestId('onboarding-tour');
  if (await tour.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await tour.getByRole('button', { name: 'Passer', exact: true }).click();
    await expect(tour).toBeHidden();
  }
}

test('advanced command center launches and administers a deep research result', async ({
  electronApp,
  appPage,
}) => {
  const runtimeErrors: string[] = [];
  appPage.on('pageerror', (error) => runtimeErrors.push(error.message));
  appPage.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await installLauncherMock(electronApp);
  await dismissTransientOverlays(appPage);
  await appPage.evaluate(() => {
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            setNewShellEnabled: (enabled: boolean) => void;
            setPrimaryView: (view: 'chat' | 'advanced') => void;
          };
        };
      }
    ).useAppStore?.getState();
    if (!store) throw new Error('useAppStore missing');
    store.setNewShellEnabled(true);
    store.setPrimaryView('chat');
  });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(800, 600);
  });

  await expect(appPage.getByTestId('new-shell')).toBeVisible();
  await expect(appPage.getByTestId('rail-history')).toBeVisible();
  await appPage.getByTitle('Avancé', { exact: true }).click();
  await expect(appPage.getByTestId('advanced-command-center')).toBeVisible();
  await expect(appPage.getByRole('heading', { name: 'Fonctionnalités avancées' })).toBeVisible();
  expect(await appPage.title()).toBeTruthy();
  expect(appPage.url()).toMatch(/^file:/);
  await expect(appPage.locator('vite-error-overlay')).toHaveCount(0);

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1_400, 900);
  });

  await appPage.screenshot({
    path: path.join('/tmp', 'cowork-advanced-command-center-features.png'),
    fullPage: false,
  });

  await appPage.getByTestId('advanced-mode-research-deep').click();
  await appPage
    .getByTestId('advanced-launcher-prompt')
    .fill('Étudier la continuité des conversations multimodales');
  await expect(appPage.getByTestId('advanced-launcher-model')).toHaveValue('qwen3.6:27b');
  await expect(appPage.getByTestId('advanced-launcher-ollama-url')).toHaveValue(
    'http://gpuNode:11434/v1'
  );
  await appPage.getByTestId('advanced-launcher-start').click();

  await expect(appPage.getByTestId('advanced-tab-runs')).toHaveAttribute('aria-selected', 'true');
  await expect(appPage.getByTestId('advanced-run-ll_e2e_advanced')).toBeVisible();
  await expect(appPage.getByTestId('advanced-run-result')).toContainText('CENTRE_COMMANDE_OK');
  await expect(appPage.getByTestId('advanced-run-log')).toContainText('Rapport finalisé');
  await expect(appPage.getByTestId('advanced-run-detail')).toContainText('Limite 30 min');
  await expect(appPage.getByTestId('advanced-run-rerun')).toBeEnabled();

  await appPage.screenshot({
    path: path.join('/tmp', 'cowork-advanced-command-center-desktop.png'),
    fullPage: false,
  });

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });
  await appPage.getByTestId('advanced-tab-features').click();
  await expect(appPage.getByTestId('advanced-launcher-prompt')).toBeVisible();
  await expect(appPage.getByText('Tous les modules')).toBeVisible();
  await appPage.screenshot({
    path: path.join('/tmp', 'cowork-advanced-command-center-responsive.png'),
    fullPage: false,
  });
  expect(runtimeErrors).toEqual([]);
});

test('advanced command center administers GPU node GPU jobs', async ({ electronApp, appPage }) => {
  const runtimeErrors: string[] = [];
  appPage.on('pageerror', (error) => runtimeErrors.push(error.message));
  appPage.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await installGpuMediaMock(electronApp);
  await dismissTransientOverlays(appPage);
  await appPage.evaluate(() => {
    localStorage.removeItem('codebuddy.gpu-media.jobs.v1');
    const store = (
      window as unknown as {
        useAppStore?: {
          getState: () => {
            setNewShellEnabled: (enabled: boolean) => void;
            setPrimaryView: (view: 'chat' | 'advanced') => void;
          };
        };
      }
    ).useAppStore?.getState();
    if (!store) throw new Error('useAppStore missing');
    store.setNewShellEnabled(true);
    store.setPrimaryView('advanced');
  });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1_400, 900);
  });

  await appPage.getByTestId('advanced-tab-gpu').click();
  await expect(appPage.getByTestId('gpu-media-admin')).toBeVisible();
  await expect(appPage.getByText(/gpuNode-e2e/)).toBeVisible();
  expect(await appPage.title()).toBeTruthy();
  expect(appPage.url()).toMatch(/^file:/);
  await expect(appPage.locator('vite-error-overlay')).toHaveCount(0);
  await appPage.getByTestId('gpu-image-path').fill('D:\\captures\\room.jpg');
  await appPage.getByTestId('gpu-output-dir').fill('D:\\results');
  await appPage.getByTestId('gpu-submit').click();
  await expect(appPage.getByTestId('gpu-job-gpu-e2e-running')).toBeVisible();
  await expect(appPage.getByTestId('gpu-job-detail')).toContainText('chargement du checkpoint');
  await appPage.getByTestId('gpu-cancel').click();
  await expect(appPage.getByTestId('gpu-job-detail')).toContainText('Annulée');

  await appPage.getByTestId('gpu-existing-id').fill('gpu-e2e-completed');
  await appPage.getByTestId('gpu-existing-add').click();
  await expect(appPage.getByTestId('gpu-job-output')).toContainText('point_cloud.ply');
  await appPage.getByTestId('gpu-download').click();
  await expect(appPage.getByText(/Manifeste PanoWorld enregistré/)).toBeVisible();
  await appPage.screenshot({
    path: path.join('/tmp', 'cowork-gpu-media-admin.png'),
    fullPage: false,
  });

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });
  await expect(appPage.getByTestId('gpu-media-admin')).toBeVisible();
  await appPage.screenshot({
    path: path.join('/tmp', 'cowork-gpu-media-admin-responsive.png'),
    fullPage: false,
  });
  expect(runtimeErrors).toEqual([]);
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule, resolveCoreEntry } from '../src/main/utils/core-loader';
import {
  AUTONOMY_SERVICE_NAME,
  controlAutonomyServiceForReview,
  getAutonomyDaemonStatusForReview,
  getAutonomyModelTierForReview,
  installAutonomyServiceForReview,
  uninstallAutonomyServiceForReview,
} from '../src/main/autonomy/autonomy-daemon-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
  resolveCoreEntry: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);
const mockedResolveCoreEntry = vi.mocked(resolveCoreEntry);

interface InstallerStub {
  install: ReturnType<typeof vi.fn>;
  uninstall: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  control: ReturnType<typeof vi.fn>;
}

function stubInstallerModule(installer: InstallerStub): { capturedConfig: () => Record<string, unknown> | undefined } {
  let captured: Record<string, unknown> | undefined;
  mockedLoadCoreModule.mockImplementation(async (path: string) => {
    if (path !== 'daemon/service-installer.js') return null;
    return {
      ServiceInstaller: class {
        constructor(config?: Record<string, unknown>) {
          captured = config;
        }
        install = installer.install;
        uninstall = installer.uninstall;
        status = installer.status;
        control = installer.control;
      },
    };
  });
  return { capturedConfig: () => captured };
}

function makeInstaller(overrides: Partial<InstallerStub> = {}): InstallerStub {
  return {
    install: vi.fn().mockResolvedValue({ success: true, servicePath: '/tmp/unit', platform: 'linux' }),
    uninstall: vi.fn().mockResolvedValue({ success: true, servicePath: '/tmp/unit', platform: 'linux' }),
    status: vi.fn().mockResolvedValue({ installed: true, running: true, platform: 'linux' }),
    control: vi.fn().mockResolvedValue({ success: true, action: 'start', platform: 'linux' }),
    ...overrides,
  };
}

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
  mockedResolveCoreEntry.mockReset();
});

describe('autonomy daemon status', () => {
  it('reports the codebuddy-autonomy service status and queue dir', async () => {
    stubInstallerModule(makeInstaller());

    const review = await getAutonomyDaemonStatusForReview();

    expect(review.ok).toBe(true);
    expect(review.serviceName).toBe(AUTONOMY_SERVICE_NAME);
    expect(review.service).toEqual({ installed: true, running: true, platform: 'linux' });
    expect(review.queueDir).toContain('.codebuddy');
    expect(review.manageCommand).toContain(AUTONOMY_SERVICE_NAME);
  });

  it('degrades cleanly when the core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    const review = await getAutonomyDaemonStatusForReview();

    expect(review.ok).toBe(false);
    expect(review.service).toBeNull();
    expect(review.error).toContain('unavailable');
  });
});

describe('autonomy service control', () => {
  it('starts the service through the core installer and returns fresh status', async () => {
    const installer = makeInstaller({
      control: vi.fn().mockResolvedValue({ success: true, action: 'start', platform: 'linux' }),
      status: vi.fn().mockResolvedValue({ installed: true, running: true, platform: 'linux' }),
    });
    stubInstallerModule(installer);

    const review = await controlAutonomyServiceForReview('start');

    expect(review.ok).toBe(true);
    expect(installer.control).toHaveBeenCalledWith('start');
    expect(review.service?.running).toBe(true);
  });

  it('surfaces a control failure with the installer error', async () => {
    const installer = makeInstaller({
      control: vi
        .fn()
        .mockResolvedValue({ success: false, action: 'stop', platform: 'linux', error: 'unit not loaded' }),
    });
    stubInstallerModule(installer);

    const review = await controlAutonomyServiceForReview('stop');

    expect(review.ok).toBe(false);
    expect(review.error).toContain('unit not loaded');
  });

  it('rejects unknown actions without touching the core', async () => {
    const review = await controlAutonomyServiceForReview('explode' as never);

    expect(review.ok).toBe(false);
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });
});

describe('autonomy service install', () => {
  it('installs with safe defaults (artifact executor, local $0 model) via the built CLI entry', async () => {
    const installer = makeInstaller();
    const { capturedConfig } = stubInstallerModule(installer);
    mockedResolveCoreEntry.mockReturnValue('/repo/dist/index.js');

    const review = await installAutonomyServiceForReview();

    expect(review.ok).toBe(true);
    expect(review.executor).toBe('artifact');
    expect(review.model).toBe('qwen2.5:7b-instruct');
    const config = capturedConfig();
    expect(config?.serviceName).toBe(AUTONOMY_SERVICE_NAME);
    expect(config?.args).toEqual(
      expect.arrayContaining(['/repo/dist/index.js', 'autonomy', 'run', '--watch'])
    );
    const env = config?.env as Record<string, string>;
    expect(env.CODEBUDDY_LOCAL_MODEL).toBe('qwen2.5:7b-instruct');
    // The artifact executor must never receive the file-editing env switches.
    expect(env.CODEBUDDY_AUTONOMY_EXECUTOR).toBeUndefined();
  });

  it('fails closed when the agent executor is requested without a workspace', async () => {
    const review = await installAutonomyServiceForReview({ executor: 'agent' });

    expect(review.ok).toBe(false);
    expect(review.error).toContain('workspace');
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });

  it('fails cleanly when no built CLI exists', async () => {
    mockedResolveCoreEntry.mockReturnValue(null);

    const review = await installAutonomyServiceForReview();

    expect(review.ok).toBe(false);
    expect(review.error).toContain('npm run build');
  });
});

describe('autonomy service uninstall', () => {
  it('uninstalls through the core installer', async () => {
    const installer = makeInstaller();
    stubInstallerModule(installer);

    const review = await uninstallAutonomyServiceForReview();

    expect(review.ok).toBe(true);
    expect(installer.uninstall).toHaveBeenCalled();
  });
});

describe('autonomy model tier', () => {
  it('builds the free-first ladder with the current choice', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      resolveModelTierConfig: () => ({
        localModel: 'qwen2.5:7b-instruct',
        localBaseUrl: 'http://localhost:11434/v1',
        networkModels: [{ model: 'qwen3.6:27b', baseUrl: 'http://darkstar:11434/v1' }],
        escalationModel: 'grok-4',
      }),
      chooseAutonomousModel: () => ({
        model: 'qwen2.5:7b-instruct',
        baseUrl: 'http://localhost:11434/v1',
        tier: 'local',
        paid: false,
        reason: 'basic task on the fastest local ($0) model',
      }),
    });

    const review = await getAutonomyModelTierForReview();

    expect(review.ok).toBe(true);
    expect(review.ladder).toHaveLength(3);
    expect(review.ladder[0]).toMatchObject({ tier: 'local', paid: false, configured: true });
    expect(review.ladder[1]).toMatchObject({ tier: 'network', model: 'qwen3.6:27b', paid: false });
    expect(review.ladder[2]).toMatchObject({ tier: 'escalated', model: 'grok-4', paid: true, configured: true });
    expect(review.currentChoice?.tier).toBe('local');
    expect(review.currentChoice?.paid).toBe(false);
  });

  it('marks the paid rung unconfigured when no escalation model is set', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      resolveModelTierConfig: () => ({
        localModel: 'llama3.2',
        localBaseUrl: 'http://localhost:11434/v1',
      }),
      chooseAutonomousModel: () => ({
        model: 'llama3.2',
        tier: 'local',
        paid: false,
        reason: 'basic',
      }),
    });

    const review = await getAutonomyModelTierForReview();

    expect(review.ok).toBe(true);
    expect(review.ladder).toHaveLength(2);
    expect(review.ladder[1]).toMatchObject({ tier: 'escalated', configured: false, paid: true });
  });
});

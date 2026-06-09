/**
 * ServiceInstaller.control() — start/stop/restart of the installed service.
 *
 * homedir() is redirected to a temp dir so the "installed" check reads a unit
 * file we own, and execSync is mocked so no real systemctl/launchctl runs.
 */
import * as fs from 'fs/promises';
import * as path from 'path';

const realOs = await vi.importActual<typeof import('os')>('os');
const tmpHome = await fs.mkdtemp(path.join(realOs.tmpdir(), 'svc-installer-test-'));

const execSyncMock = jest.fn().mockReturnValue('');

jest.mock('child_process', () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

jest.mock('os', () => ({
  homedir: () => tmpHome,
  platform: () => 'linux',
  tmpdir: () => realOs.tmpdir(),
}));

const { ServiceInstaller } = await import('../../src/daemon/service-installer.js');

describe('ServiceInstaller.control (linux/systemd)', () => {
  const serviceName = 'cb-test-autonomy';
  const unitPath = path.join(tmpHome, '.config', 'systemd', 'user', `${serviceName}.service`);

  beforeEach(() => {
    execSyncMock.mockClear();
    execSyncMock.mockReturnValue('');
  });

  afterAll(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('fails closed when the service is not installed', async () => {
    const installer = new ServiceInstaller({ serviceName: 'cb-never-installed' });
    const result = await installer.control('start');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not installed');
    // No service-manager command may run for an uninstalled service.
    const calls = execSyncMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('systemctl --user start'))).toBe(false);
  });

  describe('with an installed unit', () => {
    beforeEach(async () => {
      await fs.mkdir(path.dirname(unitPath), { recursive: true });
      await fs.writeFile(unitPath, '[Unit]\nDescription=test\n', 'utf8');
    });

    afterEach(async () => {
      await fs.rm(unitPath, { force: true });
    });

    it.each(['start', 'stop', 'restart'] as const)('runs systemctl --user %s', async (action) => {
      const installer = new ServiceInstaller({ serviceName });
      const result = await installer.control(action);
      expect(result).toMatchObject({ success: true, action, platform: 'linux' });
      const calls = execSyncMock.mock.calls.map((c) => String(c[0]));
      expect(calls).toContain(`systemctl --user ${action} ${serviceName}.service`);
    });

    it('surfaces the systemctl error on failure', async () => {
      execSyncMock.mockImplementation((cmd: unknown) => {
        if (String(cmd).includes('systemctl --user restart')) {
          throw new Error('Failed to restart unit');
        }
        return '';
      });
      const installer = new ServiceInstaller({ serviceName });
      const result = await installer.control('restart');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to restart unit');
    });

    it('status reports installed and parses is-active output', async () => {
      execSyncMock.mockImplementation((cmd: unknown) =>
        String(cmd).includes('is-active') ? 'active\n' : ''
      );
      const installer = new ServiceInstaller({ serviceName });
      const status = await installer.status();
      expect(status).toEqual({ installed: true, running: true, platform: 'linux' });
    });
  });
});

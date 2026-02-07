import { runDoctorChecks, DoctorCheck } from '../../src/doctor/index';

describe('Doctor', () => {
  let checks: DoctorCheck[];

  beforeAll(async () => {
    checks = await runDoctorChecks(process.cwd());
  });

  it('should return an array of checks', () => {
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
  });

  it('should have valid status values for all checks', () => {
    for (const check of checks) {
      expect(['ok', 'warn', 'error']).toContain(check.status);
      expect(check.name).toBeTruthy();
      expect(check.message).toBeTruthy();
    }
  });

  it('should pass Node.js version check', () => {
    const nodeCheck = checks.find(c => c.name === 'Node.js version');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe('ok');
  });

  it('should detect git in a git repo', () => {
    const gitCheck = checks.find(c => c.name === 'Git');
    expect(gitCheck).toBeDefined();
    expect(gitCheck!.status).toBe('ok');
    expect(gitCheck!.message).toContain('git repo');
  });

  it('should check API keys', () => {
    const apiChecks = checks.filter(c => c.name.startsWith('API key:'));
    expect(apiChecks.length).toBe(4);
  });

  it('should check disk space', () => {
    const diskCheck = checks.find(c => c.name === 'Disk space');
    expect(diskCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(diskCheck!.status);
  });
});

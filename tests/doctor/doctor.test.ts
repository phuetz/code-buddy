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
    // checkNodeVersion() legitimately returns 'warn' on Node 18/20/21 (Cowork needs
    // >= 22) and 'ok' on >= 22 — both are a passing outcome for the CLI (>= 18). The
    // CI matrix runs 18.x/20.x, so accept ok OR warn like the sibling checks; only a
    // hard 'error' (Node < 18) should fail this.
    expect(['ok', 'warn']).toContain(nodeCheck!.status);
  });

  it('should detect git in a git repo', () => {
    const gitCheck = checks.find(c => c.name === 'Git');
    expect(gitCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(gitCheck!.status);
    if (gitCheck!.status === 'ok') {
      expect(gitCheck!.message).toContain('git repo');
    } else {
      expect(gitCheck!.message).toContain('not inside a git repo');
    }
  });

  it('should check API keys', () => {
    const apiChecks = checks.filter(c => c.name.startsWith('API key:'));
    expect(apiChecks.length).toBe(4);
    expect(apiChecks.some(c => c.name.includes('GEMINI_API_KEY / GOOGLE_API_KEY'))).toBe(true);
    for (const check of apiChecks.filter(c => c.message.startsWith('not set'))) {
      expect(check.status).toBe('ok');
      expect(check.message).toContain('optional');
    }
  });

  it('does not warn when the unused legacy project config is absent', () => {
    const configCheck = checks.find(c => c.name === '.codebuddy/config.json (legacy)');
    expect(configCheck).toBeDefined();
    expect(configCheck!.status).toBe('ok');
    if (configCheck!.message.startsWith('not present')) {
      expect(configCheck!.message).toContain('optional');
      expect(configCheck!.message).toContain('settings.json');
    }
  });

  it('explains the impact of optional dependencies that are absent', () => {
    const optionalDependencies = checks.filter(c =>
      c.status === 'warn' && ['ripgrep (rg)', 'sox (voice input)', 'RTK (token compressor)', 'ICM (infinite context memory)'].includes(c.name)
    );
    for (const check of optionalDependencies) {
      expect(check.message).toContain('optional');
      expect(check.message).toContain('install');
    }
  });

  it('should check disk space', () => {
    const diskCheck = checks.find(c => c.name === 'Disk space');
    expect(diskCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(diskCheck!.status);
  });
});

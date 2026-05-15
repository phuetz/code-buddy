import { handleVulns } from '../../src/commands/handlers/lightweight';

const executeScanVulnerabilities = jest.fn();

jest.mock('../../src/security/dependency-vuln-scanner.js', () => ({
  executeScanVulnerabilities: (...args: unknown[]) => executeScanVulnerabilities(...args),
}));

describe('handleVulns', () => {
  beforeEach(() => {
    executeScanVulnerabilities.mockReset();
  });

  it('reports empty successful scans explicitly', async () => {
    executeScanVulnerabilities.mockResolvedValueOnce({ success: true, output: '   ' });

    const result = await handleVulns([]);

    expect(result.entry?.content).toBe('Vulnerability scan completed with no report output.');
  });

  it('does not report success when the vulnerability scan fails without details', async () => {
    executeScanVulnerabilities.mockResolvedValueOnce({ success: false });

    const result = await handleVulns([]);

    expect(result.entry?.content).toBe('Vulnerability scan failed without error details.');
  });

  it('passes supported package manager and path arguments to the scanner', async () => {
    executeScanVulnerabilities.mockResolvedValueOnce({ success: true, output: 'No known vulnerabilities found.' });

    await handleVulns(['npm', '--path=packages/app']);

    expect(executeScanVulnerabilities).toHaveBeenCalledWith({
      path: 'packages/app',
      package_manager: 'npm',
    });
  });
});

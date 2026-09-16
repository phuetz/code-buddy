import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { offerOnboardingDemo } from '../../src/wizard/onboarding.js';
import { runTryDemo } from '../../src/commands/try.js';

vi.mock('../../src/commands/try.js', () => ({ runTryDemo: vi.fn() }));
vi.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: () => ({ getBaseURL: () => 'http://localhost:12345/v1' }),
}));

describe('onboarding demo uses the selected route and reports failure', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => { process.exitCode = originalExitCode; vi.restoreAllMocks(); vi.clearAllMocks(); });

  it.each([0, 1, 2])('preserves the selected local model and handles exit %s', async (code) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(runTryDemo).mockResolvedValue(code);
    const input = new PassThrough();
    const rl = createInterface({ input, output: new PassThrough() });
    try {
      const pending = offerOnboardingDemo(rl, { provider: 'lmstudio', model: 'chosen-model', apiKey: '', ttsEnabled: false });
      input.write('y\n');
      await pending;
      const options = vi.mocked(runTryDemo).mock.calls[0]![0]!;
      expect(await options.resolveProvider!()).toMatchObject({ model: 'chosen-model', baseURL: 'http://localhost:12345/v1', label: 'lmstudio (chosen-model)' });
      expect(process.exitCode).toBe(code || originalExitCode);
    } finally { rl.close(); }
  });

  it('does not silently test a free provider after a cloud provider was selected', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const rl = createInterface({ input: new PassThrough(), output: new PassThrough() });
    try {
      await offerOnboardingDemo(rl, { provider: 'claude', model: 'chosen-cloud', apiKey: '', ttsEnabled: false });
      expect(runTryDemo).not.toHaveBeenCalled();
    } finally { rl.close(); }
  });
});

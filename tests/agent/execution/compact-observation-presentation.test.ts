import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyObservationVariator } from '../../../src/agent/execution/post-tool-handlers.js';
import { resetObservationVariator } from '../../../src/context/observation-variator.js';
afterEach(() => { vi.unstubAllEnvs(); resetObservationVariator(); });
describe('compact tool observations preserve data rather than rotating prose', () => {
  it.each(['bash', 'view_file', 'search'])('passes the exact %s observation without invented output headers', name => {
    vi.stubEnv('CODEBUDDY_HEADLESS', 'true');
    vi.stubEnv('CODEBUDDY_PROMPT_COMPACT', 'true');
    const raw = '  observed value \t\n';
    for (let turn = 0; turn < 4; turn++) expect(applyObservationVariator(name, raw)).toBe(raw);
  });
  it.each([
    { headless: 'false', compact: 'true' },
    { headless: 'true', compact: 'false' },
  ])('preserves the full-profile presentation policy: %j', ({ headless, compact }) => {
    vi.stubEnv('CODEBUDDY_HEADLESS', headless);
    vi.stubEnv('CODEBUDDY_PROMPT_COMPACT', compact);
    const raw = '  observed value \t\n';
    const wrapped = applyObservationVariator('bash', raw);
    expect(wrapped).toContain(raw);
    expect(wrapped).not.toBe(raw);
  });
});

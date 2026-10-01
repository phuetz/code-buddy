import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/telemetry-config.js', () => ({
  setTelemetryEnabled: vi.fn(),
  setTelemetryLevel: vi.fn(),
  getTelemetryConfig: () => ({ enabled: false, level: 'none' }),
  isTelemetryEnabled: () => false,
}));

import { handleTelemetry } from '../../src/commands/handlers/lightweight.js';
import { setTelemetryEnabled, setTelemetryLevel } from '../../src/utils/telemetry-config.js';

describe('telemetry headless outcomes', () => {
  it.each(['off', 'on', 'errors-only', 'full'])('reports a successful /telemetry %s as exit 0', async (action) => {
    const result = await handleTelemetry([action]);
    expect(result.handled).toBe(true);
    expect(result.failed).not.toBe(true);
    expect(result.entry?.content).toMatch(/Telemetry (disabled|enabled|set)/);
    if (action === 'off' || action === 'on') {
      expect(setTelemetryEnabled).toHaveBeenCalledWith(action === 'on');
    } else {
      expect(setTelemetryLevel).toHaveBeenCalledWith(action);
    }
  });
});

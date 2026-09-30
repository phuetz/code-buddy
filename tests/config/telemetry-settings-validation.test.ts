import { describe, expect, it } from 'vitest';
import { SettingsSchema } from '../../src/utils/config-validation/schema.js';

describe('persisted telemetry settings', () => {
  it.each([
    { enabled: false, level: 'none' },
    { enabled: true, level: 'full' },
    { enabled: true, level: 'errors-only' },
  ])('accepts the block written by /telemetry: %j', (telemetry) => {
    const parsed = SettingsSchema.safeParse({ telemetry });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toHaveProperty('telemetry', telemetry);
  });
  it('rejects an invalid telemetry level or enabled value', () => {
    expect(SettingsSchema.safeParse({ telemetry: { enabled: false, level: 'everything' } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ telemetry: { enabled: 'no', level: 'none' } }).success).toBe(false);
  });
});

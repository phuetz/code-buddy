import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPSHOT_ACCELERATOR,
  DEFAULT_DICTATION_ACCELERATOR,
  DEFAULT_QUICKASK_ACCELERATOR,
  PANIC_ACCELERATOR,
  findAcceleratorConflict,
  planGlobalAccelerator,
  resolveAccelerator,
} from '../src/main/global-accelerators';

describe('global accelerators', () => {
  it('resolves env override and falls back', () => {
    expect(resolveAccelerator(undefined, DEFAULT_QUICKASK_ACCELERATOR)).toBe(DEFAULT_QUICKASK_ACCELERATOR);
    expect(resolveAccelerator('  CommandOrControl+Alt+Q  ', DEFAULT_QUICKASK_ACCELERATOR)).toBe(
      'CommandOrControl+Alt+Q',
    );
  });

  it('detects conflict with dictation and panic stop', () => {
    const reserved = {
      panic: PANIC_ACCELERATOR,
      dictation: DEFAULT_DICTATION_ACCELERATOR,
    };
    expect(findAcceleratorConflict('CommandOrControl+Shift+Space', reserved)).toBe('dictation');
    expect(findAcceleratorConflict('CommandOrControl+Alt+S', reserved)).toBe('panic');
    expect(findAcceleratorConflict(DEFAULT_QUICKASK_ACCELERATOR, reserved)).toBeNull();
    expect(findAcceleratorConflict(DEFAULT_APPSHOT_ACCELERATOR, reserved)).toBeNull();
  });

  it('refuses to plan a Quick Ask chord that collides with panic', () => {
    const plan = planGlobalAccelerator({
      envValue: 'CommandOrControl+Alt+S',
      fallback: DEFAULT_QUICKASK_ACCELERATOR,
      reserved: { panic: PANIC_ACCELERATOR, dictation: DEFAULT_DICTATION_ACCELERATOR },
      self: 'quickAsk',
    });
    expect(plan.conflict).toBe('panic');
  });
});

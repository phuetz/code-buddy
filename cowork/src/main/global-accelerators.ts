/**
 * Global shortcut identifiers for Cowork.
 * Dictation and Panic Stop are reserved; Quick Ask / Appshot must not reuse them.
 */

export const PANIC_ACCELERATOR = 'CommandOrControl+Alt+S';
export const DEFAULT_DICTATION_ACCELERATOR = 'CommandOrControl+Shift+Space';
export const DEFAULT_QUICKASK_ACCELERATOR = 'CommandOrControl+Alt+Space';
export const DEFAULT_APPSHOT_ACCELERATOR = 'CommandOrControl+Alt+A';

export function resolveAccelerator(envValue: string | undefined, fallback: string): string {
  const trimmed = envValue?.trim();
  return trimmed ? trimmed : fallback;
}

export function normalizeAccelerator(accel: string): string {
  return accel.replace(/\s+/g, '').toLowerCase();
}

export type ReservedAcceleratorName = 'panic' | 'dictation' | 'quickAsk' | 'appshot';

export function findAcceleratorConflict(
  candidate: string,
  reserved: Partial<Record<ReservedAcceleratorName, string>>,
  self?: ReservedAcceleratorName,
): ReservedAcceleratorName | null {
  const needle = normalizeAccelerator(candidate);
  for (const [name, value] of Object.entries(reserved) as Array<[ReservedAcceleratorName, string]>) {
    if (self && name === self) continue;
    if (value && normalizeAccelerator(value) === needle) return name;
  }
  return null;
}

export interface RegisterAcceleratorResult {
  registered: boolean;
  accelerator: string;
  conflict?: ReservedAcceleratorName;
  unavailable?: boolean;
}

export function planGlobalAccelerator(input: {
  envValue: string | undefined;
  fallback: string;
  reserved: Partial<Record<ReservedAcceleratorName, string>>;
  self: ReservedAcceleratorName;
}): { accelerator: string; conflict: ReservedAcceleratorName | null } {
  const accelerator = resolveAccelerator(input.envValue, input.fallback);
  return {
    accelerator,
    conflict: findAcceleratorConflict(accelerator, input.reserved, input.self),
  };
}

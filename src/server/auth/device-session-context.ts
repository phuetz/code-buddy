import { AsyncLocalStorage } from 'node:async_hooks';

export interface DeviceSessionIdentity {
  readonly deviceId?: string;
  readonly profile?: 'agent' | 'companion';
  readonly identity?: 'owner';
  readonly amr?: readonly string[];
}

const context = new AsyncLocalStorage<DeviceSessionIdentity>();

/** Companion integration seam: signed identity of the current WS turn only. */
export function getDeviceSessionIdentity(): DeviceSessionIdentity | undefined {
  return context.getStore();
}

export function withDeviceSessionIdentity<T>(identity: DeviceSessionIdentity, run: () => Promise<T>): Promise<T> {
  return context.run(Object.freeze({
    ...identity,
    ...(identity.amr ? { amr: Object.freeze([...identity.amr]) } : {}),
  }), run);
}

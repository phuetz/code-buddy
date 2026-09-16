import type { JwtPayload } from '../types.js';
import { getDeviceAuthStore } from './device-store.js';

/** Legacy tokens do not touch the device store. */
export function isDeviceAccessTokenActive(payload: JwtPayload): boolean {
  return !Array.isArray(payload.amr) || !payload.amr.includes('device') || (
    Number.isFinite(payload.exp) && payload.exp * 1000 > Date.now() && getDeviceAuthStore().isActive(payload.sub)
  );
}

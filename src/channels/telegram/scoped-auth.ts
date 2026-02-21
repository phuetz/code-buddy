/**
 * Telegram Scoped Authorization - Re-export from generic pro module
 */
export { ScopedAuthManager } from '../pro/scoped-auth.js';
export type {
  AuthDecision,
  ScopedPermission,
  SecretHandle,
  PendingConfirm,
  TemporaryAccess,
  ScopeCheckContext,
} from '../pro/types.js';

// Backward-compatible alias
export type { AuthScope as TelegramScope } from '../pro/types.js';

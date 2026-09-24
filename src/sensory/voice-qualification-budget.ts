import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

/** Persistent lifetime reservation. Fail closed on missing config, corruption or concurrency. */
export function reserveVoiceQualification(env: NodeJS.ProcessEnv, now: number): boolean {
  const path = env.CODEBUDDY_VOICE_JEV_BUDGET_FILE;
  const expires = Date.parse(env.CODEBUDDY_VOICE_JEV_EXPIRES_AT ?? '');
  const limit = Number(env.CODEBUDDY_VOICE_JEV_MAX_REQUESTS ?? 1000);
  if (!path || !Number.isFinite(expires) || now >= expires
    || !Number.isInteger(limit) || limit < 1 || limit > 1000) return false;
  let lock: number | undefined;
  const temp = `${path}.${process.pid}.tmp`;
  try {
    lock = openSync(`${path}.lock`, 'wx', 0o600);
    let count = 0;
    try {
      const ledger = JSON.parse(readFileSync(path, 'utf8')) as { reserved?: unknown };
      if (!Number.isSafeInteger(ledger.reserved) || Number(ledger.reserved) < 0) return false;
      count = Number(ledger.reserved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
    }
    if (count >= limit) return false;
    writeFileSync(temp, JSON.stringify({ reserved: count + 1, updatedAt: new Date(now).toISOString() }), { mode: 0o600 });
    renameSync(temp, path);
    return true;
  } catch {
    return false;
  } finally {
    if (lock !== undefined) {
      closeSync(lock);
      try { unlinkSync(`${path}.lock`); } catch { /* already removed */ }
      try { unlinkSync(temp); } catch { /* rename succeeded */ }
    }
  }
}

import { runProc } from '../agent/self-improvement/evolution/variant-fitness.js';
import { MissionStore, MissionBusyError, type Mission, type MissionAuthority } from './mission-store.js';

/** Runs in the calling process; persisted intent survives a pilot crash, execution is never replayed implicitly. */
export async function runMission(store: MissionStore, id: string, authority: MissionAuthority, signal?: AbortSignal): Promise<Mission> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) throw new Error('Cancelled before starting mission');
  signal?.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setInterval> | undefined;
  let lostAuthority: unknown;
  try {
    store.renew(id, authority);
    const mission = store.start(id, authority);
    timer = setInterval(() => {
      try { store.renew(id, authority); }
      catch (error) {
        try {
          if (error instanceof MissionBusyError && (store.get(id).expiresAt ?? 0) > Date.now() + 20000) return;
        } catch { /* An unreadable lease is not authority to keep executing. */ }
        lostAuthority = error; controller.abort();
      }
    }, 15000);
    const op = mission.operation;
    const result = await runProc(op.command, op.args, { checkoutDir: op.workspace, timeoutMs: op.timeoutMs, signal: controller.signal });
    if (lostAuthority) throw lostAuthority;
    const finish = () => store.complete(id, authority, {
      success: result.code === 0 && !result.timedOut, stdout: result.stdout, stderr: result.stderr, exitCode: result.code,
    });
    for (let retry = 0; ; retry++) {
      try { return finish(); }
      catch (error) {
        if (!(error instanceof MissionBusyError) || retry >= 20) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  } finally {
    if (timer) clearInterval(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

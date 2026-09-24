/**
 * Bounded native-sandbox gate for tests.
 * Docker is not a native backend: a runner that has a daemon and no
 * bubblewrap used to treat it as "the real sandbox" and then wait on
 * `docker run`. A probe that never returns is abandoned by
 * detectCapabilities; this race is a second bound so a module-level await
 * still finishes if that deadline is removed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCapabilities, OSSandbox, type SandboxBackend } from '../../src/sandbox/os-sandbox.js';

const PROBE_RACE_MS = 12_000;
const TRIAL_MS = 8_000;

export interface NativeBackendTrial {
  ok: boolean;
  reason: string;
}

export interface NativeSandboxReadiness {
  bubblewrap: NativeBackendTrial;
  landlock: NativeBackendTrial;
  /** True when at least one native backend passed a real command. */
  ready: boolean;
  reason: string;
}

async function trialBackend(backend: Extract<SandboxBackend, 'bubblewrap' | 'landlock'>): Promise<NativeBackendTrial> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `native-trial-${backend}-`));
  try {
    const sandbox = new OSSandbox({
      backend,
      workDir,
      readOnlyPaths: ['/usr', '/lib', '/lib64', '/bin', '/sbin'],
      readWritePaths: [],
      allowNetwork: false,
      timeout: TRIAL_MS,
    });
    const result = await sandbox.exec('/bin/true', []);
    if (result.timedOut) return { ok: false, reason: `${backend}: essai interrompu` };
    if (!result.sandboxed) return { ok: false, reason: `${backend}: essai non confine` };
    if (result.exitCode !== 0) {
      return { ok: false, reason: `${backend}: essai exit ${result.exitCode}` };
    }
    return { ok: true, reason: `${backend}: essai reussi` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${backend}: ${message}` };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export async function probeNativeSandbox(): Promise<NativeSandboxReadiness> {
  const failed = (reason: string): NativeSandboxReadiness => {
    const line = `ASSERT sonde-native ignoree motif=${reason}`;
    console.log(line);
    return {
      bubblewrap: { ok: false, reason },
      landlock: { ok: false, reason },
      ready: false,
      reason,
    };
  };

  let caps: Awaited<ReturnType<typeof detectCapabilities>>;
  try {
    caps = await new Promise<Awaited<ReturnType<typeof detectCapabilities>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sonde de capacite interrompue')), PROBE_RACE_MS);
      detectCapabilities().then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error: unknown) => { clearTimeout(timer); reject(error); },
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failed(message);
  }

  if (process.platform !== 'linux') {
    return failed(`pas de bac a sable natif linux (plateforme ${process.platform})`);
  }

  const bubblewrap = caps.bubblewrap ? await trialBackend('bubblewrap') : {
    ok: false,
    reason: 'bubblewrap: sonde negative',
  };
  // Landlock in this tree is bubblewrap plus a seccomp filter. Without a
  // working bubblewrap the landlock backend cannot run, so it is not tried.
  const landlock = caps.bubblewrap ? await trialBackend('landlock') : {
    ok: false,
    reason: 'landlock: bubblewrap absent',
  };
  const ready = bubblewrap.ok || landlock.ok;
  const reason = ready
    ? [bubblewrap.reason, landlock.reason].filter(Boolean).join('; ')
    : `aucun bac a sable natif (bubblewrap=${caps.bubblewrap} landlock=${caps.landlock} docker=${caps.docker} recommended=${caps.recommended}; ${bubblewrap.reason}; ${landlock.reason})`;
  console.log(ready
    ? `ASSERT sonde-native prete ${reason}`
    : `ASSERT sonde-native ignoree motif=${reason}`);
  return { bubblewrap, landlock, ready, reason };
}

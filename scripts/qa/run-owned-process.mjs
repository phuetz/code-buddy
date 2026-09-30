import { spawn } from 'node:child_process';

/** Linux QA only: every child owns a process group, closed even on timeout. */
export function runOwnedProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const closeGroup = signal => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const timer = setTimeout(() => { timedOut = true; closeGroup('SIGKILL'); }, options.timeoutMs ?? 30000);
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      closeGroup('SIGKILL');
      resolve({ command, args, code, signal, timedOut, stdout, stderr });
    });
  });
}

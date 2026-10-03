import { spawn, spawnSync } from 'node:child_process';
import { ShellEnvPolicy } from '../security/shell-env-policy.js';

export interface SupervisedHookResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface HookExecutionSnapshot {
  id: string;
  files: Record<string, string>;
}

/**
 * Linux subreaper: children remain owned by this supervisor after double-fork
 * or setsid. Pipes are read without waiting on inherited descriptors at timeout.
 * Fail before spawn if ownership/inspection cannot be established.
 */
const SUPERVISOR = String.raw`
import ctypes, glob, json, os, selectors, signal, subprocess, sys, tempfile, time

def status(proc):
    result = {}
    with open('/proc/%s/status' % proc) as f:
        for line in f:
            key, _, value = line.partition(':')
            result[key] = value.strip()
    return result

libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:
    raise RuntimeError('Cannot establish hook child-subreaper ownership')
own = status('self')
root = int(own['Pid'])
namespace_index = len(own.get('NSpid', str(root)).split()) - 1
if int(own.get('NSpid', str(root)).split()[namespace_index]) != os.getpid():
    raise RuntimeError('Cannot identify the hook supervisor PID namespace')

def descendants():
    pending = [root]
    seen = set()
    result = []
    while pending:
        parent = pending.pop()
        for task in glob.glob('/proc/%s/task/*/children' % parent):
            try:
                with open(task) as f:
                    children = [int(x) for x in f.read().split()]
            except FileNotFoundError:
                continue
            for proc in children:
                if proc in seen:
                    continue
                seen.add(proc)
                try:
                    info = status(proc)
                    ids = info.get('NSpid', str(proc)).split()
                    local_pid = int(ids[namespace_index])
                except FileNotFoundError:
                    continue
                if local_pid == os.getpid():
                    raise RuntimeError('Invalid descendant namespace mapping')
                result.append(local_pid)
                pending.append(proc)
    return result

# Inspection is a required capability, not a best-effort fallback.
with open('/proc/self/task/%s/children' % root) as f:
    f.read()
descendants()
payload = json.load(sys.stdin)
private_bundle = None
snapshot = payload.get('snapshot')
if snapshot:
    private_bundle = tempfile.TemporaryDirectory(prefix=snapshot['id'] + '-')
    for relative, text in snapshot['files'].items():
        if relative.startswith('/') or '..' in relative.split('/') or '\\' in relative:
            raise RuntimeError('Invalid verified snapshot path')
        target = os.path.join(private_bundle.name, relative)
        os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
        with open(target, 'x', encoding='utf-8') as f:
            os.chmod(target, 0o600)
            f.write(text)
    payload['env']['CODEBUDDY_IMPORTED_HOOK_ROOT'] = private_bundle.name
    payload['env']['CLAUDE_PLUGIN_ROOT'] = os.path.join(private_bundle.name, 'bundle')
timeout = min(max(float(payload['timeout']) / 1000, 0.001), 300)
deadline = time.monotonic() + timeout
data = payload['input'].encode('utf-8')
selector = selectors.DefaultSelector()
child = subprocess.Popen(['sh', '-c', payload['command']], start_new_session=True,
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=payload['env'])
sent = 0
out, err = bytearray(), bytearray()
error = None

def close_stream(stream):
    try:
        selector.unregister(stream)
    except KeyError:
        pass
    stream.close()

try:
    for stream, name in [(child.stdin, 'in'), (child.stdout, 'out'), (child.stderr, 'err')]:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_WRITE if name == 'in' else selectors.EVENT_READ, name)
    while selector.get_map():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            error = 'Hook timed out'
            break
        for key, mask in selector.select(min(remaining, 0.02)):
            stream, name = key.fileobj, key.data
            if name == 'in':
                try:
                    sent += os.write(stream.fileno(), data[sent:sent + 16384])
                except BrokenPipeError:
                    sent = len(data)
                if sent >= len(data):
                    close_stream(stream)
            else:
                chunk = os.read(stream.fileno(), 16384)
                if not chunk:
                    close_stream(stream)
                else:
                    (out if name == 'out' else err).extend(chunk)
                    if len(out) + len(err) > 256 * 1024:
                        error = 'Hook output exceeded 256 KiB'
                        break
        if error:
            break
    if error is None:
        try:
            child.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            error = 'Hook timed out'
finally:
    # Stop creators, kill the original session/group, then every adopted child,
    # including children that started a different session or closed their pipes.
    try:
        os.killpg(child.pid, signal.SIGSTOP)
    except ProcessLookupError:
        pass
    cleanup_deadline = time.monotonic() + 0.75
    while True:
        children = descendants()
        for local_pid in children:
            try:
                os.kill(local_pid, signal.SIGSTOP)
            except ProcessLookupError:
                pass
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        for local_pid in children:
            try:
                os.kill(local_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        # Popen reaps its direct child; waitpid reaps all adopted descendants.
        child.poll()
        while True:
            try:
                pid, code = os.waitpid(-1, os.WNOHANG)
                if not pid:
                    break
                if pid == child.pid and child.returncode is None:
                    child.returncode = os.waitstatus_to_exitcode(code)
            except ChildProcessError:
                break
        if not descendants():
            break
        if time.monotonic() >= cleanup_deadline:
            error = 'Hook descendants could not be terminated'
            break
        time.sleep(0.005)
    for key in list(selector.get_map().values()):
        close_stream(key.fileobj)
    selector.close()
    if private_bundle:
        private_bundle.cleanup()

print(json.dumps({'status': child.returncode, 'stdout': out[:256*1024].decode('utf-8', 'replace'),
    'stderr': err[:256*1024].decode('utf-8', 'replace'), 'error': error}))
`;

function request(command: string, input: string, timeout: number, env: NodeJS.ProcessEnv, snapshot?: HookExecutionSnapshot): string {
  if (process.platform !== 'linux') throw new Error('Safe hook command supervision requires Linux child-subreaper support; command was not executed');
  return JSON.stringify({ command, input, timeout, env, snapshot });
}

function result(stdout: string, stderr: string, code: number | null): SupervisedHookResult {
  if (code !== 0) return { status: code, stdout: '', stderr, error: new Error(`Hook supervisor failed: ${stderr.trim()}`) };
  try {
    const parsed = JSON.parse(stdout) as { status: number | null; stdout: string; stderr: string; error?: string };
    if (typeof parsed.stdout !== 'string' || typeof parsed.stderr !== 'string'
      || parsed.status !== null && !Number.isInteger(parsed.status)
      || parsed.status === null && !parsed.error
      || parsed.error !== undefined && parsed.error !== null && typeof parsed.error !== 'string') throw new Error('Invalid supervisor result');
    return { ...parsed, error: parsed.error ? new Error(parsed.error) : undefined };
  } catch (error) { return { status: null, stdout: '', stderr, error: new Error(`Unreadable hook supervisor decision: ${error}`) }; }
}

export function runHookCommandSync(command: string, input: string, timeout: number, env: NodeJS.ProcessEnv, snapshot?: HookExecutionSnapshot): SupervisedHookResult {
  const payload = request(command, input, timeout, env, snapshot);
  const child = spawnSync('/usr/bin/python3', ['-I', '-c', SUPERVISOR], {
    input: payload, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    env: new ShellEnvPolicy({ inherit: 'core' }).buildEnv(),
  });
  if (child.error) return { status: null, stdout: '', stderr: child.stderr ?? '', error: child.error };
  return result(child.stdout, child.stderr, child.status);
}

export async function runHookCommand(command: string, input: string, timeout: number, env: NodeJS.ProcessEnv, snapshot?: HookExecutionSnapshot): Promise<SupervisedHookResult> {
  const payload = request(command, input, timeout, env, snapshot);
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/python3', ['-I', '-c', SUPERVISOR], {
      env: new ShellEnvPolicy({ inherit: 'core' }).buildEnv(), stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdin.on('error', () => { /* Supervisor already reported a failure. */ });
    child.stdin.end(payload);
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ status: null, stdout: '', stderr, error }));
    child.on('close', (code) => resolve(result(stdout, stderr, code)));
  });
}

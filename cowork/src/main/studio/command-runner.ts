/**
 * Non-PTY command runner for App Studio.
 *
 * This is intentionally not an interactive terminal backend: it can run project
 * commands and stream output, but full-screen interactive programs such as
 * `vim` are outside its scope. The integrator must confine `cwd` to the active
 * workspace and may route commands through the core validator before launch.
 *
 * @module main/studio/command-runner
 */

import { spawn } from 'child_process';

export interface CommandRunInput {
  cwd: string;
  command: string;
  id: string;
}

export interface CommandOutputEvent {
  id: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  timestamp: string;
}

export type CommandRunnerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type OutputCallback = (event: CommandOutputEvent) => void;
type SpawnImpl = typeof spawn;

interface RunningCommand {
  id: string;
  child: ReturnType<SpawnImpl>;
  output: string[];
  stdoutPartial: string;
  stderrPartial: string;
  onOutput?: OutputCallback;
  killTimer?: NodeJS.Timeout;
}

const RING_BUFFER_LINES = 500;
const KILL_GRACE_MS = 2_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CommandRunner {
  private readonly commands = new Map<string, RunningCommand>();

  constructor(
    private readonly defaultOutput?: OutputCallback,
    private readonly spawnImpl: SpawnImpl = spawn,
  ) {}

  runCommand(input: CommandRunInput, onOutput?: OutputCallback): CommandRunnerResult<{ id: string; pid: number }> {
    try {
      const id = input.id.trim();
      const cwd = input.cwd.trim();
      const command = input.command.trim();
      if (!id) return { ok: false, error: 'id is required' };
      if (!cwd) return { ok: false, error: 'cwd is required' };
      if (!command) return { ok: false, error: 'command is required' };
      if (this.commands.has(id)) return { ok: false, error: `Command ${id} is already running` };

      const child = this.spawnImpl(command, {
        shell: true,
        cwd,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (child.pid === undefined) return { ok: false, error: `Failed to spawn command ${id}` };

      const record: RunningCommand = {
        id,
        child,
        output: [],
        stdoutPartial: '',
        stderrPartial: '',
        onOutput: onOutput ?? this.defaultOutput,
      };
      this.commands.set(id, record);

      child.stdout?.on('data', (chunk: Buffer) => this.consume(record, 'stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => this.consume(record, 'stderr', chunk));
      child.once('error', (error) => {
        this.emit(record, 'system', `Command error: ${errorMessage(error)}`);
        this.commands.delete(id);
      });
      child.once('close', (code, signal) => {
        if (record.killTimer) clearTimeout(record.killTimer);
        this.flush(record, 'stdout');
        this.flush(record, 'stderr');
        this.emit(record, 'system', `Command exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`);
        this.commands.delete(id);
      });

      this.emit(record, 'system', `Command started: ${command}`);
      return { ok: true, data: { id, pid: child.pid } };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  kill(id: string): CommandRunnerResult<{ id: string; killed: boolean }> {
    try {
      const record = this.commands.get(id);
      if (!record) return { ok: false, error: `Command ${id} is not running` };
      const killed = this.signal(record, 'SIGTERM');
      record.killTimer = setTimeout(() => {
        if (!this.commands.has(id)) return;
        this.signal(record, 'SIGKILL');
      }, KILL_GRACE_MS);
      record.killTimer.unref?.();
      return { ok: true, data: { id, killed } };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  getBufferedOutput(id: string): string[] {
    return [...(this.commands.get(id)?.output ?? [])];
  }

  private consume(record: RunningCommand, stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const key = stream === 'stdout' ? 'stdoutPartial' : 'stderrPartial';
    const text = record[key] + chunk.toString('utf8');
    const parts = text.split(/\r?\n/);
    record[key] = parts.pop() ?? '';
    for (const line of parts) {
      this.emit(record, stream, line);
    }
  }

  private flush(record: RunningCommand, stream: 'stdout' | 'stderr'): void {
    const key = stream === 'stdout' ? 'stdoutPartial' : 'stderrPartial';
    const line = record[key];
    if (!line) return;
    record[key] = '';
    this.emit(record, stream, line);
  }

  private emit(record: RunningCommand, stream: CommandOutputEvent['stream'], line: string): void {
    record.output.push(line);
    if (record.output.length > RING_BUFFER_LINES) {
      record.output.splice(0, record.output.length - RING_BUFFER_LINES);
    }
    record.onOutput?.({
      id: record.id,
      stream,
      line,
      timestamp: new Date().toISOString(),
    });
  }

  private signal(record: RunningCommand, signal: NodeJS.Signals): boolean {
    try {
      if (process.platform !== 'win32' && record.child.pid !== undefined) {
        process.kill(-record.child.pid, signal);
        return true;
      }
      return record.child.kill(signal);
    } catch {
      try {
        return record.child.kill(signal);
      } catch {
        return false;
      }
    }
  }
}

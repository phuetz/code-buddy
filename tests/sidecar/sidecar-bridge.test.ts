/**
 * Sidecar Bridge Tests
 *
 * Tests the TypeScript bridge that communicates with the Rust sidecar
 * via JSON-RPC over stdin/stdout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable, PassThrough } from 'stream';

// Fresh mock process factory
function createMockProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const proc = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(),
    pid: 12345,
  });

  return proc;
}

let currentMockProcess: ReturnType<typeof createMockProcess>;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => currentMockProcess),
}));

vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('fs')>();
  return {
    ...orig,
    existsSync: vi.fn((path: string) => {
      if (typeof path === 'string' && path.includes('codebuddy-sidecar')) return true;
      return false;
    }),
  };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SidecarBridge', () => {
  let SidecarBridge: typeof import('../../src/sidecar/sidecar-bridge.js').SidecarBridge;
  let getSidecarBridge: typeof import('../../src/sidecar/sidecar-bridge.js').getSidecarBridge;
  let resetSidecarBridge: typeof import('../../src/sidecar/sidecar-bridge.js').resetSidecarBridge;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentMockProcess = createMockProcess();
    const mod = await import('../../src/sidecar/sidecar-bridge.js');
    SidecarBridge = mod.SidecarBridge;
    getSidecarBridge = mod.getSidecarBridge;
    resetSidecarBridge = mod.resetSidecarBridge;
    resetSidecarBridge();
  });

  afterEach(() => {
    resetSidecarBridge();
  });

  describe('isAvailable', () => {
    it('should detect sidecar binary', () => {
      const bridge = new SidecarBridge();
      expect(bridge.isAvailable()).toBe(true);
    });

    it('should cache availability check', () => {
      const bridge = new SidecarBridge();
      bridge.isAvailable();
      bridge.isAvailable();
      expect(bridge.isAvailable()).toBe(true);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const a = getSidecarBridge();
      const b = getSidecarBridge();
      expect(a).toBe(b);
    });

    it('should reset singleton', () => {
      const a = getSidecarBridge();
      resetSidecarBridge();
      const b = getSidecarBridge();
      expect(a).not.toBe(b);
    });
  });

  describe('call', () => {
    it('should send JSON-RPC request and receive response', async () => {
      const bridge = new SidecarBridge();
      const written: string[] = [];

      currentMockProcess.stdin.on('data', (chunk: Buffer) => {
        written.push(chunk.toString());
      });

      // Start the bridge — simulate ping response
      const startPromise = bridge.start();
      setImmediate(() => {
        currentMockProcess.stdout.push('{"id":1,"result":{"pong":true}}\n');
      });
      await startPromise;

      expect(written.length).toBeGreaterThan(0);
      const parsed = JSON.parse(written[0]);
      expect(parsed.method).toBe('ping');
      expect(parsed.id).toBe(1);

      bridge.stop();
    });

    it('should handle error responses from sidecar', async () => {
      const bridge = new SidecarBridge();

      const startPromise = bridge.start();
      setImmediate(() => {
        currentMockProcess.stdout.push('{"id":1,"result":{"pong":true}}\n');
      });
      await startPromise;

      const callPromise = bridge.call('stt.transcribe', { audio_b64: '' });
      setImmediate(() => {
        currentMockProcess.stdout.push('{"id":2,"error":"No audio data decoded"}\n');
      });

      await expect(callPromise).rejects.toThrow('No audio data decoded');
      bridge.stop();
    });

    it('should handle timeout on call', async () => {
      const bridge = new SidecarBridge();

      const startPromise = bridge.start();
      setImmediate(() => {
        currentMockProcess.stdout.push('{"id":1,"result":{"pong":true}}\n');
      });
      await startPromise;

      // Call with very short timeout — no response will come
      const callPromise = bridge.call('stt.status', {}, 50);
      await expect(callPromise).rejects.toThrow('timed out');
      bridge.stop();
    });

    it('should resolve with result data', async () => {
      const bridge = new SidecarBridge();

      const startPromise = bridge.start();
      setImmediate(() => {
        currentMockProcess.stdout.push('{"id":1,"result":{"pong":true}}\n');
      });
      await startPromise;

      const callPromise = bridge.call('stt.status', {});
      setImmediate(() => {
        currentMockProcess.stdout.push('{"id":2,"result":{"fast_loaded":false,"accurate_loaded":false,"ready":false}}\n');
      });

      const result = await callPromise;
      expect(result).toEqual({ fast_loaded: false, accurate_loaded: false, ready: false });
      bridge.stop();
    });
  });

  describe('convenience methods', () => {
    it('should have STT methods', () => {
      const bridge = new SidecarBridge();
      expect(typeof bridge.loadModel).toBe('function');
      expect(typeof bridge.transcribe).toBe('function');
      expect(typeof bridge.sttStatus).toBe('function');
    });

    it('should have desktop automation methods', () => {
      const bridge = new SidecarBridge();
      expect(typeof bridge.paste).toBe('function');
      expect(typeof bridge.typeText).toBe('function');
      expect(typeof bridge.keyPress).toBe('function');
      expect(typeof bridge.clipboardGet).toBe('function');
      expect(typeof bridge.clipboardSet).toBe('function');
    });

    it('should have version method', () => {
      const bridge = new SidecarBridge();
      expect(typeof bridge.version).toBe('function');
    });
  });

  describe('stop', () => {
    it('should kill process and clean up', async () => {
      const bridge = new SidecarBridge();

      const startPromise = bridge.start();
      setImmediate(() => {
        currentMockProcess.stdout.push('{"id":1,"result":{"pong":true}}\n');
      });
      await startPromise;

      bridge.stop();
      expect(currentMockProcess.kill).toHaveBeenCalled();
    });

    it('should be safe to call stop when not started', () => {
      const bridge = new SidecarBridge();
      expect(() => bridge.stop()).not.toThrow();
    });
  });

  describe('process exit handling', () => {
    it('should reject pending requests on process exit', async () => {
      const bridge = new SidecarBridge();

      const startPromise = bridge.start();
      setImmediate(() => {
        currentMockProcess.stdout.push('{"id":1,"result":{"pong":true}}\n');
      });
      await startPromise;

      const callPromise = bridge.call('stt.status', {}, 30000);

      // Simulate process exit
      setImmediate(() => {
        currentMockProcess.emit('exit', 1);
      });

      await expect(callPromise).rejects.toThrow('Sidecar process exited');
    });
  });
});

describe('SidecarBridge real binary integration', () => {
  it('should communicate with the actual sidecar binary if available', async () => {
    const fs = await vi.importActual<typeof import('fs')>('fs');
    const { join } = await import('path');

    const releasePath = join(process.cwd(), 'src-sidecar', 'target', 'release', 'codebuddy-sidecar.exe');
    const debugPath = join(process.cwd(), 'src-sidecar', 'target', 'debug', 'codebuddy-sidecar.exe');

    const binaryExists = fs.existsSync(releasePath) || fs.existsSync(debugPath);

    if (!binaryExists) {
      console.log('Skipping real binary test — sidecar not built');
      return;
    }

    const { spawn } = await vi.importActual<typeof import('child_process')>('child_process');
    const { createInterface } = await import('readline');

    const binaryPath = fs.existsSync(releasePath) ? releasePath : debugPath;
    const proc = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
      rl.on('line', (line: string) => {
        clearTimeout(timeout);
        resolve(JSON.parse(line));
      });
      proc.stdin!.write('{"id":42,"method":"version","params":{}}\n');
    });

    expect(response.id).toBe(42);
    const result = response.result as Record<string, unknown>;
    expect(result.name).toBe('codebuddy-sidecar');
    expect(result.version).toBe('0.1.0');
    expect(result.features).toEqual(['stt', 'desktop']);

    proc.stdin!.end();
    proc.kill();
    rl.close();
  });
});

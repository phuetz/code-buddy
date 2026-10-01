import { describe, it, expect, afterEach } from 'vitest';
import { confineComputeInvocation } from '../../src/security/compute-confinement';
import { realpathSync } from 'node:fs';

describe('confineComputeInvocation', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  it('refuses unrestricted execution when not on Linux', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    });

    expect(() => confineComputeInvocation('/bin/echo', ['hello'], '/tmp')).toThrowError(
      'Compute confinement requires Linux Landlock/seccomp; refusing unrestricted execution'
    );
  });

  it('returns the exact python3 invocation structure with correct flags on Linux', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });

    const args = ['hello', 'world'];

    const validRoot = realpathSync(process.cwd());
    const validCommandPath = realpathSync(process.argv[0]);

    const result = confineComputeInvocation(validCommandPath, args, validRoot);

    expect(result.command).toBe('/usr/bin/python3');
    expect(result.args[0]).toBe('-I');
    expect(result.args[1]).toBe('-c');
    expect(typeof result.args[2]).toBe('string'); // The BOOTSTRAP script
    expect(result.args[3]).toBe(validRoot); // realpathSync(root)
    expect(result.args[4]).toBe(validCommandPath); // executable
    expect(result.args.slice(5)).toEqual(args);
  });

  it('contains the expected Landlock syscall numbers and execv in the BOOTSTRAP script', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });

    const validRoot = realpathSync(process.cwd());
    const validCommandPath = realpathSync(process.argv[0]);

    const result = confineComputeInvocation(validCommandPath, [], validRoot);
    const bootstrapScript = result.args[2];

    expect(bootstrapScript).toContain('444'); // Landlock syscall create ruleset
    expect(bootstrapScript).toContain('445'); // Landlock syscall add rule
    expect(bootstrapScript).toContain('os.execv'); // Exec into the user command
  });
});

import { describe, expect, it } from 'vitest';
import { capabilityAllowsSegment } from '../../src/sandbox/shell-capabilities.js';

describe('Grok R3: les options npm gardent la portée des tests accordés', () => {
  const granted = new Set<'tests'>(['tests']);
  it.each([
    ['npm', 'test', '--prefix', '/other/project'],
    ['npm', 'run', 'lint', '--userconfig=/other/config'],
    ['npm', 'run', 'test', '--ignore-scripts=false'],
    ['npm', 'test', '--globalconfig', '/other/config'],
    ['npm', '--version', '--prefix=/other/project'],
  ].map(argv => [argv]))('refuse une option de configuration npm: %j', argv => {
    expect(capabilityAllowsSegment(argv, granted)).toBe(false);
  });
  it.each([
    ['npm', 'test', '--', 'tests/sample.test.ts', '--maxWorkers=2'],
    ['npm', 'run', 'lint', '--silent', '--', '--fix'],
    ['npm', '--version'],
  ].map(argv => [argv]))('garde les arguments du script après --: %j', argv => {
    expect(capabilityAllowsSegment(argv, granted)).toBe(true);
  });
});

/** Explicit operator grants. Text received from a model cannot change these. */
import type { ShellPolicyEvaluation } from './execpolicy.js';

export type ShellCapability = 'tests' | 'git-local' | 'npm-registry';
export function shellCapabilities(): Set<ShellCapability> {
  const values = (process.env.CODEBUDDY_SHELL_CAPABILITIES ?? '').split(',').filter(Boolean);
  const valid = new Set(['tests', 'git-local', 'npm-registry']);
  for (const value of values) if (!valid.has(value)) throw new Error(`Unknown shell capability: ${value}`);
  return new Set(values as ShellCapability[]);
}

export function capabilityAllowsSegment(argv: string[], capabilities = shellCapabilities()): boolean {
  const [command, operation, ...args] = argv;
  if (command === 'git' && capabilities.has('git-local')) {
    // No global -c/-C/--git-dir, remotes, reset, checkout, hooks or config writes.
    return ['add', 'commit'].includes(operation ?? '') && !args.some(arg => /^(?:--amend|--config-env|--exec-path|--git-dir|--work-tree|--output)(?:=|$)/.test(arg));
  }
  if (command !== 'npm') return false;
  if (capabilities.has('tests') && ['ls', 'list', 'explain'].includes(operation ?? '')
    && args.every(arg => ['--json', '--all'].includes(arg) || /^--depth=\d+$/.test(arg)
      || /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9.*^~+<>=| -]+)?$/i.test(arg))) return true;
  if (capabilities.has('tests') && (['--version', '-v', 'test'].includes(operation ?? '')
    || (operation === 'run' && /^(?:test|build|lint|typecheck|check|verify|audit)(?:[-:]|$)/.test(args[0] ?? '')))) return true;
  if (!capabilities.has('npm-registry')) return false;
  if (operation === 'audit') return args.every(arg => ['--json', '--omit=dev', '--production'].includes(arg));
  if (operation === 'pack') return args.length >= 1 && args.length <= 3
    && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9.*^~+<>=| -]+)?$/i.test(args[0] ?? '')
    && args.slice(1).every(arg => ['--json', '--silent'].includes(arg));
  if (operation === 'view') return args.length >= 1 && args.length <= 3
    && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9.*^~+<>=| -]+)?$/i.test(args[0] ?? '')
    && args.slice(1).every(arg => arg === '--json' || /^[a-z][a-z0-9_.-]*$/i.test(arg));
  return ['install', 'update'].includes(operation ?? '') && args.includes('--package-lock-only')
    && args.every(arg => ['--package-lock-only', '--ignore-scripts', '--no-fund', '--no-audit'].includes(arg));
}

export function scopedCapabilityAllows(evaluation: ShellPolicyEvaluation): boolean {
  if (evaluation.action === 'deny' || (evaluation.complex && !evaluation.simpleSequence)) return false;
  const capabilities = shellCapabilities();
  return evaluation.segmentEvaluations.length > 0 && evaluation.segmentEvaluations.every((segment, index) =>
    segment.action === 'allow' || segment.action === 'sandbox'
    || (['builtin-pkg-managers', 'builtin-git-boundary'].includes(segment.matchedRule?.id ?? '')
      && capabilityAllowsSegment(evaluation.parsedSegments[index] ?? [], capabilities)));
}

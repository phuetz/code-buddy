import { SAFE_BINARIES, SafeBinariesChecker } from '../../src/security/safe-binaries.js';

describe('SafeBinariesChecker shell-aware policy', () => {
  let checker: SafeBinariesChecker;

  beforeEach(() => {
    SafeBinariesChecker.resetInstance();
    checker = SafeBinariesChecker.getInstance();
  });

  afterEach(() => {
    SafeBinariesChecker.resetInstance();
  });

  it('accepts simple read-only commands and fully safe chains', () => {
    expect(checker.isSafe('ls -la')).toBe(true);
    expect(checker.isSafe('/usr/bin/rg -n "TODO" src')).toBe(true);
    expect(checker.isSafe('find src -type f -name "*.ts"')).toBe(true);
    expect(checker.isSafe('wc -l < README.md')).toBe(true);
    expect(checker.isSafe('echo "comparison: a > b"')).toBe(true);

    expect(checker.isSafeChain('cat README.md | rg Code | sort | uniq')).toBe(true);
    expect(checker.isSafeChain('test -f package.json && echo present || echo absent')).toBe(true);
    // BashTool calls isSafe(), so it must evaluate the complete expression too.
    expect(checker.isSafe('ls && pwd')).toBe(true);
  });

  it.each([
    'echo hello > output.txt',
    'echo hello >> output.txt',
    'rg error 2> errors.txt',
    'rg error &> all-output.txt',
    'sort README.md -o sorted.txt',
    'sort README.md --output=sorted.txt',
  ])('does not auto-approve write-capable output: %s', command => {
    expect(checker.isSafe(command)).toBe(false);
  });

  it.each([
    'echo $(whoami)',
    'echo "user: $(whoami)"',
    'echo `whoami`',
    '(pwd)',
    'cat <(rg TODO src)',
    'ls\nrm -rf /tmp/codebuddy-test',
    'ls & rm -rf /tmp/codebuddy-test',
  ])('does not auto-approve hidden shell execution: %s', command => {
    expect(checker.isSafe(command)).toBe(false);
    expect(checker.isSafeChain(command)).toBe(false);
  });

  it.each([
    'find . -delete',
    'find . -exec echo {} ;',
    'find . -execdir echo {} +',
    'find . -ok echo {} ;',
    'find . -okdir echo {} +',
    'find . -fprint results.txt',
  ])('does not auto-approve mutating or command-running find action: %s', command => {
    expect(checker.isSafe(command)).toBe(false);
  });

  it.each([
    'rg --pre sh pattern .',
    'rg --pre=sh pattern .',
    'rg --hostname-bin hostname pattern .',
    'rg --hostname-bin=/tmp/helper pattern .',
    'rg --search-zip pattern archive.zip',
    'rg -z pattern archive.zip',
  ])('does not auto-approve ripgrep helper execution: %s', command => {
    expect(checker.isSafe(command)).toBe(false);
  });

  it('removes stateful and command-running utilities from the default allowlist', () => {
    for (const binary of ['tee', 'xargs', 'yes', 'stty']) {
      expect(SAFE_BINARIES).not.toContain(binary);
      expect(checker.isSafe(binary)).toBe(false);
    }
  });

  it('requires every command in a chain to be independently safe', () => {
    expect(checker.isSafe('ls | rm -rf /tmp/codebuddy-test')).toBe(false);
    expect(checker.isSafeChain('cat README.md && curl https://example.com')).toBe(false);
    expect(checker.isSafeChain('rg TODO src | tee findings.txt')).toBe(false);
  });

  it('recognizes option-aware read-only Git commands without trusting arbitrary paths', () => {
    expect(checker.isSafe('git status --short')).toBe(true);
    expect(checker.isSafe('git log --oneline -5')).toBe(true);
    expect(checker.isSafe('git remote -v')).toBe(true);
    expect(checker.isSafe('git branch')).toBe(true);
    expect(checker.isSafe('git branch -D main')).toBe(false);
    expect(checker.isSafe('git log --output=history.txt')).toBe(false);
    expect(checker.isSafe('/usr/bin/git status')).toBe(true);
    expect(checker.isSafe('/tmp/git status')).toBe(false);
  });

  it('does not inherit a safe classification through env or privilege wrappers', () => {
    expect(checker.isSafe('env')).toBe(true);
    expect(checker.isSafe('env -u SECRET')).toBe(true);
    expect(checker.isSafe('env FOO=bar')).toBe(true);
    expect(checker.isSafe('env rm -rf /tmp/codebuddy-test')).toBe(false);
    expect(checker.isSafe("env -S 'rm -rf /tmp/codebuddy-test'")).toBe(false);
    expect(checker.isSafe('sudo ls')).toBe(false);
  });

  it('keeps explicit custom binaries while applying shell syntax checks', () => {
    checker.addSafeBinary('my-reader');

    expect(checker.isSafe('my-reader input.txt')).toBe(true);
    expect(checker.isSafe('my-reader input.txt > copy.txt')).toBe(false);
    expect(checker.isSafe('my-reader $(whoami)')).toBe(false);
  });
});

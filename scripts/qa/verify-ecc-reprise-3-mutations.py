#!/usr/bin/env python3
"""Restore one scoped safety regression at a time, require assertion failures."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '_qa/pare-feu-ecc/reprise-3/mutations'
OUT.mkdir(parents=True, exist_ok=True)
SCANNER = 'src/security/skill-scanner.ts'
TOOLS = 'src/agent/agent-tools.ts'
FILTER = 'src/agent/custom/custom-agent-tool-filter.ts'
TESTS = ['tests/security/skill-firewall-ecc-reprise-3.test.ts',
         'tests/agents/agent-ecc-reprise-3.test.ts',
         'tests/skills/skill-firewall-ecc-reprise-3-consumers.test.ts',
         'tests/security/skill-firewall-ecc-adverse.test.ts']

def replace(old, new):
    def edit(source):
        assert old in source, old
        return source.replace(old, new)
    return edit

def previous_line(marker):
    original = subprocess.check_output(['git', 'show', f'6bf228905:{SCANNER}'], cwd=ROOT, text=True)
    before = next(line for line in original.splitlines() if marker in line)
    def edit(source):
        after = next(line for line in source.splitlines() if marker in line)
        return replace(after, before)(source)
    return edit

def whole_line_native(source):
    old = subprocess.check_output(['git', 'show', f'6bf228905:{SCANNER}'], cwd=ROOT, text=True)
    line = next(line for line in old.splitlines() if "if (dp.name === 'native-process' &&" in line)
    start = source.index('    // An inert occurrence')
    end = source.index("    return context.imperative ?", start)
    return source[:start] + line + '\n' + source[end:]

def secondary_exact(source):
    old = subprocess.check_output(['git', 'show', '6bf228905:src/agent/agent-loader.ts'], cwd=ROOT, text=True)
    start = old.index('export function isToolAllowedForAgent(')
    end = old.index('\n}', start) + 2
    left = source.index('export function isToolAllowedForAgent(')
    right = source.index('\n}', left) + 2
    return source[:left] + old[start:end] + source[right:]

# Disable both shell syntax passes, leaving the PHP detector untouched.
def disable_shell(source):
    line = next(line for line in source.splitlines() if "name: 'shell-backtick'" in line)
    start = line.index('pattern: /')
    end = line.index(', severity:', start)
    return replace(line, line[:start] + 'pattern: /(?!)/' + line[end:])(source).replace("['php-backtick', 'shell-backtick']", "['php-backtick']")

CASES = [
    ('bare-recursive-delete-lost', SCANNER, previous_line("name: 'script-recursive-delete'")),
    ('native-benign-whole-line', SCANNER, whole_line_native),
    ('module-binding-whole-line', SCANNER, previous_line("if (dp.name === 'child_process' &&")),
    ('wildcard-allowlist-accepted', TOOLS, replace("(purpose === 'allow' && !/[A-Za-z]/.test(t.replace(/[*?]/g, '')))", 'false')),
    ('negative-allowlist-accepted', TOOLS, replace("t.startsWith('!') ||", '')),
    ('programmatic-policy-unchecked', FILTER, replace("  parseAgentTools(agent.tools);\n  parseAgentTools(agent.disabledTools, 'deny');\n", '')),
    ('deny-all-policy-rejected', 'src/agent/custom/custom-agent-loader.ts', replace("parseAgentTools(parsed.disabledTools, 'deny')", 'parseAgentTools(parsed.disabledTools)')),
    ('secondary-denials-ignored', 'src/agent/agent-loader.ts', secondary_exact),
    ('quoted-subprocess-without-import-missed', SCANNER, replace(r'subprocess\s*(?:\.|\[)', r'subprocess\s*\.')),
    ('shell-backticks-missed', SCANNER, disable_shell),
    ('literal-backtick-consumes-command', SCANNER, replace("shellPosition(line, offset).literal ? ' ' : tick", 'tick')),
    ('multiline-backticks-missed', SCANNER, replace('findings.push(...collectMultilineBackticks(content, filePath, contexts, findings));', '')),
    ('backticks-reconstructed-from-prose', SCANNER, replace("    if (dp.name === 'php-backtick' || dp.name === 'shell-backtick') continue;\n", '')),
    ('html-process-line-skipped', SCANNER, replace("if (line.trim() === '---') continue;", "if (line.trim().startsWith('<!--') || line.trim() === '---') continue;")),
    ('shell-quoted-text-executed', SCANNER, replace(' || shellPosition(line, offset).literal', '')),
    ('shell-heredoc-literal-executed', SCANNER, replace(' || context.shellLiteral', '')),
    ('heredoc-opener-inside-string', SCANNER, replace('!position.quoted && !position.literal', '!position.literal')),
    ('heredoc-never-closes', SCANNER, replace('if (heredoc && (heredoc.stripTabs', 'if (false && heredoc && (heredoc.stripTabs')),
    ('prose-quoted-argument-benign', SCANNER, replace(r""" && /^system\s*\(\s*[^'"`();{}]+\)/.test(call)""", '')),
    ('swift-computed-size-benign', SCANNER, replace(r'/^system\s*\(\s*size\s*:\s*\d+(?:\.\d+)?\s*[,)]/', r'/^system\s*\(\s*size\s*:/')),
    ('documentary-severity-lowered', SCANNER, replace('severity: dp.severity,', "severity: kind === 'documentary' ? 'info' : dp.severity,")),
    ('review-automatic-gate-open', SCANNER, replace("return buildSkillFirewallReport(result.file, [result]).verdict !== 'allow';", "return result.findings.some(f => f.severity === 'critical');")),
    ('authored-review-accepted', 'src/agent/self-improvement/skill-mutator.ts', replace("safe: report.verdict === 'allow',", 'safe: !report.quarantineRequired,')),
]

results = []
for name, file, edit in CASES:
    target = ROOT / file
    original = target.read_bytes()
    try:
        mutated = edit(original.decode())
        assert mutated.encode() != original, name
        target.write_text(mutated)
        with (OUT / f'{name}.log').open('w') as log:
            run = subprocess.run(['node_modules/.bin/vitest', 'run', '--configLoader', 'runner', '--maxWorkers', '2', *TESTS], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=120)
        transcript = (OUT / f'{name}.log').read_text()
        failures = [line.strip() for line in transcript.splitlines() if line.startswith(' FAIL ')]
        count = re.search(r'Tests\s+(\d+) failed', transcript)
        killed = run.returncode != 0 and 'AssertionError:' in transcript and bool(failures)
        results.append({'mutation': name, 'file': file, 'exitCode': run.returncode,
                        'killedByAssertion': killed, 'failedTests': failures,
                        'failedTestCount': int(count.group(1)) if count else None,
                        'restoredSha256': hashlib.sha256(original).hexdigest()})
        print(f'{name}: {"killed" if killed else "NOT PROVEN"}', flush=True)
    finally:
        target.write_bytes(original)
    assert target.read_bytes() == original
    (OUT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
sys.exit(0 if all(r['killedByAssertion'] for r in results) else 1)

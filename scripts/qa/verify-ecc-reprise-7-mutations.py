#!/usr/bin/env python3
"""Restore one scoped safety regression at a time, require assertion failures."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / '_qa/pare-feu-ecc/reprise-7/mutations'
OUT.mkdir(parents=True, exist_ok=True)
SCANNER = 'src/security/skill-scanner.ts'
TESTS = ['tests/security/skill-firewall-ecc-reprise-7.test.ts', 'tests/skills/skill-firewall-ecc-reprise-7-consumers.test.ts', 'tests/agents/agent-ecc-reprise-7.test.ts']

def replace(old, new):
    def edit(source):
        assert old in source, old
        return source.replace(old, new)
    return edit

def pattern_disabled(name):
    def edit(source):
        line = next(line for line in source.splitlines() if f"name: '{name}'" in line)
        left = line.index('pattern: /'); right = line.index(', severity:', left)
        return replace(line, line[:left] + 'pattern: /(?!)/' + line[right:])(source)
    return edit

CASES = [
    ('terminators-missed', SCANNER, replace("['\"]?[-+][^\\s;&|()]*", r"-(?:[A-Za-z]+|-[A-Za-z][\w-]*)(?=[ \t]|$)")),
    ('plus-options-missed', SCANNER, replace("['\"]?[-+][^\\s;&|()]*", "['\"]?-[^\\s;&|()]*")),
    ('quoted-options-missed', SCANNER, replace("['\"]?[-+][^\\s;&|()]*", "[-+][^\\s;&|()]*")),
    ('mandatory-unicode-folding-disabled', SCANNER, replace('const folded = foldUnicodeForScan(content);', 'const folded = content;')),
    ('generic-launcher-folding-duplicated', SCANNER, replace("if (dp.name === 'shell-interpreter' && (existing.some(f => f.pattern === dp.name) || extra.some(f => f.pattern === dp.name))) continue;", '')),
    ('unseen-launcher-decoding-lost', SCANNER, replace("if (dp.name === 'shell-interpreter' && (existing.some(f => f.pattern === dp.name) || extra.some(f => f.pattern === dp.name))) continue;", "if (dp.name === 'shell-interpreter') continue;")),
    ('python-binding-quarantined', SCANNER, replace("if (dp.name === 'shell-interpreter' && /^(?:py|python[\\d.]*)$/.test(context.language)", "if (false && dp.name === 'shell-interpreter' && /^(?:py|python[\\d.]*)$/.test(context.language)")),
    ('python-whole-line-exemption', SCANNER, replace("if (dp.name === 'shell-interpreter' && /^(?:py|python[\\d.]*)$/.test(context.language)", "if (/^(?:py|python[\\d.]*)$/.test(context.language) && /^\\s*for.*\\b(?:sh|bash)\\s+in\\b/.test(line)) return 'benign';\n  if (dp.name === 'shell-interpreter' && /^(?:py|python[\\d.]*)$/.test(context.language)")),
    ('script-launcher-documentary', SCANNER, replace("if (!context.markdown) return 'active';", "if (!context.markdown && dp.name === 'shell-interpreter') return 'documentary';\n  if (!context.markdown) return 'active';")),
    ('documentary-floor-removed', SCANNER, replace("const verdict = activeVerdict === 'allow' && findings.some(f => f.documentary) ? 'review' : activeVerdict;", 'const verdict = activeVerdict;')),
    ('agent-documentary-critical-accepted', 'src/skills/agent-importer.ts', replace("scan.findings = scan.findings.map(f => f.severity === 'critical' || f.severity === 'high' ? { ...f, documentary: false } : f);", '')),
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

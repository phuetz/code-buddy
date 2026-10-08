#!/usr/bin/env python3
"""Restore one scoped safety regression at a time, require assertion failures."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / '_qa/pare-feu-ecc/reprise-4/mutations'
OUT.mkdir(parents=True, exist_ok=True)
SCANNER = 'src/security/skill-scanner.ts'
TESTS = ['tests/security/skill-firewall-ecc-reprise-4.test.ts',
         'tests/agents/agent-ecc-reprise-4.test.ts',
         'tests/skills/skill-firewall-ecc-reprise-4-consumers.test.ts',
         'tests/security/skill-firewall-ecc-adverse.test.ts']

def replace(old, new):
    def edit(source):
        assert old in source, old
        return source.replace(old, new)
    return edit

CASES = [
    ('folded-backticks-ignored', SCANNER, replace('collectMultilineBackticks(folded, filePath, foldedContexts, [])', 'collectMultilineBackticks(content, filePath, contexts, [])')),
    ('folded-language-context-ignored', SCANNER, replace('scanContexts(folded, filePath, !contexts[0]?.markdown)', 'scanContexts(content, filePath, !contexts[0]?.markdown)')),
    ('generic-folding-manufactures-backticks', SCANNER, replace("    if (dp.name === 'php-backtick' || dp.name === 'shell-backtick') continue;\n", '')),
    ('optional-delete-missed', SCANNER, replace(r'(?:\?\.\s*)?', '')),
    ('ambiguous-prose-accepted', SCANNER, replace('PROSE_SYSTEM_REFERENCE.test(call)', 'true')),
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

#!/usr/bin/env python3
"""Restore each reviewed component to 8ec6ff16b and require a failing assertion."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = '8ec6ff16b3c9a1740da28dbf69021a8b7f1c65b2'
OUT = ROOT / '_qa/pare-feu-ecc/reprise-1/review-mutations'
OUT.mkdir(parents=True, exist_ok=True)
CASES = [
    ('reviewed-scanner', 'src/security/skill-scanner.ts', ['tests/security/skill-firewall-ecc-reprise.test.ts', 'tests/skills/skill-firewall-ecc-consumers.test.ts']),
    ('reviewed-private-report', 'docs/reports/2026-10/PARE-FEU-ECC-2026-10-03.md', ['tests/security/donnees-personnelles.test.ts']),
]
results = []
for name, source, tests in CASES:
    target = ROOT / source
    original = target.read_bytes()
    try:
        target.write_bytes(subprocess.check_output(['git', 'show', f'{BASE}:{source}'], cwd=ROOT))
        with (OUT / f'{name}.log').open('w') as log:
            run = subprocess.run(['node_modules/.bin/vitest', 'run', '--configLoader', 'runner', '--maxWorkers', '2', *tests], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=120)
        transcript = (OUT / f'{name}.log').read_text()
        killed = run.returncode != 0 and 'AssertionError:' in transcript and 'Tests ' in transcript
        results.append({'mutation': name, 'source': source, 'tests': tests, 'exitCode': run.returncode, 'killedByAssertion': killed, 'restoredSha256': hashlib.sha256(original).hexdigest()})
        print(f'{name}: {"killed" if killed else "NOT PROVEN"}', flush=True)
    finally:
        target.write_bytes(original)
    assert target.read_bytes() == original
(OUT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
sys.exit(0 if all(item['killedByAssertion'] for item in results) else 1)

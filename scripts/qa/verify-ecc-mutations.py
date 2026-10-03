#!/usr/bin/env python3
"""Revert individual components to the mission base, require red, always restore."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = '70bcab004f822bccadb73f931e9de1d932b900a5'
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / '_qa/pare-feu-ecc/mutations'
OUT.mkdir(parents=True, exist_ok=True)
CASES = [
    ('scanner-original', 'src/security/skill-scanner.ts', 'tests/security/skill-firewall-ecc.test.ts'),
    ('importer-original', 'src/skills/skill-importer.ts', 'tests/skills/skill-import-ecc.test.ts'),
    ('markdown-loader-original', 'src/agent/agent-loader.ts', 'tests/agents/agent-tools-ecc.test.ts'),
    ('definition-loader-original', 'src/agent/definitions/agent-definition-loader.ts', 'tests/agents/agent-tools-ecc.test.ts'),
    ('custom-loader-original', 'src/agent/custom/custom-agent-loader.ts', 'tests/agents/agent-tools-ecc.test.ts'),
    ('empty-filter-original', 'src/agent/custom/custom-agent-tool-filter.ts', 'tests/agents/agent-tools-ecc.test.ts'),
]
results = []
for name, source, test in CASES:
    target = ROOT / source
    original = target.read_bytes()
    try:
        mutant = subprocess.check_output(['git', 'show', f'{BASE}:{source}'], cwd=ROOT)
        target.write_bytes(mutant)
        with (OUT / f'{name}.log').open('w') as log:
            run = subprocess.run(['node_modules/.bin/vitest', 'run', '--configLoader', 'runner', '--maxWorkers', '2', test], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=120)
        transcript = (OUT / f'{name}.log').read_text()
        killed = run.returncode != 0 and 'AssertionError:' in transcript and 'Tests ' in transcript
        results.append({'mutation': name, 'source': source, 'test': test, 'exitCode': run.returncode, 'killedByAssertion': killed})
        print(f'{name}: {"killed" if killed else "NOT PROVEN"}', flush=True)
    finally:
        target.write_bytes(original)
(OUT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
sys.exit(0 if all(item['killedByAssertion'] for item in results) else 1)

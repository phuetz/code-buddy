#!/usr/bin/env python3
"""Foreground real-CLI replay, isolated fresh HOME and physical-copy assertions."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '_qa/pare-feu-ecc/reprise-5'
phase = sys.argv[1]
run_id = sys.argv[2] if len(sys.argv) > 2 else 'final'
cwd = OUT / 'baseline-f432faceb' if phase == 'before' else ROOT
assert phase in ('before', 'after')
fixtures = OUT / (sys.argv[3] if len(sys.argv) > 3 else 'cli')
cases = json.loads((fixtures / 'cases.json').read_text())
proofs = []
for include in (False, True):
    name = f'cli-{run_id}-{phase}-' + ('review' if include else 'default')
    home = ROOT / '_qa/pare-feu-ecc/home' / ('reprise5-' + name)
    home.mkdir(exist_ok=False)
    env = os.environ.copy()
    env.update(HOME=str(home), USERPROFILE=str(home), CODEBUDDY_HOME=str(home / '.codebuddy'))
    env.pop('GROK_HOME', None)
    env.pop('CODEBUDDY_SKILL_FIREWALL_DEOB_ALL', None)
    cmd = [str(ROOT / 'node_modules/.bin/tsx'), 'src/index.ts', 'skills', 'import', '--dir',
           str(fixtures / 'source'), '--apply', '--agents', '--json']
    if include:
        cmd.append('--include-review')
    with (OUT / (name + '.json')).open('w') as out, (OUT / (name + '.stderr')).open('w') as err:
        run = subprocess.run(cmd, cwd=cwd, env=env, stdout=out, stderr=err, timeout=180)
    assert run.returncode == 0, (name, run.returncode)
    report = json.loads((OUT / (name + '.json')).read_text())['report']
    rows = {r['sourcePath']: r for key in ('imported', 'quarantined', 'review') for r in report[key]}
    actual = {p.parent.name for p in (home / '.codebuddy/skills').glob('*/SKILL.md')}
    assert actual == {r['name'] for r in report['imported']}
    case_proofs = []
    for case in cases:
        row = rows['skills/' + case['id']]
        if phase == 'after':
            assert row['verdict'] == case['expected'], (case, row)
        copied = row.get('name', 'imported-' + case['id']) in actual
        assert copied == (row['verdict'] == 'allow' or (include and row['verdict'] == 'review')), (case, row, copied)
        case_proofs.append({'id': case['id'], 'verdict': row['verdict'], 'copied': copied})
    agents = report['agents']
    if phase == 'after':
        assert len(agents['quarantined']) == 4 and not agents['review']
    staged = list((home / '.codebuddy/agents/review').glob('*.md'))
    assert len(staged) == len(agents['review'])
    assert all('disabled: true' in p.read_text() and 'permissionMode: suggest' in p.read_text() for p in staged)
    proofs.append({'phase': phase, 'includeReview': include, 'exitCode': 0,
                   'allVerdictsAndPhysicalCopiesChecked': True,
                   'counts': {k: len(report[k]) for k in ('imported', 'quarantined', 'review', 'skipped')},
                   'agents': {k: len(agents[k]) for k in ('review', 'quarantined', 'skipped')}, 'cases': case_proofs})
    print(name, proofs[-1]['counts'], flush=True)
(OUT / f'cli-{run_id}-{phase}-assertions.json').write_text(json.dumps(proofs, indent=2) + '\n')

#!/usr/bin/env python3
"""P1 recette, STREAMING path — the interactive CLI (Ink, processUserMessageStream) in a PTY.

    node scripts/recette-comparatif/run-isolated.mjs p1-stream -- python3 scripts/recette-comparatif/p1-loop-guard-stream-pty.py

A stubborn FIXTURE (not a model) keeps asking for the same view_file call. The
guard must warn once, then stop the turn before the round limit. The headless
`-p` recette (p1-loop-guard.mjs) covers the sequential path.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pty_fixture import Fixture, plain, run_pty  # noqa: E402

BASE = os.environ['RECETTE_QA_BASE']
WORKSPACE = os.path.join(BASE, 'workspace')
os.makedirs(os.path.join(WORKSPACE, 'src'), exist_ok=True)
with open(os.path.join(WORKSPACE, 'src', 'a.ts'), 'w', encoding='utf-8') as fh:
    fh.write('export const answer = 42;\n')


def stubborn(body, index):
    if not body.get('messages'):
        return {'content': 'ok'}
    return {'tool_calls': [{'name': 'view_file', 'arguments': {'path': 'src/a.ts'}}]}


fixture = Fixture(stubborn, model='fixture-loop-model')
env = dict(os.environ, CODEBUDDY_SKIP_ONBOARDING='1')
args = ['-u', fixture.base_url, '-k', 'fixture-not-a-secret', '-m', 'fixture-loop-model', '--max-tool-rounds', '40']
transcript, steps = run_pty(args, [
    (r'Describe a task|Message', 'Read src/a.ts and tell me the exported value.'),
    (r'Read src/a\.ts and tell me', '\r'),
    (r'Stopped by the loop guard', None),
], WORKSPACE, env, timeout=240)
fixture.close()
with open(os.path.join(BASE, 'pty-transcript.txt'), 'w', encoding='utf-8') as fh:
    fh.write(transcript)
text = plain(transcript)
turns = fixture.chat_turns()
guard_requests = [r for r in turns if any('<context type="loop-guard">' in str(m.get('content')) for m in r.get('messages', []))]
summary = {
    'item': 'P1',
    'path': 'streaming (interactive CLI in a PTY)',
    'provider': 'fixture (deterministic, not a model)',
    'stepsCompleted': steps,
    'streamRequests': sum(1 for r in turns if r.get('stream')),
    'chatTurns': len(turns),
    'requestsCarryingGuardWarning': len(guard_requests),
    'warningShown': 'Loop guard:' in text,
    'stoppedByGuard': 'Stopped by the loop guard' in text,
    'maxRoundsMessage': 'Maximum tool execution rounds reached' in text,
    'blockedExternal': re.findall(r'external (?:network|fetch) blocked \(([^)]*)\)', transcript),
}
summary['pass'] = (steps == 3 and summary['streamRequests'] == summary['chatTurns'] == 8 and summary['warningShown']
                   and summary['stoppedByGuard'] and not summary['maxRoundsMessage']
                   and all('registry.npmjs.org' in b for b in summary['blockedExternal']))
with open(os.path.join(BASE, 'summary.json'), 'w', encoding='utf-8') as fh:
    json.dump(summary, fh, indent=2)
print(json.dumps(summary, indent=2))
raise SystemExit(0 if summary['pass'] else 1)

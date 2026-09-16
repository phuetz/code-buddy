#!/usr/bin/env python3
"""P4 recette — first-use hints in the real interactive CLI (PTY), persisted per profile.

    node scripts/recette-comparatif/run-isolated.mjs p4-hints -- python3 scripts/recette-comparatif/p4-first-use-hints-pty.py

Session 1: a slow FIXTURE turn (not a model) lets two messages queue behind it, twice;
then a tool returns a 100 KB log twice. Expect exactly one queue tip and one
restore_context tip. Session 2 (same throwaway HOME, new process): the same
situations show no tip (persisted markers).
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from pty_fixture import Fixture, plain, run_pty  # noqa: E402

BASE = os.environ['RECETTE_QA_BASE']
HOME = os.environ['HOME']
WORKSPACE = os.path.join(BASE, 'workspace')
os.makedirs(WORKSPACE, exist_ok=True)
with open(os.path.join(WORKSPACE, 'big.log'), 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(f'build step {i}: compiled module_{i * 7919 % 10007}.ts in {i % 97} ms' for i in range(2500)))


def last_user(body):
    users = [m for m in body.get('messages', []) if m.get('role') == 'user']
    return str(users[-1].get('content')) if users else ''


def script(body, index):
    if not body.get('messages'):
        return {'content': 'ok'}
    last = body['messages'][-1]
    user = last_user(body)
    if last.get('role') == 'tool':
        return {'content': f'READ-DONE {index}'}
    if 'slow' in user:
        time.sleep(8)
        return {'content': f'SLOW-DONE {index}'}
    if 'read big' in user:
        return {'tool_calls': [{'name': 'view_file', 'arguments': {'path': 'big.log'}}]}
    return {'content': f'QUICK-DONE {index}'}


fixture = Fixture(script, model='fixture-hints-model')
env = dict(os.environ, CODEBUDDY_SKIP_ONBOARDING='1', CODEBUDDY_LM_RESIZER='false')
args = ['-u', fixture.base_url, '-k', 'fixture-not-a-secret', '-m', 'fixture-hints-model']
ENTER = '\r'


def session(label):
    steps = [
        (r'Describe a task|Message', 'slow one'), (r'slow one', ENTER),
        ('', 'queued alpha', 1.5), ('', ENTER, 0.8),
        (r'QUICK-DONE', None),
        (r'Describe a task', 'slow two'), (r'slow two', ENTER),
        ('', 'queued beta', 1.5), ('', ENTER, 0.8),
        (r'QUICK-DONE', None),
        (r'Describe a task', 'read big one'), (r'read big one', ENTER),
        (r'READ-DONE', None), ('', 'read big two', 2.0), ('', ENTER, 0.8),
        (r'READ-DONE', None),
    ]
    transcript, done = run_pty(args, steps, WORKSPACE, env, timeout=240, settle=1.0)
    with open(os.path.join(BASE, f'pty-{label}.txt'), 'w', encoding='utf-8') as fh:
        fh.write(transcript)
    text = plain(transcript)
    # Ink redraws frames: count distinct tip occurrences per redraw-insensitive marker.
    return {
        'steps': done,
        'stepsTotal': len(steps),
        'queueTipShown': 'this message was queued while Buddy was busy' in text,
        'restoreTipShown': 'long tool outputs are shortened for the model' in text,
        'blocked': re.findall(r'external (?:network|fetch) blocked \(([^)]*)\)', transcript),
    }


first = session('session1')
markers_after_first = sorted(os.listdir(os.path.join(HOME, '.codebuddy', 'hints'))) if os.path.isdir(os.path.join(HOME, '.codebuddy', 'hints')) else []
second = session('session2')
fixture.close()

session1_text = plain(open(os.path.join(BASE, 'pty-session1.txt'), encoding='utf-8').read())
summary = {
    'item': 'P4',
    'part': 'first-use hints (interactive CLI, PTY)',
    'provider': 'fixture (deterministic, not a model)',
    'session1': first,
    'session2': second,
    'markersAfterSession1': markers_after_first,
    'session1QueueTipOnce': session1_text.count('this message was queued while Buddy was busy') >= 1,
    'chatTurns': len(fixture.chat_turns()),
}
summary['pass'] = (first['steps'] == first['stepsTotal'] and second['steps'] == second['stepsTotal']
                   and first['queueTipShown'] and first['restoreTipShown']
                   and not second['queueTipShown'] and not second['restoreTipShown']
                   and markers_after_first == ['message_queued', 'restore_context']
                   and all('registry.npmjs.org' in b for b in first['blocked'] + second['blocked']))
with open(os.path.join(BASE, 'summary.json'), 'w', encoding='utf-8') as fh:
    json.dump(summary, fh, indent=2)
print(json.dumps(summary, indent=2))
raise SystemExit(0 if summary['pass'] else 1)

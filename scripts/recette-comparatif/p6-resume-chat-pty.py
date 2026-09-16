#!/usr/bin/env python3
"""P6 recette — real `buddy --resume` WITHOUT an ID, then chat, in a pseudo-terminal.

    node scripts/recette-comparatif/run-isolated.mjs p6-resume-chat -- python3 scripts/recette-comparatif/p6-resume-chat-pty.py

Seeds 3 sessions with distinct markers, opens the picker through the interactive
entry point, picks the 2nd session (↓ Enter), then sends a message. The FIXTURE
provider (not a model) records the request: it must carry the picked session's
history and none of the others' markers, and its reply must appear in the chat.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pty_fixture import Fixture, plain, run_pty  # noqa: E402

BASE = os.environ['RECETTE_QA_BASE']
SESSIONS = os.environ['CODEBUDDY_SESSIONS_DIR']
WORKSPACE = os.path.join(BASE, 'workspace')
os.makedirs(SESSIONS, exist_ok=True)
os.makedirs(WORKSPACE, exist_ok=True)


def session(sid, name, when, marker):
    path = os.path.join(SESSIONS, f'{sid}.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump({'id': sid, 'name': name, 'workingDirectory': WORKSPACE, 'model': 'fixture-resume-model',
                   'createdAt': when, 'lastAccessedAt': when, 'messages': [
                       {'type': 'user', 'content': f'question {marker}', 'timestamp': when},
                       {'type': 'assistant', 'content': f'answer {marker}', 'timestamp': when}]}, fh)
    os.chmod(path, 0o600)


session('aaaa1111-remise', 'remise facture', '2026-09-15T10:00:00Z', 'MARKER-REMISE-1111')
session('bbbb2222-docs', 'documentation', '2026-09-15T09:00:00Z', 'MARKER-DOCS-2222')
session('cccc3333-ci', 'pipeline ci', '2026-09-15T08:00:00Z', 'MARKER-CI-3333')


def script(body, index):
    if not body.get('messages'):
        return {'content': 'ok'}
    return {'content': 'FIXTURE-RESUMED-REPLY'}


fixture = Fixture(script, model='fixture-resume-model')
env = dict(os.environ, CODEBUDDY_SKIP_ONBOARDING='1')
# RECETTE_RESUME_ID=bbbb2222 exercises `--resume <id>` (same hydration path, no picker).
explicit = os.environ.get('RECETTE_RESUME_ID')
args = ['-u', fixture.base_url, '-k', 'fixture-not-a-secret', '-m', 'fixture-resume-model', '--resume', *([explicit] if explicit else [])]
picker_steps = [] if explicit else [(r'Resume a session', '\x1b[B', 1.0), ('', '\r', 0.6)]
transcript, steps = run_pty(args, [
    *picker_steps,
    (r'Describe a task|Message', 'what did we decide?', 2.0),
    ('', '\r', 0.8),
    (r'FIXTURE-RESUMED-REPLY', None),
    # Graceful exit (one Ctrl+C), then wait for the process to end so shutdown persistence can run.
    ('', '\x03', 1.5),
    (r'(?!)', None),
], WORKSPACE, env, timeout=60)
fixture.close()
with open(os.path.join(BASE, 'pty-transcript.txt'), 'w', encoding='utf-8') as fh:
    fh.write(transcript)
text = plain(transcript)
turns = fixture.chat_turns()
sent = json.dumps(turns[-1]['messages']) if turns else ''
summary = {
    'item': 'P6',
    'part': 'buddy --resume without ID, then chat (PTY)',
    'provider': 'fixture (deterministic, not a model)',
    'mode': f'--resume {explicit}' if explicit else '--resume (picker)',
    'stepsCompleted': steps,
    'pickerShown': ('Resume a session' in text) if not explicit else None,
    'resumedSecondSession': 'Resuming session: documentation' in text,
    'recapShown': 'Recap (local, no model call)' in text,
    'chatTurns': len(turns),
    'requestCarriesPickedHistory': 'MARKER-DOCS-2222' in sent and 'what did we decide?' in sent,
    'requestMixesOtherSessions': 'MARKER-REMISE-1111' in sent or 'MARKER-CI-3333' in sent,
    'fixtureReplyShown': 'FIXTURE-RESUMED-REPLY' in text,
    'blockedExternal': re.findall(r'external (?:network|fetch) blocked \(([^)]*)\)', transcript),
}
# Picker keys + message + reply seen + Ctrl+C sent (the last wait ends when the process exits).
summary['pass'] = (steps >= len(picker_steps) + 4 and (bool(explicit) or summary['pickerShown']) and summary['resumedSecondSession'] and summary['chatTurns'] >= 1
                   and summary['requestCarriesPickedHistory'] and not summary['requestMixesOtherSessions']
                   and summary['fixtureReplyShown'] and all('registry.npmjs.org' in b for b in summary['blockedExternal']))
with open(os.path.join(BASE, 'summary.json'), 'w', encoding='utf-8') as fh:
    json.dump(summary, fh, indent=2)
print(json.dumps(summary, indent=2))
raise SystemExit(0 if summary['pass'] else 1)

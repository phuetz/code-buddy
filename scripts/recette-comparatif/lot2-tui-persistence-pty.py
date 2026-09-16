#!/usr/bin/env python3
"""Lot 2 A — interactive TUI turns must be persisted in the session file.

    node scripts/recette-comparatif/run-isolated.mjs lot2-tui -- python3 scripts/recette-comparatif/lot2-tui-persistence-pty.py

Real interactive CLI in a PTY, deterministic FIXTURE provider on loopback (not a model),
throwaway HOME. A witness session must stay byte-identical.

1. fresh launch: message 1 (plain reply), message 2 (fixture asks view_file, then replies); Ctrl+C;
2. `buddy --resume <id>`: message 3; Ctrl+C;
3. `buddy --resume` without ID (picker, Enter on the most recent): message 4; Ctrl+C;
4. reload: the file is read back by the real SessionStore in a new process.

Oracle (summary.json): exactly one new session file; message order user1, assistant1, user2,
tool call/result, assistant2, user3, assistant3, user4, assistant4; no duplicated turn; request for
message 3 and 4 carries earlier turns; witness unchanged; no other session's marker.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pty_fixture import REPO, TSX, Fixture, plain, run_pty  # noqa: E402

BASE = os.environ['RECETTE_QA_BASE']
SESSIONS = os.environ['CODEBUDDY_SESSIONS_DIR']
WORKSPACE = os.path.join(BASE, 'workspace')
os.makedirs(SESSIONS, exist_ok=True)
os.makedirs(WORKSPACE, exist_ok=True)
with open(os.path.join(WORKSPACE, 'notes.txt'), 'w', encoding='utf-8') as fh:
    fh.write('NOTE-CONTENT-4242\n')

witness_path = os.path.join(SESSIONS, 'wwww0000-temoin.json')
with open(witness_path, 'w', encoding='utf-8') as fh:
    json.dump({'id': 'wwww0000-temoin', 'name': 'temoin', 'workingDirectory': WORKSPACE, 'model': 'fixture-lot2-model',
               'createdAt': '2026-09-01T08:00:00Z', 'lastAccessedAt': '2026-09-01T08:00:00Z',
               'messages': [{'type': 'user', 'content': 'question WITNESS-MARKER-0000', 'timestamp': '2026-09-01T08:00:00Z'},
                            {'type': 'assistant', 'content': 'answer WITNESS-MARKER-0000', 'timestamp': '2026-09-01T08:00:01Z'}]}, fh)
os.chmod(witness_path, 0o600)
witness_hash = hashlib.sha256(open(witness_path, 'rb').read()).hexdigest()


def script(body, index):
    msgs = body.get('messages') or []
    if not msgs:
        return {'content': 'ok'}
    last = msgs[-1]
    users = [m for m in msgs if m.get('role') == 'user']
    user = str(users[-1].get('content')) if users else ''
    if last.get('role') == 'tool':
        return {'content': 'REPLY-2 notes read'}
    for n in ('1', '3', '4'):
        if f'MSG-{n}' in user:
            return {'content': f'REPLY-{n} done'}
    if 'MSG-2' in user:
        return {'tool_calls': [{'name': 'view_file', 'arguments': {'path': 'notes.txt'}}]}
    return {'content': 'REPLY-? unexpected'}


fixture = Fixture(script, model='fixture-lot2-model')
env = dict(os.environ, CODEBUDDY_SKIP_ONBOARDING='1')
MODEL = ['-u', fixture.base_url, '-k', 'fixture-not-a-secret', '-m', 'fixture-lot2-model']
QUIT = [('', '\x03', 1.5), (r'(?!)', None)]


def send(text, reply):
    return [('', text, 2.0), ('', '\r', 0.8), (reply, None)]


def new_files():
    return sorted(f for f in os.listdir(SESSIONS) if f.endswith('.json') and not f.startswith('wwww0000'))


transcripts = {}
t1, s1 = run_pty(MODEL, [(r'Describe a task|Message', None), *send('first MSG-1 please', r'REPLY-1'), *send('second MSG-2 read notes', r'REPLY-2'), *QUIT], WORKSPACE, env, timeout=150)
transcripts['launch1'] = t1
files_after_1 = new_files()
session_id = files_after_1[0][:-5] if len(files_after_1) == 1 else None

t2, s2 = run_pty([*MODEL, '--resume', session_id or 'missing'], [(r'Describe a task|Message', None), *send('third MSG-3 continue', r'REPLY-3'), *QUIT], WORKSPACE, env, timeout=150)
transcripts['launch2-resume-id'] = t2
t3, s3 = run_pty([*MODEL, '--resume'], [(r'Resume a session', '\r', 1.5), (r'Describe a task|Message', None), *send('fourth MSG-4 finish', r'REPLY-4'), *QUIT], WORKSPACE, env, timeout=150)
transcripts['launch3-resume-picker'] = t3
fixture.close()
for name, text in transcripts.items():
    with open(os.path.join(BASE, f'pty-{name}.txt'), 'w', encoding='utf-8') as fh:
        fh.write(text)

final_files = new_files()
record = {}
if session_id and os.path.exists(os.path.join(SESSIONS, f'{session_id}.json')):
    record = json.load(open(os.path.join(SESSIONS, f'{session_id}.json'), encoding='utf-8'))
messages = record.get('messages', [])
sequence = []
for m in messages:
    content = str(m.get('content', ''))
    marker = re.search(r'(MSG-\d|REPLY-\d|NOTE-CONTENT-4242)', content)
    sequence.append(f"{m.get('type')}:{marker.group(1) if marker else ''}")

# Reload through the real SessionStore in a new process (JSON store, same throwaway HOME).
reload_script = (
    "import { SessionStore } from '%s/src/persistence/session-store.ts';"
    "const s = new SessionStore({ useSQLite: false });"
    "const session = await s.getSessionByPartialId(process.argv[1]);"
    "console.log(JSON.stringify({ id: session?.id, count: session?.messages.length, types: session?.messages.map((m) => m.type) }));"
) % REPO
reload = subprocess.run(['node', TSX[0], '--input-type=module', '-e', reload_script, session_id or 'missing'],
                        cwd=WORKSPACE, env=env, capture_output=True, text=True, timeout=120)
try:
    reloaded = json.loads(reload.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    reloaded = {'error': (reload.stdout + reload.stderr)[-400:]}

turns = fixture.chat_turns()


def carries(marker_needed, marker_turn):
    reqs = [r for r in turns if marker_turn in json.dumps(r.get('messages', []))]
    return bool(reqs) and all(marker_needed in json.dumps(r.get('messages', [])) for r in reqs)


def resumed_tool_pairing():
    """In the first request after `--resume <id>`, every tool message answers a preceding assistant tool call."""
    reqs = [r for r in turns if 'MSG-3' in json.dumps(r.get('messages', []))]
    if not reqs:
        return False
    msgs = reqs[0].get('messages', [])
    call_ids = set()
    tool_msgs = 0
    for m in msgs:
        for call in m.get('tool_calls') or []:
            call_ids.add(call.get('id'))
        if m.get('role') == 'tool':
            tool_msgs += 1
            if m.get('tool_call_id') not in call_ids:
                return False
    return tool_msgs == 1 and len(call_ids) == 1


summary = {
    'item': 'lot2-A',
    'provider': 'fixture (deterministic, not a model)',
    'stepsCompleted': [s1, s2, s3],
    'filesAfterLaunch1': files_after_1,
    'finalNewFiles': final_files,
    'sessionId': session_id,
    'sequence': sequence,
    'userTurns': [x for x in sequence if x.startswith('user:')],
    'assistantReplies': [x for x in sequence if x.startswith('assistant:REPLY')],
    'toolCallPersisted': any(m.get('type') in ('tool_call', 'tool_result') and 'view_file' in json.dumps(m) for m in messages),
    'toolResultContentPersisted': any('NOTE-CONTENT-4242' in str(m.get('content', '')) for m in messages if m.get('type') == 'tool_result'),
    'msg3RequestCarriesMsg1And2': carries('MSG-1', 'MSG-3') and carries('MSG-2', 'MSG-3'),
    'msg4RequestCarriesMsg3': carries('MSG-3', 'MSG-4'),
    'resumedToolPairing': resumed_tool_pairing(),
    'witnessUnchanged': hashlib.sha256(open(witness_path, 'rb').read()).hexdigest() == witness_hash,
    'witnessMarkerInRequests': any('WITNESS-MARKER-0000' in json.dumps(r) for r in turns),
    'reloaded': reloaded,
    'blockedExternal': sorted({b for t in transcripts.values() for b in re.findall(r'external (?:network|fetch) blocked \(([^)]*)\)', t)}),
}
ordered = [x for x in sequence if x.split(':')[1]]
summary['orderedMarkers'] = ordered
want_users = ['user:MSG-1', 'user:MSG-2', 'user:MSG-3', 'user:MSG-4']
want_replies = ['assistant:REPLY-1', 'assistant:REPLY-2', 'assistant:REPLY-3', 'assistant:REPLY-4']
summary['pass'] = (
    len(final_files) == 1 and session_id is not None
    and summary['userTurns'] == want_users and summary['assistantReplies'] == want_replies
    and sequence.index('user:MSG-2') < sequence.index('assistant:REPLY-2') and summary['toolCallPersisted']
    and summary['msg3RequestCarriesMsg1And2'] and summary['msg4RequestCarriesMsg3']
    and summary['resumedToolPairing']
    and summary['witnessUnchanged'] and not summary['witnessMarkerInRequests']
    and reloaded.get('count') == len(messages) and len(messages) > 0
    and all('registry.npmjs.org' in b for b in summary['blockedExternal'])
)
with open(os.path.join(BASE, 'summary.json'), 'w', encoding='utf-8') as fh:
    json.dump(summary, fh, indent=2)
print(json.dumps(summary, indent=2))
raise SystemExit(0 if summary['pass'] else 1)

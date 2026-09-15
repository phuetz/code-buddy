#!/usr/bin/env python3
"""P6 recette — real `buddy session resume` (no ID) inside a real pseudo-terminal.

    node scripts/recette-comparatif/run-isolated.mjs p6-recette -- python3 scripts/recette-comparatif/p6-session-resume-pty.py

Creates 3 sessions in the throwaway profile, presses Down then Enter in the picker,
and checks the resumed session, its local recap and the non-TTY behaviour.
Writes summary.json and raw transcripts into $RECETTE_QA_BASE.
"""
import json
import os
import pty
import re
import select
import subprocess
import sys
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE = os.environ['RECETTE_QA_BASE']
SESSIONS = os.environ['CODEBUDDY_SESSIONS_DIR']
os.makedirs(SESSIONS, exist_ok=True)

def session(sid, name, when, messages):
    path = os.path.join(SESSIONS, f'{sid}.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump({'id': sid, 'name': name, 'workingDirectory': BASE, 'model': 'fixture', 'messages': messages,
                   'createdAt': when, 'lastAccessedAt': when}, fh)
    os.chmod(path, 0o600)

session('aaaa1111-remise', 'remise facture', '2026-09-15T10:00:00Z', [
    {'type': 'user', 'content': 'corrige la remise', 'timestamp': '2026-09-15T10:00:00Z'},
    {'type': 'assistant', 'content': 'Remise corrigée.', 'timestamp': '2026-09-15T10:00:02Z'}])
session('bbbb2222-docs', 'documentation', '2026-09-15T09:00:00Z', [
    {'type': 'user', 'content': 'écris la doc du module paiement', 'timestamp': '2026-09-15T09:00:00Z'},
    {'type': 'tool_result', 'content': 'ok', 'timestamp': '2026-09-15T09:00:01Z',
     'toolCall': {'id': '1', 'type': 'function', 'function': {'name': 'view_file', 'arguments': '{"path":"src/paiement.ts"}'}}},
    {'type': 'assistant', 'content': 'DOC-MARKER-7731 : documentation rédigée.', 'timestamp': '2026-09-15T09:00:05Z'}])
session('cccc3333-ci', 'pipeline ci', '2026-09-15T08:00:00Z', [
    {'type': 'user', 'content': 'répare la CI', 'timestamp': '2026-09-15T08:00:00Z'}])

CMD = [sys.executable if False else 'node', os.path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
       os.path.join(REPO, 'src', 'index.ts'), 'session', 'resume']

def run_pty(keys, timeout=120):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(BASE)
        os.execvp(CMD[0], CMD)
    out = b''
    sent = False
    deadline = time.time() + timeout
    status = None
    while time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                chunk = b''
            if not chunk:
                break
            out += chunk
        if not sent and b'Resume a session' in out:
            time.sleep(0.3)
            for key in keys:
                os.write(fd, key)
                time.sleep(0.3)
            sent = True
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            try:
                while True:
                    r, _, _ = select.select([fd], [], [], 0.2)
                    if not r:
                        break
                    chunk = os.read(fd, 4096)
                    if not chunk:
                        break
                    out += chunk
            except OSError:
                pass
            break
    else:
        os.kill(pid, 15)
        _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status) if status is not None else None
    return code, out.decode('utf-8', 'replace'), sent

code, transcript, sent = run_pty([b'\x1b[B', b'\r'])
with open(os.path.join(BASE, 'pty-transcript.txt'), 'w', encoding='utf-8') as fh:
    fh.write(transcript)
plain = re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', transcript)

non_tty = subprocess.run(CMD, cwd=BASE, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
with open(os.path.join(BASE, 'non-tty-stdout.txt'), 'w', encoding='utf-8') as fh:
    fh.write(non_tty.stdout + non_tty.stderr)

summary = {
    'item': 'P6',
    'ptyExit': code,
    'keysSentAfterPicker': sent,
    'resumedSecondSession': 'Resuming session: documentation' in plain,
    'lastMessageShown': 'DOC-MARKER-7731' in plain,
    'recapShown': 'Recap (local, no model call)' in plain and 'Files touched: src/paiement.ts' in plain,
    'nextCommandShown': 'buddy --resume bbbb2222' in plain,
    'nonTtyExit': non_tty.returncode,
    'nonTtyListed': 'remise facture' in non_tty.stdout and 'No interactive terminal' in non_tty.stdout,
    'blockedExternal': len(re.findall(r'external (network|fetch) blocked', transcript + non_tty.stderr)),
}
summary['pass'] = (code == 0 and sent and summary['resumedSecondSession'] and summary['lastMessageShown']
                   and summary['recapShown'] and summary['nonTtyExit'] == 1 and summary['nonTtyListed']
                   and summary['blockedExternal'] == 0)
with open(os.path.join(BASE, 'summary.json'), 'w', encoding='utf-8') as fh:
    json.dump(summary, fh, indent=2)
print(json.dumps(summary, indent=2))
sys.exit(0 if summary['pass'] else 1)

#!/usr/bin/env python3
"""Foreground Linux PTY recipe for the real CLI, with an existing local Ollama model.

Use --before with an unmodified entry point to capture the original failure.
Each run requires a new output directory and an isolated temporary profile.
Install the optional QA dependency in a disposable directory:
  python3 -m pip install --target /tmp/buddy-pty-deps pyte==0.8.2
  PYTHONPATH=/tmp/buddy-pty-deps python3 scripts/verify-cancelled-draft-pty.py ...
"""
import argparse
import datetime
import codecs
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

import pyte

parser = argparse.ArgumentParser()
parser.add_argument('--entry', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--before', action='store_true')
parser.add_argument('--navigation-review', action='store_true')
parser.add_argument('--model', default='qwen3:4b-instruct')
parser.add_argument('--base-url', default='http://127.0.0.1:11434/v1')
args = parser.parse_args()
entry = Path(args.entry).resolve()
out = Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=False)
started = time.monotonic()
records = []
terminal = bytearray()
screen = pyte.Screen(140, 35)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 35, 140, 0, 0))
process = None
cast = (out / 'terminal.cast').open('w')
cast.write(json.dumps({'version': 2, 'width': 140, 'height': 35,
                      'timestamp': int(time.time()), 'title': 'Code Buddy cancelled draft'}) + '\n')
ansi = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)')


def collect(duration=0.4):
    end = time.monotonic() + duration
    while time.monotonic() < end:
        if select.select([master], [], [], 0.03)[0]:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            terminal.extend(data)
            stream.feed(decoder.decode(data))
            cast.write(json.dumps([round(time.monotonic() - started, 3), 'o',
                                   data.decode(errors='replace')], ensure_ascii=False) + '\n')
            cast.flush()


def visible(start=0):
    return ansi.sub('', terminal[start:].decode(errors='replace'))


def send(label, data):
    start = len(terminal)
    records.append({'action': label, 'input': data.decode(errors='replace')})
    os.write(master, data)
    collect()
    text = visible(start)
    (out / (label + '.txt')).write_text(text)
    return text


def check(name, condition):
    records.append({'check': name, 'passed': bool(condition)})
    if not condition:
        raise AssertionError(name)


try:
    with tempfile.TemporaryDirectory(prefix='cb-draft-pty-') as home:
        profile = Path(home) / '.codebuddy'
        profile.mkdir()
        # Cache the version to avoid the CLI's automatic npm update request.
        (profile / 'update-cache.json').write_text(json.dumps({
            'latestVersion': '2.3.0', 'lastCheck': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        env = {'PATH': os.environ['PATH'], 'HOME': home, 'USERPROFILE': home,
               'XDG_CONFIG_HOME': home + '/config', 'XDG_DATA_HOME': home + '/data',
               'TERM': 'xterm-256color', 'GROK_API_KEY': 'synthetic-local-qa',
               'GROK_BASE_URL': args.base_url, 'GROK_MODEL': args.model,
               'CODEBUDDY_PROVIDER': 'ollama', 'CODEBUDDY_MAX_TOKENS': '256',
               'CODEBUDDY_DISABLE_MCP': 'true', 'CODEBUDDY_SENSORY': 'false',
               'CODEBUDDY_TELEMETRY': 'false', 'CODEBUDDY_LEARNING_BACKGROUND_REVIEW': 'false',
               'CODEBUDDY_BACKGROUND_REVIEW': 'false', 'CODEBUDDY_SNAPSHOT_INTERVAL_MIN': '0',
               'CODEBUDDY_SEMANTIC_GATE': 'false'}
        process = subprocess.Popen(['node', '--import', str(entry.parent.parent / 'node_modules/tsx/dist/loader.mjs'), str(entry)], cwd=home, env=env,
                                   stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        deadline = time.monotonic() + 35
        while 'Ready' not in visible() and process.poll() is None and time.monotonic() < deadline:
            collect(0.1)
        check('real_cli_ready', 'Ready' in visible())
        history = 'Réponds uniquement HISTORIQUE_QA sans appeler aucun outil.'
        send('history_type', history.encode())
        submission_start = len(terminal)
        send('history_submit', b'\r')
        deadline = time.monotonic() + 120
        idle_since = None
        frame = ''
        completed = False
        assistant_answer = ''
        while time.monotonic() < deadline and process.poll() is None:
            collect(0.2)
            # Interpret erasures and cursor movement: old Ready frames and streamed
            # tokens in the byte transcript cannot prove the current UI is idle.
            frame = '\n'.join(screen.display)
            idle = ('Enter send' in frame and 'Enter queue' not in frame
                    and 'Generating response' not in frame
                    and re.search(r'Message\s+Ready', frame) is not None)
            answer_match = re.search(r'(?m)^\s*⏺\s+([^\n]+)$', frame)
            assistant_answer = answer_match.group(1).strip() if answer_match else ''
            # Echo compliance is a model behavior, independent of input recovery.
            # Require the completed assistant bubble and usage, not the user prompt.
            answered = bool(assistant_answer and 'Code Buddy' in frame and '[tokens:' in frame)
            if idle and answered:
                idle_since = idle_since or time.monotonic()
                if time.monotonic() - idle_since >= 1.0:
                    completed = True
                    break
            else:
                idle_since = None
        (out / 'model-completed-screen.txt').write_text(frame + '\n')
        (out / 'model-answer.txt').write_text(assistant_answer + '\n')
        (out / 'model-turn.txt').write_text(visible(submission_start))
        check('model_turn_completed_stable_idle_screen', completed)
        check('model_answer_in_completed_screen', answered)
        draft = 'BROUILLON_QA_20261003\n@image-qa.png\nFIN_QA'
        text = send('paste', draft.encode())
        check('multiline_paste_visible', 'BROUILLON_QA_20261003' in text and '@image-qa.png' in text)
        cleared = send('cancel', b'\x03')
        restored = send('restore', b'\x1b[A') if process.poll() is None else ''
        if args.before:
            check('baseline_draft_cannot_be_restored', 'BROUILLON_QA_20261003' not in restored)
        else:
            check('cancel_keeps_cli_alive', process.poll() is None)
            check('cancel_clears_composer', 'Describe a task' in cleared)
            check('up_restores_multiline_paste', 'BROUILLON_QA_20261003' in restored and '@image-qa.png' in restored)
            if args.navigation_review:
                send('noop_down_after_restore', b'\x1b[B')
            normal = send('history_after_restore', b'\x1b[A')
            check('next_up_after_noop_down_uses_history' if args.navigation_review else 'next_up_uses_history', '❯ Réponds uniquement HISTORIQUE_QA' in normal and 'BROUILLON_QA_20261003' not in normal)
            if args.navigation_review:
                returned = send('B2_down_returns_draft', b'\x1b[B')
                check('B2_restored_draft_survives_history_round_trip', 'BROUILLON_QA_20261003' in returned and '@image-qa.png' in returned)
                send('B1_clear', b'\x18')
                send('B1_paste', draft.encode())
                send('B1_cancel', b'\x03')
                send('B1_restore', b'\x1b[A')
                send('B1_cursor_start', b'\x01')
                moved = send('B1_down_moves_cursor', b'\x1b[B')
                check('B1_down_moves_within_multiline_text', '❯ @image-qa.png' in moved and 'BROUILLON_QA_20261003' in moved)
                send('B3_clear', b'\x18')
                send('B3_pending_draft', b'BROUILLON_RECHERCHE_QA')
                send('B3_cancel_draft', b'\x03')
                send('B3_work', b'MON_TRAVAIL_QA')
                send('B3_start_search', b'\x12')
                match = send('B3_query', b'H')
                check('B3_real_history_match_visible', '❯ Réponds uniquement HISTORIQUE_QA' in match)
                original = send('B3_cancel_search', b'\x03')
                check('B3_cancel_restores_original_work', '❯ MON_TRAVAIL_QA' in original and process.poll() is None)
                send('B3_clear_work', b'\x18')
                pending = send('B3_restore_pending', b'\x1b[A')
                check('B3_cancel_did_not_overwrite_pending_draft', '❯ BROUILLON_RECHERCHE_QA' in pending)
                send('B4_clear', b'\x18')
                send('B4_empty_search', b'\x12')
                send('B4_cancel_empty_search', b'\x03')
                check('B4_empty_search_does_not_exit', process.poll() is None)
                send('B4_type_v', b'v')
                typed = send('B4_type_i', b'i')
                check('B4_editor_resumes_after_search_cancel', '❯ vi' in typed)
                send('review_clear', b'\x18')
                send('review_no_second_restore', b'\x1b[A')
            send('clear_history_with_ctrl_u', b'\x15')
            twice = send('no_second_restore', b'\x1b[A')
            check('restoration_consumed', 'BROUILLON_QA_20261003' not in twice)
            # A separate draft verifies actual double Ctrl+C.
            send('clear_again', b'\x15')
            send('double_type', b'DOUBLE_CTRL_C_QA')
            send('double_first', b'\x03')
            check('first_ctrl_c_still_alive', process.poll() is None)
            send('double_second', b'\x03')
        deadline = time.monotonic() + 8
        while process.poll() is None and time.monotonic() < deadline:
            collect(0.1)
        check('ctrl_c_exits_process', process.poll() == 0)
        matches = []
        for file in Path(home).rglob('*'):
            if file.is_file() and any(marker in file.read_bytes() for marker in (b'BROUILLON_QA_20261003', b'BROUILLON_RECHERCHE_QA', b'MON_TRAVAIL_QA')):
                matches.append(str(file.relative_to(home)))
        check('cancelled_draft_not_persisted', not matches)
        records.append({'result': 'passed', 'before': args.before, 'exit_code': process.returncode,
                        'model': args.model, 'base_url': args.base_url, 'tools_requested': False})
except Exception as error:
    records.append({'result': 'failed', 'error': str(error)})
    raise
finally:
    if process is not None and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        records.append({'cleanup': 'process group stopped', 'exit_code': process.returncode})
    collect(0.1)
    cast.close()
    os.close(master)
    (out / 'events.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
    (out / 'terminal.txt').write_text(visible())

#!/usr/bin/env python3
"""P8 recette — `/resources` in the real interactive CLI inside a pseudo-terminal.

    node scripts/recette-comparatif/run-isolated.mjs p8-recette -- python3 scripts/recette-comparatif/p8-resources-pty.py

Seeds a 2-resource catalogue whose endpoints point at a loopback CONTROL server
that counts every request (a read-only view must cause none), starts a
deterministic FIXTURE chat provider (not a model) on loopback, types
`/resources` in the interactive CLI, then checks the empty-catalogue hint and
`buddy resources select` warnings. Writes summary.json and raw transcripts
into $RECETTE_QA_BASE.
"""
import hashlib
import http.server
import json
import os
import pty
import re
import select
import subprocess
import threading
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE = os.environ['RECETTE_QA_BASE']
HOME = os.environ['HOME']
WORKSPACE = os.path.join(BASE, 'workspace')
os.makedirs(WORKSPACE, exist_ok=True)

control_requests = []
chat_requests = []


class Control(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        control_requests.append(self.path)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *args):
        pass


class Fixture(http.server.BaseHTTPRequestHandler):
    def _json(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json({'object': 'list', 'data': [{'id': 'fixture-model', 'object': 'model'}]})

    def do_POST(self):
        length = int(self.headers.get('content-length') or 0)
        chat_requests.append(self.rfile.read(length).decode('utf-8', 'replace'))
        self._json({'id': 'fx', 'object': 'chat.completion', 'model': 'fixture-model',
                    'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': 'FIXTURE-REPLY'}}],
                    'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}})

    def log_message(self, *args):
        pass


def serve(handler):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


control = serve(Control)
fixture = serve(Fixture)
origin = f'http://127.0.0.1:{control.server_address[1]}/'
catalog_dir = os.path.join(HOME, '.codebuddy', 'resources')
os.makedirs(catalog_dir, mode=0o700, exist_ok=True)
old = int((time.time() - 3600) * 1000)
fingerprint = hashlib.sha256(f'{origin}api/health'.encode()).hexdigest()
catalog = {'version': 1, 'entries': [
    {'resource': {'id': 'ragchat-local', 'kind': 'rag', 'hostId': 'host-alpha', 'declaredCapabilities': ['pdf-search'],
                  'endpointRef': 'RAGCHAT_BASE_URL', 'healthPath': '/api/health', 'permissions': {'probe': True, 'use': True},
                  'ttlMs': 60000, 'timeoutMs': 1000},
     'observation': {'state': 'online', 'checkedAt': old, 'lastSeen': old, 'latencyMs': 12,
                     'endpointFingerprint': fingerprint, 'reason': 'HTTP_HEALTH_OK_NOT_USAGE_PROOF'}},
    {'resource': {'id': 'gpu-inference', 'kind': 'inference', 'hostId': 'host-beta', 'declaredCapabilities': ['chat'],
                  'endpointRef': 'GPU_INFER_URL', 'healthPath': '/v1/models', 'permissions': {'probe': False, 'use': True},
                  'ttlMs': 60000, 'timeoutMs': 1000},
     'observation': None},
]}
catalog_path = os.path.join(catalog_dir, 'catalog.json')
with open(catalog_path, 'w', encoding='utf-8') as fh:
    json.dump(catalog, fh)
os.chmod(catalog_path, 0o600)
catalog_bytes = open(catalog_path, 'rb').read()

ENV = dict(os.environ, RAGCHAT_BASE_URL=origin, GPU_INFER_URL=origin, CODEBUDDY_SKIP_ONBOARDING='1')
TSX = [os.path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'), os.path.join(REPO, 'src', 'index.ts')]
MODEL_ARGS = ['-u', f'http://127.0.0.1:{fixture.server_address[1]}/v1', '-k', 'fixture-not-a-secret', '-m', 'fixture-model']
STRIP = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]')


marks = {}


def run_pty(args, typed, ready=re.compile(r'>|❯|Type|message', re.I), wait_after=12, timeout=150):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(WORKSPACE)
        os.execvpe('node', ['node', *TSX, *args], ENV)
    out = b''
    sent = False
    started = time.time()
    sent_at = None
    while time.time() - started < timeout:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            out += chunk
        plain = STRIP.sub('', out.decode('utf-8', 'replace'))
        if not sent and time.time() - started > 8 and ready.search(plain):
            marks['chatBeforeTyping'] = len(chat_requests)
            for ch in typed:
                os.write(fd, ch.encode())
                time.sleep(0.03)
            time.sleep(0.8)
            os.write(fd, b'\r')
            sent = True
            sent_at = time.time()
        if sent and time.time() - sent_at > wait_after:
            break
        done, _ = os.waitpid(pid, os.WNOHANG)
        if done:
            break
    try:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
    except OSError:
        pass
    return out.decode('utf-8', 'replace'), sent


transcript, sent = run_pty(MODEL_ARGS, '/resources')
marks['chatAfterPty'] = len(chat_requests)
with open(os.path.join(BASE, 'fixture-chat-requests.jsonl'), 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(chat_requests))
with open(os.path.join(BASE, 'pty-resources.txt'), 'w', encoding='utf-8') as fh:
    fh.write(transcript)
plain = STRIP.sub('', transcript)

cli = lambda *a: subprocess.run(['node', *TSX, *a], cwd=WORKSPACE, env=ENV, capture_output=True, text=True, timeout=150)
headless = cli(*MODEL_ARGS, '-p', '/resources')
with open(os.path.join(BASE, 'headless-resources.txt'), 'w', encoding='utf-8') as fh:
    fh.write(headless.stdout + headless.stderr)

select_rag = cli('resources', 'select', 'pdf-search', '--kind', 'rag')
with open(os.path.join(BASE, 'select-rag.txt'), 'w', encoding='utf-8') as fh:
    fh.write(select_rag.stdout + select_rag.stderr)

os.rename(catalog_path, catalog_path + '.bak')
empty = cli(*MODEL_ARGS, '-p', '/resources')
os.rename(catalog_path + '.bak', catalog_path)
with open(os.path.join(BASE, 'headless-empty.txt'), 'w', encoding='utf-8') as fh:
    fh.write(empty.stdout + empty.stderr)

read_only_control_requests = len(control_requests)
catalog_unchanged_snapshot = open(catalog_path, 'rb').read() == catalog_bytes

# Criterion 3 with the real CLI: explicit probe, then select on the same / another endpoint reference.
probe_same = cli('resources', 'probe', 'ragchat-local')
select_same = cli('resources', 'select', 'pdf-search', '--kind', 'rag')
other_file = os.path.join(BASE, 'rag-other.json')
with open(other_file, 'w', encoding='utf-8') as fh:
    json.dump({'id': 'rag-other', 'kind': 'rag', 'hostId': 'host-alpha', 'declaredCapabilities': ['pdf-search'],
               'endpointRef': 'OTHER_RAG_URL', 'healthPath': '/api/health', 'permissions': {'probe': True, 'use': True}}, fh)
ENV['OTHER_RAG_URL'] = origin
cli('resources', 'remove', 'ragchat-local')
cli('resources', 'add', other_file)
probe_other = cli('resources', 'probe', 'rag-other')
select_other = cli('resources', 'select', 'pdf-search', '--kind', 'rag')
with open(os.path.join(BASE, 'select-warnings.txt'), 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(r.stdout + r.stderr for r in (probe_same, select_same, probe_other, select_other)))


def parsed(result):
    try:
        return json.loads(result.stdout)
    except ValueError:
        return {}


catalog_unchanged = catalog_unchanged_snapshot
both = plain + '\n' + headless.stdout
summary = {
    'item': 'P8',
    'ptyKeysSent': sent,
    'ptyListsBoth': 'ragchat-local' in plain and 'gpu-inference' in plain,
    'ptyShowsStale': 'stale' in plain,
    'headlessListsBoth': 'ragchat-local' in headless.stdout and 'gpu-inference' in headless.stdout,
    'resolvedUrlShown': origin.rstrip('/') in both,
    'fingerprintShown': fingerprint in both or fingerprint[:16] in both,
    'emptyPointsToAdd': 'buddy resources add' in empty.stdout,
    'controlRequestsDuringReadOnlyViews': read_only_control_requests,
    'fixtureChatRequestsBeforeTyping': marks.get('chatBeforeTyping'),
    'fixtureChatRequestsAfterSlash': marks['chatAfterPty'] - (marks.get('chatBeforeTyping') or 0),
    # Requests carrying a conversation (messages); empty-body POSTs are connection checks, not model turns.
    'fixtureChatTurnsTotal': sum(1 for body in chat_requests if json.loads(body or '{}').get('messages')),
    'fixtureChatRequestsTotal': len(chat_requests),
    'catalogUnchangedByViews': catalog_unchanged,
    'selectSameRefWarning': parsed(select_same).get('warning'),
    'selectOtherRefSelected': (parsed(select_other).get('selected') or {}).get('resource', {}).get('id'),
    'selectOtherRefWarning': parsed(select_other).get('warning'),
    'controlRequestsAfterExplicitProbes': len(control_requests) - read_only_control_requests,
    'blockedExternal': re.findall(r'external (?:network|fetch) blocked \(([^)]*)\)', transcript + headless.stderr + empty.stderr),
}
# The interactive CLI's update notifier tries registry.npmjs.org at startup (pre-existing, blocked by the preload).
unexpected_blocked = [b for b in summary['blockedExternal'] if 'registry.npmjs.org' not in b]
summary['pass'] = (sent and summary['ptyListsBoth'] and summary['ptyShowsStale'] and summary['headlessListsBoth']
                   and not summary['resolvedUrlShown'] and not summary['fingerprintShown'] and summary['emptyPointsToAdd']
                   and summary['controlRequestsDuringReadOnlyViews'] == 0 and summary['fixtureChatRequestsAfterSlash'] == 0 and summary['fixtureChatTurnsTotal'] == 0
                   and summary['catalogUnchangedByViews'] and summary['selectSameRefWarning'] is None
                   and summary['selectOtherRefSelected'] == 'rag-other' and bool(summary['selectOtherRefWarning'])
                   and summary['controlRequestsAfterExplicitProbes'] == 2 and not unexpected_blocked)
with open(os.path.join(BASE, 'summary.json'), 'w', encoding='utf-8') as fh:
    json.dump(summary, fh, indent=2)
print(json.dumps(summary, indent=2))
raise SystemExit(0 if summary['pass'] else 1)

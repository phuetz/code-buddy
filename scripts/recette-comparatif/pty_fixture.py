"""Shared helpers for PTY recettes: a deterministic OpenAI-compatible FIXTURE
provider on 127.0.0.1 (streaming SSE + JSON, not a model) and a pseudo-terminal
driver for the real interactive CLI. Python stdlib only.
"""
import http.server
import json
import os
import pty
import re
import select
import threading
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TSX = [os.path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'), os.path.join(REPO, 'src', 'index.ts')]
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]')


def plain(text):
    return ANSI.sub('', text)


class Fixture:
    """`script(body, index)` returns {'content': str, 'tool_calls': [{'name', 'arguments'}]}."""

    def __init__(self, script, model='fixture-model'):
        self.requests = []
        fixture = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _send(self, code, payload, ctype='application/json'):
                body = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
                self.send_response(code)
                self.send_header('content-type', ctype)
                self.send_header('content-length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                self._send(200, {'object': 'list', 'data': [{'id': model, 'object': 'model', 'context_length': 32768}]})

            def do_POST(self):
                length = int(self.headers.get('content-length') or 0)
                raw = self.rfile.read(length).decode('utf-8', 'replace')
                try:
                    body = json.loads(raw or '{}')
                except ValueError:
                    body = {}
                if not self.path.endswith('/chat/completions'):
                    self._send(404, {'error': {'message': 'fixture: unsupported'}})
                    return
                index = len(fixture.requests)
                fixture.requests.append(body)
                reply = script(body, index) or {'content': 'fixture: done'}
                calls = [{'index': i, 'id': f'fixture_call_{index}_{i}', 'type': 'function',
                          'function': {'name': c['name'], 'arguments': json.dumps(c.get('arguments', {}))}}
                         for i, c in enumerate(reply.get('tool_calls') or [])]
                finish = 'tool_calls' if calls else 'stop'
                usage = {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}
                if body.get('stream'):
                    chunks = []
                    base = {'id': f'fixture-{index}', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': model}
                    if reply.get('content'):
                        chunks.append({**base, 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': reply['content']}, 'finish_reason': None}]})
                    if calls:
                        chunks.append({**base, 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'tool_calls': calls}, 'finish_reason': None}]})
                    chunks.append({**base, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}], 'usage': usage})
                    self._send(200, ''.join(f'data: {json.dumps(c)}\n\n' for c in chunks) + 'data: [DONE]\n\n', 'text/event-stream')
                    return
                message = {'role': 'assistant', 'content': reply.get('content')}
                if calls:
                    message['tool_calls'] = [{k: v for k, v in c.items() if k != 'index'} for c in calls]
                self._send(200, {'id': f'fixture-{index}', 'object': 'chat.completion', 'model': model,
                                 'choices': [{'index': 0, 'message': message, 'finish_reason': finish}], 'usage': usage})

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base_url = f'http://127.0.0.1:{self.server.server_address[1]}/v1'

    def chat_turns(self):
        return [r for r in self.requests if r.get('messages')]

    def close(self):
        self.server.shutdown()


def run_pty(args, steps, cwd, env, timeout=180, settle=1.5):
    """Run the real CLI in a PTY. `steps` is a list of (wait_regex, keys[, min_wait_s]) sent in order;
    `(regex, None)` just waits for that output. A regex of '' matches immediately (use min_wait_s for
    timing while Ink does not redraw). Returns (transcript, completed_steps)."""
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe('node', ['node', *TSX, *args], env)
    out = b''
    done_steps = 0
    started = time.time()
    last_step_at = started
    mark = 0
    try:
        while time.time() - started < timeout and done_steps < len(steps):
            r, _, _ = select.select([fd], [], [], 0.2)
            if r:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                out += chunk
            pattern, keys, *extra = steps[done_steps]
            wait = extra[0] if extra else settle
            text = plain(out[mark:].decode('utf-8', 'replace'))
            if re.search(pattern, text) and time.time() - last_step_at > wait:
                if keys is not None:
                    for key in keys:
                        os.write(fd, key.encode() if isinstance(key, str) else key)
                        time.sleep(0.04)
                done_steps += 1
                last_step_at = time.time()
                mark = len(out)
            if os.waitpid(pid, os.WNOHANG)[0]:
                break
        end = time.time() + 1.0
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.1)
            if not r:
                continue
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            out += chunk
    finally:
        try:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
        except OSError:
            pass
    return out.decode('utf-8', 'replace'), done_steps

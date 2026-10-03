"""Reproduce swallowed authentication failure without OAuth files or network."""
import contextlib
import io
import json
from types import SimpleNamespace

import colab_cli.common as common
from colab_cli.commands.session import sessions_command
from colab_cli.commands.usage import usage


class FailedAuthState(common.State):
    @property
    def client(self):
        raise SystemExit(1)


fake = FailedAuthState()
fake._store = SimpleNamespace(list=lambda: {})
common.state = fake
results = {}
for name, command in [('sessions', sessions_command), ('usage', usage)]:
    stdout, stderr = io.StringIO(), io.StringIO()
    code = 0
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            command()
        except SystemExit as error:
            code = error.code
    results[name] = {'code': code, 'stdout': stdout.getvalue(), 'stderr': stderr.getvalue()}
assert results['sessions']['code'] == 0
assert 'No active sessions found on server.' in results['sessions']['stdout']
assert results['usage']['code'] == 1
print(json.dumps(results, indent=2))

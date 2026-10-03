"""Exercise public Client.assign() and the installed Typer entrypoint offline.

Only the HTTP transport, logging, updater and credential-bearing state are
replaced. All assignment URL construction, GET-to-POST exchange, error handling
and terminal exception rendering use the installed CLI. No OAuth file, network,
background updater or real allocation is accessed.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from http import HTTPStatus
from importlib.metadata import version
from types import SimpleNamespace
from unittest.mock import patch

import requests
from colab_cli.client import Accelerator, Client, ColabRequestError, Prod, Variant, uuid_to_web_safe_base64

NOTEBOOK = uuid.UUID("00000000-0000-0000-0000-000000000001")


class FakeHttp:
    def __init__(self, failing_method, code):
        self.failing_method = failing_method
        self.code = code
        self.calls = []

    def request(self, method, endpoint, **kwargs):
        assert method in ("GET", "POST")
        assert endpoint.startswith("https://colab.research.google.com/tun/m/assign?")
        assert kwargs["params"] == {"authuser": "0"}
        code = self.code if method == self.failing_method else 200
        assert method == self.failing_method or method == "GET"
        if method == "POST":
            assert kwargs["headers"]["X-Goog-Colab-Token"] == "synthetic-xsrf"
        self.calls.append({"method": method, "url": endpoint, "status": code})
        response = requests.Response()
        response.status_code = code
        response.reason = HTTPStatus(code).phrase
        # A valid preflight response makes the real assign() continue to POST.
        response._content = json.dumps({
            "acc": "H100", "nbh": uuid_to_web_safe_base64(NOTEBOOK),
            "token": "synthetic-xsrf", "variant": "GPU",
        }).encode() if code == 200 else b""
        response.request = requests.Request(method, endpoint, **kwargs).prepare()
        return response


def terminal_case(method, code):
    import colab_cli.cli as cli
    import colab_cli.common as common

    transport = FakeHttp(method, code)
    # Both modules have their own reference to the singleton. Neither sees the
    # real state, and setup_logging cannot open ~/.config/colab-cli/colab.log.
    fake = SimpleNamespace(client=Client(Prod(), transport))
    cli.state = common.state = fake
    with patch.object(cli, "setup_logging", lambda *_: None), \
            patch.object(cli.auto_update, "run_background_check", lambda: None), \
            patch("colab_cli.commands.session.uuid.uuid4", return_value=NOTEBOOK):
        sys.argv = ["colab", "--auth", "oauth2", "new", "-s", "offline-proof", "--gpu", "H100"]
        cli.main()


if len(sys.argv) == 4 and sys.argv[1] == "--terminal":
    terminal_case(sys.argv[2], int(sys.argv[3]))
    raise AssertionError("Expected the installed entrypoint to fail")

records = []
for method in ("GET", "POST"):
    for code in (503, 401, 403, 504):
        transport = FakeHttp(method, code)
        try:
            Client(Prod(), transport).assign(NOTEBOOK, variant=Variant.GPU, accelerator=Accelerator.H100)
        except ColabRequestError as error:
            assert transport.calls[-1]["method"] == method
            assert error.response.status_code == code
            records.append({"method": method, "status": code, "message": str(error), "requests": transport.calls})
        else:
            raise AssertionError("Expected assign() to fail")

terminals = []
for method in ("GET", "POST"):
    # A direct interpreter child gives Typer its real sys.excepthook and stderr
    # rendering. subprocess.run waits/reaps it; no launcher grandchild exists.
    for terminal_width in (80, 40):
        for colored in (False, True):
            for code in (503, 401, 403, 504):
                # Do not let the caller silently select the only tested render.
                # The colored case deliberately combines FORCE_COLOR/NO_COLOR,
                # as the environment inherited by invokeColab can do.
                env = {key: value for key, value in os.environ.items()
                       if key not in ("FORCE_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "NO_COLOR", "TTY_COMPATIBLE")}
                env.update({"COLUMNS": str(terminal_width), "NO_COLOR": "1", "TERM": "xterm-256color"})
                if colored:
                    env.update({"FORCE_COLOR": "1", "CLICOLOR": "1", "CLICOLOR_FORCE": "1"})
                with tempfile.TemporaryDirectory(prefix="colab-error-") as isolated_home:
                    env["HOME"] = isolated_home
                    process = subprocess.run([sys.executable, __file__, "--terminal", method, str(code)],
                                             capture_output=True, text=True, timeout=15, env=env)
                assert process.returncode == 1
                assert ("\x1b[" in process.stderr) == colored, (method, code, terminal_width, colored, process.stderr[-1500:])
                plain = re.sub(r"\x1b\[[0-9;]*m", "", process.stderr)
                assert HTTPStatus(code).phrase in " ".join(plain.split())
                terminals.append({"method": method, "columns": terminal_width,
                                  "colored": colored, "status": code,
                                  "code": process.returncode, "stdout": process.stdout,
                                  "stderr": process.stderr})

print(json.dumps({
    "cliVersion": version("google-colab-cli"),
    "source": "Public Client.assign() with fake HTTP; GET failure or valid GET then POST failure; installed Typer main() with isolated HOME/fake state; explicit plain and FORCE_COLOR renders, no logging/updater/OAuth/network",
    "errors": records,
    "terminalErrors": terminals,
}, indent=2))

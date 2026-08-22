"""Appels Claude Code couverts par le forfait, avec limites locales strictes."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any


DEFAULT_MAX_CALLS = 200
DEFAULT_MIN_INTERVAL_SECONDS = 5.0
DEFAULT_TIMEOUT_SECONDS = 600
DEFAULT_LARGE_PROMPT_CHARS = 100_000
QUOTA_MARKERS = (
    "usage limit",
    "rate limit",
    "quota",
    "hit your limit",
    "reached your limit",
    "limit reached",
    "too many requests",
    "resets at",
    "resets in",
)


class ClaudeForfaitError(RuntimeError):
    """Échec de Claude Code après l'unique nouvelle tentative autorisée."""


class ClaudeQuotaError(ClaudeForfaitError):
    """Le quota du forfait Claude est momentanément épuisé."""


class ClaudeCallLimitReached(ClaudeForfaitError):
    """Le plafond local d'appels pour cette exécution est atteint."""


@dataclass(frozen=True)
class ClaudeCallResult:
    content: str
    model: str
    elapsed_seconds: float
    call_number: int


class ClaudeForfaitRunner:
    """Sérialise, espace, compte et journalise les appels ``claude -p``."""

    def __init__(
        self,
        *,
        model: str = "opus",
        max_calls: int = DEFAULT_MAX_CALLS,
        min_interval_seconds: float = DEFAULT_MIN_INTERVAL_SECONDS,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        large_prompt_chars: int = DEFAULT_LARGE_PROMPT_CHARS,
        event_sink: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        if model not in {"opus", "sonnet"}:
            raise ValueError("le modèle Claude doit être opus ou sonnet")
        if max_calls < 1:
            raise ValueError("max_calls doit être >= 1")
        if min_interval_seconds < 0:
            raise ValueError("min_interval_seconds doit être positif")
        if timeout_seconds < 1:
            raise ValueError("timeout_seconds doit être >= 1")
        if large_prompt_chars < 1:
            raise ValueError("large_prompt_chars doit être >= 1")
        self.model = model
        self.max_calls = max_calls
        self.min_interval_seconds = min_interval_seconds
        self.timeout_seconds = timeout_seconds
        self.large_prompt_chars = large_prompt_chars
        self.event_sink = event_sink
        self.calls_started = 0
        self.calls_succeeded = 0
        self.quota_errors = 0
        self._last_started_at: float | None = None
        self._lock = threading.Lock()

    def _emit(self, event: dict[str, Any]) -> None:
        if self.event_sink is not None:
            self.event_sink(event)

    def _reserve_call(self, label: str, attempt: int) -> int:
        if self.calls_started >= self.max_calls:
            self._emit(
                {
                    "event": "claude_forfait_limit_reached",
                    "provider": "claude-forfait",
                    "model": self.model,
                    "label": label,
                    "calls_started": self.calls_started,
                    "max_calls": self.max_calls,
                    "actual_cost_usd": 0.0,
                }
            )
            raise ClaudeCallLimitReached(
                "plafond Claude forfait atteint : "
                f"{self.calls_started}/{self.max_calls} appels"
            )
        now = time.monotonic()
        if self._last_started_at is not None:
            remaining = self.min_interval_seconds - (now - self._last_started_at)
            if remaining > 0:
                time.sleep(remaining)
        self.calls_started += 1
        self._last_started_at = time.monotonic()
        call_number = self.calls_started
        self._emit(
            {
                "event": "claude_forfait_call_started",
                "provider": "claude-forfait",
                "model": self.model,
                "label": label,
                "attempt": attempt,
                "call_number": call_number,
                "max_calls": self.max_calls,
                "actual_cost_usd": 0.0,
            }
        )
        return call_number

    def _invoke(
        self,
        prompt: str,
        label: str,
        attempt: int,
    ) -> ClaudeCallResult:
        call_number = self._reserve_call(label, attempt)
        command = [
            "claude",
            "-p",
            "--model",
            self.model,
            "--output-format",
            "text",
            "--no-session-persistence",
            "--permission-mode",
            "plan",
        ]
        temporary_path: Path | None = None
        input_handle = None
        transport = "argument"
        if len(prompt) >= self.large_prompt_chars:
            descriptor, raw_path = tempfile.mkstemp(
                prefix="claude-forfait-", suffix=".prompt.txt"
            )
            temporary_path = Path(raw_path)
            with open(descriptor, "w", encoding="utf-8", closefd=True) as handle:
                handle.write(prompt)
            input_handle = temporary_path.open("r", encoding="utf-8")
            transport = "temporary_file_stdin"
        else:
            command.append(prompt)
        started = time.monotonic()
        try:
            completed = subprocess.run(
                command,
                stdin=input_handle,
                text=True,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            elapsed = time.monotonic() - started
            self._emit(
                {
                    "event": "claude_forfait_call",
                    "provider": "claude-forfait",
                    "model": self.model,
                    "label": label,
                    "attempt": attempt,
                    "call_number": call_number,
                    "status": "timeout",
                    "timeout_seconds": self.timeout_seconds,
                    "elapsed_seconds": elapsed,
                    "prompt_bytes": len(prompt.encode("utf-8")),
                    "prompt_transport": transport,
                    "actual_cost_usd": 0.0,
                }
            )
            raise ClaudeForfaitError(
                f"timeout Claude forfait après {self.timeout_seconds}s"
            ) from exc
        finally:
            if input_handle is not None:
                input_handle.close()
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
        elapsed = time.monotonic() - started
        combined_error = f"{completed.stderr}\n{completed.stdout}".casefold()
        if completed.returncode != 0 and any(
            marker in combined_error for marker in QUOTA_MARKERS
        ):
            self.quota_errors += 1
            self._emit(
                {
                    "event": "claude_forfait_call",
                    "provider": "claude-forfait",
                    "model": self.model,
                    "label": label,
                    "attempt": attempt,
                    "call_number": call_number,
                    "status": "quota_exhausted",
                    "returncode": completed.returncode,
                    "elapsed_seconds": elapsed,
                    "prompt_bytes": len(prompt.encode("utf-8")),
                    "prompt_transport": transport,
                    "error_tail": combined_error[-800:],
                    "actual_cost_usd": 0.0,
                }
            )
            raise ClaudeQuotaError("quota du forfait Claude atteint")
        content = completed.stdout.strip()
        if completed.returncode != 0 or not content:
            error = (completed.stderr or completed.stdout or "réponse vide").strip()
            self._emit(
                {
                    "event": "claude_forfait_call",
                    "provider": "claude-forfait",
                    "model": self.model,
                    "label": label,
                    "attempt": attempt,
                    "call_number": call_number,
                    "status": "error",
                    "returncode": completed.returncode,
                    "elapsed_seconds": elapsed,
                    "prompt_bytes": len(prompt.encode("utf-8")),
                    "prompt_transport": transport,
                    "error_tail": error[-800:],
                    "actual_cost_usd": 0.0,
                }
            )
            raise ClaudeForfaitError(
                f"échec claude -p ({completed.returncode}) : {error[-400:]}"
            )
        self.calls_succeeded += 1
        self._emit(
            {
                "event": "claude_forfait_call",
                "provider": "claude-forfait",
                "model": self.model,
                "label": label,
                "attempt": attempt,
                "call_number": call_number,
                "status": "completed",
                "returncode": completed.returncode,
                "elapsed_seconds": elapsed,
                "prompt_bytes": len(prompt.encode("utf-8")),
                "prompt_transport": transport,
                "actual_cost_usd": 0.0,
            }
        )
        return ClaudeCallResult(content, self.model, elapsed, call_number)

    def run(self, prompt: str, *, label: str) -> ClaudeCallResult:
        """Exécute un appel, puis une seule nouvelle tentative hors quota."""
        with self._lock:
            last_error: ClaudeForfaitError | None = None
            for attempt in (1, 2):
                try:
                    return self._invoke(prompt, label, attempt)
                except (ClaudeQuotaError, ClaudeCallLimitReached):
                    raise
                except ClaudeForfaitError as exc:
                    last_error = exc
            assert last_error is not None
            raise last_error

    def snapshot(self) -> dict[str, Any]:
        return {
            "provider": "claude-forfait",
            "model": self.model,
            "calls_started": self.calls_started,
            "calls_succeeded": self.calls_succeeded,
            "quota_errors": self.quota_errors,
            "max_calls": self.max_calls,
            "min_interval_seconds": self.min_interval_seconds,
            "timeout_seconds": self.timeout_seconds,
            "actual_cost_usd": 0.0,
        }

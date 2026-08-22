"""Connecteur sans réseau réservé aux tests et démonstrations locales."""

from __future__ import annotations

import hashlib

from publish_queue import QueueEntry
from .base import (
    PermanentPublishError,
    PublishResult,
    ensure_entry_publishable,
)


class SimulatedPublisher:
    def __init__(self, platform: str, *, fail_once: bool = False) -> None:
        self.platform = platform
        self.fail_once = fail_once
        self.calls = 0

    def publish(self, entry: QueueEntry, *, checkpoint=None) -> PublishResult:
        ensure_entry_publishable(entry, self.platform)
        self.calls += 1
        if self.fail_once and self.calls == 1:
            from .base import RetryablePublishError

            raise RetryablePublishError('panne simulée')
        identifier = 'simulation-' + hashlib.sha256(
            f'{entry.id}:{self.platform}'.encode('utf-8')
        ).hexdigest()[:16]
        if checkpoint:
            checkpoint({'simulation': True}, identifier)
        return PublishResult(
            external_id=identifier,
            external_url=f'https://example.invalid/{identifier}',
        )

    def check_status(self, entry: QueueEntry) -> PublishResult:
        if not entry.external_id:
            raise PermanentPublishError('identifiant simulé absent')
        return PublishResult(entry.external_id)

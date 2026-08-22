#!/usr/bin/env python3
"""Planificateur prudent, reprenable et idempotent de la file approuvée."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import time
from typing import Callable, Protocol

from publish_queue import (
    DEFAULT_AUDIT_LOG,
    DEFAULT_DATABASE,
    PublicationQueue,
    QueueEntry,
)
from publishers.base import (
    BasePublisher,
    LivePublishingDisabled,
    MissingCredentials,
    PublishError,
    PublishResult,
)
from publishers.instagram import InstagramPublisher
from publishers.tiktok import TikTokPublisher
from publishers.youtube import YouTubePublisher


DEFAULT_SPACING = timedelta(hours=3)


class Publisher(Protocol):
    def publish(self, entry: QueueEntry, *, checkpoint=None) -> PublishResult:
        ...

    def check_status(self, entry: QueueEntry) -> PublishResult:
        ...


PublisherFactory = Callable[[str], Publisher]


def retry_delay(entry: QueueEntry, error: PublishError) -> timedelta | None:
    if error.retry_after:
        return error.retry_after
    if isinstance(error, (MissingCredentials, LivePublishingDisabled)):
        return timedelta(hours=1)
    if error.retryable:
        exponent = min(entry.attempt_count, 6)
        return timedelta(minutes=min(15 * (2 ** exponent), 360))
    return None


def platform_is_spaced(
    queue: PublicationQueue,
    entry: QueueEntry,
    now: datetime,
    spacing: timedelta,
) -> bool:
    previous = queue.latest_platform_attempt(entry.platform)
    return previous is None or now - previous >= spacing


def run_once(
    queue: PublicationQueue,
    publisher_factory: PublisherFactory,
    *,
    now: datetime | None = None,
    spacing: timedelta = DEFAULT_SPACING,
    limit: int = 10,
) -> dict[str, int]:
    instant = now or datetime.now(timezone.utc)
    summary = {
        'repris': queue.revive_due_failures(instant),
        'publiés': 0,
        'programmés': 0,
        'échecs': 0,
        'espacés': 0,
        'en_traitement': 0,
    }

    # Les plateformes asynchrones sont uniquement interrogées ici. La création
    # distante qui déclenche une publication n'a eu lieu qu'à l'état approuvé.
    for entry in queue.list(['programmé'], limit=limit):
        try:
            result = publisher_factory(entry.platform).check_status(entry)
            if result.processing:
                summary['en_traitement'] += 1
            else:
                queue.mark_published(
                    entry.id,
                    external_id=result.external_id,
                    external_url=result.external_url,
                    actor=f'connecteur-{entry.platform}',
                )
                summary['publiés'] += 1
        except PublishError as error:
            queue.mark_failed(
                entry.id,
                error=str(error),
                actor=f'connecteur-{entry.platform}',
                retry_after=retry_delay(entry, error),
                now=instant,
            )
            summary['échecs'] += 1

    for claimed in queue.claim_due(now=instant, limit=limit):
        entry = queue.get(claimed.id)
        if not platform_is_spaced(queue, entry, instant, spacing):
            queue.release_claim(entry.id)
            summary['espacés'] += 1
            continue
        try:
            entry = queue.record_attempt(
                entry.id,
                actor=f'planificateur-{entry.platform}',
                now=instant,
            )

            def checkpoint(
                state: dict,
                external_id: str | None,
                *,
                identifier: str = entry.id,
                platform: str = entry.platform,
            ) -> None:
                queue.checkpoint_remote(
                    identifier,
                    remote_state=state,
                    external_id=external_id,
                    actor=f'connecteur-{platform}',
                )

            result = publisher_factory(entry.platform).publish(
                queue.get(entry.id),
                checkpoint=checkpoint,
            )
            if result.remote_state:
                checkpoint(result.remote_state, result.external_id)
            if result.processing:
                queue.mark_scheduled(
                    entry.id,
                    external_id=result.external_id,
                    actor=f'connecteur-{entry.platform}',
                )
                summary['programmés'] += 1
            else:
                queue.mark_published(
                    entry.id,
                    external_id=result.external_id,
                    external_url=result.external_url,
                    actor=f'connecteur-{entry.platform}',
                )
                summary['publiés'] += 1
        except PublishError as error:
            current = queue.get(entry.id)
            queue.mark_failed(
                entry.id,
                error=str(error),
                actor=f'connecteur-{entry.platform}',
                retry_after=retry_delay(current, error),
                now=instant,
            )
            summary['échecs'] += 1
        except Exception as error:
            # Une erreur locale imprévue est reprise elle aussi. Le point de
            # reprise distant empêche un second envoi si l'API avait répondu.
            queue.mark_failed(
                entry.id,
                error=f'erreur locale inattendue : {error}',
                actor=f'connecteur-{entry.platform}',
                retry_after=timedelta(minutes=30),
                now=instant,
            )
            summary['échecs'] += 1
    return summary


def real_factory(allow_real: bool) -> PublisherFactory:
    classes: dict[str, type[BasePublisher]] = {
        'youtube': YouTubePublisher,
        'tiktok': TikTokPublisher,
        'instagram': InstagramPublisher,
    }

    def create(platform: str) -> BasePublisher:
        return classes[platform](allow_real=allow_real)

    return create


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=DEFAULT_DATABASE)
    parser.add_argument('--journal', type=Path, default=DEFAULT_AUDIT_LOG)
    parser.add_argument(
        '--intervalle',
        type=int,
        default=60,
        help='secondes entre deux passages (défaut : 60)',
    )
    parser.add_argument(
        '--espacement-minutes',
        type=int,
        default=180,
        help='minimum par plateforme (défaut prudent : 180 min)',
    )
    parser.add_argument('--une-fois', action='store_true')
    parser.add_argument(
        '--autoriser-envoi-reel',
        action='store_true',
        help='première moitié de la double garde ; voir INFLUENCER_REAL_PUBLISH',
    )
    args = parser.parse_args(argv)
    if args.intervalle < 10 or args.espacement_minutes < 1:
        parser.error('--intervalle >= 10 et --espacement-minutes >= 1 requis')
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    queue = PublicationQueue(args.base, args.journal)
    factory = real_factory(args.autoriser_envoi_reel)
    spacing = timedelta(minutes=args.espacement_minutes)
    while True:
        summary = run_once(queue, factory, spacing=spacing)
        print(
            ' — '.join(f'{key}: {value}' for key, value in summary.items()),
            flush=True,
        )
        if args.une_fois:
            return 0 if summary['échecs'] == 0 else 2
        time.sleep(args.intervalle)


if __name__ == '__main__':
    raise SystemExit(main())

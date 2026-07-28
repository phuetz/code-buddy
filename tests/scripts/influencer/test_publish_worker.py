"""Tests du planificateur, de la reprise et de l'idempotence."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT_DIR = (
    Path(__file__).resolve().parents[3] / 'scripts' / 'influencer'
)
sys.path.insert(0, str(SCRIPT_DIR))

from publish_queue import PublicationQueue  # noqa: E402
from publish_worker import run_once  # noqa: E402
from publishers.simulated import SimulatedPublisher  # noqa: E402


class PublishWorkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.video = root / 'video.mp4'
        self.video.write_bytes(b'video')
        self.thumbnail = root / 'thumb.jpg'
        self.thumbnail.write_bytes(b'image')
        self.queue = PublicationQueue(
            root / 'file.sqlite3',
            root / 'journal.jsonl',
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def approved_entry(self, now: datetime):
        entry = self.queue.add(
            video_file=self.video,
            platform='youtube',
            title='Une nouveauté IA locale',
            description='Une description sourcée.',
            keywords=['IA'],
            thumbnail=self.thumbnail,
            scheduled_for=now - timedelta(minutes=1),
            source_attributions=['source : example.test — 28/07/2026'],
            subject='Une nouveauté IA locale',
            persona='Lisa',
            status='à_valider',
        )
        return self.queue.approve(entry.id, approver='Patrice')

    def test_retry_after_failure_then_publish_exactly_once(self) -> None:
        now = datetime(2026, 7, 28, 12, tzinfo=timezone.utc)
        entry = self.approved_entry(now)
        publisher = SimulatedPublisher('youtube', fail_once=True)
        factory = lambda _platform: publisher

        first = run_once(
            self.queue,
            factory,
            now=now,
            spacing=timedelta(0),
        )
        failed = self.queue.get(entry.id)
        self.assertEqual(first['échecs'], 1)
        self.assertEqual(failed.status, 'échec')
        self.assertIsNotNone(failed.retry_at)

        second = run_once(
            self.queue,
            factory,
            now=now + timedelta(hours=2),
            spacing=timedelta(0),
        )
        published = self.queue.get(entry.id)
        self.assertEqual(second['repris'], 1)
        self.assertEqual(second['publiés'], 1)
        self.assertEqual(published.status, 'publié')
        self.assertEqual(publisher.calls, 2)

        third = run_once(
            self.queue,
            factory,
            now=now + timedelta(hours=3),
            spacing=timedelta(0),
        )
        self.assertEqual(third['publiés'], 0)
        self.assertEqual(publisher.calls, 2)

    def test_default_spacing_prevents_two_same_platform_attempts(self) -> None:
        now = datetime(2026, 7, 28, 12, tzinfo=timezone.utc)
        first = self.approved_entry(now)
        other = Path(self.temporary.name) / 'other.mp4'
        other.write_bytes(b'other')
        second = self.queue.add(
            video_file=other,
            platform='youtube',
            title='Deuxième nouveauté',
            description='Deuxième description sourcée.',
            keywords=['IA'],
            thumbnail=self.thumbnail,
            scheduled_for=now - timedelta(minutes=1),
            source_attributions=['source : example.test — 28/07/2026'],
            subject='Deuxième nouveauté IA',
            persona='Lisa',
            status='à_valider',
        )
        self.queue.approve(second.id, approver='Patrice')
        publisher = SimulatedPublisher('youtube')

        summary = run_once(
            self.queue,
            lambda _platform: publisher,
            now=now,
            spacing=timedelta(hours=3),
        )

        self.assertEqual(summary['publiés'], 1)
        self.assertEqual(summary['espacés'], 1)
        self.assertEqual(publisher.calls, 1)
        states = {entry.id: entry.status for entry in self.queue.list()}
        self.assertEqual(states[first.id], 'publié')
        self.assertEqual(states[second.id], 'approuvé')


if __name__ == '__main__':
    unittest.main()

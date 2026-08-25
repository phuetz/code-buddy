"""Tests de la file de publication et du verrou humain."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import os
import unittest
from unittest import mock


SCRIPT_DIR = (
    Path(__file__).resolve().parents[3] / 'scripts' / 'influencer'
)
sys.path.insert(0, str(SCRIPT_DIR))

from publish_queue import (  # noqa: E402
    DuplicateEntryError,
    EditorialPolicyError,
    InvalidTransitionError,
    PublicationQueue,
)
from publishers.base import MissingCredentials, PermanentPublishError  # noqa: E402
from publishers.simulated import SimulatedPublisher  # noqa: E402
from publishers.youtube import YouTubePublisher  # noqa: E402


class QueueFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.video = self.root / 'video.mp4'
        self.video.write_bytes(b'fausse-video-pour-test')
        self.thumbnail = self.root / 'miniature.jpg'
        self.thumbnail.write_bytes(b'fausse-image-pour-test')
        self.queue = PublicationQueue(
            self.root / 'file.sqlite3',
            self.root / 'journal.jsonl',
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def add(self, **overrides):
        values = {
            'video_file': self.video,
            'platform': 'youtube',
            'title': 'Un outil IA local utile',
            'description': 'Démonstration avec des sources officielles.',
            'keywords': ['IA', 'local'],
            'thumbnail': self.thumbnail,
            'scheduled_for': datetime.now(timezone.utc) - timedelta(minutes=1),
            'source_attributions': [
                {
                    'attribution': 'source : example.test — 28/07/2026',
                    'source_url': 'https://example.test',
                }
            ],
            'subject': 'Un outil IA local',
            'persona': 'Lisa',
        }
        values.update(overrides)
        return self.queue.add(**values)


class PublicationQueueTest(QueueFixture):
    def test_required_state_transitions_and_named_approval(self) -> None:
        entry = self.add()
        self.assertEqual(entry.status, 'brouillon')

        entry = self.queue.submit_for_review(entry.id)
        self.assertEqual(entry.status, 'à_valider')
        with self.assertRaises(InvalidTransitionError):
            self.queue.transition(
                entry.id,
                'approuvé',
                actor='automate',
            )

        entry = self.queue.approve(entry.id, approver='Patrice')
        self.assertEqual(entry.status, 'approuvé')
        self.assertEqual(entry.approved_by, 'Patrice')
        self.assertIsNotNone(entry.approved_at)

        entry = self.queue.mark_published(
            entry.id,
            external_id='yt-123',
            external_url='https://youtu.be/yt-123',
            actor='connecteur-youtube',
        )
        self.assertEqual(entry.status, 'publié')
        self.assertEqual(entry.external_id, 'yt-123')
        events = self.queue.audit_events(entry.id)
        self.assertEqual(
            [event['event'] for event in events],
            [
                'entrée_créée',
                'état_modifié',
                'lot_approuvé',
                'publication_confirmée',
            ],
        )

    def test_excluded_subject_is_refused_and_logged_before_queue(self) -> None:
        # La liste des sujets écartés est PRIVÉE : elle vit dans l'environnement, jamais
        # dans ce dépôt public. Le test pose donc la sienne — sans quoi il passerait
        # sur la machine de Patrice et échouerait partout ailleurs.
        patch = mock.patch.dict(os.environ, {'INFLUENCER_EXCLUDED_TOPICS': 'organisme temoin'})
        patch.start()
        self.addCleanup(patch.stop)
        with self.assertRaises(EditorialPolicyError):
            self.add(
                subject='Organisme témoin teste un algorithme',
                title='Organisme témoin automatise un contrôle',
            )

        self.assertEqual(self.queue.list(), [])
        events = self.queue.audit_events()
        self.assertEqual(events[-1]['event'], 'sujet_refusé')
        self.assertIn('Organisme témoin', events[-1]['details']['subject'])
        self.assertTrue((self.root / 'journal.jsonl').read_text())

    def test_same_video_is_unique_per_platform(self) -> None:
        self.add()
        with self.assertRaises(DuplicateEntryError):
            self.add(title='Un autre titre')

        instagram = self.add(platform='instagram')
        self.assertEqual(instagram.platform, 'instagram')

    def test_batch_decisions_are_atomic_and_audited(self) -> None:
        first = self.add(status='à_valider')
        second_video = self.root / 'autre.mp4'
        second_video.write_bytes(b'autre-video')
        second = self.add(
            video_file=second_video,
            platform='tiktok',
            status='à_valider',
        )
        decisions = self.queue.apply_review_decisions(
            [first.id, second.id],
            [first.id],
            approver='Patrice',
        )

        self.assertEqual(decisions[first.id], 'approuvé')
        self.assertEqual(decisions[second.id], 'rejeté')
        self.assertEqual(self.queue.get(first.id).approved_by, 'Patrice')

    def test_publisher_refuses_every_non_approved_state(self) -> None:
        entry = self.add(status='à_valider')
        publisher = SimulatedPublisher('youtube')

        with self.assertRaisesRegex(PermanentPublishError, 'approuvé'):
            publisher.publish(entry)
        self.assertEqual(publisher.calls, 0)

    def test_missing_tokens_fails_cleanly_without_losing_entry(self) -> None:
        entry = self.add(status='à_valider')
        entry = self.queue.approve(entry.id, approver='Patrice')
        missing = self.root / 'oauth-absent.json'
        publisher = YouTubePublisher(
            credentials_path=missing,
            allow_real=True,
        )

        with self.assertRaises(MissingCredentials):
            publisher.publish(entry)
        self.assertEqual(self.queue.get(entry.id).status, 'approuvé')
        self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()

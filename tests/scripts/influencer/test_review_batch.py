"""Tests de la planche de revue locale."""

from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT_DIR = (
    Path(__file__).resolve().parents[3] / 'scripts' / 'influencer'
)
sys.path.insert(0, str(SCRIPT_DIR))

from publish_queue import PublicationQueue  # noqa: E402
from review_batch import ReviewAsset, render_html  # noqa: E402


class ReviewBatchTest(unittest.TestCase):
    def test_html_contains_every_fast_review_field_and_local_form(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / 'video.mp4'
            video.write_bytes(b'video')
            thumbnail = root / 'thumb.jpg'
            thumbnail.write_bytes(b'image')
            queue = PublicationQueue(
                root / 'queue.sqlite3',
                root / 'audit.jsonl',
            )
            entry = queue.add(
                video_file=video,
                platform='tiktok',
                title='Le titre à vérifier',
                description='Première ligne.\nDeuxième ligne.\nTroisième ligne.',
                keywords=['IA'],
                thumbnail=thumbnail,
                scheduled_for=datetime.now(timezone.utc),
                source_attributions=['source : exemple'],
                subject='Un sujet IA sans conflit',
                persona='Ambre',
                status='à_valider',
            )
            html = render_html(
                [ReviewAsset(entry, root / 'clip.mp4')],
                csrf_token='secret-local',
                approver='Patrice',
            )

        self.assertIn('Le titre à vérifier', html)
        self.assertIn('Première ligne.', html)
        self.assertIn('Deuxième ligne.', html)
        self.assertNotIn('Troisième ligne.', html)
        self.assertIn('TIKTOK', html)
        self.assertIn('name="approved"', html)
        self.assertIn('action="/decisions"', html)
        self.assertIn('secret-local', html)
        self.assertIn('ENREGISTRER LE LOT', html)


if __name__ == '__main__':
    unittest.main()

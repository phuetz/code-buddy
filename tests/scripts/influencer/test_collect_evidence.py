"""Tests ciblés du collecteur de preuves visuelles de Lisa."""

import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'collect-evidence.py'
)
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location('collect_evidence', SCRIPT)
assert SPEC and SPEC.loader
collect_evidence = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = collect_evidence
SPEC.loader.exec_module(collect_evidence)


class CollectEvidenceTest(unittest.TestCase):
    def test_split_dimensions_are_read_from_wrap_short(self) -> None:
        self.assertEqual(
            collect_evidence.split_dimensions(),
            (1080, 960),
        )

    def test_thirdparty_is_refused_without_named_consent(self) -> None:
        with self.assertRaisesRegex(
            collect_evidence.EvidenceError,
            '--consent-obtenu',
        ):
            collect_evidence.validate_legal_category(
                'thirdparty',
                'https://youtube.com/watch?v=example',
                None,
            )

        collect_evidence.validate_legal_category(
            'thirdparty',
            'https://creator.example/video',
            'Camille Martin, accord écrit du 28/07/2026 par courriel',
        )

    def test_press_agency_assets_are_always_refused(self) -> None:
        with self.assertRaisesRegex(
            collect_evidence.EvidenceError,
            'agence',
        ):
            collect_evidence.validate_legal_category(
                'press',
                'https://media.gettyimages.com/photo/example.jpg',
                None,
            )

    def test_snap_uses_visible_home_staging_for_forbidden_destination(
        self,
    ) -> None:
        home = Path('/home/lisa')
        for destination in (
            Path('/tmp/preuves'),
            home / '.codebuddy' / 'preuves',
        ):
            with self.subTest(destination=destination):
                staging = collect_evidence.visible_staging_root(
                    '/snap/bin/chromium',
                    destination,
                    home,
                )
                self.assertEqual(
                    staging,
                    home / 'Documents' / 'codebuddy-preuves-chromium',
                )
                self.assertFalse(
                    any(part.startswith('.') for part in staging.parts)
                )

    def test_own_capture_produces_split_metadata_and_daily_cache(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'test-patrice.png'
            output = root / 'sortie'
            Image.new('RGB', (1400, 900), '#2463eb').save(source)
            cache = output / 'cache-index.json'
            log = output / 'journal.jsonl'

            first = collect_evidence.collect_one(
                source=str(source),
                category='own',
                output_dir=output,
                cache_path=cache,
                log_path=log,
                chromium=None,
                wait_seconds=0,
            )
            full = Path(first['files']['full'])
            split = Path(first['files']['split'])
            first_mtime = full.stat().st_mtime_ns
            second = collect_evidence.collect_one(
                source=str(source),
                category='own',
                output_dir=output,
                cache_path=cache,
                log_path=log,
                chromium=None,
                wait_seconds=0,
            )

            self.assertEqual(first, second)
            self.assertEqual(full.stat().st_mtime_ns, first_mtime)
            with Image.open(full) as full_image:
                self.assertEqual(full_image.size, (1400, 900))
            with Image.open(split) as split_image:
                self.assertEqual(
                    split_image.size,
                    (
                        collect_evidence.SPLIT_WIDTH,
                        collect_evidence.SPLIT_HEIGHT,
                    ),
                )
            self.assertEqual(first['legal_category'], 'own')
            self.assertEqual(
                first['dimensions']['full_viewport'],
                {'width': 1400, 'height': 900},
            )
            self.assertIn('capture Patrice', first['attribution'])

    def test_thirdparty_consent_is_written_to_metadata_and_journal(self) -> None:
        from PIL import Image

        consent = 'Camille Martin, 28/07/2026, accord écrit par courriel'
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            session = root / 'session'
            output = root / 'sortie'
            session.mkdir()
            screenshot = session / 'capture.png'
            Image.new('RGB', (1200, 850), '#111827').save(screenshot)
            capture = collect_evidence.BrowserCapture(
                screenshot,
                'Extrait autorisé',
                'https://creator.example/extrait',
                0,
            )
            with mock.patch.object(
                collect_evidence,
                'capture_web_page',
                return_value=capture,
            ):
                metadata = collect_evidence.collect_one(
                    source='https://creator.example/extrait',
                    category='thirdparty',
                    output_dir=output,
                    cache_path=output / 'cache.json',
                    log_path=output / 'journal.jsonl',
                    chromium='/snap/bin/chromium',
                    wait_seconds=0,
                    consent=consent,
                )

            self.assertEqual(metadata['consent_obtenu'], consent)
            self.assertIn(
                consent,
                (output / 'journal.jsonl').read_text(encoding='utf-8'),
            )

    def test_dead_url_is_reported_without_creating_capture(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            with mock.patch.object(
                collect_evidence,
                'capture_web_page',
                side_effect=collect_evidence.EvidenceError(
                    'source injoignable : https://example.invalid'
                ),
            ):
                with self.assertRaisesRegex(
                    collect_evidence.EvidenceError,
                    'source injoignable',
                ):
                    collect_evidence.collect_one(
                        source='https://example.invalid',
                        category='press',
                        output_dir=output,
                        cache_path=output / 'cache.json',
                        log_path=output / 'journal.jsonl',
                        chromium='/snap/bin/chromium',
                        wait_seconds=0,
                    )
            self.assertEqual(list(output.glob('*-full.png')), [])

    def test_batch_continues_after_one_unreachable_source(self) -> None:
        candidates = [
            collect_evidence.Candidate(
                'https://dead.example/preuve',
                'press',
                10,
            ),
            collect_evidence.Candidate(
                'https://openai.com/news/',
                'official',
                9,
            ),
        ]
        with tempfile.TemporaryDirectory() as temporary:
            with (
                mock.patch.object(
                    collect_evidence,
                    'discover_candidates',
                    return_value=candidates,
                ),
                mock.patch.object(
                    collect_evidence,
                    'collect_one',
                    side_effect=[
                        collect_evidence.EvidenceError('source injoignable'),
                        {'files': {}},
                    ],
                ),
            ):
                status = collect_evidence.run(
                    [
                        '--sujet',
                        'OpenAI annonce un modèle',
                        '--output-dir',
                        temporary,
                        '--delai',
                        '0',
                        '--max-preuves',
                        '3',
                    ]
                )

        self.assertEqual(status, 0)

    def test_subject_discovery_prefers_matching_official_actor(self) -> None:
        registry = collect_evidence.load_registry()
        candidates = collect_evidence.actor_candidates(
            'Claude Opus 5',
            registry,
        )

        self.assertTrue(candidates)
        self.assertEqual(candidates[0].actor, 'Anthropic')
        self.assertEqual(candidates[0].category, 'official')

    def test_editorial_exclusions_apply_to_subject_mode(self) -> None:
        # La liste des sujets écartés est PRIVÉE : elle vit dans l'environnement, jamais
        # dans ce dépôt public. Le test pose donc la sienne — sans quoi il passerait
        # sur la machine de Patrice et échouerait partout ailleurs.
        patch = mock.patch.dict(os.environ, {'INFLUENCER_EXCLUDED_TOPICS': 'organisme temoin'})
        patch.start()
        self.addCleanup(patch.stop)
        excluded = collect_evidence.find_excluded_topic(
            'Organisme témoin lance une nouvelle IA'
        )

        self.assertIsNotNone(excluded)


@unittest.skipUnless(
    os.environ.get('RUN_REAL_EVIDENCE_TESTS') == '1'
    and shutil.which('chromium'),
    'test réseau réel : RUN_REAL_EVIDENCE_TESTS=1 requis',
)
class RealPublicEvidenceTest(unittest.TestCase):
    def test_google_and_openai_public_pages(self) -> None:
        from PIL import Image

        documents = Path('~/Documents').expanduser()
        documents.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix='preuves-reelles-',
            dir=documents,
        ) as temporary:
            output = Path(temporary)
            for url in (
                'https://blog.google/technology/ai/',
                'https://openai.com/news/',
            ):
                with self.subTest(url=url):
                    metadata = collect_evidence.collect_one(
                        source=url,
                        category='official',
                        output_dir=output,
                        cache_path=output / 'cache-index.json',
                        log_path=output / 'journal.jsonl',
                        chromium=None,
                        wait_seconds=3,
                    )
                    self.assertTrue(Path(metadata['files']['metadata']).exists())
                    with Image.open(metadata['files']['full']) as full_image:
                        self.assertEqual(
                            full_image.size,
                            (
                                collect_evidence.FULL_WIDTH,
                                collect_evidence.FULL_HEIGHT,
                            ),
                        )
                    with Image.open(metadata['files']['split']) as split_image:
                        self.assertEqual(
                            split_image.size,
                            (
                                collect_evidence.SPLIT_WIDTH,
                                collect_evidence.SPLIT_HEIGHT,
                            ),
                        )
                    self.assertIn('source :', metadata['attribution'])
                    if 'blog.google' in url:
                        self.assertGreaterEqual(
                            metadata['cookie_elements_hidden'],
                            1,
                        )


if __name__ == '__main__':
    unittest.main()

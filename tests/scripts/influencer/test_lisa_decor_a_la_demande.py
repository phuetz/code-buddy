"""Tests ciblés du pipeline de décors à la demande de Lisa."""

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'lisa-decor-a-la-demande.py'
)
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location('lisa_decor_a_la_demande', SCRIPT)
assert SPEC and SPEC.loader
decor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = decor
SPEC.loader.exec_module(decor)


class LisaDecorALaDemandeTest(unittest.TestCase):
    def test_editorial_guard_refuses_false_presence(self) -> None:
        forbidden = (
            'En direct de Paris',
            'Lisa est sur place',
            "J'étais au salon",
            'Nous étions avec les exposants',
            'Elle a rencontré le fondateur',
            "J'ai constaté cette panne",
        )
        for title in forbidden:
            with self.subTest(title=title):
                with self.assertRaisesRegex(decor.DecorError, 'faux vécu'):
                    decor.validate_editorial_copy(
                        title,
                        'Une description factuelle.',
                        'Paris',
                    )

    def test_editorial_guard_adds_virtual_creator_disclosure(self) -> None:
        copy = decor.validate_editorial_copy(
            'Lisa décrypte le salon de Paris',
            'Les annonces à retenir.',
            'Paris',
        )
        self.assertEqual(
            copy.description,
            (
                'Les annonces à retenir. '
                'Lisa est une créatrice virtuelle.'
            ),
        )

    def test_prompt_locks_identity_and_rejects_live_claim(self) -> None:
        prompt = decor.build_prompt(
            'Paris, salon technologique',
            'blazer velours sapin',
            'matin',
            1,
            2,
        )
        self.assertIn('identity-preserve', prompt)
        self.assertIn('identité strictement conservée', prompt)
        self.assertIn('Seconde tentative', prompt)
        self.assertIn('ne constitue jamais une preuve', prompt)

    def test_image_api_credentials_are_scrubbed(self) -> None:
        with mock.patch.dict(
            decor.os.environ,
            {
                'OPENAI_API_KEY': 'secret-openai',
                'XAI_API_KEY': 'secret-xai',
                'CODEBUDDY_IMAGE_API_KEY': 'secret-image',
                'SAFE_VALUE': 'kept',
            },
            clear=True,
        ):
            environment = decor.scrub_image_api_environment()
        self.assertNotIn('OPENAI_API_KEY', environment)
        self.assertNotIn('XAI_API_KEY', environment)
        self.assertNotIn('CODEBUDDY_IMAGE_API_KEY', environment)
        self.assertEqual(environment['SAFE_VALUE'], 'kept')

    def test_best_candidate_must_pass_gate_and_arcface(self) -> None:
        candidates = [
            decor.Candidate(
                1, 1, '/v1.png', 'a', 0, 'OK', 0.74, False, 'sous seuil'
            ),
            decor.Candidate(
                2, 1, '/v2.png', 'b', 0, 'À REGARDER', 0.81, True, None
            ),
            decor.Candidate(
                3, 1, '/v3.png', 'c', 0, 'OK', 0.86, True, None
            ),
        ]
        self.assertEqual(decor.choose_best(candidates).variant, 3)

    def test_project_video_recovery_matches_exact_audio(self) -> None:
        items = [
            {
                'item_type': 'heygen_video',
                'video_id': 'old',
                'duration': 14.98,
                'metadata': {
                    'avatar_iv_meta': {
                        'extra_speech_meta': {
                            'audio_data': {
                                'url': (
                                    'https://media.test/transcode.mp3?'
                                    'filename=paris_test_15s.mp3'
                                )
                            }
                        }
                    }
                },
            }
        ]
        found = decor.matching_project_video(
            items,
            audio_path=Path('/tmp/paris-test-15s.mp3'),
        )
        assert found is not None
        self.assertEqual(found['video_id'], 'old')
        self.assertIsNone(
            decor.matching_project_video(
                items,
                audio_path=Path('/tmp/paris-test-15s.mp3'),
                excluded_ids={'old'},
            )
        )

    def test_registry_matches_only_exact_image_sha(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            registry = Path(temporary) / 'talking-photos.json'
            registry.write_text(
                json.dumps({
                    'items': [
                        {
                            'image_sha256': 'other',
                            'talking_photo_id': 'wrong',
                        },
                        {
                            'image_sha256': 'exact',
                            'avatar_look_id': 'look-123',
                            'group_id': 'group-456',
                        },
                    ]
                }),
                encoding='utf-8',
            )
            found = decor.find_talking_photo(registry, 'exact')
        assert found is not None
        self.assertEqual(found.talking_photo_id, 'look-123')
        self.assertEqual(found.avatar_group_id, 'group-456')

    def test_register_talking_photo_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            registry = root / 'talking-photos.json'
            image = root / 'decor.png'
            image.write_bytes(b'image')
            first = decor.TalkingPhoto(
                'look-1',
                'group-1',
                'test',
                'asset-1',
            )
            decor.register_talking_photo(
                registry,
                decor_key='paris',
                image_path=image,
                talking_photo=first,
                arcface=0.86,
            )
            reused = decor.find_talking_photo(
                registry,
                decor.sha256_file(image),
            )
            assert reused is not None
            decor.register_talking_photo(
                registry,
                decor_key='paris',
                image_path=image,
                talking_photo=reused,
                arcface=0.86,
            )
            payload = json.loads(registry.read_text(encoding='utf-8'))
        self.assertEqual(len(payload['items']), 1)
        self.assertEqual(payload['items'][0]['talking_photo_id'], 'look-1')
        self.assertEqual(payload['items'][0]['asset_id'], 'asset-1')


if __name__ == '__main__':
    unittest.main()

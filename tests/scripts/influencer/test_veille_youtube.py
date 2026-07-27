"""Tests ciblés de la veille YouTube IA."""

import argparse
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'veille-youtube.py'
)
SPEC = importlib.util.spec_from_file_location('veille_youtube', SCRIPT)
assert SPEC and SPEC.loader
veille = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = veille
SPEC.loader.exec_module(veille)


class VeilleYoutubeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.channel = veille.Channel(
            'Vision IA',
            'UCyc03X3uRuxM9n7fyRH_gIw',
            'fr',
            'actualité IA',
        )
        self.video = veille.Video(
            'HqIPj8HpwS0',
            'Vision IA',
            self.channel.channel_id,
            "C'est fini pour Claude",
            '2026-07-22T06:26:30+00:00',
            'https://www.youtube.com/watch?v=HqIPj8HpwS0',
        )

    def test_vtt_cleanup_removes_tags_timing_and_rolling_duplicates(self) -> None:
        text = """WEBVTT
Kind: captions
Language: fr

00:00:00.000 --> 00:00:02.000 align:start
Voici <00:00:00.200><c>LongCat</c>

00:00:02.000 --> 00:00:04.000 align:start
Voici LongCat
<c>pour générer des vidéos.</c>

00:00:04.000 --> 00:00:06.000 align:start
pour générer des vidéos.
"""
        self.assertEqual(
            veille.clean_vtt(text),
            'Voici LongCat\npour générer des vidéos.\n',
        )

    def test_rss_parser_uses_known_channel_identity(self) -> None:
        xml = b"""<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom"
              xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          <entry>
            <yt:videoId>HqIPj8HpwS0</yt:videoId>
            <title>Une nouveaute IA</title>
            <published>2026-07-22T06:26:30+00:00</published>
          </entry>
        </feed>"""
        videos = veille.parse_feed(xml, self.channel)
        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].channel_name, 'Vision IA')
        self.assertEqual(videos[0].video_id, 'HqIPj8HpwS0')

    def test_yaml_fallback_preserves_vision_ia_first(self) -> None:
        parsed = veille.parse_simple_yaml(
            """channels:
  - name: Vision IA
    channel_id: UCyc03X3uRuxM9n7fyRH_gIw
    language: fr
    focus: outils
    enabled: true
"""
        )
        self.assertEqual(parsed['channels'][0]['name'], 'Vision IA')
        self.assertTrue(parsed['channels'][0]['enabled'])

    def test_json_extraction_repairs_only_trailing_commas(self) -> None:
        value = veille.extract_json(
            '```json\n{"items": [{"name": "LongCat",},],}\n```'
        )
        self.assertEqual(value['items'][0]['name'], 'LongCat')

    def test_report_video_guard_survives_a_lost_index(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'VEILLE-IA.md'
            path.write_text(
                '[source](https://www.youtube.com/watch?v=HqIPj8HpwS0)'
            )
            self.assertTrue(
                veille.report_contains_video(path, 'HqIPj8HpwS0')
            )
            self.assertFalse(
                veille.report_contains_video(path, 'abcdefghijk')
            )

    def test_targeted_video_is_not_reprocessed_without_force(self) -> None:
        state = veille.default_state()
        state['seen_videos'][self.video.video_id] = {
            'analyzed_at': veille.now_iso()
        }
        args = argparse.Namespace(
            video_id=[self.video.video_id],
            force=False,
        )
        self.assertEqual(
            veille.choose_videos((self.channel,), args, state),
            [],
        )

    def test_merge_deduplicates_family_across_videos(self) -> None:
        raw = {
            'items': [
                {
                    'name': 'Wan 2.2 Bernini',
                    'family': 'Wan 2.2 Bernini',
                    'kind': 'modèle',
                    'description': 'Génère et assemble des vidéos.',
                    'use_cases': ['montage'],
                    'evidence': 'Bernini assemble la vidéo',
                    'code_buddy': {'score': 2, 'justification': 'Peu direct.'},
                    'media': {
                        'score': 9,
                        'justification': 'Très pertinent.',
                        'a_tester': True,
                    },
                    'lisa': {'score': 8, 'justification': 'Bon sujet.'},
                    'biomedical': {
                        'score': 0,
                        'justification': 'Aucun lien.',
                    },
                }
            ]
        }
        items = veille.validate_analysis(raw)
        state = veille.default_state()
        first = veille.merge_items(state, self.video, items)
        second_video = veille.Video(
            'abcdefghijk',
            'Vision IA',
            self.channel.channel_id,
            'Une autre vidéo',
            '2026-07-23T00:00:00Z',
            'https://www.youtube.com/watch?v=abcdefghijk',
        )
        second = veille.merge_items(state, second_video, items)
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(
            state['items']['wan-2-2-bernini']['occurrences'],
            2,
        )

    def test_biomedical_queue_contains_safety_notice_and_tag(self) -> None:
        state = veille.default_state()
        state['items']['alphagenome'] = {
            'key': 'alphagenome',
            'name': 'AlphaGenome',
            'family': 'AlphaGenome',
            'kind': 'modèle',
            'description': "Prédit l'effet de variants.",
            'use_cases': ['génomique'],
            'evidence': 'analyse ADN',
            'code_buddy': {
                'score': 6,
                'justification': 'RAG scientifique.',
                'a_tester': False,
            },
            'media': {
                'score': 0,
                'justification': 'Aucun lien.',
                'a_tester': False,
            },
            'lisa': {'score': 7, 'justification': 'Sujet science.'},
            'biomedical': {
                'score': 9,
                'justification': 'Analyse de variants.',
                'a_tester': True,
            },
            'first_seen': veille.now_iso(),
            'last_seen': veille.now_iso(),
            'occurrences': 1,
            'sources': [
                {
                    'video_id': self.video.video_id,
                    'title': self.video.title,
                    'channel': self.video.channel_name,
                    'published': self.video.published,
                    'url': self.video.url,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'A-TESTER.md'
            veille.write_test_queue(path, state)
            output = path.read_text()
        self.assertIn('Biomédical / recherche', output)
        self.assertIn('Tag : `biomedical`', output)
        self.assertIn('aucun avis médical', output)
        self.assertIn('RGPD', output)


if __name__ == '__main__':
    unittest.main()

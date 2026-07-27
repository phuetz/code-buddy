"""Tests ciblés de la veille YouTube IA."""

from contextlib import redirect_stderr
import importlib.util
import io
from pathlib import Path
import sys
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'veille-youtube.py'
)
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location('veille_youtube', SCRIPT)
assert SPEC and SPEC.loader
veille_youtube = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = veille_youtube
SPEC.loader.exec_module(veille_youtube)


class VeilleYoutubeTest(unittest.TestCase):
    def test_vision_ia_is_the_first_default_source(self) -> None:
        first = veille_youtube.DEFAULT_CHANNELS[0]

        self.assertEqual(first.name, 'Vision IA')
        self.assertEqual(first.channel_id, 'UCyc03X3uRuxM9n7fyRH_gIw')

    def test_vtt_cleanup_removes_tags_timestamps_and_duplicate_lines(
        self,
    ) -> None:
        transcript = veille_youtube.clean_vtt(
            'WEBVTT\n\n'
            '00:00:00.000 --> 00:00:02.000\n'
            '<c>Bonjour</c> le monde\n\n'
            '00:00:02.000 --> 00:00:04.000\n'
            '<00:00:02.100><c>Bonjour</c> le monde\n'
            'Bernini &amp; LongCat\n'
        )

        self.assertEqual(
            transcript,
            'Bonjour le monde\nBernini & LongCat',
        )

    def test_youtube_atom_feed_is_parsed(self) -> None:
        channel = veille_youtube.DEFAULT_CHANNELS[0]
        videos = veille_youtube.parse_youtube_feed(
            b'''<?xml version="1.0"?>
            <feed xmlns="http://www.w3.org/2005/Atom"
              xmlns:yt="http://www.youtube.com/xml/schemas/2015">
              <entry>
                <yt:videoId>HqIPj8HpwS0</yt:videoId>
                <title>C'est fini pour Claude</title>
                <published>2026-07-22T07:46:30+00:00</published>
                <link rel="alternate"
                  href="https://www.youtube.com/watch?v=HqIPj8HpwS0"/>
              </entry>
            </feed>''',
            channel,
        )

        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].video_id, 'HqIPj8HpwS0')
        self.assertEqual(videos[0].channel, channel)

    def test_duplicate_tool_is_not_reported_twice(self) -> None:
        state = veille_youtube.empty_state()
        video = veille_youtube.Video(
            'first',
            'Première',
            'https://example.test/first',
            '2026-07-27',
            veille_youtube.DEFAULT_CHANNELS[0],
        )
        analysis = {
            'video_summary': '',
            'items': [{
                'name': 'LongCat-Video',
                'aliases': ['LongCat Video'],
                'kind': 'video',
                'what_it_does': 'Génère des vidéos longues.',
                'use_case': 'Avatar.',
                'code_buddy': {'score': 2, 'reason': 'Peu lié.'},
                'media': {'score': 9, 'reason': 'Très utile.'},
                'lisa_topic': {'score': 8, 'reason': 'Bon sujet.'},
                'recommendation': 'a_tester',
                'source_quote': '',
            }],
        }
        first, _ = veille_youtube.merge_analysis(
            state,
            video,
            {},
            analysis,
        )
        second_video = veille_youtube.Video(
            'second',
            'Deuxième',
            'https://example.test/second',
            '2026-07-28',
            veille_youtube.DEFAULT_CHANNELS[0],
        )
        second, duplicates = veille_youtube.merge_analysis(
            state,
            second_video,
            {},
            analysis,
        )

        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(duplicates, ['LongCat-Video'])
        self.assertEqual(len(state['tools']), 1)

    def test_simple_yaml_fallback_reads_channels(self) -> None:
        value = veille_youtube.parse_simple_yaml(
            'channels:\n'
            '  - name: Vision IA\n'
            '    channel_id: UCyc03X3uRuxM9n7fyRH_gIw\n'
            '    enabled: true\n'
        )

        self.assertEqual(value['channels'][0]['name'], 'Vision IA')
        self.assertTrue(value['channels'][0]['enabled'])

    def test_paid_or_non_gemini_model_is_rejected(self) -> None:
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                veille_youtube.parse_args(
                    ['--model', 'claude-opus-4-6-thinking']
                )


if __name__ == '__main__':
    unittest.main()

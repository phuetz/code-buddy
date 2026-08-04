"""Tests ciblés du découvreur de sujets RSS."""

from contextlib import redirect_stderr
from datetime import datetime, timezone
import importlib.util
import io
import os
from pathlib import Path
import sys
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'find-subjects.py'
)
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location('find_subjects', SCRIPT)
assert SPEC and SPEC.loader
find_subjects = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = find_subjects
SPEC.loader.exec_module(find_subjects)


class FindSubjectsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 7, 26, 20, tzinfo=timezone.utc)
        self.feed = find_subjects.Feed(
            'korben',
            'Korben',
            'https://korben.info/feed',
        )

    def test_french_feed_is_dated_and_filtered_before_ranking(self) -> None:
        xml = b"""<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>France Travail teste un nouvel algorithme</title>
            <link>https://korben.info/france-travail-algorithme.html</link>
            <pubDate>Sun, 26 Jul 2026 18:00:00 +0000</pubDate>
          </item>
          <item>
            <title>Un outil open source local pour transcrire les podcasts</title>
            <link>https://korben.info/transcription-locale.html</link>
            <pubDate>Sun, 26 Jul 2026 17:00:00 +0000</pubDate>
          </item>
          <item>
            <title>Un ancien article sur Linux</title>
            <link>https://korben.info/ancien-linux.html</link>
            <pubDate>Sun, 12 Jul 2026 17:00:00 +0000</pubDate>
          </item>
        </channel></rss>"""
        fresh, stale = find_subjects.parse_feed(
            xml,
            self.feed,
            datetime(2026, 7, 19, 20, tzinfo=timezone.utc),
        )
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            eligible = find_subjects.apply_editorial_filter(fresh)

        self.assertEqual(stale, 1)
        self.assertEqual(
            [item['title'] for item in eligible],
            ['Un outil open source local pour transcrire les podcasts'],
        )
        self.assertEqual(eligible[0]['source_label'], 'Korben')
        self.assertIn('source=Korben', stderr.getvalue())
        self.assertIn('France Travail', stderr.getvalue())

    def test_similar_title_and_tracking_url_merge_origins(self) -> None:
        first = {
            'title': 'Le nouvel outil IA open source arrive enfin',
            'url': 'https://korben.info/outil-ia.html?utm_source=rss',
            'publisher': '',
            'source': 'korben',
            'source_label': 'Korben',
            'origins': [
                {
                    'source': 'korben',
                    'label': 'Korben',
                    'url': 'https://korben.info/outil-ia.html?utm_source=rss',
                }
            ],
        }
        second = {
            'title': 'Le nouvel outil IA open-source arrive enfin !',
            'url': 'https://korben.info/outil-ia.html#article',
            'publisher': '',
            'source': 'google-news',
            'source_label': 'Google News / Korben',
            'origins': [
                {
                    'source': 'google-news',
                    'label': 'Google News / Korben',
                    'url': 'https://korben.info/outil-ia.html#article',
                }
            ],
        }

        unique = find_subjects.deduplicate([first, second])

        self.assertEqual(len(unique), 1)
        self.assertEqual(len(unique[0]['origins']), 2)

    def test_verified_source_is_injected_from_candidate_not_llm(self) -> None:
        item = {
            'origins': [
                {
                    'source': 'korben',
                    'label': 'Korben',
                    'url': 'https://korben.info/outil-local.html',
                }
            ]
        }
        output = find_subjects.inject_verified_sources(
            'SUJET 1 [C001]: Un outil local\n'
            'HOOK: Il fonctionne sans cloud.\n'
            'PLAN: un / deux / trois\n'
            'POURQUOI: Utile.\n',
            {'C001': item},
        )

        self.assertIn(
            'SOURCE: Korben — https://korben.info/outil-local.html',
            output,
        )
        self.assertEqual(output.count('SOURCE:'), 1)

    def test_source_alias_and_days_are_parsed(self) -> None:
        args = find_subjects.parse_args(
            ['8', '--source', 'nextinpact', '--days', '3'],
            find_subjects.FRENCH_TECH_FEEDS,
        )

        self.assertEqual(args.count, 8)
        self.assertEqual(args.source, 'next')
        self.assertEqual(args.days, 3)

    def test_feed_list_can_be_replaced_with_json_configuration(self) -> None:
        previous = os.environ.get('INFLUENCER_RSS_FEEDS')
        os.environ['INFLUENCER_RSS_FEEDS'] = (
            '[{"slug":"local","label":"Flux local",'
            '"url":"https://example.test/rss"}]'
        )
        try:
            feeds = find_subjects.configured_french_feeds()
        finally:
            if previous is None:
                os.environ.pop('INFLUENCER_RSS_FEEDS', None)
            else:
                os.environ['INFLUENCER_RSS_FEEDS'] = previous

        self.assertEqual(
            feeds,
            (
                find_subjects.Feed(
                    'local',
                    'Flux local',
                    'https://example.test/rss',
                ),
            ),
        )


if __name__ == '__main__':
    unittest.main()

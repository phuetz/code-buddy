"""Helpers purs du pilote Suno Pro (UI 2026-09) — sans navigateur."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'suno_batch.py'
)


def _load():
    spec = importlib.util.spec_from_file_location('suno_batch', SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sb = _load()


class ParseHelpersTest(unittest.TestCase):
    def test_credits_exact_and_compact(self) -> None:
        self.assertEqual(sb.parse_credit_int('2460'), 2460)
        self.assertEqual(sb.parse_credit_int('2,460'), 2460)
        self.assertEqual(sb.parse_credit_int('2.5K'), 2500)

    def test_credits_remaining_from_account_text(self) -> None:
        body = 'Current Plan Pro Plan Credits Remaining 2460 Downloads Remaining 27'
        self.assertEqual(sb.credits_remaining_from_account_text(body), 2460)
        self.assertEqual(sb.downloads_remaining_from_account_text(body), 27)

    def test_commerce_guard(self) -> None:
        self.assertTrue(sb.is_forbidden_commerce_text('Upgrade to Premier'))
        self.assertTrue(sb.is_forbidden_commerce_text('Earn Credits'))
        self.assertTrue(sb.is_forbidden_commerce_text('Buy credits'))
        self.assertFalse(sb.is_forbidden_commerce_text('Create song'))
        self.assertFalse(sb.is_forbidden_commerce_text('Download'))
        self.assertFalse(sb.is_forbidden_commerce_text('Unlock & Download'))

    def test_slugify(self) -> None:
        self.assertEqual(sb.slugify('Quiet Workstation'), 'quiet-workstation')
        self.assertTrue(sb.slugify('').startswith('clip'))


class JobValidationTest(unittest.TestCase):
    def test_instrumental_ok(self) -> None:
        self.assertIsNone(sb.validate_job(
            {'name': 'bed-1', 'style': 'ambient 95 BPM', 'instrumental': True,
             'title': 'Quiet Workstation'},
            allow_vocals=False,
        ))

    def test_refuses_vocals_without_flag(self) -> None:
        err = sb.validate_job(
            {'name': 'song', 'style': 'folk', 'instrumental': False, 'title': 'X'},
            allow_vocals=False,
        )
        self.assertIsNotNone(err)
        self.assertIn('allow-vocals', err or '')

    def test_refuses_lyrics_without_flag(self) -> None:
        err = sb.validate_job(
            {'name': 'song', 'style': 'folk', 'instrumental': True,
             'title': 'X', 'lyrics': '[Verse]\nhello'},
            allow_vocals=False,
        )
        self.assertIsNotNone(err)

    def test_jade_vocals_allowed(self) -> None:
        self.assertIsNone(sb.validate_job(
            {'name': 'quiet', 'style': 'folk 76 BPM', 'instrumental': False,
             'title': 'If You Stay Quiet', 'lyrics': '[Verse]\nYou don\'t have to fill it'},
            allow_vocals=True,
        ))


class SunoTabGuardTest(unittest.TestCase):
    def test_skips_flow_and_dreamina(self) -> None:
        tab = sb.suno_tab([
            {'type': 'page', 'url': 'https://flow.google.com/project/abc', 'title': 'Flow'},
            {'type': 'page', 'url': 'https://dreamina.capcut.com/ai-tool/generate', 'title': 'Dreamina'},
            {'type': 'page', 'url': 'https://suno.com/create', 'title': 'Suno'},
        ])
        self.assertIn('suno.com', tab['url'])

    def test_refuses_when_only_flow_is_open(self) -> None:
        with self.assertRaises(SystemExit):
            sb.suno_tab([
                {'type': 'page', 'url': 'https://flow.google.com/project/abc', 'title': 'Flow'},
            ])

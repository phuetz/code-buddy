"""Helpers purs du pilote Dreamina/Seedance (UI 2026-09) — sans navigateur."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'seedance_batch.py'
)


def _load():
    spec = importlib.util.spec_from_file_location('seedance_batch', SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sb = _load()


class ModelAliasTest(unittest.TestCase):
    def test_25_and_mini(self) -> None:
        self.assertEqual(sb.resolve_model_label('2.5'), 'Dreamina Seedance 2.5')
        self.assertEqual(sb.resolve_model_label('2.0mini'), 'Dreamina Seedance 2.0 Mini')
        self.assertEqual(sb.resolve_model_label('2.0-mini'), 'Dreamina Seedance 2.0 Mini')

    def test_unknown_alias_exits(self) -> None:
        with self.assertRaises(SystemExit):
            sb.resolve_model_label('veo')


class ParseHelpersTest(unittest.TestCase):
    def test_duration(self) -> None:
        self.assertEqual(sb.parse_duration_secs('5s'), 5)
        self.assertEqual(sb.parse_duration_secs(5), 5)
        self.assertEqual(sb.parse_duration_secs(None), 5)

    def test_credits_exact_and_compact(self) -> None:
        self.assertEqual(sb.parse_credit_int('3273'), 3273)
        self.assertEqual(sb.parse_credit_int('3.3K'), 3300)
        self.assertEqual(sb.parse_credit_int('3,273'), 3273)

    def test_placeholder_urls(self) -> None:
        self.assertTrue(sb.is_placeholder_video_url('blob:https://x'))
        self.assertTrue(sb.is_placeholder_video_url('https://cdn/record-loading-animation.mp4'))
        self.assertFalse(sb.is_placeholder_video_url('https://v16-cc.capcut.com/video/tos/alisg/ok.mp4'))

    def test_commerce_guard(self) -> None:
        self.assertTrue(sb.is_forbidden_commerce_text('Buy credits'))
        self.assertTrue(sb.is_forbidden_commerce_text('Manage subscription'))
        self.assertFalse(sb.is_forbidden_commerce_text('Confirm'))
        self.assertFalse(sb.is_forbidden_commerce_text('Credit balance'))

    def test_generate_button_ready_uses_html_disabled(self) -> None:
        self.assertFalse(sb.looks_like_generate_button(
            disabled=True, width=36, y=882, primary=True))
        self.assertTrue(sb.looks_like_generate_button(
            disabled=False, width=36, y=882, primary=True))
        self.assertFalse(sb.looks_like_generate_button(
            disabled=False, width=120, y=882, primary=True))


class DreaminaTabGuardTest(unittest.TestCase):
    def test_skips_flow_and_picks_dreamina_generate(self) -> None:
        tab = sb.dreamina_tab([
            {'type': 'page', 'url': 'https://flow.google.com/project/abc', 'title': 'Flow'},
            {'type': 'page', 'url': 'https://suno.com/create', 'title': 'Suno'},
            {'type': 'page', 'url': 'https://dreamina.capcut.com/ai-tool/generate/?type=video',
             'title': 'Dreamina'},
        ])
        self.assertIn('dreamina.capcut.com', tab['url'])

    def test_refuses_when_only_flow_is_open(self) -> None:
        with self.assertRaises(SystemExit):
            sb.dreamina_tab([
                {'type': 'page', 'url': 'https://flow.google.com/project/abc', 'title': 'Flow'},
            ])

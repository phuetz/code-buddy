"""Tests ciblés de l'habillage Short (karaoké, attributions, images)."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'wrap-short.py'
)
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location('wrap_short', SCRIPT)
assert SPEC and SPEC.loader
wrap_short = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = wrap_short
SPEC.loader.exec_module(wrap_short)


def word(t0, t1, text):
    return {'t0': t0, 't1': t1, 'w': text}


class MergeApostrophesTest(unittest.TestCase):
    def test_recolle_apostrophe_eclatee(self):
        merged = wrap_short.merge_apostrophes(
            [word(0.0, 0.2, 'qu'), word(0.2, 0.5, "'elle"), word(0.5, 0.8, 'voit')]
        )
        self.assertEqual([w['w'] for w in merged], ["qu'elle", 'voit'])
        self.assertEqual(merged[0]['t0'], 0.0)
        self.assertEqual(merged[0]['t1'], 0.5)

    def test_sans_apostrophe_inchange(self):
        words = [word(0.0, 0.2, 'les'), word(0.2, 0.5, 'agents')]
        self.assertEqual(wrap_short.merge_apostrophes(words), words)


class CardsTest(unittest.TestCase):
    def test_conserve_les_mots_pour_le_karaoke(self):
        cards = wrap_short.cards(
            [word(0.0, 0.3, 'Un'), word(0.3, 0.6, 'agent'), word(0.6, 1.0, 'IA.')]
        )
        self.assertEqual(len(cards), 1)
        self.assertEqual([w['w'] for w in cards[0]['words']], ['Un', 'agent', 'IA.'])
        self.assertEqual(cards[0]['text'], 'Un agent IA.')


class KaraokeEventsTest(unittest.TestCase):
    def test_un_evenement_par_mot_avec_mot_actif(self):
        card = wrap_short.cards(
            [word(0.0, 0.3, 'Un'), word(0.3, 0.6, 'agent'), word(0.6, 1.0, 'IA.')]
        )[0]
        events = wrap_short.karaoke_events(card)
        self.assertEqual(len(events), 3)
        # Chaque événement montre la carte entière, mot actif balisé.
        self.assertIn(wrap_short.ACTIVE_WORD_TAG + 'Un', events[0]['text'])
        self.assertIn('agent', events[0]['text'])
        self.assertIn(wrap_short.ACTIVE_WORD_TAG + 'agent', events[1]['text'])
        self.assertIn(wrap_short.ACTIVE_WORD_TAG + 'IA.', events[2]['text'])
        # Continuité temporelle : un événement démarre quand le précédent finit.
        self.assertEqual(events[0]['t1'], events[1]['t0'])
        self.assertEqual(events[1]['t1'], events[2]['t0'])


class BuildAssTest(unittest.TestCase):
    def cards(self):
        return wrap_short.cards([word(0.0, 0.3, 'Bonjour'), word(0.3, 0.8, 'monde.')])

    def test_karaoke_par_defaut(self):
        ass = wrap_short.build_ass(self.cards(), 'HOOK', 4.5)
        self.assertIn(wrap_short.ACTIVE_WORD_TAG, ass)

    def test_cartes_statiques_sans_balise(self):
        ass = wrap_short.build_ass(self.cards(), 'HOOK', 4.5, subs='cards')
        self.assertNotIn(wrap_short.ACTIVE_WORD_TAG, ass)
        self.assertIn('Bonjour monde.', ass)

    def test_attributions_incrustees(self):
        ass = wrap_short.build_ass(
            self.cards(), '', 4.5, layout='split',
            attributions=[{'t0': 1.0, 't1': 4.0, 'text': 'source : OpenAI — 28/07/2026'}],
        )
        self.assertIn('Attr', ass)
        self.assertIn('source : OpenAI — 28/07/2026', ass)


class AttributionForCutTest(unittest.TestCase):
    def test_preuve_split_et_full(self):
        with tempfile.TemporaryDirectory() as tmp:
            stem = Path(tmp) / 'annonce-anthropic-12ab34cd'
            meta = {'attribution': 'source : anthropic.com — 28/07/2026'}
            Path(f'{stem}.meta.json').write_text(json.dumps(meta))
            for suffix in ('-full.png', '-split-1080x960.png'):
                path = f'{stem}{suffix}'
                Path(path).touch()
                self.assertEqual(
                    wrap_short.attribution_for_cut(path),
                    'source : anthropic.com — 28/07/2026',
                )

    def test_broll_sans_metadonnees(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'b042.mp4'
            path.touch()
            self.assertIsNone(wrap_short.attribution_for_cut(str(path)))


class SplitActiveCutsTest(unittest.TestCase):
    def test_ordre_et_fenetres(self):
        cuts = [
            {'path': 'b.mp4', 't0': 5.0, 'dur': 3.0},
            {'path': 'a.mp4', 't0': 2.0, 'dur': 3.0},
        ]
        active = wrap_short.split_active_cuts(cuts, 10.0)
        self.assertEqual([c['path'] for c in active], ['a.mp4', 'b.mp4'])
        self.assertEqual(active[0]['split_t0'], 0.0)
        self.assertEqual(active[1]['split_t0'], 5.0)

    def test_saute_hors_sequence(self):
        cuts = [
            {'path': 'a.mp4', 't0': 2.0, 'dur': 3.0},
            {'path': 'tard.mp4', 't0': 12.0, 'dur': 3.0},
        ]
        active = wrap_short.split_active_cuts(cuts, 10.0)
        self.assertEqual([c['path'] for c in active], ['a.mp4'])


class IsImageTest(unittest.TestCase):
    def test_extensions(self):
        self.assertTrue(wrap_short.is_image('preuve-split-1080x960.PNG'))
        self.assertTrue(wrap_short.is_image('capture.webp'))
        self.assertFalse(wrap_short.is_image('b042.mp4'))


if __name__ == '__main__':
    unittest.main()

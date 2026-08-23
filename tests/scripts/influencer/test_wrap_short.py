"""Tests ciblés de l'habillage Short (karaoké, attributions, images)."""

import importlib.util
import json
from pathlib import Path
import re
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


def _texts(cards):
    return [c['text'] for c in cards]


def _joined(words):
    return [w['w'] for w in wrap_short.merge_numeric_fragments(words)]


class MergeNumericFragmentsTest(unittest.TestCase):
    """Karaoké : un décimal/version/%/milliers reste UN jeton, jamais coupé."""

    def test_claude_4_point_5_eclate_en_4_dot_puis_5(self):
        words = [
            word(0.00, 0.35, 'Claude'),
            word(0.35, 0.55, '4.'),
            word(0.55, 0.80, '5'),
            word(0.90, 1.20, 'sort'),
        ]
        self.assertEqual(_joined(words), ['Claude', '4.5', 'sort'])
        fused = wrap_short.merge_numeric_fragments(words)
        self.assertEqual(fused[1]['t0'], 0.35)
        self.assertEqual(fused[1]['t1'], 0.80)

    def test_triple_4_point_5(self):
        words = [
            word(0.0, 0.2, '4'),
            word(0.2, 0.25, '.'),
            word(0.25, 0.4, '5'),
        ]
        self.assertEqual(_joined(words), ['4.5'])

    def test_4_et_5_sans_separateur_quand_le_transcript_dit_4_5(self):
        words = [
            word(0.0, 0.3, 'Claude'),
            word(0.3, 0.45, '4'),
            word(0.45, 0.60, '5'),
        ]
        self.assertEqual(_joined(words), ['Claude', '4.5'])

    def test_3_virgule_7_milliards(self):
        words = [
            word(0.0, 0.2, 'coûte'),
            word(0.2, 0.4, '3,'),
            word(0.4, 0.55, '7'),
            word(0.55, 1.0, 'milliards'),
        ]
        self.assertEqual(_joined(words), ['coûte', '3,7', 'milliards'])

    def test_3_7_milliards_separateur_tombe(self):
        words = [
            word(0.0, 0.2, '3'),
            word(0.2, 0.35, '7'),
            word(0.35, 0.8, 'milliards'),
        ]
        self.assertEqual(_joined(words), ['3,7', 'milliards'])

    def test_v2_5(self):
        self.assertEqual(
            _joined([word(0.0, 0.2, 'v2.'), word(0.2, 0.4, '5')]),
            ['v2.5'],
        )

    def test_gpt_4_5(self):
        self.assertEqual(
            _joined([word(0.0, 0.3, 'GPT-4.'), word(0.3, 0.5, '5')]),
            ['GPT-4.5'],
        )

    def test_1_000_et_500_000(self):
        self.assertEqual(
            _joined([word(0.0, 0.2, '1'), word(0.2, 0.5, '000')]),
            ['1 000'],
        )
        self.assertEqual(
            _joined([
                word(0.0, 0.2, '500'),
                word(0.2, 0.4, '000'),
            ]),
            ['500 000'],
        )

    def test_12_pourcent(self):
        self.assertEqual(
            _joined([word(0.0, 0.2, '12'), word(0.2, 0.4, '%')]),
            ['12 %'],
        )

    def test_deja_entier_idempotent(self):
        words = [
            word(0.0, 0.3, 'Claude'),
            word(0.3, 0.6, '4.5'),
            word(0.7, 1.0, 'v2.5'),
            word(1.0, 1.3, '1 000'),
        ]
        self.assertEqual(_joined(words), ['Claude', '4.5', 'v2.5', '1 000'])

    def test_ne_colle_pas_une_annee_et_un_chiffre_suivant(self):
        words = [
            word(0.0, 0.4, '2024.'),
            word(1.0, 1.2, '5'),
            word(1.2, 1.6, 'personnes'),
        ]
        self.assertEqual(_joined(words), ['2024.', '5', 'personnes'])

    def test_nombre_deja_entier_avec_virgule_finale(self):
        words = [
            word(0.0, 0.4, 'Grok'),
            word(0.4, 0.8, '4.6,'),
            word(0.9, 1.1, '13'),
            word(1.1, 1.4, 'août'),
        ]
        self.assertEqual(_joined(words), ['Grok', '4.6,', '13', 'août'])


class CardsKeepDecimalsTest(unittest.TestCase):
    def test_transcription_type_whisper_un_carton_par_nombre(self):
        # Simulation d'une passe whisper small : décimaux éclatés + versions + milliers.
        words = [
            word(0.00, 0.30, 'le'),
            word(0.30, 0.50, 'même'),
            word(0.50, 0.80, 'socle'),
            word(0.80, 1.00, 'que'),
            word(1.00, 1.20, '4.'),
            word(1.20, 1.40, '5'),
            word(1.50, 1.80, 'Claude'),
            word(1.80, 2.00, '4.'),
            word(2.00, 2.20, '5'),
            word(2.30, 2.50, 'soit'),
            word(2.50, 2.70, '3,'),
            word(2.70, 2.90, '7'),
            word(2.90, 3.40, 'milliards'),
            word(3.50, 3.70, 'v2.'),
            word(3.70, 3.90, '5'),
            word(4.00, 4.20, 'et'),
            word(4.20, 4.40, '1'),
            word(4.40, 4.70, '000'),
            word(4.80, 5.10, 'Qwen'),
            word(5.10, 5.40, '3.8'),
            word(5.50, 5.80, 'plus'),
            word(5.80, 6.00, '12'),
            word(6.00, 6.20, '%'),
        ]
        cards = wrap_short.cards(words, max_words=3)
        blob = ' | '.join(_texts(cards))
        self.assertIn('4.5', blob)
        self.assertIn('3,7', blob)
        self.assertIn('v2.5', blob)
        self.assertIn('1 000', blob)
        self.assertIn('Qwen 3.8', blob)
        self.assertIn('12 %', blob)
        for c in cards:
            self.assertNotRegex(c['text'], r'\d[.,]\s*$')
            self.assertFalse(
                re.fullmatch(r'\d+[.,]?', c['text'].strip()),
                f'carton orphelin {c["text"]!r}',
            )

    def test_qwen_et_pourcent_pas_coupes_par_max_words(self):
        words = [
            word(0.0, 0.2, 'sur'),
            word(0.2, 0.4, 'le'),
            word(0.4, 0.7, 'Qwen'),
            word(0.7, 1.0, '3.8'),
            word(1.1, 1.3, 'gagne'),
            word(1.3, 1.5, '12'),
            word(1.5, 1.7, '%'),
        ]
        cards = wrap_short.cards(words, max_words=3)
        blob = ' | '.join(_texts(cards))
        self.assertIn('Qwen 3.8', blob)
        self.assertIn('12 %', blob)

    def test_vraie_fin_de_phrase_reste_coupee(self):
        cards = wrap_short.cards(
            [
                word(0.0, 0.3, 'C\'est'),
                word(0.3, 0.8, 'fini.'),
                word(1.2, 1.5, 'Les'),
                word(1.5, 1.9, 'autres'),
            ],
            max_words=3,
        )
        self.assertEqual(_texts(cards)[0], "C'est fini.")
        self.assertTrue(any(t.startswith('Les') for t in _texts(cards)))


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


class MusicAudioFiltersTest(unittest.TestCase):
    def test_defaut_volume_0_01_et_ducking_voix(self):
        joined = ';'.join(wrap_short.music_audio_filters(2, 10.0))
        self.assertIn('volume=0.01[music]', joined)
        self.assertIn('threshold=0.006', joined)
        self.assertIn('loudnorm=I=-14', joined)
        self.assertEqual(wrap_short.DEFAULT_MUSIC_VOLUME, 0.01)

    def test_music_volume_override(self):
        joined = ';'.join(wrap_short.music_audio_filters(3, 8.5, volume=0.007))
        self.assertIn('volume=0.007[music]', joined)
        self.assertIn('[3:a]atrim=0:8.500', joined)
        self.assertNotIn('volume=0.01[music]', joined)

    def test_cli_option_presente(self):
        src = SCRIPT.read_text(encoding='utf-8')
        self.assertIn("'--music-volume'", src)


if __name__ == '__main__':
    unittest.main()

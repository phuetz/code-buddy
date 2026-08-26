import argparse
import importlib.util
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
LONGFORM = ROOT / 'scripts' / 'influencer' / 'longform'


SOURCE_REF = os.environ.get('LONGFORM_SOURCE_REF')


def load_module(name: str, path: Path):
    if SOURCE_REF:
        relative = path.relative_to(ROOT)
        result = subprocess.run(
            ['git', 'show', f'{SOURCE_REF}:{relative.as_posix()}'],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())
        module = types.ModuleType(name)
        module.__file__ = str(path)
        sys.modules[name] = module
        exec(compile(result.stdout, str(path), 'exec'), module.__dict__)
        return module
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


news = load_module('assemble_news_long_v9', LONGFORM / 'assemble_news_long.py')
srt = load_module('srt_depuis_rendu_v9', LONGFORM / 'srt_depuis_rendu.py')
legacy = load_module('longform_assemble_v9', LONGFORM / 'longform-assemble.py')
verifier = load_module('verifier_declencheurs_v9', LONGFORM / 'verifier_declencheurs.py')


class TriggerSafetyTests(unittest.TestCase):
    def test_missing_trigger_never_uses_fallback(self) -> None:
        words = [{'w': 'bonjour', 't0': 1.25, 't1': 1.75}]

        with self.assertRaisesRegex(news.NewsLongError, 'introuvable'):
            news.resolve_trigger(words, 'absent', fallback=9.0)

    def test_french_number_words_match_aligned_digits(self) -> None:
        cases = {
            'quatorze': ('14', 14),
            'sept': ('7', 7),
            'trois': ('3', 3),
            'soixante-treize': ('73', 73),
            'soixante et onze': ('71', 71),
            'quatre-vingts': ('80', 80),
            'quatre-vingt-quinze': ('95', 95),
            'deux cent quatorze': ('214', 214),
            'sept mille neuf cent quarante-huit': ('7948', 7948),
            'deux millions trois cent mille': ('2300000', 2_300_000),
        }

        for spoken, (aligned, value) in cases.items():
            with self.subTest(spoken=spoken, aligned=aligned):
                words = [{'w': aligned, 't0': 2.5, 't1': 2.8}]
                self.assertEqual(news.find_word(words, spoken), 2.5)
                self.assertEqual(news.french_number_value(spoken), value)

    def test_hash_occurrence_syntax_from_real_order_is_supported(self) -> None:
        words = [
            {'w': '3', 't0': 1.0, 't1': 1.2},
            {'w': 'trois', 't0': 4.0, 't1': 4.2},
        ]

        self.assertEqual(news.find_word(words, 'trois#2'), 4.0)

    def test_declared_missing_script_is_fatal(self) -> None:
        cached = '[{"w": "texte", "t0": 0.0, "t1": 0.5}]'
        cases = [
            (
                {'id': 'S1', 'script': '/definitely/missing-v9-script.txt'},
                None,
                'script déclaré.*introuvable',
            ),
            (
                {'id': 'S1'},
                Path('/definitely/missing-v9-scripts'),
                'script attendu.*introuvable',
            ),
        ]

        for segment, script_dir, message in cases:
            with self.subTest(segment=segment, script_dir=script_dir):
                # Le cache de mots est declare a jour : ce test porte sur le script
                # manquant, pas sur la fraicheur du cache. Compter les appels a
                # Path.exists rendait le test dependant de l'ordre interne de
                # words_for — il cassait des qu'une verification s'y ajoutait.
                with patch.object(news, 'stale', return_value=False):
                    with patch.object(news.Path, 'exists', return_value=False):
                        with patch.object(news.Path, 'read_text', return_value=cached):
                            with self.assertRaisesRegex(news.NewsLongError, message):
                                news.words_for(
                                    segment,
                                    Path('voice.mp3'),
                                    Path('work'),
                                    script_dir=script_dir,
                                )

    def test_verifier_cannot_pass_without_cached_transcription(self) -> None:
        with self.assertRaisesRegex(RuntimeError, 'déclencheurs non vérifiés'):
            verifier.mots_du_segment(
                Path('/definitely/missing-v6-project'),
                {},
                {'S1': {}},
                'S1',
            )


class TimelineSafetyTests(unittest.TestCase):
    def test_unknown_declared_chapter_is_fatal_before_render(self) -> None:
        config = {
            'segments': [{'id': 'S1'}],
            'chapitres': [{'at': 'REPERE-ABSENT', 'titre': 'Sommaire attendu'}],
        }

        with self.assertRaisesRegex(news.NewsLongError, 'repère REPERE-ABSENT inconnu'):
            news.validate_chapter_references(config)

    def test_card_that_cannot_fit_is_not_silently_dropped(self) -> None:
        cards = [{'_t': 9.8, 'duree': 3.0, 'type': 'chiffre'}]

        with self.assertRaisesRegex(news.NewsLongError, 'carte.*ne peut pas être affichée'):
            news.build_shots(10.0, {'tail_avatar': 0.0}, cards)

    def test_demo_cache_is_invalidated_when_source_content_changes(self) -> None:
        with tempfile.TemporaryDirectory(prefix='.x1-demo-cache-', dir=LONGFORM) as directory:
            root = Path(directory)
            source = root / 'demo.mp4'
            destination = root / 'card.mp4'
            chassis = root / 'chassis' / 'chassis.png'
            source.write_bytes(b'old take')

            def render_from_current_source(_command, dest):
                dest.write_bytes(source.read_bytes())

            probe = subprocess.CompletedProcess(
                args=['ffprobe'], returncode=0, stdout='640,480\n', stderr=''
            )
            with patch.object(news, 'run', return_value=probe), \
                 patch.object(news, 'render_demo_chassis', return_value=chassis), \
                 patch.object(news, 'atomic', side_effect=render_from_current_source) as atomic:
                news.render_demo_card({'video': str(source)}, 1.0, destination, root)
                original_stat = source.stat()
                source.write_bytes(b'new take')
                os.utime(
                    source,
                    ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns),
                )

                news.render_demo_card({'video': str(source)}, 1.0, destination, root)
                self.assertEqual(destination.read_bytes(), b'new take')
                self.assertEqual(atomic.call_count, 2)

                news.render_demo_card({'video': str(source)}, 1.0, destination, root)
                self.assertEqual(atomic.call_count, 2)

    def test_segment_cache_is_invalidated_when_narrated_script_changes(self) -> None:
        with tempfile.TemporaryDirectory(prefix='.x5-script-cache-', dir=LONGFORM) as directory:
            root = Path(directory)
            source = root / 'voice.mp4'
            composite = root / 'composite.mp4'
            ass = root / 'subs.ass'
            destination = root / 'segment.mp4'
            audio = root / 'segment.wav'
            mastered = root / 'mastered.wav'
            master = root / 'master.mp4'
            for item in (source, composite, ass, mastered):
                item.write_bytes(item.name.encode())

            base_ns = 1_700_000_000_000_000_000
            os.utime(mastered, ns=(base_ns, base_ns))
            render_count = 0

            def fake_atomic(_command, dest):
                nonlocal render_count
                if dest == destination:
                    render_count += 1
                    dest.write_bytes(f'render-{render_count}'.encode())
                    tick = base_ns + render_count * 1_000_000_000
                    os.utime(dest, ns=(tick, tick))
                else:
                    dest.write_bytes(b'audio')

            def render(script_dir):
                signature = news.segment_script_cache_signature({'id': 'S1'}, script_dir)
                news.assemble_segment(
                    'S1', source, None, 1.0, composite,
                    [{'type': 'avatar', 't0': 0.0, 't1': 1.0, 'card': None}],
                    [], {}, ass, destination, audio, [],
                    script_signature=signature,
                )
                if news.stale(master, destination, mastered):
                    master.write_bytes(destination.read_bytes())
                    tick = destination.stat().st_mtime_ns + 100_000_000
                    os.utime(master, ns=(tick, tick))

            with patch.object(news, 'atomic', side_effect=fake_atomic):
                render(None)
                self.assertEqual(master.read_bytes(), b'render-1')

                script_dir = root / 'scripts'
                script_dir.mkdir()
                script = script_dir / 'S1.txt'
                script.write_text('ses lecons', encoding='utf-8')
                render(script_dir)
                self.assertEqual(master.read_bytes(), b'render-2')

                render(script_dir)
                self.assertEqual(render_count, 2)

                original_stat = script.stat()
                script.write_text('CodeBuddy!', encoding='utf-8')
                os.utime(
                    script,
                    ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns),
                )
                render(script_dir)
                self.assertEqual(master.read_bytes(), b'render-3')

                render(None)
                self.assertEqual(master.read_bytes(), b'render-4')

    def test_cache_root_already_named_words_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix='.x5-words-cache-', dir=LONGFORM) as directory:
            root = Path(directory)
            order = root / 'order.json'
            order.write_text('{"titre":"cache root test","segments":[]}', encoding='utf-8')
            cache_root = root / 'shared' / 'words'

            result = subprocess.run(
                [
                    sys.executable,
                    str(LONGFORM / 'assemble_news_long.py'),
                    str(order),
                    '--out-dir',
                    str(root / 'out'),
                    '--cache-dir',
                    str(cache_root),
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 2)
            self.assertRegex(result.stderr, '--cache-dir.*racine')
            self.assertFalse(cache_root.exists())


class SubtitleSafetyTests(unittest.TestCase):
    def test_two_minute_timeline_media_gap_is_fatal(self) -> None:
        with self.assertRaisesRegex(srt.SubtitleSyncError, '125.400 s'):
            srt.assert_duration_match(1087.967, 1213.367, tolerance=0.5)

    def test_ffprobe_failure_is_not_converted_to_zero_seconds(self) -> None:
        failed = subprocess.CompletedProcess(
            args=['ffprobe'], returncode=1, stdout='', stderr='invalid media'
        )

        with patch.object(srt.subprocess, 'run', return_value=failed):
            with self.assertRaisesRegex(srt.SubtitleSyncError, 'ffprobe'):
                srt.duree(Path('broken.wav'))


class LegacyAssemblySafetyTests(unittest.TestCase):
    def test_missing_voiceover_visuals_are_fatal(self) -> None:
        with patch.object(legacy, 'render_card') as render_card:
            with self.assertRaisesRegex(legacy.AssemblyError, 'aucun visuel'):
                legacy.render_voiceover_section(
                    {'id': 'S1'},
                    10.0,
                    [],
                    Path('render'),
                    LONGFORM / '.v9-no-visual-output.mp4',
                )
        render_card.assert_not_called()

    def test_existing_final_mux_is_not_reported_as_success(self) -> None:
        existing = LONGFORM / 'README.md'

        with patch.object(legacy, 'atomic_ffmpeg') as atomic_ffmpeg:
            with self.assertRaisesRegex(legacy.AssemblyError, 'faux succès refusé'):
                legacy.final_mux(Path('video.mp4'), Path('audio.wav'), 10.0, existing)
        atomic_ffmpeg.assert_not_called()

    def test_existing_chapter_file_is_recomputed(self) -> None:
        existing = LONGFORM / 'README.md'

        with patch.object(legacy.Path, 'write_text') as write_text:
            legacy.write_chapters(existing, [{'id': 'S1', 'phase': 'intro'}], [0.0])
        write_text.assert_called_once()

    def test_missing_avatar_is_fatal_without_placeholder(self) -> None:
        args = argparse.Namespace(
            workdir=str(LONGFORM / '.v9-no-work'),
            out=str(LONGFORM / '.v9-no-output.mp4'),
            mood='elegant',
            music=None,
        )
        plan = {'sections': [{'id': 'S1', 'mode': 'avatar'}]}

        with patch.object(legacy.argparse.ArgumentParser, 'parse_args', return_value=args), \
             patch.object(legacy.Path, 'mkdir'), \
             patch.object(legacy.Path, 'is_file', side_effect=[True, False]), \
             patch.object(legacy, 'read_plan', return_value=plan), \
             patch.object(legacy, 'assert_no_production_markers'), \
             patch.object(legacy, 'section_duration', return_value=10.0), \
             patch.object(legacy, 'write_chapters'), \
             patch.object(legacy, 'xfade_videos'), \
             patch.object(legacy, 'render_narration'), \
             patch.object(legacy, 'resolve_music', return_value=Path('music.mp3')), \
             patch.object(legacy, 'mix_music'), \
             patch.object(legacy, 'master_audio'), \
             patch.object(legacy, 'final_mux'), \
             patch.object(legacy, 'master_video_audio', return_value={}), \
             patch.object(legacy, 'write_qc_sidecar'), \
             patch.object(legacy, 'render_card') as render_card:
            with self.assertRaisesRegex(SystemExit, 'avatar absent'):
                legacy.main()
        render_card.assert_not_called()


if __name__ == '__main__':
    unittest.main()

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'lisa-presentatrice.py'
)
SCRIPT_DIR = str(SCRIPT.parent)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)
SPEC = importlib.util.spec_from_file_location('lisa_presentatrice', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
lisa = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = lisa
SPEC.loader.exec_module(lisa)


def srt_seconds(value: str) -> float:
    hours, minutes, remainder = value.split(':')
    seconds, milliseconds = remainder.split(',')
    return (
        int(hours) * 3600
        + int(minutes) * 60
        + int(seconds)
        + int(milliseconds) / 1000
    )


class LisaVisualShotPlanTest(unittest.TestCase):
    def test_mixed_section_applies_identity_only_outside_cutaways(self) -> None:
        sections = [
            {'id': 'intro', 'mode': 'presenter'},
            {'id': 'mixed', 'mode': 'hybride'},
            {'id': 'facts', 'mode': 'broll'},
        ]
        timeline = [
            {'start': 0.0, 'end': 5.0},
            {'start': 5.0, 'end': 25.0},
            {'start': 25.0, 'end': 35.0},
        ]
        cutaways = {
            'intro': [],
            'mixed': [{'start': 8.0, 'end': 13.0, 'asset': 'proof.png'}],
        }
        plan = lisa.visual_gate_shot_plan(sections, timeline, cutaways)
        self.assertEqual(
            plan,
            [
                {'start': 0.0, 'end': 13.0, 'shot_type': 'persona'},
                {'start': 13.0, 'end': 18.0, 'shot_type': 'broll'},
                {'start': 18.0, 'end': 25.0, 'shot_type': 'persona'},
                {'start': 25.0, 'end': 35.0, 'shot_type': 'broll'},
            ],
        )

    def test_subtitles_split_crossfades_without_short_cues(self) -> None:
        sections = [
            {
                'id': 'intro',
                'texte': 'Une phrase complète. Une seconde phrase lisible.',
                'source_id': 'synthese',
            },
            {
                'id': 'suite',
                'texte': 'La suite reste claire et ne chevauche jamais la précédente.',
                'source_id': 'synthese',
            },
        ]
        timeline = [
            {'start': 0.0, 'end': 4.0, 'duration': 4.0},
            {'start': 3.75, 'end': 7.75, 'duration': 4.0},
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            srt = root / 'captions.srt'
            ass = root / 'captions.ass'
            lisa.make_subtitles(
                sections,
                timeline,
                {'synthese': {'label': 'Synthèse'}},
                srt,
                ass,
            )
            ranges = []
            for line in srt.read_text(encoding='utf-8').splitlines():
                if ' --> ' not in line:
                    continue
                start, end = line.split(' --> ')
                ranges.append(
                    (
                        srt_seconds(start),
                        srt_seconds(end),
                    )
                )
            self.assertTrue(all(end - start >= 0.69 for start, end in ranges))
            self.assertTrue(
                all(
                    current[1] <= following[0]
                    for current, following in zip(ranges, ranges[1:])
                )
            )


if __name__ == '__main__':
    unittest.main()

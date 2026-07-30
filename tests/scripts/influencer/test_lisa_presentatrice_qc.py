from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
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


if __name__ == '__main__':
    unittest.main()

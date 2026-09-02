from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[2]
    / 'scripts'
    / 'gpuNode'
    / 'measure-visual-gates.py'
)
SPEC = importlib.util.spec_from_file_location('measure_visual_gates', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
gates = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gates
SPEC.loader.exec_module(gates)


class ShotTypeIdentityGateTest(unittest.TestCase):
    def test_broll_and_slide_explicitly_skip_arcface(self) -> None:
        for shot_type in ('broll', 'slide'):
            metrics = gates.skipped_identity_metrics(shot_type)
            self.assertEqual(metrics['status'], 'skipped_no_persona')
            self.assertFalse(metrics['identityExpected'])
            self.assertEqual(metrics['evaluatedFrameCount'], 0)
            self.assertIsNone(metrics['meanSimilarity'])

    def test_persona_cannot_use_the_skip_path(self) -> None:
        with self.assertRaises(ValueError):
            gates.skipped_identity_metrics('persona')


if __name__ == '__main__':
    unittest.main()

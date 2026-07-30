from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'video_delivery_qc.py'
)
SPEC = importlib.util.spec_from_file_location('video_delivery_qc', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
qc = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = qc
SPEC.loader.exec_module(qc)


class VideoDeliveryQCTest(unittest.TestCase):
    def test_short_title_and_author_never_overlap(self) -> None:
        boxes = qc.short_title_layout()
        self.assertLessEqual(boxes['title'].bottom, boxes['author'].y)

    def test_end_card_is_mobile_safe_and_high_contrast(self) -> None:
        layout = qc.end_card_layout(1080, 1920)
        self.assertGreaterEqual(layout.duration_seconds, 4)
        self.assertGreaterEqual(
            qc.contrast_ratio(layout.foreground, layout.background),
            4.5,
        )
        for box in (
            layout.title,
            layout.author,
            layout.status,
            layout.cta,
            layout.url,
        ):
            self.assertGreaterEqual(box.x, layout.safe_margin_x)
            self.assertLessEqual(box.right, layout.width - layout.safe_margin_x)

    def test_production_markers_are_blocking_but_normal_prose_is_not(self) -> None:
        qc.assert_no_production_markers(
            {'texte': 'En conclusion, ce modèle reste utile.'}
        )
        with self.assertRaisesRegex(qc.DeliveryQCError, 'Accroche'):
            qc.assert_no_production_markers(
                {'slides': ['Accroche', 'Le vrai texte']}
            )
        with self.assertRaisesRegex(qc.DeliveryQCError, 'TODO'):
            qc.assert_no_production_markers({'texte': 'TODO: finir'})

    def test_loudness_gate_accepts_target_and_rejects_both_failure_modes(self) -> None:
        accepted = qc.LoudnessMeasurement(-14.02, -1.31, 4.0, -24.0, 0.0)
        self.assertEqual(
            qc.assert_delivery_loudness(Path('/unused'), accepted),
            accepted,
        )
        with self.assertRaisesRegex(qc.DeliveryQCError, 'LUFS'):
            qc.assert_delivery_loudness(
                Path('/unused'),
                qc.LoudnessMeasurement(-16.2, -1.3, 4.0, -24.0, 0.0),
            )
        with self.assertRaisesRegex(qc.DeliveryQCError, 'dBTP'):
            qc.assert_delivery_loudness(
                Path('/unused'),
                qc.LoudnessMeasurement(-14.0, -0.47, 4.0, -24.0, 0.0),
            )


if __name__ == '__main__':
    unittest.main()

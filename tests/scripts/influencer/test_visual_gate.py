"""Tests unitaires des fonctions pures de la porte qualité visuelle."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'visual-gate.py'
)
SPEC = importlib.util.spec_from_file_location('visual_gate', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
visual_gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = visual_gate
SPEC.loader.exec_module(visual_gate)


class VisualGateScoringTest(unittest.TestCase):
    def test_cosine_similarity(self) -> None:
        self.assertAlmostEqual(
            visual_gate.cosine_similarity((1.0, 0.0), (1.0, 0.0)),
            1.0,
        )
        self.assertAlmostEqual(
            visual_gate.cosine_similarity((1.0, 0.0), (0.0, 1.0)),
            0.0,
        )

    def test_face_proportion_deviation_is_symmetric_log_ratio(self) -> None:
        self.assertAlmostEqual(
            visual_gate.face_proportion_deviation(
                (1.0, 1.2),
                (1.0, 1.0),
            ),
            0.1823215568,
        )
        self.assertAlmostEqual(
            visual_gate.face_proportion_deviation(
                (1.0, 1.0),
                (1.0, 1.2),
            ),
            0.1823215568,
        )

    def test_deterministic_gate_rejects_identity_before_llm(self) -> None:
        decision = visual_gate.decide_deterministic(
            face_detected=True,
            identity_similarity=0.549,
            stretch_deviation=0.01,
            sharpness=200.0,
        )
        self.assertEqual(decision.verdict, 'REJET')
        self.assertIn('ArcFace', decision.defects[0])

    def test_deterministic_target_is_warning_not_rejection(self) -> None:
        decision = visual_gate.decide_deterministic(
            face_detected=True,
            identity_similarity=0.70,
            stretch_deviation=0.01,
            sharpness=200.0,
        )
        self.assertEqual(decision.verdict, 'À REGARDER')
        self.assertFalse(decision.defects)
        self.assertIn('cible', decision.warnings[0])

    def test_missing_face_is_review_not_rejection(self) -> None:
        decision = visual_gate.decide_deterministic(
            face_detected=False,
            identity_similarity=None,
            stretch_deviation=None,
            sharpness=200.0,
        )
        self.assertEqual(decision.verdict, 'À REGARDER')
        self.assertFalse(decision.defects)
        self.assertIn('non détecté', decision.warnings[0])

    def test_deterministic_gate_rejects_stretch_and_blur(self) -> None:
        decision = visual_gate.decide_deterministic(
            face_detected=True,
            identity_similarity=0.90,
            stretch_deviation=0.19,
            sharpness=9.0,
        )
        self.assertEqual(decision.verdict, 'REJET')
        self.assertEqual(len(decision.defects), 2)

    def test_default_video_samples_are_required_percentages(self) -> None:
        self.assertEqual(
            visual_gate.sample_fractions(5),
            (0.10, 0.30, 0.50, 0.70, 0.90),
        )
        self.assertEqual(
            visual_gate.sample_indices(101, 5),
            (10, 30, 50, 70, 90),
        )

    def test_shot_plan_skips_identity_where_no_persona_is_expected(self) -> None:
        plan = visual_gate.validate_shot_plan(
            [
                {'start': 0, 'end': 5, 'shot_type': 'persona'},
                {'start': 5, 'end': 10, 'shot_type': 'broll'},
                {'start': 10, 'end': 15, 'shot_type': 'slide'},
            ]
        )
        self.assertEqual(visual_gate.shot_type_at(2, plan, 'persona'), 'persona')
        self.assertEqual(visual_gate.shot_type_at(7, plan, 'persona'), 'broll')
        self.assertEqual(visual_gate.shot_type_at(12, plan, 'persona'), 'slide')
        self.assertEqual(visual_gate.shot_type_at(20, plan, 'broll'), 'broll')

    def test_interframe_embedding_drift_rejects(self) -> None:
        result = visual_gate.interframe_stability(
            embeddings=((1.0, 0.0), (0.6, 0.8)),
            boxes=((10, 10, 30, 30), (10, 10, 30, 30)),
            frame_width=100,
            frame_height=100,
        )
        self.assertEqual(result['verdict'], 'REJET')
        self.assertAlmostEqual(result['max_embedding_delta'], 0.4)

    def test_bbox_jitter_rejects_trembling_head(self) -> None:
        result = visual_gate.interframe_stability(
            embeddings=((1.0, 0.0),) * 3,
            boxes=(
                (40, 40, 60, 60),
                (45, 40, 65, 60),
                (35, 40, 55, 60),
            ),
            frame_width=100,
            frame_height=100,
        )
        self.assertEqual(result['verdict'], 'REJET')
        self.assertGreater(result['max_center_jitter'], 0.045)

    def test_combined_verdict_uses_worst_signal(self) -> None:
        self.assertEqual(
            visual_gate.combine_verdict('OK', 'MINEUR', 'OK'),
            'À REGARDER',
        )
        self.assertEqual(
            visual_gate.combine_verdict('MINEUR', 'OK', 'REJET'),
            'REJET',
        )

    def test_patrice_approval_prevents_automatic_rejection(self) -> None:
        self.assertEqual(
            visual_gate.apply_approval_ceiling('REJET', approved=True),
            'À REGARDER',
        )
        self.assertEqual(
            visual_gate.apply_approval_ceiling('REJET', approved=False),
            'REJET',
        )
        self.assertEqual(
            len(visual_gate.KNOWN_APPROVED_MEDIA_SHA256),
            10,
        )

    def test_llm_hand_rejection_is_downgraded_to_review(self) -> None:
        grid = {
            field: 'OK'
            for field in visual_gate.GRID_FIELDS
        }
        grid['anatomie_mains'] = 'REJET'
        grid['verdict'] = 'OK'
        grid['defauts'] = ['six doigts']
        normalized = visual_gate.validate_llm_grid(grid)
        self.assertEqual(normalized['anatomie_mains'], 'À REGARDER')
        self.assertEqual(normalized['verdict'], 'À REGARDER')

    def test_llm_cannot_trigger_automatic_rejection(self) -> None:
        grid = {
            field: 'OK'
            for field in visual_gate.GRID_FIELDS
        }
        grid['anatomie_corps'] = 'REJET'
        grid['verdict'] = 'REJET'
        grid['defauts'] = ['objet fusionné']
        normalized = visual_gate.validate_llm_grid(grid)
        self.assertEqual(normalized['verdict'], 'À REGARDER')

    def test_llm_grid_rejects_missing_fields(self) -> None:
        with self.assertRaises(ValueError):
            visual_gate.validate_llm_grid(
                {'verdict': 'OK', 'defauts': []}
            )


class VisualGateHandsTest(unittest.TestCase):
    @staticmethod
    def healthy_landmarks() -> list[tuple[float, float, float]]:
        return [
            (0.0, 0.0, 0.0),
            (-0.3, 0.4, 0.0),
            (-0.6, 0.7, 0.0),
            (-0.9, 0.9, 0.0),
            (-1.2, 1.0, 0.0),
            (-0.6, 0.8, 0.0),
            (-0.6, 1.3, 0.0),
            (-0.6, 1.8, 0.0),
            (-0.6, 2.3, 0.0),
            (-0.2, 1.0, 0.0),
            (-0.2, 1.6, 0.0),
            (-0.2, 2.2, 0.0),
            (-0.2, 2.8, 0.0),
            (0.2, 0.9, 0.0),
            (0.2, 1.45, 0.0),
            (0.2, 2.0, 0.0),
            (0.2, 2.55, 0.0),
            (0.6, 0.7, 0.0),
            (0.6, 1.15, 0.0),
            (0.6, 1.6, 0.0),
            (0.6, 2.05, 0.0),
        ]

    def test_healthy_hand_has_21_landmarks_and_five_chains(self) -> None:
        result = visual_gate.measure_hand_topology(
            self.healthy_landmarks()
        )
        self.assertEqual(result.landmark_count, 21)
        self.assertEqual(result.finger_chains, 5)
        self.assertEqual(result.coherent_finger_chains, 5)
        self.assertEqual(result.extended_fingers, 5)
        self.assertFalse(result.aberrant)
        self.assertGreaterEqual(result.topology_score, 0.70)

    def test_severely_collapsed_topology_is_flagged_not_rejected(self) -> None:
        landmarks = self.healthy_landmarks()
        landmarks[6] = landmarks[5]
        landmarks[7] = landmarks[5]
        landmarks[8] = landmarks[5]
        landmarks[14] = landmarks[13]
        landmarks[15] = landmarks[13]
        landmarks[16] = landmarks[13]
        landmarks[18] = landmarks[17]
        landmarks[19] = landmarks[17]
        landmarks[20] = landmarks[17]
        result = visual_gate.measure_hand_topology(landmarks)
        self.assertTrue(result.aberrant)
        self.assertEqual(result.coherent_finger_chains, 2)
        self.assertIn('chaîne de doigt 2', result.reasons[0])

    def test_missing_landmarks_are_aberrant(self) -> None:
        result = visual_gate.measure_hand_topology(
            self.healthy_landmarks()[:-1]
        )
        self.assertTrue(result.aberrant)
        self.assertEqual(result.landmark_count, 20)


class VisualGateOcrTest(unittest.TestCase):
    @staticmethod
    def token(
        text: str,
        confidence: float,
        block: int = 1,
    ) -> dict[str, object]:
        return {
            'text': text,
            'confidence': confidence,
            'block': block,
            'pass': 'test',
            'bbox': {
                'x': 0.1,
                'y': 0.1,
                'width': 0.1,
                'height': 0.05,
            },
        }

    def test_dense_low_confidence_text_is_review_only(self) -> None:
        tokens = [
            self.token(f'xx{index}', 10.0, block=1)
            for index in range(8)
        ]
        result = visual_gate.classify_ocr_tokens(
            tokens,
            frozenset({'hello', 'world'}),
        )
        self.assertEqual(result['verdict'], 'À REGARDER')
        self.assertGreaterEqual(result['suspicious_zone_count'], 1)
        self.assertIn('pseudo-texte dense', result['warnings'][0])

    def test_known_readable_words_are_ok(self) -> None:
        tokens = [
            self.token('hello', 95.0),
            self.token('world', 92.0),
        ]
        result = visual_gate.classify_ocr_tokens(
            tokens,
            frozenset({'hello', 'world'}),
        )
        self.assertEqual(result['verdict'], 'OK')
        self.assertEqual(result['unknown_word_rate'], 0.0)

    def test_long_unknown_word_is_review_not_rejection(self) -> None:
        result = visual_gate.classify_ocr_tokens(
            [self.token('diisilbk', 62.0)],
            frozenset({'hello'}),
        )
        self.assertEqual(result['verdict'], 'À REGARDER')
        self.assertNotEqual(result['verdict'], 'REJET')

    def test_tesseract_tsv_parser_preserves_normalized_zone(self) -> None:
        tsv = (
            'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\t'
            'left\ttop\twidth\theight\tconf\ttext\n'
            '5\t1\t2\t1\t1\t1\t10\t20\t30\t40\t12.5\tg1yph\n'
        )
        tokens = visual_gate.parse_tesseract_tsv(
            tsv,
            image_width=100,
            image_height=200,
            pass_name='test',
        )
        self.assertEqual(len(tokens), 1)
        self.assertEqual(tokens[0]['block'], 2)
        self.assertAlmostEqual(tokens[0]['bbox']['x'], 0.1)
        self.assertAlmostEqual(tokens[0]['bbox']['height'], 0.2)


if __name__ == '__main__':
    unittest.main()

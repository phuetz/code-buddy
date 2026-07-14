import unittest

from watch import (
    AnonymousMultiTracker,
    MOTION_FRAME_SLOTS,
    SEMANTIC_FRAME_SLOTS,
    CameraLivenessState,
    MotionEventState,
    PersonState,
    VisionSample,
    classify_presence_transitions,
    detector_evidence_for,
    normalized_box,
    select_drowsy_track,
)


def detection(x, y=0.2, width=0.2, height=0.5, confidence=0.9, **extra):
    return {
        "box2d": {"x": x, "y": y, "width": width, "height": height},
        "confidence": confidence,
        **extra,
    }


class NormalizedBoxTests(unittest.TestCase):
    def test_normalizes_and_clamps_pixels_without_depth(self):
        self.assertEqual(
            normalized_box(-10, 20, 120, 80, 100, 100),
            {"x": 0.0, "y": 0.2, "width": 1.0, "height": 0.6},
        )
        self.assertIsNone(normalized_box(10, 10, 10, 20, 100, 100))
        self.assertIsNone(normalized_box(0, 0, 10, 10, 0, 100))


class PersonStateTests(unittest.TestCase):
    def test_tracker_is_opaque_stable_for_one_presence_episode_and_then_rotates(self):
        state = PersonState(episode_prefix="testscope")
        state.grace = 2

        entered = state.update(True)
        self.assertEqual(entered, ("person_entered", 200, "anon-testscope-1"))
        self.assertEqual(state.presence_episode_id, "anon-testscope-1")
        self.assertIsNone(state.update(True))
        self.assertIsNone(state.update(False))
        self.assertEqual(
            state.update(False),
            ("person_lost", 120, "anon-testscope-1"),
        )
        self.assertIsNone(state.presence_episode_id)
        self.assertEqual(
            state.update(True),
            ("person_entered", 200, "anon-testscope-2"),
        )


class AnonymousMultiTrackerTests(unittest.TestCase):
    def test_tracks_two_anonymous_faces_across_reversed_detector_order(self):
        tracker = AnonymousMultiTracker(
            episode_prefix="multi", max_persons=4, grace=2, iou_threshold=0.2
        )
        first = tracker.update([detection(0.6), detection(0.1)])
        self.assertEqual(
            [track["episodeId"] for track in first["entered"]],
            ["anon-multi-1", "anon-multi-2"],
        )
        self.assertEqual(len(first["visible"]), 2)

        second = tracker.update([detection(0.58), detection(0.12)])
        self.assertEqual(second["entered"], [])
        self.assertEqual(second["lost"], [])
        self.assertEqual(
            [track["episodeId"] for track in second["visible"]],
            ["anon-multi-1", "anon-multi-2"],
        )

    def test_one_lost_track_does_not_hide_the_other_visible_track(self):
        tracker = AnonymousMultiTracker(
            episode_prefix="loss", max_persons=4, grace=2, iou_threshold=0.2
        )
        first = tracker.update([detection(0.1), detection(0.6)])
        left_id = first["visible"][0]["episodeId"]
        right_id = first["visible"][1]["episodeId"]

        grace = tracker.update([detection(0.61)])
        self.assertEqual([track["episodeId"] for track in grace["visible"]], [right_id])
        self.assertEqual(grace["lost"], [])
        lost = tracker.update([detection(0.62)])
        self.assertEqual([track["episodeId"] for track in lost["visible"]], [right_id])
        self.assertEqual([track["episodeId"] for track in lost["lost"]], [left_id])
        self.assertTrue(tracker.present)

    def test_total_detector_loss_is_delayed_and_reacquisition_keeps_episode(self):
        tracker = AnonymousMultiTracker(
            episode_prefix="grace", max_persons=4, grace=2, iou_threshold=0.2
        )
        episode_id = tracker.update([detection(0.3)])["visible"][0]["episodeId"]
        self.assertEqual(tracker.update([])["lost"], [])
        reacquired = tracker.update([detection(0.31)])
        self.assertEqual(reacquired["visible"][0]["episodeId"], episode_id)
        self.assertEqual(tracker.update([])["lost"], [])
        lost = tracker.update([])
        self.assertEqual(lost["visible"], [])
        self.assertEqual(lost["lost"][0]["episodeId"], episode_id)
        self.assertFalse(tracker.present)

    def test_rejects_invalid_geometry_caps_tracks_and_strips_identity_material(self):
        tracker = AnonymousMultiTracker(
            episode_prefix="safe", max_persons=2, grace=1, iou_threshold=0.2
        )
        raw = [
            detection(0.1, personId="Patrice", landmarks=[{"x": 1, "z": 2}]),
            detection(0.4),
            detection(0.7),
            detection(0.9, width=0.2),
            detection(float("nan")),
        ]
        batch = tracker.update(raw)
        self.assertEqual(len(batch["visible"]), 2)
        self.assertLessEqual(len(tracker.tracks), 2)
        serialized = str(batch)
        self.assertNotIn("Patrice", serialized)
        self.assertNotIn("landmarks", serialized)
        self.assertNotIn("personId", serialized)

    def test_single_track_cap_replaces_disjoint_episode_without_human_alert(self):
        tracker = AnonymousMultiTracker(
            episode_prefix="single", max_persons=1, grace=8, iou_threshold=0.2
        )
        tracker.update([detection(0.1)])
        had_presence = tracker.present
        replaced = tracker.update([detection(0.7)])
        transitions = classify_presence_transitions(
            replaced,
            had_presence,
            tracker.present,
        )
        self.assertEqual(len(tracker.tracks), 1)
        self.assertEqual(
            [kind for kind, _, _ in transitions],
            ["person_observed", "person_track_lost"],
        )

    def test_rejects_boolean_geometry_and_confidence(self):
        tracker = AnonymousMultiTracker(episode_prefix="bool", max_persons=2)
        batch = tracker.update([
            detection(True),
            detection(0.2, confidence=True),
        ])
        self.assertEqual(batch["visible"], [])


class PresenceTransitionTests(unittest.TestCase):
    def test_only_first_entry_from_empty_is_human_facing(self):
        batch = {
            "entered": [detection(0.1), detection(0.6)],
            "lost": [],
        }
        transitions = classify_presence_transitions(batch, False, True)
        self.assertEqual(
            [kind for kind, _, _ in transitions],
            ["person_entered", "person_observed"],
        )

    def test_partial_loss_is_internal_and_total_loss_is_human_facing_once(self):
        partial = classify_presence_transitions(
            {"entered": [], "lost": [detection(0.1)]},
            True,
            True,
        )
        self.assertEqual([kind for kind, _, _ in partial], ["person_track_lost"])

        total = classify_presence_transitions(
            {"entered": [], "lost": [detection(0.1), detection(0.6)]},
            True,
            False,
        )
        self.assertEqual(
            [kind for kind, _, _ in total],
            ["person_lost", "person_track_lost"],
        )


class DrowsyAttributionTests(unittest.TestCase):
    def test_yolo_track_can_use_one_unambiguous_face_blink_measurement(self):
        track = {
            **detection(0.2, confidence=0.95),
            "episodeId": "anon-yolo-1",
            "eyeClosed": None,
        }
        face_sample = VisionSample(
            True,
            0.8,
            {"confidence": 0.8},
            [detection(0.3, eyeClosed=0.8)],
        )
        selected = select_drowsy_track([track], face_sample, True)
        self.assertEqual(selected["episodeId"], "anon-yolo-1")
        self.assertEqual(selected["eyeClosed"], 0.8)

    def test_multiple_visible_tracks_suppress_ambiguous_blink_attribution(self):
        face_sample = VisionSample(
            True,
            0.8,
            {"confidence": 0.8},
            [detection(0.3, eyeClosed=0.8)],
        )
        self.assertIsNone(select_drowsy_track(
            [detection(0.1), detection(0.6)],
            face_sample,
            True,
        ))

    def test_face_only_mode_keeps_legacy_drowsiness(self):
        face_sample = VisionSample(
            True,
            0.9,
            {"confidence": 0.85, "box2d": detection(0.2)["box2d"]},
            [detection(0.2, eyeClosed=0.9)],
        )
        selected = select_drowsy_track([], face_sample, False)
        self.assertIsNone(selected["episodeId"])
        self.assertEqual(selected["eyeClosed"], 0.9)

    def test_drowsy_event_reports_face_detector_provenance_with_yolo_presence(self):
        person_sample = VisionSample(
            True,
            None,
            {"detector": "yolov8", "model": "person.onnx", "frameWidth": 640},
            [detection(0.2)],
        )
        face_sample = VisionSample(
            True,
            0.8,
            {"detector": "mediapipe_face", "frameWidth": 640},
            [detection(0.3, eyeClosed=0.8)],
        )
        self.assertEqual(
            detector_evidence_for("drowsy", person_sample, face_sample),
            {"detector": "mediapipe_face", "frameWidth": 640},
        )
        self.assertEqual(
            detector_evidence_for("person_observed", person_sample, face_sample),
            {"detector": "yolov8", "model": "person.onnx", "frameWidth": 640},
        )


class CameraLivenessTests(unittest.TestCase):
    def test_emits_refresh_failure_transition_and_recovery(self):
        state = CameraLivenessState(heartbeat_secs=5, failure_grace=2)

        self.assertEqual(state.update(True, at=0), ("camera_alive", 10))
        self.assertIsNone(state.update(True, at=4))
        self.assertEqual(state.update(True, at=5), ("camera_alive", 10))
        self.assertIsNone(state.update(False, at=6))
        self.assertEqual(state.update(False, at=7), ("camera_unavailable", 180))
        self.assertIsNone(state.update(False, at=8))
        self.assertEqual(state.update(False, at=12), ("camera_unavailable", 180))
        self.assertEqual(state.update(True, at=13), ("camera_alive", 10))

        clamped = CameraLivenessState(heartbeat_secs=60, failure_grace=2)
        self.assertEqual(clamped.heartbeat_secs, 10)


class MotionEventTests(unittest.TestCase):
    def test_emits_first_motion_then_respects_bounded_refresh_cadence(self):
        state = MotionEventState(cooldown_secs=8)

        self.assertFalse(state.should_emit(False, at=0))
        self.assertTrue(state.should_emit(True, at=1))
        self.assertFalse(state.should_emit(True, at=8.9))
        self.assertTrue(state.should_emit(True, at=9))
        self.assertFalse(state.should_emit(False, at=20))
        self.assertGreaterEqual(MOTION_FRAME_SLOTS, 16)
        self.assertLessEqual(MOTION_FRAME_SLOTS, 128)
        self.assertGreaterEqual(SEMANTIC_FRAME_SLOTS, 64)
        self.assertLessEqual(SEMANTIC_FRAME_SLOTS, 256)


if __name__ == "__main__":
    unittest.main()

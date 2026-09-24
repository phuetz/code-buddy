import unittest

import numpy as np

from watch import (
    AnonymousMultiTracker,
    MOTION_FRAME_SLOTS,
    SEMANTIC_FRAME_SLOTS,
    CameraLivenessState,
    MotionGate,
    MotionEventState,
    PersonState,
    VisionSample,
    classify_presence_transitions,
    detector_evidence_for,
    estimate_spatial,
    head_yaw_pitch,
    horizontal_fov_deg,
    normalized_box,
    safe_detection,
    select_drowsy_track,
)
import math
from types import SimpleNamespace


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


def face_landmarks(right_iris, left_iris):
    points = [SimpleNamespace(x=0.5, y=0.5) for _ in range(478)]
    points[468] = SimpleNamespace(x=right_iris[0], y=right_iris[1])
    points[473] = SimpleNamespace(x=left_iris[0], y=left_iris[1])
    return points


def yaw_matrix(yaw_deg):
    angle = math.radians(yaw_deg)
    return [
        [math.cos(angle), 0.0, math.sin(angle), 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [-math.sin(angle), 0.0, math.cos(angle), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


class SpatialEstimateTests(unittest.TestCase):
    def test_horizontal_fov_is_derived_from_the_diagonal(self):
        # 90 deg diagonal on 4:3 -> 2*atan(tan(45 deg) * 0.8) = 77.3 deg.
        self.assertAlmostEqual(horizontal_fov_deg(640, 480), 77.32, places=1)

    def test_centered_face_at_one_metre(self):
        # focal = 320 / tan(38.66 deg) = 400 px; 63 mm at 1 m -> 25.2 px.
        ipd = 25.2 / 640
        spatial = estimate_spatial(face_landmarks((0.5 - ipd / 2, 0.5), (0.5 + ipd / 2, 0.5)), 640, 480)
        self.assertEqual(spatial["basis"], "estimate-ipd-v1")
        self.assertAlmostEqual(spatial["distanceM"], 1.0, delta=0.02)
        self.assertAlmostEqual(spatial["azimuthDeg"], 0.0, delta=0.2)
        self.assertNotIn("facing", spatial)

    def test_bearing_sign_follows_the_image_side(self):
        right = estimate_spatial(face_landmarks((0.80, 0.5), (0.84, 0.5)), 640, 480)
        left = estimate_spatial(face_landmarks((0.16, 0.5), (0.20, 0.5)), 640, 480)
        high = estimate_spatial(face_landmarks((0.48, 0.1), (0.52, 0.1)), 640, 480)
        self.assertGreater(right["azimuthDeg"], 20)
        self.assertLess(left["azimuthDeg"], -20)
        self.assertGreater(high["elevationDeg"], 20)

    def test_turned_head_is_not_read_as_a_closer_face(self):
        ipd = 25.2 / 640
        straight = estimate_spatial(face_landmarks((0.5 - ipd / 2, 0.5), (0.5 + ipd / 2, 0.5)), 640, 480, (0.0, 0.0))
        half = ipd * math.cos(math.radians(40))
        turned = estimate_spatial(face_landmarks((0.5 - half / 2, 0.5), (0.5 + half / 2, 0.5)), 640, 480, (40.0, 0.0))
        self.assertAlmostEqual(turned["distanceM"], straight["distanceM"], delta=0.03)

    def test_facing_means_the_head_points_back_at_the_camera(self):
        side = face_landmarks((0.80, 0.5), (0.84, 0.5))
        azimuth = estimate_spatial(side, 640, 480)["azimuthDeg"]
        self.assertTrue(estimate_spatial(side, 640, 480, (-azimuth, 0.0))["facing"])
        self.assertFalse(estimate_spatial(side, 640, 480, (azimuth, 0.0))["facing"])
        high = face_landmarks((0.48, 0.1), (0.52, 0.1))
        elevation = estimate_spatial(high, 640, 480)["elevationDeg"]
        self.assertTrue(estimate_spatial(high, 640, 480, (0.0, elevation))["facing"])
        self.assertFalse(estimate_spatial(high, 640, 480, (0.0, -elevation))["facing"])

    def test_missing_iris_landmarks_give_no_estimate(self):
        self.assertIsNone(estimate_spatial([SimpleNamespace(x=0.5, y=0.5)] * 468, 640, 480))

    def test_head_yaw_reads_the_pose_matrix(self):
        yaw, pitch = head_yaw_pitch(yaw_matrix(30))
        self.assertAlmostEqual(yaw, 30.0, places=3)
        self.assertAlmostEqual(pitch, 0.0, places=3)
        self.assertIsNone(head_yaw_pitch([[float("nan")] * 4] * 4))

    def test_tracker_keeps_only_a_bounded_labelled_estimate(self):
        spatial = {"basis": "estimate-ipd-v1", "azimuthDeg": 12.0, "elevationDeg": 3.0,
                   "distanceM": 1.4, "headYawDeg": -10.0, "headPitchDeg": 2.0, "facing": True}
        kept = safe_detection(detection(0.2, spatial=spatial))
        self.assertEqual(kept["spatial"], spatial)
        for bad in (
            {**spatial, "basis": "metric"},
            {**spatial, "distanceM": float("inf")},
            {**spatial, "azimuthDeg": 400.0},
        ):
            self.assertNotIn("spatial", safe_detection(detection(0.2, spatial=bad)))
        smuggled = safe_detection(detection(0.2, spatial={**spatial, "landmarks": [1, 2]}))
        self.assertNotIn("landmarks", smuggled["spatial"])


class PersonStateTests(unittest.TestCase):
    def test_tracker_is_opaque_stable_for_one_presence_episode_and_then_rotates(self):
        state = PersonState(episode_prefix="testscope", lost_secs=20)

        entered = state.update(True, at=0)
        self.assertEqual(entered, ("person_entered", 200, "anon-testscope-1"))
        self.assertEqual(state.presence_episode_id, "anon-testscope-1")
        self.assertIsNone(state.update(True, at=1))
        self.assertIsNone(state.update(False, at=2))
        self.assertEqual(
            state.update(False, at=21),
            ("person_lost", 120, "anon-testscope-1"),
        )
        self.assertIsNone(state.presence_episode_id)
        self.assertEqual(
            state.update(True, at=22),
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
            episode_prefix="grace", max_persons=4, lost_secs=20, iou_threshold=0.2
        )
        episode_id = tracker.update([detection(0.3)], at=0)["visible"][0]["episodeId"]
        self.assertEqual(tracker.update([], at=2)["lost"], [])
        reacquired = tracker.update([detection(0.31)], at=3)
        self.assertEqual(reacquired["visible"][0]["episodeId"], episode_id)
        self.assertEqual(tracker.update([], at=22.9)["lost"], [])
        lost = tracker.update([], at=23)
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

    def test_dark_gaussian_sensor_noise_never_emits_motion(self):
        rng = np.random.default_rng(42)
        gate = MotionGate(motion_threshold=0.02, min_luma=12, noise_window=16)
        events = MotionEventState(cooldown_secs=2)
        emitted = 0
        darkness_logs = 0

        for index in range(20):
            frame = np.clip(rng.normal(6, 5, size=(120, 160)), 0, 255).astype(np.uint8)
            decision = gate.update(frame, at=float(index))
            emitted += int(events.should_emit(decision["moved"], at=float(index)))
            darkness_logs += int(decision["logDarkness"])

        self.assertEqual(emitted, 0)
        self.assertLessEqual(darkness_logs, 1)
        self.assertLess(decision["meanLuma"], 12)
        self.assertIn("noiseFloor", decision)

    def test_moving_rectangle_emits_exactly_one_motion_event(self):
        gate = MotionGate(motion_threshold=0.02, min_luma=12, noise_window=16)
        events = MotionEventState(cooldown_secs=2)
        base = np.full((120, 160), 80, dtype=np.uint8)
        moved = base.copy()
        moved[30:80, 40:100] = 220

        decisions = [
            gate.update(base, at=0),
            gate.update(moved, at=1),
            gate.update(moved, at=2),
        ]
        emitted = sum(
            events.should_emit(decision["moved"], at=float(index))
            for index, decision in enumerate(decisions)
        )

        self.assertEqual(emitted, 1)
        self.assertGreater(decisions[1]["score"], decisions[1]["effectiveThreshold"])
        self.assertGreaterEqual(decisions[1]["meanLuma"], 12)


if __name__ == "__main__":
    unittest.main()

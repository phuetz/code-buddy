import unittest

from camera_health import CameraHealthState


class CameraHealthStateTest(unittest.TestCase):
    def test_emits_offline_once_after_consecutive_failure_threshold(self):
        state = CameraHealthState(failure_threshold=3)

        self.assertIsNone(state.update(False))
        self.assertIsNone(state.update(False))
        self.assertEqual(state.update(False), ("offline", 150))
        self.assertIsNone(state.update(False))
        self.assertTrue(state.offline)

    def test_short_failure_flicker_does_not_emit(self):
        state = CameraHealthState(failure_threshold=3)

        self.assertIsNone(state.update(False))
        self.assertIsNone(state.update(False))
        self.assertIsNone(state.update(True))
        self.assertFalse(state.offline)
        self.assertEqual(state.consecutive_failures, 0)

    def test_recovery_emits_online_once_and_rearms_offline(self):
        state = CameraHealthState(failure_threshold=2)

        self.assertIsNone(state.update(False))
        self.assertEqual(state.update(False), ("offline", 150))
        self.assertEqual(state.update(True), ("online", 120))
        self.assertIsNone(state.update(True))

        self.assertIsNone(state.update(False))
        self.assertEqual(state.update(False), ("offline", 150))


if __name__ == "__main__":
    unittest.main()

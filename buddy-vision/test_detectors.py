import io
import unittest
from contextlib import redirect_stderr

from detectors import DrowsyState, PersonState, parse_yolo_classes


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class PersonStateTest(unittest.TestCase):
    def test_entry_grace_then_exit(self):
        state = PersonState(grace=3)

        self.assertEqual(state.update(True), ("person_entered", 200))
        self.assertIsNone(state.update(False))
        self.assertIsNone(state.update(False))
        self.assertEqual(state.update(False), ("person_left", 120))

    def test_flicker_within_grace_does_not_emit_transition(self):
        state = PersonState(grace=3)

        self.assertEqual(state.update(True), ("person_entered", 200))
        self.assertIsNone(state.update(False))
        self.assertIsNone(state.update(False))
        self.assertIsNone(state.update(True))
        self.assertTrue(state.present)
        self.assertEqual(state.absent, 0)


class DrowsyStateTest(unittest.TestCase):
    def test_emits_once_after_threshold_and_rearms_when_eyes_reopen(self):
        clock = FakeClock()
        state = DrowsyState(thresh=0.5, secs=2.0, clock=clock)

        self.assertIsNone(state.update(0.75))
        clock.advance(1.9)
        self.assertIsNone(state.update(0.75))
        clock.advance(0.1)
        self.assertEqual(state.update(0.75), ("drowsy", 230))
        clock.advance(10.0)
        self.assertIsNone(state.update(0.75))

        self.assertIsNone(state.update(0.1))
        self.assertIsNone(state.update(0.75))
        clock.advance(2.0)
        self.assertEqual(state.update(0.75), ("drowsy", 230))


class ParseYoloClassesTest(unittest.TestCase):
    def test_garbage_defaults_to_person_class(self):
        stderr = io.StringIO()

        with redirect_stderr(stderr):
            classes = parse_yolo_classes("garbage")

        self.assertEqual(classes, [0])
        self.assertIn("ignoring non-numeric YOLO class 'garbage'", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()

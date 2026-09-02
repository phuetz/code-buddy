import unittest
import numpy as np
import cv2
from watch import MOTION_MIN_LUMA, MOTION_THRESH, MotionGate

class DarkMotionThresholdTests(unittest.TestCase):
    def test_dark_sensor_noise_should_not_trigger_motion(self):
        """Mission SENSE2 — Trou 7 : Le seuil MOTION_THRESH=0.02 est sous le bruit capteur dans le noir (0.0315-0.0370).
        Dans l'obscurité, le bruit thermique du capteur (mesuré p50=0.0315, p90=0.0370)
        dépasse systématiquement le seuil fixe de 0.02.
        """
        # Simulation réaliste de deux trames sombres consécutives avec bruit thermique de capteur
        # Moyenne d'intensité sous la porte d'obscurité, avec assez de bruit brut
        # pour franchir l'ancien seuil fixe.
        np.random.seed(42)
        shape = (120, 160)
        noise1 = np.clip(np.random.normal(6, 6.0, shape), 0, 255).astype(np.uint8)
        noise2 = np.clip(np.random.normal(6, 6.0, shape), 0, 255).astype(np.uint8)

        raw_score = float(np.mean(cv2.absdiff(noise1, noise2)) / 255.0)
        self.assertGreater(raw_score, MOTION_THRESH)

        gate = MotionGate(
            motion_threshold=MOTION_THRESH,
            min_luma=MOTION_MIN_LUMA,
            noise_window=16,
        )
        gate.update(noise1, at=0.0)
        decision = gate.update(noise2, at=1.0)

        self.assertTrue(decision["dark"])
        self.assertLess(decision["meanLuma"], MOTION_MIN_LUMA)
        self.assertFalse(
            decision["moved"],
            f"Faux mouvement détecté dans le noir : bruit brut={raw_score:.4f} >= seuil={MOTION_THRESH}",
        )

if __name__ == "__main__":
    unittest.main()

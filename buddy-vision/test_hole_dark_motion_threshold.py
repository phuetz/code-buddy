import unittest
import numpy as np
import cv2
from watch import motion_score, MOTION_THRESH

class DarkMotionThresholdTests(unittest.TestCase):
    def test_dark_sensor_noise_should_not_trigger_motion(self):
        """Mission SENSE2 — Trou 7 : Le seuil MOTION_THRESH=0.02 est sous le bruit capteur dans le noir (0.0315-0.0370).
        Dans l'obscurité, le bruit thermique du capteur (mesuré p50=0.0315, p90=0.0370)
        dépasse systématiquement le seuil fixe de 0.02.
        """
        # Simulation réaliste de deux trames sombres consécutives avec bruit thermique de capteur
        # Moyenne d'intensité basse (pièce sombre, ~15/255) avec bruit gaussien sigma ~ 6.0
        # produisant une différence absolue moyenne d'environ 8.5/255 = 0.033
        np.random.seed(42)
        shape = (120, 160)
        noise1 = np.clip(np.random.normal(15, 6.0, shape), 0, 255).astype(np.uint8)
        noise2 = np.clip(np.random.normal(15, 6.0, shape), 0, 255).astype(np.uint8)

        score = motion_score(noise1, noise2)
        # Score mesuré : environ 0.033
        self.assertGreater(score, 0.025)

        # TROU PROUVÉ : Dans watch.py, MOTION_THRESH = 0.02.
        # Sur ces deux images purement sombres et statiques, score >= MOTION_THRESH est True !
        # Le comportement attendu pour un détecteur de mouvement fiable est de NE PAS détecter
        # de mouvement sur un fond noir statique bruité (moved == False).
        # Dans le code actuel, score >= MOTION_THRESH vaut True, donc ce test échoue en ROUGE.
        moved = score >= MOTION_THRESH
        self.assertFalse(moved, f"Faux mouvement détecté dans le noir : score={score:.4f} >= seuil={MOTION_THRESH}")

if __name__ == "__main__":
    unittest.main()

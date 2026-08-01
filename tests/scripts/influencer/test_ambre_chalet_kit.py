"""Contrats éditoriaux du kit de publication AMBRE chalet v02."""

import importlib.util
from pathlib import Path
import sys
import unittest


RACINE = Path(__file__).resolve().parents[3]
SCRIPT = RACINE / 'scripts' / 'influencer' / 'build-ambre-chalet-kit.py'
SPEC = importlib.util.spec_from_file_location('build_ambre_chalet_kit', SCRIPT)
assert SPEC and SPEC.loader
kit = importlib.util.module_from_spec(SPEC)
sys.modules['build_ambre_chalet_kit'] = kit
SPEC.loader.exec_module(kit)


class ContratEditorialTest(unittest.TestCase):
    def test_la_transparence_est_le_premier_paragraphe(self) -> None:
        premier = kit.DESCRIPTION.split('\n\n', 1)[0].lower()
        self.assertIn('créatrice virtuelle', premier)
        self.assertIn('avec l’ia', premier)
        self.assertIn('ne relate pas un voyage réel', premier)

    def test_les_quinze_tags_sont_uniques(self) -> None:
        self.assertEqual(len(kit.TAGS), 15)
        self.assertEqual(len({tag.casefold() for tag in kit.TAGS}), 15)

    def test_les_trois_plans_recommandes_sont_exacts(self) -> None:
        self.assertEqual(set(kit.PLANS), {'16', '22', '31'})
        self.assertEqual(kit.PLANS['31'], 74.60)

    def test_la_checklist_garde_les_deux_blocages_humains(self) -> None:
        self.assertIn('contenu modifié ou synthétique', kit.CHECKLIST)
        self.assertIn('Epidemic Sound', kit.CHECKLIST)
        self.assertIn('[[...]]', kit.CHECKLIST)


if __name__ == '__main__':
    unittest.main()

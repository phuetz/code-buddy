"""Contrats éditoriaux du kit de publication LISA « 5 signaux » v4."""

import importlib.util
from pathlib import Path
import sys
import unittest


RACINE = Path(__file__).resolve().parents[3]
SCRIPT = RACINE / 'scripts/influencer/build-lisa-signaux-kit.py'
SPEC = importlib.util.spec_from_file_location('build_lisa_signaux_kit', SCRIPT)
assert SPEC and SPEC.loader
kit = importlib.util.module_from_spec(SPEC)
sys.modules['build_lisa_signaux_kit'] = kit
SPEC.loader.exec_module(kit)


class ContratEditorialTest(unittest.TestCase):
    def test_la_transparence_ouvre_la_description(self) -> None:
        premier = kit.DESCRIPTION.split('\n\n', 1)[0].lower()
        self.assertIn('créatrice virtuelle', premier)
        self.assertIn('générés avec l’ia', premier)
        self.assertIn('ni voyage ni test personnel', premier)

    def test_les_titres_restent_sous_soixante_caracteres(self) -> None:
        self.assertEqual(len(kit.TITRES_RECOMMANDES), 5)
        self.assertTrue(all(len(titre) < 60 for titre in kit.TITRES_RECOMMANDES))

    def test_les_quinze_tags_sont_uniques(self) -> None:
        self.assertEqual(len(kit.TAGS), 15)
        self.assertEqual(len({tag.casefold() for tag in kit.TAGS}), 15)

    def test_les_douze_chapitres_sont_ordonnes(self) -> None:
        lignes = kit.CHAPITRES.strip().splitlines()
        self.assertEqual(len(lignes), 12)
        self.assertTrue(lignes[0].startswith('00:00 '))
        self.assertTrue(lignes[-1].startswith('08:13 '))

    def test_la_checklist_impose_le_v4_et_la_declaration_ia(self) -> None:
        self.assertIn('exclusivement `lisa-vision-ia-5-signaux-v4.mp4`', kit.CHECKLIST)
        self.assertIn('contenu modifié ou synthétique', kit.CHECKLIST)
        self.assertIn('[[...]]', kit.CHECKLIST)

    def test_la_provenance_imagegen_est_documentee(self) -> None:
        self.assertIn('Use case: ads-marketing', kit.IMAGEGEN_PROMPT)
        self.assertIn('strict identity reference', kit.IMAGEGEN_PROMPT)

    def test_le_controle_identite_refuse_sous_le_seuil_canonique(self) -> None:
        self.assertEqual(kit.SEUIL_IDENTITE, 0.75)


if __name__ == '__main__':
    unittest.main()

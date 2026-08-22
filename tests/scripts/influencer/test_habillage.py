"""Tests du contrôle d'habillage : il doit surtout savoir **refuser**.

Un contrôle qui ne trouve rien ne prouve rien. Chaque test « conforme » a donc
son jumeau qui remet délibérément le défaut d'origine — texte trop long pour
son cadre, blanc sur blanc, élément qui recouvre le texte — et vérifie que la
fabrication échoue.
"""

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw


RACINE = Path(__file__).resolve().parents[3]
SCRIPT = RACINE / 'scripts' / 'influencer' / 'habillage.py'
SPEC = importlib.util.spec_from_file_location('habillage', SCRIPT)
assert SPEC and SPEC.loader
habillage = importlib.util.module_from_spec(SPEC)
sys.modules['habillage'] = habillage
SPEC.loader.exec_module(habillage)

Boite = habillage.Boite
HabillageError = habillage.HabillageError
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def dessiner(bloc, fond='#101010', taille=(960, 200), obstacle=None):
    """Rend un bloc sur un fond donné et renvoie le chemin de l'image."""
    image = Image.new('RGB', taille, fond)
    dessin = ImageDraw.Draw(image)
    fonte = habillage.police(bloc.chemin_police, bloc.taille)
    pas = int(round(bloc.taille * bloc.interligne))
    decalage = fonte.getbbox(bloc.lignes[0] or 'Hg')[1]
    x, y = bloc.origine
    for index, ligne in enumerate(bloc.lignes):
        dessin.text((x, y + index * pas - decalage), ligne,
                    font=fonte, fill=bloc.couleur)
    if obstacle is not None:
        boite, couleur = obstacle
        dessin.rectangle([boite.x, boite.y, boite.droite, boite.bas], fill=couleur)
    chemin = Path(tempfile.mkstemp(suffix='.png')[1])
    image.save(chemin)
    return chemin


class ContrasteWcagTest(unittest.TestCase):
    def test_les_ratios_de_reference_sont_exacts(self) -> None:
        self.assertAlmostEqual(habillage.contraste('#000000', '#ffffff'), 21.0, places=4)
        self.assertAlmostEqual(habillage.contraste('#ffffff', '#ffffff'), 1.0, places=4)
        # Gris de référence WCAG : #767676 sur blanc = 4,54:1 (seuil AA).
        self.assertAlmostEqual(
            habillage.contraste('#767676', '#ffffff'), 4.54, places=2)


class AjustementTest(unittest.TestCase):
    def test_le_corps_est_reduit_jusqu_a_tenir_dans_le_cadre(self) -> None:
        cadre = Boite(0, 0, 600, 200)
        ajustement = habillage.ajuster_au_cadre(
            'UN TITRE PLUTOT LONG', FONT, cadre, 96, taille_min=20, lignes_max=1)
        self.assertLess(ajustement.taille, 96)
        self.assertLessEqual(ajustement.largeur, cadre.largeur)
        self.assertLessEqual(ajustement.hauteur, cadre.hauteur)

    def test_le_texte_passe_a_la_ligne_quand_c_est_permis(self) -> None:
        cadre = Boite(0, 0, 700, 220)
        ajustement = habillage.ajuster_au_cadre(
            'Un million de tokens n’est pas un million de preuves',
            FONT, cadre, 66, taille_min=30, lignes_max=2)
        self.assertEqual(len(ajustement.lignes), 2)
        self.assertLessEqual(ajustement.largeur, cadre.largeur)

    def test_un_texte_qui_ne_tient_pas_fait_echouer_la_fabrication(self) -> None:
        """Le défaut d'origine : « ELLE AGIT » posé en travers de son cadre."""
        cadre = Boite(0, 0, 120, 40)
        with self.assertRaises(HabillageError) as capture:
            habillage.ajuster_au_cadre(
                'UN TEXTE BEAUCOUP TROP LONG POUR CE CADRE MINUSCULE',
                FONT, cadre, 96, taille_min=44, lignes_max=1, nom='accroche')
        self.assertIn('accroche', str(capture.exception))
        self.assertIn('ne tient pas', str(capture.exception))


class LisibiliteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.bloc = habillage.Bloc(
            nom='carton', lignes=['ATTRIBUTION OFFICIELLE'],
            chemin_police=FONT, taille=40, origine=(40, 60), couleur='#ffffff')

    def test_blanc_sur_fond_sombre_passe(self) -> None:
        image = dessiner(self.bloc, fond='#0d1018')
        mesure = habillage.mesurer_lisibilite(image, self.bloc)
        self.assertGreater(mesure.contraste, 15.0)
        self.assertEqual(habillage.controler(image, [self.bloc]), [])

    def test_blanc_sur_blanc_est_refuse(self) -> None:
        """Le défaut le plus grave : le carton d'attribution du master Meta."""
        image = dessiner(self.bloc, fond='#f5f5f5')
        mesure = habillage.mesurer_lisibilite(image, self.bloc)
        self.assertLess(mesure.contraste, 1.2)
        with self.assertRaises(HabillageError) as capture:
            habillage.exiger(image, [self.bloc])
        self.assertIn('contraste rendu', str(capture.exception))

    def test_un_element_qui_traverse_le_texte_est_refuse(self) -> None:
        """Le mockup de téléphone qui masquait le tiers central du carton."""
        image = dessiner(
            self.bloc, fond='#0d1018',
            obstacle=(Boite(300, 0, 220, 200), '#ffffff'),
        )
        manquements = habillage.controler(image, [self.bloc])
        self.assertTrue(
            any('fond non uniforme' in m for m in manquements), manquements)

    def test_un_texte_hors_de_son_cadre_est_refuse(self) -> None:
        deborde = habillage.Bloc(
            nom='accroche', lignes=['ELLE AGIT'], chemin_police=FONT,
            taille=90, origine=(40, 60), couleur='#ffffff',
            cadre=Boite(30, 50, 200, 100),
        )
        image = dessiner(deborde, fond='#160d2f')
        with self.assertRaises(HabillageError) as capture:
            habillage.exiger(image, [deborde])
        self.assertIn('déborde de son cadre', str(capture.exception))


class ChevauchementTest(unittest.TestCase):
    def test_deux_zones_qui_se_recouvrent_sont_signalees(self) -> None:
        """La puce « Source » posée sur le bandeau « LISA IA »."""
        trouves = habillage.chevauchements([
            ('bandeau LISA IA', Boite(36, 25, 236, 78)),
            ('puce Source', Boite(44, 34, 682, 30)),
        ])
        self.assertEqual(len(trouves), 1)
        self.assertEqual(trouves[0][0], 'bandeau LISA IA')
        self.assertGreater(trouves[0][2].aire(), 0)

    def test_une_puce_deplacee_a_droite_ne_recouvre_plus_rien(self) -> None:
        self.assertEqual(
            habillage.chevauchements([
                ('bandeau LISA IA', Boite(36, 25, 236, 78)),
                ('puce Source', Boite(298, 34, 682, 30)),
            ]),
            [],
        )


if __name__ == '__main__':
    unittest.main()

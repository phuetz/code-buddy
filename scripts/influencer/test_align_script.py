#!/usr/bin/env python3
"""Tests de l'alignement karaoké sur le script (`wrap-short.py --script`).

Le karaoké est BRÛLÉ dans l'image : un mot faux ne se rattrape pas après le rendu.
Ces tests tiennent donc la garantie centrale — le texte affiché sort du script, jamais
de la transcription — et les garde-fous qui l'entourent (instants croissants, ancrage
insuffisant signalé, entrées vides refusées).

Exécutable des deux façons :
    python3 scripts/influencer/test_align_script.py
    python3 -m unittest discover scripts/influencer
"""
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path

ICI = Path(__file__).resolve().parent
# wrap-short.py porte un tiret (imposé par la ligne de commande) : impossible à importer
# normalement. On le charge par importlib, après avoir mis son dossier dans sys.path
# puisqu'il importe son voisin video_delivery_qc.
if str(ICI) not in sys.path:
    sys.path.insert(0, str(ICI))
_spec = importlib.util.spec_from_file_location('wrap_short', ICI / 'wrap-short.py')
ws = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ws)


def mots(*triplets):
    """Fabrique une transcription whisper : (t0, t1, texte affiché par le STT)."""
    return [{'t0': t0, 't1': t1, 'w': w} for t0, t1, w in triplets]


class TexteAffiche(unittest.TestCase):
    """Le script est la SEULE source des mots montrés."""

    def test_sortie_mot_pour_mot_identique_au_script(self):
        script = "Bonjour, ici Lisa. DeepSeek et Qwen arrivent chez vous."
        # Le STT francise tout : Liya, Deeppsych, Quen.
        stt = mots(
            (0.0, 0.4, 'Bonjour,'), (0.4, 0.7, 'ici'), (0.7, 1.1, 'Liya.'),
            (1.2, 1.8, 'Deeppsych'), (1.8, 2.0, 'et'), (2.0, 2.4, 'Quen'),
            (2.4, 2.9, 'arrivent'), (2.9, 3.1, 'chez'), (3.1, 3.5, 'vous.'),
        )
        aligne, rapport = ws.align_to_script(stt, script)
        self.assertEqual([w['w'] for w in aligne], ws.script_words(script))
        self.assertEqual(rapport['mots_script'], 9)
        self.assertEqual(rapport['mots_stt'], 9)

    def test_mot_invente_par_whisper_absent_de_la_sortie(self):
        script = "Grok 4.6 change la donne."
        stt = mots(
            (0.0, 0.5, 'GROC'), (0.5, 0.9, '4.6'), (0.9, 1.3, 'change'),
            (1.3, 1.5, 'la'), (1.5, 1.9, 'donne.'),
        )
        aligne, _ = ws.align_to_script(stt, script, min_anchor_ratio=0.1)
        texte = ' '.join(w['w'] for w in aligne)
        self.assertNotIn('GROC', texte)
        self.assertNotIn('Groc', texte)
        self.assertIn('Grok', texte)

    def test_mots_ajoutes_par_le_stt_disparaissent(self):
        # Hésitations et faux départs entendus mais absents du script.
        script = "On teste Kimi K3."
        stt = mots(
            (0.0, 0.3, 'Euh'), (0.3, 0.6, 'alors'), (0.6, 0.9, 'On'),
            (0.9, 1.3, 'teste'), (1.3, 1.7, 'Kimi'), (1.7, 2.1, 'K3.'),
            (2.1, 2.4, 'voilà'),
        )
        aligne, rapport = ws.align_to_script(stt, script)
        self.assertEqual([w['w'] for w in aligne], ['On', 'teste', 'Kimi', 'K3.'])
        for parasite in ('Euh', 'alors', 'voilà'):
            self.assertNotIn(parasite, [w['w'] for w in aligne])
        self.assertEqual(rapport['mots_stt'], 7)
        self.assertEqual(rapport['mots_script'], 4)


class Instants(unittest.TestCase):
    """Les instants viennent du STT et doivent rester jouables."""

    SCRIPT = ("Bonjour à tous. Aujourd'hui, Fable 5 et Opus 5 se répondent "
              "sur un banc d'agents vraiment exigeant.")
    STT = mots(
        (0.5, 0.9, 'Bonjour'), (0.9, 1.0, 'à'), (1.0, 1.4, 'tous.'),
        (1.6, 2.2, "Aujourd'hui,"), (2.2, 2.6, "s'effable"), (2.6, 2.9, '5'),
        (2.9, 3.0, 'et'), (3.0, 3.4, 'Au'), (3.4, 3.6, 'plus'), (3.6, 3.8, '5'),
        (3.8, 4.2, 'se'), (4.2, 4.7, 'répondent'), (4.7, 4.9, 'sur'),
        (4.9, 5.1, 'un'), (5.1, 5.5, 'banc'), (5.5, 5.7, "d'agents"),
        (5.7, 6.3, 'exigeant.'),
    )

    def test_instants_croissants_et_dans_la_plage_du_stt(self):
        aligne, _ = ws.align_to_script(self.STT, self.SCRIPT, min_anchor_ratio=0.1)
        debut, fin = self.STT[0]['t0'], max(w['t1'] for w in self.STT)
        precedent = debut
        for mot in aligne:
            self.assertIsNotNone(mot['t0'], mot)
            self.assertIsNotNone(mot['t1'], mot)
            self.assertGreaterEqual(mot['t0'], precedent - 1e-9, mot)
            self.assertGreaterEqual(mot['t1'], mot['t0'] - 1e-9, mot)
            self.assertGreaterEqual(mot['t0'], debut - 1e-9, mot)
            self.assertLessEqual(mot['t1'], fin + 1e-9, mot)
            precedent = mot['t0']

    def test_mots_manques_par_le_stt_recoivent_des_instants_interpoles(self):
        # Le STT a sauté « vraiment » : le mot doit quand même être daté, dans le trou.
        aligne, _ = ws.align_to_script(self.STT, self.SCRIPT, min_anchor_ratio=0.1)
        par_mot = {w['w']: w for w in aligne}
        self.assertIn('vraiment', par_mot)
        vraiment = par_mot['vraiment']
        self.assertGreaterEqual(vraiment['t0'], par_mot["d'agents"]['t1'] - 1e-9)
        self.assertLessEqual(vraiment['t1'], par_mot['exigeant.']['t0'] + 1e-9)
        self.assertGreater(vraiment['t1'], vraiment['t0'])

    def test_mot_manque_en_plein_debit_reste_visible(self):
        # Whisper ne laisse aucun silence entre deux mots reconnus : sans emprunt aux
        # voisins, le mot sauté hériterait d'un trou de durée nulle et ne s'afficherait
        # jamais — le script l'aurait rétabli pour rien.
        script = "Il tourne vraiment vite."
        stt = mots((0.0, 1.0, 'Il'), (1.0, 2.0, 'tourne'), (2.0, 3.0, 'vite.'))
        aligne, _ = ws.align_to_script(stt, script, min_anchor_ratio=0.1)
        par_mot = {w['w']: w for w in aligne}
        self.assertGreaterEqual(par_mot['vraiment']['t1'] - par_mot['vraiment']['t0'],
                                ws.MIN_WORD_DURATION - 1e-9)
        # Le temps est repris aux ancres voisines, jamais plus de la moitié de leur durée.
        self.assertGreaterEqual(par_mot['tourne']['t1'] - par_mot['tourne']['t0'], 0.5)
        self.assertGreaterEqual(par_mot['vite.']['t1'] - par_mot['vite.']['t0'], 0.5)
        # …et l'ensemble reste dans la plage du STT, dans l'ordre.
        self.assertGreaterEqual(par_mot['Il']['t0'], 0.0)
        self.assertLessEqual(par_mot['vite.']['t1'], 3.0)
        instants = [w['t0'] for w in aligne]
        self.assertEqual(instants, sorted(instants))

    def test_un_mot_long_recoit_une_part_plus_grande_qu_un_mot_court(self):
        # Trou de 4 s entre deux ancres, quatre mots que le STT n'a pas rendus.
        script = "Bonjour tu vois extraordinairement bien Grok"
        stt = mots((0.0, 1.0, 'Bonjour'), (5.0, 5.5, 'Grok'))
        aligne, _ = ws.align_to_script(stt, script, min_anchor_ratio=0.1)
        duree = {w['w']: w['t1'] - w['t0'] for w in aligne}
        self.assertGreater(duree['extraordinairement'], duree['tu'])
        self.assertGreater(duree['extraordinairement'], duree['bien'])
        for mot in ('tu', 'vois', 'extraordinairement', 'bien'):
            self.assertGreater(duree[mot], 0.0)
        comble = sum(duree[m] for m in ('tu', 'vois', 'extraordinairement', 'bien'))
        self.assertAlmostEqual(comble, 4.0, places=6)  # 1.0 → 5.0, tout le trou


class GardeFous(unittest.TestCase):
    """Mieux vaut s'arrêter que graver un karaoké faux."""

    def test_script_hors_sujet_signale_un_ancrage_insuffisant(self):
        stt = mots(
            (0.0, 0.4, 'Kimi'), (0.4, 0.8, 'K3'), (0.8, 1.2, 'pèse'),
            (1.2, 1.8, 'deux'), (1.8, 2.4, 'mille'), (2.4, 3.0, 'milliards'),
        )
        aligne, rapport = ws.align_to_script(stt, "Ma tante joue du piano dimanche prochain.")
        self.assertFalse(rapport['suffisant'])
        self.assertLess(rapport['taux_ancrage'], 0.35)
        # Le résultat reste exploitable pour un diagnostic, mais l'appelant doit refuser.
        self.assertEqual([w['w'] for w in aligne][:2], ['Ma', 'tante'])

    def test_script_correspondant_est_juge_suffisant(self):
        stt = mots((0.0, 0.4, 'Kimi'), (0.4, 0.8, 'K3'), (0.8, 1.2, 'arrive.'))
        _, rapport = ws.align_to_script(stt, "Kimi K3 arrive.")
        self.assertTrue(rapport['suffisant'])
        self.assertEqual(rapport['ancres'], 3)
        self.assertEqual(rapport['taux_ancrage'], 1.0)

    def test_script_vide_leve_valueerror(self):
        stt = mots((0.0, 0.4, 'Bonjour'))
        with self.assertRaises(ValueError):
            ws.align_to_script(stt, '')
        with self.assertRaises(ValueError):
            # Un script réduit à du markdown ne contient aucun mot à afficher.
            ws.align_to_script(stt, "## Titre\n---\n")

    def test_transcription_vide_leve_valueerror(self):
        with self.assertRaises(ValueError):
            ws.align_to_script([], "Bonjour à tous.")


class ScriptWords(unittest.TestCase):
    """Le script est écrit pour être LU : le markdown d'édition ne doit pas s'afficher."""

    def test_retire_titres_separateurs_didascalies_emphases_et_crochets(self):
        script = (
            "## 0:05 — Empilement\n"
            "---\n"
            "**Décor : salon, lumière rasante**\n"
            "**Qwen 3.8** arrive [pause] chez vous.\n"
        )
        self.assertEqual(ws.script_words(script), ['Qwen', '3.8', 'arrive', 'chez', 'vous.'])

    def test_garde_la_ponctuation_collee_aux_mots(self):
        # La ponctuation porte la respiration : c'est elle qui découpe les cartes.
        self.assertEqual(
            ws.script_words("Ouvert. Pas dans votre salon, non ?"),
            ['Ouvert.', 'Pas', 'dans', 'votre', 'salon,', 'non\u00a0?'],
        )

    def test_la_ponctuation_isolee_rejoint_son_mot(self):
        """Aucun signe ne doit disparaître, aucun ne doit occuper une case à lui seul.

        La typographie française met une espace avant « : ; ? ! » » : ces signes arrivent
        donc isolés. Les jeter coûtait 140 signes sur la longue GLM — dont les guillemets
        des citations que la vidéo réfute, qui devenaient des affirmations de Lisa.
        """
        self.assertEqual(
            ws.script_words("Merci d'avoir regardé — à très vite."),
            ['Merci', "d'avoir", 'regardé —', 'à', 'très', 'vite.'],
        )

    def test_les_guillemets_encadrent_bien_la_citation(self):
        sortie = ws.script_words("Il a dit : « ouvert ne veut pas dire local ». Faux.")
        self.assertEqual(
            sortie,
            ['Il', 'a', 'dit\u00a0:', '«\u00a0ouvert', 'ne', 'veut', 'pas', 'dire',
             'local\u00a0».', 'Faux.'],
        )

    def test_aucun_signe_de_ponctuation_ne_se_perd(self):
        # Contrôle de conservation : ce qui entre en ponctuation doit ressortir.
        script = ("Deux fronts : « le salon » et « l'affiche ». Lequel gagne ? "
                  "Aucun — les deux avancent.")
        sortie = ' '.join(ws.script_words(script))
        for signe in '«»:?—.':
            self.assertEqual(
                sortie.count(signe), script.count(signe),
                f'{signe!r} perdu : {script.count(signe)} dans le script, '
                f'{sortie.count(signe)} en sortie',
            )

    def test_aucun_jeton_vide_ni_purement_ponctuation(self):
        script = "Il a dit : « ouvert ». Puis — silence. Vraiment ?"
        for mot in ws.script_words(script):
            self.assertTrue(mot.strip(ws._PONCTUATION_SEULE + '\u00a0'), repr(mot))


BASE_REELLE = Path(os.path.expanduser(
    '~/.codebuddy/personas/lisa/longform-02-glm-2026-08-23/work'))
WORDS_REELS = BASE_REELLE / 'cache' / 'words' / 's1.json'
BLOCS_REELS = BASE_REELLE / 'voix-blocs.json'


@unittest.skipUnless(WORDS_REELS.exists() and BLOCS_REELS.exists(),
                     f'jeu réel absent ({WORDS_REELS})')
class CasReel(unittest.TestCase):
    """Bout en bout sur la prise s1 du long-format GLM (mots whisper réels)."""

    @classmethod
    def setUpClass(cls):
        cls.words = json.loads(WORDS_REELS.read_text(encoding='utf-8'))
        blocs = json.loads(BLOCS_REELS.read_text(encoding='utf-8'))
        cls.script = cls._bloc_du_segment(blocs, cls.words)

    @staticmethod
    def _bloc_du_segment(blocs, words):
        """Repère le bloc de narration correspondant en comparant les débuts de phrase."""
        import difflib
        debut_stt = ' '.join(ws._align_key(w['w']) for w in words[:12])
        meilleur, score = None, -1.0
        for bloc in blocs:
            tetes = ws.script_words(bloc.get('voix', ''))[:12]
            debut = ' '.join(ws._align_key(t) for t in tetes)
            r = difflib.SequenceMatcher(None, debut_stt, debut).ratio()
            if r > score:
                meilleur, score = bloc, r
        return meilleur['voix']

    def test_ancrage_majoritaire_et_noms_propres_corriges(self):
        aligne, rapport = ws.align_to_script(self.words, self.script)
        self.assertTrue(rapport['suffisant'], rapport)
        self.assertGreater(rapport['taux_ancrage'], 0.5, rapport)

        texte = ' '.join(w['w'] for w in aligne)
        self.assertIn('Qwen', self.script)  # le script écrit bien le nom correctement
        self.assertIn('Quen', ' '.join(w['w'] for w in self.words))  # whisper le francise
        self.assertIn('Qwen', texte)
        self.assertNotIn('Quen', texte)
        self.assertEqual([w['w'] for w in aligne], ws.script_words(self.script))

    def test_instants_reels_croissants_et_bornes(self):
        aligne, _ = ws.align_to_script(self.words, self.script)
        debut = self.words[0]['t0']
        fin = max(w['t1'] for w in self.words)
        precedent = debut
        for mot in aligne:
            self.assertGreaterEqual(mot['t0'], precedent - 1e-9, mot)
            self.assertGreaterEqual(mot['t1'], mot['t0'] - 1e-9, mot)
            self.assertLessEqual(mot['t1'], fin + 1e-9, mot)
            precedent = mot['t0']


class TraitsUnion(unittest.TestCase):
    """Whisper coupe les mots composés ; le carton ne doit jamais se réduire au tiret.

    Mesuré le 24/08 sur les Shorts déjà rendus : L3 affichait « -là. » et « -même. »,
    L4 « -delà », V1 « -ce » — des cartons entiers vidés de leur mot.
    """

    @staticmethod
    def _mots(tokens):
        return [{'w': t, 't0': i * 0.3, 't1': i * 0.3 + 0.28} for i, t in enumerate(tokens)]

    def test_recolle_un_mot_compose_eclate(self):
        sortie = ws.merge_apostrophes(self._mots(['au', '-delà', 'de', 'ça']))
        self.assertEqual([w['w'] for w in sortie], ['au-delà', 'de', 'ça'])

    def test_recolle_en_gardant_la_ponctuation_finale(self):
        sortie = ws.merge_apostrophes(self._mots(['ce', 'travail', '-là.', 'Toi', '-même.']))
        self.assertEqual([w['w'] for w in sortie], ['ce', 'travail-là.', 'Toi-même.'])

    def test_recolle_apres_une_apostrophe(self):
        sortie = ws.merge_apostrophes(self._mots(["qu'est", '-ce', 'que']))
        self.assertEqual([w['w'] for w in sortie], ["qu'est-ce", 'que'])

    def test_un_tiret_seul_reste_une_respiration(self):
        # Le cadratin isolé est une pause voulue par le script, pas une coupure de whisper.
        sortie = ws.merge_apostrophes(self._mots(['regardé', '—', 'à', 'très', 'vite']))
        self.assertEqual([w['w'] for w in sortie], ['regardé', '—', 'à', 'très', 'vite'])

    def test_le_recollage_preserve_les_instants(self):
        sortie = ws.merge_apostrophes(self._mots(['au', '-delà', 'de']))
        self.assertAlmostEqual(sortie[0]['t0'], 0.0)
        self.assertAlmostEqual(sortie[0]['t1'], 0.58)  # fin du second jeton


_SPEC_SRT = importlib.util.spec_from_file_location(
    'srt_from_script', Path(__file__).resolve().parent / 'srt_from_script.py')
srt = importlib.util.module_from_spec(_SPEC_SRT)
_SPEC_SRT.loader.exec_module(srt)


class DecoupageSousTitres(unittest.TestCase):
    """Ce que le spectateur lit : deux lignes, 42 caractères, et un chiffre entier."""

    @staticmethod
    def _mots(texte, pas=0.4):
        return [{'w': w, 't0': i * pas, 't1': (i + 1) * pas}
                for i, w in enumerate(texte.split())]

    def test_le_nombre_ne_se_separe_jamais_de_son_unite(self):
        # Mesuré sur le Short L5 : « Kimi K3, 2700 » finissait un carton et « milliards »
        # ouvrait le suivant — le chiffre est pourtant l'argument de la vidéo.
        cartons = srt.decouper(self._mots(
            'Nouveau monstre Open Source, Kimi K3, 2700 milliards de paramètres mais surtout'))
        for carton in cartons:
            self.assertNotEqual(carton[-1]['w'].rstrip('.,'), '2700',
                                'le nombre a été coupé de son unité')

    def test_aucune_ligne_ne_depasse_deux_fois_la_largeur(self):
        texte = ('Un carton doit toujours tenir sur deux lignes de quarante-deux signes '
                 'sans quoi le lecteur de YouTube replie le texte où il veut')
        for carton in srt.decouper(self._mots(texte)):
            rendu = srt.plier(' '.join(m['w'] for m in carton))
            self.assertLessEqual(len(rendu.split('\n')), srt.MAX_LIGNES, rendu)

    def test_le_pliage_ne_coupe_pas_dans_un_mot(self):
        rendu = srt.plier('Claude Opus 4.6 tourne en local sur une machine normale aujourd hui')
        self.assertEqual(rendu.replace('\n', ' '),
                         'Claude Opus 4.6 tourne en local sur une machine normale aujourd hui')

    def test_les_instants_ne_se_chevauchent_pas(self):
        cartons = srt.decouper(self._mots('un deux trois quatre cinq six sept huit neuf dix'))
        bornes = srt.bornes(cartons, fin_totale=99.0)
        for (a0, a1), (b0, _) in zip(bornes, bornes[1:]):
            self.assertLessEqual(a1, b0 + 1e-9, f'{a1} déborde sur {b0}')
            self.assertLess(a0, a1)

    def test_un_carton_bref_est_etire_jusqu_au_seuil_de_lecture(self):
        cartons = [[{'w': 'Ouvert.', 't0': 1.0, 't1': 1.05}],
                   [{'w': 'Ensuite.', 't0': 9.0, 't1': 9.4}]]
        bornes = srt.bornes(cartons, fin_totale=20.0)
        self.assertAlmostEqual(bornes[0][1] - bornes[0][0], srt.MIN_DUREE, places=3)

    def test_le_srt_rendu_est_bien_forme(self):
        alignes = self._mots('Qwen 3.8 tourne en local. Gratuit. Hors ligne.')
        rendu = srt.rendre_srt(alignes, fin_totale=10.0)
        self.assertTrue(rendu.startswith('1\n'))
        self.assertIn(' --> ', rendu)
        self.assertNotIn('\n\n\n', rendu)


if __name__ == '__main__':
    unittest.main(verbosity=2)

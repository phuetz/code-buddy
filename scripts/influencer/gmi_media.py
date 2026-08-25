#!/usr/bin/env python3
"""GMI Cloud — voix (Speech 2.8) et musique (Music 3.0) par la file de génération.

L'offre MiniMax de GMI Cloud rend M3, M2.7, Speech 2.8 et Music 3.0 illimités du 24/08 au
6/09/2026 (https://www.gmicloud.ai/minimax-week). Passé cette date, VÉRIFIER avant de s'en
servir : un palier gratuit peut disparaître sans préavis — celui de MiniMax M3 chez
OpenRouter a vécu deux heures le 25/08.

Deux pièges qui coûtent une demi-heure chacun, réglés ici une fois pour toutes :

* Cloudflare renvoie « error code: 1010 » sur l'agent utilisateur par défaut de Python.
  Il faut un User-Agent de navigateur — curl et Node passent sans rien faire.
* Music 3.0 EXIGE le champ `lyrics`, même pour un morceau instrumental : passer
  `[instrumental]`. Sans lui, la requête est rejetée avant d'entrer dans la file.

Usage :
    gmi_media.py voix   "texte à dire"            --out voix.mp3 [--modele …]
    gmi_media.py musique "description du morceau"  --out lit.mp3  [--paroles "…"]
    gmi_media.py modeles [motif]        # ce que la clé donne réellement, aujourd'hui
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

BASE = 'https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey'
MEDIA_ENV = Path('~/.codebuddy/media.env').expanduser()
# Un agent utilisateur de navigateur : sans lui, Cloudflare coupe avant l'API.
ENTETES_BASE = {'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}


def cle() -> str:
    valeur = os.environ.get('GMI_API_KEY')
    if valeur:
        return valeur.strip()
    try:
        for ligne in MEDIA_ENV.read_text(encoding='utf-8').splitlines():
            if ligne.startswith('GMI_API_KEY='):
                return ligne.split('=', 1)[1].strip().strip('\'"')
    except OSError:
        pass
    sys.exit(f'GMI_API_KEY introuvable (ni dans l\'environnement, ni dans {MEDIA_ENV})')


def appel(chemin: str, corps: dict | None = None, methode: str = 'GET') -> dict:
    entetes = {**ENTETES_BASE, 'Authorization': f'Bearer {cle()}'}
    donnees = json.dumps(corps).encode() if corps is not None else None
    req = urllib.request.Request(f'{BASE}{chemin}', data=donnees, headers=entetes, method=methode)
    try:
        return json.loads(urllib.request.urlopen(req, timeout=120).read())
    except urllib.error.HTTPError as err:
        detail = ''
        try:
            detail = err.read().decode()[:300]
        except OSError:
            pass
        sys.exit(f'GMI a refusé la requête ({err.code}) : {detail}')


def attendre(request_id: str, patience_s: int = 300) -> dict:
    """Interroge la file jusqu'au verdict. Rend l'`outcome`, ou s'arrête en disant pourquoi."""
    debut = time.time()
    while time.time() - debut < patience_s:
        etat = appel(f'/requests/{request_id}')
        statut = etat.get('status')
        if statut == 'success':
            return etat.get('outcome') or {}
        if statut == 'failed':
            sys.exit(f'génération échouée : {json.dumps(etat, ensure_ascii=False)[:300]}')
        time.sleep(4)
    sys.exit(f'toujours pas de résultat après {patience_s} s (requête {request_id})')


def telecharger(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    destination.write_bytes(urllib.request.urlopen(req, timeout=300).read())
    return destination


def generer(modele: str, charge: dict, sortie: Path) -> Path:
    depart = appel('/requests', {'model': modele, 'payload': charge}, methode='POST')
    identifiant = depart.get('request_id')
    if not identifiant:
        sys.exit(f'GMI n\'a pas ouvert de requête : {json.dumps(depart, ensure_ascii=False)[:300]}')
    print(f'  {modele} — requête {identifiant}', file=sys.stderr)
    resultat = attendre(identifiant)
    url = resultat.get('audio_url') or resultat.get('url') or resultat.get('video_url')
    if not url:
        sys.exit(f'aucun média dans la réponse : {json.dumps(resultat, ensure_ascii=False)[:300]}')
    return telecharger(url, sortie)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sous = ap.add_subparsers(dest='action', required=True)

    v = sous.add_parser('voix', help='synthèse vocale (Speech 2.8)')
    v.add_argument('texte')
    v.add_argument('--out', required=True)
    v.add_argument('--modele', default='minimax-tts-speech-2.8-hd')
    v.add_argument('--voix', default='', help="identifiant de voix ; vide = voix par défaut du modèle")

    m = sous.add_parser('musique', help='génération musicale (Music 3.0)')
    m.add_argument('description')
    m.add_argument('--out', required=True)
    m.add_argument('--modele', default='minimax-music-3.0')
    m.add_argument('--paroles', default='[instrumental]',
                   help='champ EXIGÉ par le modèle ; « [instrumental] » pour un lit sans voix')

    lm = sous.add_parser('modeles', help="ce que la clé donne réellement, aujourd'hui")
    lm.add_argument('motif', nargs='?', default='')

    a = ap.parse_args()

    if a.action == 'modeles':
        ids = appel('/models').get('model_ids', [])
        retenus = sorted(i for i in ids if a.motif.lower() in i.lower())
        print(f'{len(retenus)} modèle(s) sur {len(ids)}')
        for i in retenus:
            print(' ', i)
        return

    if a.action == 'voix':
        charge: dict = {'text': a.texte}
        if a.voix:
            charge['voice_id'] = a.voix
        chemin = generer(a.modele, charge, Path(os.path.expanduser(a.out)))
    else:
        chemin = generer(a.modele, {'prompt': a.description, 'lyrics': a.paroles},
                         Path(os.path.expanduser(a.out)))

    print(f'{chemin} — {chemin.stat().st_size} octets')


if __name__ == '__main__':
    main()

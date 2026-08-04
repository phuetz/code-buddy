#!/usr/bin/env python3
"""Trie les rushes Flow selon le seul défaut qui les rend inutilisables : le texte incrusté.

Un plan généré qui porte un sous-titre, une légende inventée ou un carton ne peut
être monté nulle part — le texte est dans l'image, on ne l'enlève pas. Les autres
défauts (cadrage, rythme, lumière) se rattrapent au montage ou se jugent à l'œil ;
celui-là est éliminatoire et se détecte mécaniquement. C'est donc le seul que ce
script tranche, et il ne prétend pas juger la qualité artistique.

Méthode : quelques images échantillonnées par vidéo (ffmpeg), OCR Tesseract en TSV,
et on ne retient que les mots dont la confiance ET la forme tiennent — l'OCR
« lit » volontiers du texte dans une écorce d'arbre ou des reflets.

RIEN N'EST SUPPRIMÉ NI DÉPLACÉ. Le script écrit un index JSON et, avec --link,
crée des liens symboliques dans deux dossiers de lecture (propres / à écarter).
L'original reste sa seule copie.

Usage :
    flow-quality-sort.py [--root DIR] [--frames N] [--min-conf C] [--link] [--json FILE]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_ROOT = Path('~/.codebuddy/media-video/flow-daily').expanduser()

# Un mot n'est retenu comme « vrai texte » que s'il est assez long ET alphabétique :
# l'OCR renvoie sans cesse des « |1 », « ~ », « e » sur des textures naturelles.
WORD_RE = re.compile(r'^[A-Za-zÀ-ÿ0-9]{3,}$')


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def video_duration(path: Path) -> float:
    p = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=nw=1:nk=1', str(path)])
    try:
        return float(p.stdout.strip())
    except ValueError:
        return 0.0


def sample_frames(path: Path, out_dir: Path, count: int) -> list[Path]:
    """Images réparties dans la durée, en évitant la toute première (souvent noire)."""
    duration = video_duration(path)
    if duration <= 0:
        return []
    frames: list[Path] = []
    for i in range(count):
        # réparti sur [10%, 90%] pour éviter fondus d'ouverture et de fermeture
        t = duration * (0.1 + 0.8 * (i / max(1, count - 1)))
        dest = out_dir / f'{path.stem}-{i:02d}.png'
        p = run(['ffmpeg', '-v', 'error', '-ss', f'{t:.2f}', '-i', str(path),
                 '-frames:v', '1', '-y', str(dest)])
        if p.returncode == 0 and dest.exists():
            frames.append(dest)
    return frames


def detect_text(frame: Path, min_conf: int) -> list[str]:
    """Mots crédibles lus dans une image. Liste vide = image jugée sans texte."""
    p = run(['tesseract', str(frame), 'stdout', '--psm', '11', '-l', 'fra+eng', 'tsv'])
    if p.returncode != 0:
        return []
    words: list[str] = []
    for line in p.stdout.splitlines()[1:]:
        cols = line.split('\t')
        if len(cols) < 12:
            continue
        try:
            conf = float(cols[10])
        except ValueError:
            continue
        word = cols[11].strip()
        if conf >= min_conf and WORD_RE.match(word):
            words.append(word)
    return words


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    ap.add_argument('--frames', type=int, default=4, help='images échantillonnées par vidéo')
    ap.add_argument('--min-conf', type=int, default=70, help='confiance OCR minimale (0-100)')
    # Mesuré sur des témoins : un vrai bandeau incrusté produit 28 à 74 mots, tandis que
    # l'OCR « lit » 2 ou 3 mots courts dans une écorce ou des reflets. Un seuil bas
    # écarterait donc des rushes parfaitement sains ; 8 sépare nettement les deux cas.
    ap.add_argument('--min-words', type=int, default=8,
                    help='mots crédibles à partir desquels la vidéo est écartée (défaut calibré sur témoins)')
    ap.add_argument('--link', action='store_true',
                    help='crée des liens symboliques de lecture (aucune copie, aucun déplacement)')
    ap.add_argument('--json', type=Path, help='où écrire l’index (défaut : <root>/quality-index.json)')
    args = ap.parse_args()

    if not args.root.exists():
        print(f'Racine introuvable : {args.root}', file=sys.stderr)
        return 1
    for binary in ('ffmpeg', 'ffprobe', 'tesseract'):
        if not shutil.which(binary):
            print(f'{binary} est requis et absent du PATH.', file=sys.stderr)
            return 1

    videos = sorted(args.root.rglob('*.mp4'))
    if not videos:
        print(f'Aucune vidéo sous {args.root}.')
        return 0

    clean: list[dict] = []
    flagged: list[dict] = []
    with tempfile.TemporaryDirectory(prefix='flow-qc-') as tmp:
        tmp_dir = Path(tmp)
        for n, video in enumerate(videos, 1):
            frames = sample_frames(video, tmp_dir, args.frames)
            hits: list[str] = []
            for frame in frames:
                hits.extend(detect_text(frame, args.min_conf))
                frame.unlink(missing_ok=True)
            entry = {
                'path': str(video),
                'relative': str(video.relative_to(args.root)),
                'framesChecked': len(frames),
                'words': sorted(set(hits))[:12],
                'wordCount': len(hits),
            }
            if len(hits) >= args.min_words:
                flagged.append(entry)
                verdict = f'TEXTE ({len(hits)} mots : {", ".join(entry["words"][:4])})'
            else:
                clean.append(entry)
                verdict = 'propre'
            print(f'[{n}/{len(videos)}] {video.name:28s} {verdict}', flush=True)

    index = {
        'root': str(args.root),
        'settings': {'frames': args.frames, 'minConf': args.min_conf, 'minWords': args.min_words},
        'counts': {'total': len(videos), 'clean': len(clean), 'flagged': len(flagged)},
        'clean': clean,
        'flagged': flagged,
    }
    dest = args.json or (args.root / 'quality-index.json')
    dest.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')

    if args.link:
        for name, rows in (('reutilisables', clean), ('a-ecarter-texte-incruste', flagged)):
            link_dir = args.root / '_tri' / name
            link_dir.mkdir(parents=True, exist_ok=True)
            for row in rows:
                src = Path(row['path'])
                link = link_dir / f"{src.parent.name}-{src.name}"
                if link.is_symlink() or link.exists():
                    link.unlink()
                link.symlink_to(src)

    print()
    print(f'Total {len(videos)} · réutilisables {len(clean)} · à écarter {len(flagged)}')
    print(f'Index : {dest}')
    if args.link:
        print(f'Liens : {args.root / "_tri"} (symboliques — aucun fichier déplacé)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

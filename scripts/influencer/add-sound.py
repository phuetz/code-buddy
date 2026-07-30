#!/usr/bin/env python3
"""Sonorise un clip muet avec une musique et une ambiance synthétique.

Usage:
  python3 add-sound.py clip.mp4 --music mood:elegant --scene interior
  python3 add-sound.py clip.mp4 --music musique.mp3 --no-ambience --out son.mp4
"""
import argparse
import json
import os
import random
import re
import subprocess
import sys
from pathlib import Path

from video_delivery_qc import (
    DeliveryQCError,
    assert_delivery_loudness,
    write_qc_sidecar,
)


MUSIC_ROOT = os.path.expanduser('~/.codebuddy/media-audio/music')
LOUDNORM_TARGET = 'I=-14:TP=-1.5:LRA=11'
AMBIENCES = {
    'interior': 'c=brown,highpass=f=35,lowpass=f=700,volume=-34dB',
    'exterior': 'c=pink,highpass=f=80,lowpass=f=6500,volume=-38dB',
    'sea': 'c=brown,highpass=f=60,lowpass=f=2800,tremolo=f=0.12:d=0.70,volume=-30dB',
    'city': 'c=pink,highpass=f=120,lowpass=f=5500,volume=-39dB',
}


def run(cmd, capture=False):
    try:
        return subprocess.run(
            cmd, check=True, text=True, capture_output=capture)
    except FileNotFoundError:
        sys.exit(f'commande introuvable: {cmd[0]}')
    except subprocess.CalledProcessError as e:
        if e.stderr:
            print(e.stderr.rstrip(), file=sys.stderr)
        sys.exit(f'échec de {cmd[0]} (code {e.returncode})')


def media_duration(path):
    result = run([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', path,
    ], capture=True)
    try:
        duration = float(result.stdout.strip())
    except ValueError:
        sys.exit(f'durée illisible: {path}')
    if duration <= 0:
        sys.exit(f'durée invalide: {path}')
    return duration


def resolve_music(spec):
    if not spec.startswith('mood:'):
        path = os.path.abspath(os.path.expanduser(spec))
        if not os.path.isfile(path):
            sys.exit(f'musique introuvable: {path}')
        return path

    mood = spec.removeprefix('mood:').strip()
    if not mood or os.path.basename(mood) != mood:
        sys.exit(f'mood invalide: {mood!r}')
    mood_dir = os.path.join(MUSIC_ROOT, mood)
    try:
        tracks = [
            entry.path for entry in os.scandir(mood_dir)
            if entry.is_file() and entry.name.lower().endswith('.mp3')
        ]
    except FileNotFoundError:
        sys.exit(f'dossier de mood introuvable: {mood_dir}')
    if not tracks:
        sys.exit(f'aucun MP3 dans le mood {mood!r}: {mood_dir}')
    return random.choice(tracks)


def audio_filter(
    duration, gain_music, scene, ambience, loudnorm, music_input_index=0,
):
    fade_in = min(0.8, duration / 4)
    fade_out = min(1.2, duration / 4)
    fade_out_start = max(fade_in, duration - fade_out)
    filters = [
        f'[{music_input_index}:a:0]atrim=0:{duration:.6f},'
        'asetpts=PTS-STARTPTS,'
        'aresample=48000,'
        'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
        f'volume={gain_music:g}dB,'
        f'afade=t=in:st=0:d={fade_in:.6f},'
        f'afade=t=out:st={fade_out_start:.6f}:d={fade_out:.6f}[music]',
    ]
    if ambience:
        noise, processing = AMBIENCES[scene].split(',', 1)
        filters.extend([
            f'anoisesrc={noise}:r=48000:a=1:s=1337:d={duration:.6f},'
            f'{processing},'
            'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
            '[ambience]',
            '[music][ambience]amix=inputs=2:normalize=0:dropout_transition=0,'
            f'atrim=0:{duration:.6f},asetpts=PTS-STARTPTS[mix]',
        ])
    else:
        filters.append('[music]anull[mix]')
    filters.append(f'[mix]loudnorm={loudnorm}[master]')
    return ';'.join(filters)


def measure_loudnorm(music, duration, gain_music, scene, ambience):
    analysis_filter = audio_filter(
        duration, gain_music, scene, ambience,
        f'{LOUDNORM_TARGET}:print_format=json')
    result = run([
        'ffmpeg', '-hide_banner', '-v', 'info', '-stream_loop', '-1',
        '-i', music, '-filter_complex', analysis_filter, '-map', '[master]',
        '-t', f'{duration:.6f}', '-f', 'null', '-',
    ], capture=True)
    matches = re.findall(r'\{\s*"input_i".*?\}', result.stderr, re.DOTALL)
    if not matches:
        sys.exit('ffmpeg loudnorm: mesures de première passe introuvables')
    try:
        return json.loads(matches[-1])
    except json.JSONDecodeError as e:
        sys.exit(f'ffmpeg loudnorm: JSON de première passe invalide: {e}')


def loudnorm_second_pass(measured):
    required = (
        'input_i', 'input_tp', 'input_lra', 'input_thresh',
        'target_offset',
    )
    if any(key not in measured for key in required):
        sys.exit('ffmpeg loudnorm: mesures de première passe incomplètes')
    return (
        f'{LOUDNORM_TARGET}:'
        f'measured_I={measured["input_i"]}:'
        f'measured_TP={measured["input_tp"]}:'
        f'measured_LRA={measured["input_lra"]}:'
        f'measured_thresh={measured["input_thresh"]}:'
        f'offset={measured["target_offset"]}:'
        'linear=false:print_format=summary'
    )


def default_output(src):
    stem = os.path.splitext(os.path.abspath(src))[0]
    return f'{stem}-son.mp4'


def main():
    ap = argparse.ArgumentParser(
        description='Ajoute musique et ambiance à un clip muet, masterisé à -14 LUFS.')
    ap.add_argument('src', help='clip vidéo source')
    ap.add_argument(
        '--music', required=True,
        help='fichier audio direct ou mood:<nom> sous ~/.codebuddy/media-audio/music/')
    ap.add_argument(
        '--scene', choices=tuple(AMBIENCES), default='interior',
        help="profil d'ambiance synthétique (défaut: interior)")
    ap.add_argument(
        '--gain-music', type=float, default=0.0, metavar='DB',
        help='gain appliqué à la musique avant mastering (défaut: 0 dB)')
    ap.add_argument(
        '--no-ambience', action='store_true',
        help="désactive l'ambiance synthétique")
    ap.add_argument(
        '--out', help='sortie MP4 (défaut: <source>-son.mp4)')
    args = ap.parse_args()

    src = os.path.abspath(os.path.expanduser(args.src))
    if not os.path.isfile(src):
        sys.exit(f'clip introuvable: {src}')
    out = os.path.abspath(os.path.expanduser(args.out or default_output(src)))
    if os.path.realpath(out) == os.path.realpath(src):
        sys.exit('la sortie doit être différente de la source')
    music = resolve_music(args.music)
    duration = media_duration(src)

    print(f'Musique: {music}')
    print(f'Durée: {duration:.3f}s — analyse loudnorm passe 1/2')
    measured = measure_loudnorm(
        music, duration, args.gain_music, args.scene,
        not args.no_ambience)
    second_pass = loudnorm_second_pass(measured)
    render_filter = audio_filter(
        duration, args.gain_music, args.scene, not args.no_ambience,
        second_pass, music_input_index=1)

    print(f'Encodage et mastering loudnorm passe 2/2: {out}')
    run([
        'ffmpeg', '-y', '-hide_banner', '-v', 'error',
        '-i', src, '-stream_loop', '-1', '-i', music,
        '-filter_complex', render_filter,
        '-map', '0:v:0', '-map', '[master]',
        '-map_metadata', '0',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-t', f'{duration:.6f}', '-movflags', '+faststart', out,
    ])
    try:
        measurement = assert_delivery_loudness(Path(out))
        write_qc_sidecar(Path(out), measurement)
    except DeliveryQCError as error:
        sys.exit(str(error))
    print(
        f'OK {out} (musique: {os.path.basename(music)}, '
        f'ambiance: {"aucune" if args.no_ambience else args.scene})')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Orchestre les maillons existants jusqu'à la file de publication.

Ce module ne réimplémente ni la veille, ni les preuves, ni HeyGen, ni le
montage. Il lance leurs interfaces CLI et conserve un manifeste de reprise.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
from typing import Any, Sequence

from editorial_policy import find_excluded_topic
from video_delivery_qc import (
    DeliveryQCError,
    assert_no_production_markers,
    master_video_audio,
    write_qc_sidecar,
)
from publish_queue import (
    DEFAULT_AUDIT_LOG,
    DEFAULT_DATABASE,
    PLATFORMS,
    PublicationQueue,
    QueueError,
    load_evidence_attributions,
    media_duration,
)


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_WORK = Path('~/.codebuddy/influencer-production').expanduser()


class PipelineError(RuntimeError):
    pass


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineError(f'manifeste illisible : {error}') from error
    if not isinstance(value, dict):
        raise PipelineError('le manifeste doit être un objet JSON')
    return value


def atomic_manifest(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    temporary.replace(path)


def require(value: dict[str, Any], *keys: str) -> None:
    missing = [key for key in keys if not value.get(key)]
    if missing:
        raise PipelineError(f'champs manquants : {", ".join(missing)}')


def validate_editorial(manifest: dict[str, Any]) -> None:
    require(manifest, 'subject', 'persona')
    assert_no_production_markers(manifest, 'manifeste de production')
    excluded = find_excluded_topic(
        ' '.join(
            str(manifest.get(key, ''))
            for key in ('subject', 'title', 'description', 'script')
        )
    )
    if excluded:
        reason, keyword = excluded
        raise PipelineError(
            f'sujet interdit avant production : {keyword} ({reason})'
        )


def validate_format(manifest: dict[str, Any]) -> None:
    persona = str(manifest.get('persona', '')).lower()
    if persona == 'lisa':
        structure = manifest.get('structure', {})
        expected = ('0-3', '3-10', '10-45', '45-60')
        if not isinstance(structure, dict) or any(
            not structure.get(key) for key in expected
        ):
            raise PipelineError(
                'Lisa exige la structure Ninon AI 3/10/45/60 '
                '(clés 0-3, 3-10, 10-45, 45-60)'
            )
    elif persona == 'ambre':
        if manifest.get('registre') != 'douceur':
            raise PipelineError('Ambre exige registre="douceur"')
        plan_duration = float(manifest.get('plan_duration_seconds', 0))
        if not 2.5 <= plan_duration <= 3:
            raise PipelineError(
                'Ambre exige des plans de 2,5 à 3 s à mouvement interne lent'
            )
        if not manifest.get('no_hard_effects', False):
            raise PipelineError(
                'Ambre exige no_hard_effects=true (aucun effet brutal)'
            )
    else:
        raise PipelineError('persona attendue : Lisa ou Ambre')


def run(command: Sequence[str], *, dry_run: bool) -> None:
    print(' '.join(str(part) for part in command))
    if dry_run:
        return
    subprocess.run(list(command), check=True)


def discover(
    *,
    count: int,
    days: int,
    include_youtube_watch: bool,
    dry_run: bool,
) -> None:
    run(
        [
            sys.executable,
            str(SCRIPT_DIR / 'find-subjects.py'),
            str(count),
            '--days',
            str(days),
        ],
        dry_run=dry_run,
    )
    if include_youtube_watch:
        run(
            [
                sys.executable,
                str(SCRIPT_DIR / 'veille-youtube.py'),
                '--days',
                str(days),
            ],
            dry_run=dry_run,
        )


def submit_recording(
    manifest_path: Path,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    manifest = load_manifest(manifest_path)
    validate_editorial(manifest)
    validate_format(manifest)
    require(manifest, 'audio_file')
    work = Path(manifest.get('work_dir', DEFAULT_WORK)).expanduser().resolve()
    evidence_dir = work / 'preuves'
    before = set(evidence_dir.glob('*.meta.json')) if evidence_dir.exists() else set()
    run(
        [
            sys.executable,
            str(SCRIPT_DIR / 'collect-evidence.py'),
            '--sujet',
            str(manifest['subject']),
            '--output-dir',
            str(evidence_dir),
        ],
        dry_run=dry_run,
    )
    job_name = str(manifest.get('job_name', manifest_path.stem))
    run(
        [
            sys.executable,
            str(SCRIPT_DIR / 'heygen-batch.py'),
            'submit',
            str(Path(manifest['audio_file']).expanduser().resolve()),
            job_name,
        ],
        dry_run=dry_run,
    )
    if not dry_run:
        after = set(evidence_dir.glob('*.meta.json'))
        manifest['evidence_manifests'] = [
            str(path) for path in sorted(after - before or after)
        ]
        manifest['stage'] = 'enregistrement_soumis'
        manifest['heygen_job_name'] = job_name
        atomic_manifest(manifest_path, manifest)
    return manifest


def make_thumbnail(video: Path, output: Path, *, dry_run: bool) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            'ffmpeg',
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            '1',
            '-i',
            str(video),
            '-frames:v',
            '1',
            '-vf',
            'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
            str(output),
        ],
        dry_run=dry_run,
    )


def finalise(
    manifest_path: Path,
    *,
    qc_confirmed: bool,
    dry_run: bool,
    database: Path,
    audit_log: Path,
) -> list[str]:
    manifest = load_manifest(manifest_path)
    validate_editorial(manifest)
    validate_format(manifest)
    if not qc_confirmed:
        raise PipelineError(
            'QC HeyGen obligatoire : transcrire les 8 premières secondes, '
            'vérifier le mapping, puis ajouter --qc-heygen-confirme'
        )
    require(
        manifest,
        'presenter_video',
        'hook',
        'title',
        'description',
        'scheduled_for',
        'platforms',
        'evidence_manifests',
    )
    broll = manifest.get('broll')
    if not isinstance(broll, list) or not broll:
        raise PipelineError('au moins un B-roll/preuve est requis')
    work = Path(manifest.get('work_dir', DEFAULT_WORK)).expanduser().resolve()
    work.mkdir(parents=True, exist_ok=True)
    wrapped = work / f'{manifest_path.stem}-monte.mp4'
    final_video = work / f'{manifest_path.stem}-final.mp4'
    command = [
        sys.executable,
        str(SCRIPT_DIR / 'wrap-short.py'),
        str(Path(manifest['presenter_video']).expanduser().resolve()),
        str(wrapped),
        '--hook',
        str(manifest['hook']),
        '--layout',
        'split',
        '--face-crop',
        str(manifest.get('face_crop', 'top:0.15,bottom:0.65')),
    ]
    for item in broll:
        if not isinstance(item, dict):
            raise PipelineError('chaque B-roll doit être un objet')
        require(item, 'path', 'trigger', 'duration')
        command.extend(
            [
                '--cut',
                f'{item["path"]}@{item["trigger"]}:{item["duration"]}',
            ]
        )
    run(command, dry_run=dry_run)
    music = manifest.get('music')
    if music:
        run(
            [
                sys.executable,
                str(SCRIPT_DIR / 'add-sound.py'),
                str(wrapped),
                '--music',
                str(music),
                '--scene',
                str(manifest.get('sound_scene', 'interior')),
                '--out',
                str(final_video),
            ],
            dry_run=dry_run,
        )
    elif not dry_run:
        # Pas de réencodage inutile : wrap-short a déjà conservé la voix.
        final_video = wrapped
    else:
        final_video = wrapped

    thumbnail = Path(
        manifest.get('thumbnail', work / f'{manifest_path.stem}-miniature.jpg')
    ).expanduser().resolve()
    if not manifest.get('thumbnail'):
        make_thumbnail(final_video, thumbnail, dry_run=dry_run)
    if dry_run:
        return []
    measurement = master_video_audio(final_video)
    write_qc_sidecar(final_video, measurement)
    duration = media_duration(final_video)
    if str(manifest['persona']).lower() == 'lisa' and (
        duration is None or not 50 <= duration <= 65
    ):
        raise PipelineError(
            f'Lisa : durée finale {duration!r} hors format validé 50–65 s'
        )
    platforms = list(manifest['platforms'])
    unknown = set(platforms) - set(PLATFORMS)
    if unknown:
        raise PipelineError(f'plateformes inconnues : {", ".join(unknown)}')
    attributions = load_evidence_attributions(manifest['evidence_manifests'])
    queue = PublicationQueue(database, audit_log)
    identifiers = []
    for platform in platforms:
        entry = queue.add(
            video_file=final_video,
            platform=platform,
            title=str(manifest['title']),
            description=str(manifest['description']),
            keywords=[str(value) for value in manifest.get('keywords', [])],
            thumbnail=thumbnail,
            scheduled_for=str(manifest['scheduled_for']),
            source_attributions=attributions,
            subject=str(manifest['subject']),
            persona=str(manifest['persona']),
            actor='production-pipeline',
            status='à_valider',
        )
        identifiers.append(entry.id)
    manifest['stage'] = 'à_valider'
    manifest['final_video'] = str(final_video)
    manifest['thumbnail'] = str(thumbnail)
    manifest['queue_entry_ids'] = identifiers
    atomic_manifest(manifest_path, manifest)
    return identifiers


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=DEFAULT_DATABASE)
    parser.add_argument('--journal', type=Path, default=DEFAULT_AUDIT_LOG)
    parser.add_argument('--simulation', action='store_true')
    commands = parser.add_subparsers(dest='command', required=True)

    discovery = commands.add_parser('découvrir')
    discovery.add_argument('--nombre', type=int, default=8)
    discovery.add_argument('--jours', type=int, default=7)
    discovery.add_argument('--avec-veille-youtube', action='store_true')

    submit = commands.add_parser('soumettre-enregistrement')
    submit.add_argument('manifest', type=Path)

    finish = commands.add_parser('finaliser')
    finish.add_argument('manifest', type=Path)
    finish.add_argument('--qc-heygen-confirme', action='store_true')
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == 'découvrir':
            discover(
                count=args.nombre,
                days=args.jours,
                include_youtube_watch=args.avec_veille_youtube,
                dry_run=args.simulation,
            )
        elif args.command == 'soumettre-enregistrement':
            submit_recording(args.manifest, dry_run=args.simulation)
        elif args.command == 'finaliser':
            identifiers = finalise(
                args.manifest,
                qc_confirmed=args.qc_heygen_confirme,
                dry_run=args.simulation,
                database=args.base,
                audit_log=args.journal,
            )
            for identifier in identifiers:
                print(identifier)
    except (
        PipelineError,
        QueueError,
        DeliveryQCError,
        subprocess.CalledProcessError,
    ) as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

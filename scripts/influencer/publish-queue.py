#!/usr/bin/env python3
"""Gère la file locale de publication de Lisa et Ambre."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from publish_queue import (
    DEFAULT_AUDIT_LOG,
    DEFAULT_DATABASE,
    PLATFORMS,
    PublicationQueue,
    QueueError,
    load_evidence_attributions,
)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument('--base', type=Path, default=DEFAULT_DATABASE)
    root.add_argument('--journal', type=Path, default=DEFAULT_AUDIT_LOG)
    commands = root.add_subparsers(dest='command', required=True)

    add = commands.add_parser('ajouter')
    add.add_argument('video', type=Path)
    add.add_argument('--plateforme', choices=PLATFORMS, required=True)
    add.add_argument('--titre', required=True)
    add.add_argument('--description', required=True)
    add.add_argument('--mot-cle', action='append', default=[])
    add.add_argument('--miniature', type=Path, required=True)
    add.add_argument('--horaire', required=True, help='ISO 8601 avec fuseau')
    add.add_argument('--preuve', action='append', required=True)
    add.add_argument('--sujet', required=True)
    add.add_argument('--persona', choices=('Lisa', 'Ambre'), required=True)
    add.add_argument('--à-valider', action='store_true')

    submit = commands.add_parser('soumettre')
    submit.add_argument('id')

    listing = commands.add_parser('lister')
    listing.add_argument('--état', action='append', dest='statuses')
    listing.add_argument('--json', action='store_true')

    audit = commands.add_parser('journal')
    audit.add_argument('--id')
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    queue = PublicationQueue(args.base, args.journal)
    try:
        if args.command == 'ajouter':
            entry = queue.add(
                video_file=args.video,
                platform=args.plateforme,
                title=args.titre,
                description=args.description,
                keywords=args.mot_cle,
                thumbnail=args.miniature,
                scheduled_for=args.horaire,
                source_attributions=load_evidence_attributions(args.preuve),
                subject=args.sujet,
                persona=args.persona,
                actor='ligne-de-commande',
                status='à_valider' if args.à_valider else 'brouillon',
            )
            print(entry.id)
        elif args.command == 'soumettre':
            print(queue.submit_for_review(args.id).status)
        elif args.command == 'lister':
            entries = queue.list(args.statuses)
            if args.json:
                print(json.dumps(
                    [entry.as_dict() for entry in entries],
                    ensure_ascii=False,
                    indent=2,
                ))
            else:
                for entry in entries:
                    print(
                        f'{entry.id}  {entry.status:<10}  '
                        f'{entry.platform:<9}  {entry.scheduled_for}  '
                        f'{entry.title}'
                    )
        elif args.command == 'journal':
            print(json.dumps(
                queue.audit_events(args.id),
                ensure_ascii=False,
                indent=2,
            ))
    except QueueError as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

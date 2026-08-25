#!/usr/bin/env python3
"""File SQLite sûre pour la publication des vidéos de Lisa et Ambre.

INVARIANT DE SÉCURITÉ — NE PAS « SIMPLIFIER » :
aucune publication ne peut contourner l'état ``à_valider`` ni l'approbation
humaine nominative. Ce point de contrôle protège simultanément :

1. les comptes contre un profil d'automatisation assimilable à du spam ;
2. Patrice contre la publication d'un sujet où il est personnellement exposé
   (sujets déclarés dans INFLUENCER_EXCLUDED_TOPICS, liste privée) ;
3. les quotas d'envoi des plateformes.

L'automatisation commence avant ce verrou et reprend immédiatement après lui.
Supprimer ce passage obligatoire ferait perdre la propriété de sécurité
centrale de la chaîne, même si tous les autres contrôles restaient présents.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import mimetypes
from pathlib import Path
import sqlite3
import subprocess
from typing import Any, Iterator, Sequence
import uuid

from editorial_policy import find_excluded_topic


DEFAULT_ROOT = Path('~/.codebuddy/influencer-publication').expanduser()
DEFAULT_DATABASE = DEFAULT_ROOT / 'file.sqlite3'
DEFAULT_AUDIT_LOG = DEFAULT_ROOT / 'journal.jsonl'
PLATFORMS = ('youtube', 'tiktok', 'instagram')
STATUSES = (
    'brouillon',
    'à_valider',
    'approuvé',
    'programmé',
    'publié',
    'rejeté',
    'échec',
)
AI_DECLARATION = (
    'Contenu réaliste altéré ou synthétique créé avec l’aide de l’IA.'
)

# Une approbation ne figure volontairement pas ici. Elle passe exclusivement
# par approve(), qui exige l'identité de l'approbateur et écrit son audit.
GENERIC_TRANSITIONS: dict[str, frozenset[str]] = {
    'brouillon': frozenset({'à_valider', 'rejeté'}),
    'à_valider': frozenset({'rejeté'}),
    'approuvé': frozenset({'programmé', 'publié', 'échec'}),
    'programmé': frozenset({'publié', 'échec'}),
    'échec': frozenset({'approuvé', 'rejeté'}),
    'publié': frozenset(),
    'rejeté': frozenset(),
}


class QueueError(RuntimeError):
    """Erreur attendue de la file, présentable à l'opérateur."""


class EditorialPolicyError(QueueError):
    """Sujet refusé par la politique éditoriale."""


class InvalidTransitionError(QueueError):
    """Transition d'état interdite."""


class DuplicateEntryError(QueueError):
    """La même vidéo est déjà connue pour cette plateforme."""


@dataclass(frozen=True)
class QueueEntry:
    id: str
    video_file: str
    platform: str
    title: str
    description: str
    keywords: tuple[str, ...]
    thumbnail: str
    scheduled_for: str
    ai_declaration: str
    ai_declared: bool
    source_attributions: tuple[dict[str, Any], ...]
    subject: str
    persona: str
    status: str
    duration_seconds: float | None
    content_hash: str
    created_at: str
    updated_at: str
    approved_by: str | None
    approved_at: str | None
    published_at: str | None
    external_id: str | None
    external_url: str | None
    attempt_count: int
    last_attempt_at: str | None
    retry_at: str | None
    last_error: str | None
    remote_state: dict[str, Any]
    claimed_until: str | None
    claim_token: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> 'QueueEntry':
        return cls(
            id=row['id'],
            video_file=row['video_file'],
            platform=row['platform'],
            title=row['title'],
            description=row['description'],
            keywords=tuple(json.loads(row['keywords_json'])),
            thumbnail=row['thumbnail'],
            scheduled_for=row['scheduled_for'],
            ai_declaration=row['ai_declaration'],
            ai_declared=bool(row['ai_declared']),
            source_attributions=tuple(
                json.loads(row['source_attributions_json'])
            ),
            subject=row['subject'],
            persona=row['persona'],
            status=row['status'],
            duration_seconds=row['duration_seconds'],
            content_hash=row['content_hash'],
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            approved_by=row['approved_by'],
            approved_at=row['approved_at'],
            published_at=row['published_at'],
            external_id=row['external_id'],
            external_url=row['external_url'],
            attempt_count=row['attempt_count'],
            last_attempt_at=row['last_attempt_at'],
            retry_at=row['retry_at'],
            last_error=row['last_error'],
            remote_state=json.loads(row['remote_state_json']),
            claimed_until=row['claimed_until'],
            claim_token=row['claim_token'],
        )

    def as_dict(self) -> dict[str, Any]:
        value = dict(self.__dict__)
        value['keywords'] = list(self.keywords)
        value['source_attributions'] = list(self.source_attributions)
        return value


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime | None = None) -> str:
    value = value or utc_now()
    if value.tzinfo is None:
        raise QueueError('un horaire avec fuseau est obligatoire')
    return value.astimezone(timezone.utc).isoformat(timespec='seconds')


def parse_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise QueueError(f'horaire ISO 8601 invalide : {value}') from error
    if parsed.tzinfo is None:
        raise QueueError(
            f'le fuseau est obligatoire dans l’horaire prévu : {value}'
        )
    return parsed.astimezone(timezone.utc)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def media_duration(path: Path) -> float | None:
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v',
                'error',
                '-show_entries',
                'format=duration',
                '-of',
                'default=noprint_wrappers=1:nokey=1',
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return round(float(result.stdout.strip()), 3)
    except (FileNotFoundError, ValueError, subprocess.SubprocessError):
        return None


def normalise_attributions(
    values: Sequence[dict[str, Any] | str],
) -> list[dict[str, Any]]:
    result = []
    for value in values:
        if isinstance(value, str):
            result.append({'attribution': value})
        elif isinstance(value, dict) and value:
            result.append(dict(value))
        else:
            raise QueueError('chaque attribution doit être un texte ou un objet')
    if not result:
        raise QueueError('au moins une attribution de source est obligatoire')
    return result


def load_evidence_attributions(paths: Sequence[str | Path]) -> list[dict[str, Any]]:
    """Extrait les attributions des manifestes de collect-evidence.py."""
    values: list[dict[str, Any]] = []
    for raw_path in paths:
        path = Path(raw_path).expanduser().resolve()
        try:
            metadata = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as error:
            raise QueueError(f'manifeste de preuve illisible {path} : {error}')
        attribution = metadata.get('attribution')
        if not attribution:
            raise QueueError(f'attribution absente du manifeste {path}')
        values.append(
            {
                'attribution': str(attribution),
                'source_url': metadata.get('final_url')
                or metadata.get('source_url'),
                'captured_at': metadata.get('captured_at'),
                'legal_category': metadata.get('legal_category'),
                'evidence_manifest': str(path),
            }
        )
    return values


class PublicationQueue:
    def __init__(
        self,
        database: Path | str = DEFAULT_DATABASE,
        audit_log: Path | str = DEFAULT_AUDIT_LOG,
    ) -> None:
        self.database = Path(database).expanduser().resolve()
        self.audit_log = Path(audit_log).expanduser().resolve()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.audit_log.parent.mkdir(parents=True, exist_ok=True)
        self._initialise()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys = ON')
        connection.execute('PRAGMA busy_timeout = 30000')
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def _transaction(self, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            connection.execute('BEGIN IMMEDIATE' if immediate else 'BEGIN')
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialise(self) -> None:
        with self._connection() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS entries (
                  id TEXT PRIMARY KEY,
                  video_file TEXT NOT NULL,
                  platform TEXT NOT NULL,
                  title TEXT NOT NULL,
                  description TEXT NOT NULL,
                  keywords_json TEXT NOT NULL,
                  thumbnail TEXT NOT NULL,
                  scheduled_for TEXT NOT NULL,
                  ai_declaration TEXT NOT NULL,
                  ai_declared INTEGER NOT NULL CHECK (ai_declared = 1),
                  source_attributions_json TEXT NOT NULL,
                  subject TEXT NOT NULL,
                  persona TEXT NOT NULL,
                  status TEXT NOT NULL,
                  duration_seconds REAL,
                  content_hash TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  approved_by TEXT,
                  approved_at TEXT,
                  published_at TEXT,
                  external_id TEXT,
                  external_url TEXT,
                  attempt_count INTEGER NOT NULL DEFAULT 0,
                  last_attempt_at TEXT,
                  retry_at TEXT,
                  last_error TEXT,
                  remote_state_json TEXT NOT NULL DEFAULT '{}',
                  claimed_until TEXT,
                  claim_token TEXT,
                  UNIQUE(content_hash, platform)
                );
                CREATE INDEX IF NOT EXISTS entries_due
                  ON entries(status, scheduled_for, retry_at);
                CREATE TABLE IF NOT EXISTS audit_events (
                  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                  occurred_at TEXT NOT NULL,
                  entry_id TEXT,
                  event TEXT NOT NULL,
                  actor TEXT NOT NULL,
                  details_json TEXT NOT NULL
                );
                """
            )

    def _append_jsonl(self, payload: dict[str, Any]) -> None:
        # La base est l'autorité transactionnelle. Le JSONL est une projection
        # humaine ; son éventuelle indisponibilité ne doit pas annuler la file.
        try:
            with self.audit_log.open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(payload, ensure_ascii=False) + '\n')
        except OSError:
            pass

    def _audit(
        self,
        connection: sqlite3.Connection,
        event: str,
        actor: str,
        entry_id: str | None,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            'occurred_at': iso_utc(),
            'entry_id': entry_id,
            'event': event,
            'actor': actor,
            'details': details or {},
        }
        connection.execute(
            """
            INSERT INTO audit_events(
              occurred_at, entry_id, event, actor, details_json
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                payload['occurred_at'],
                entry_id,
                event,
                actor,
                json.dumps(payload['details'], ensure_ascii=False),
            ),
        )
        return payload

    def add(
        self,
        *,
        video_file: str | Path,
        platform: str,
        title: str,
        description: str,
        keywords: Sequence[str],
        thumbnail: str | Path,
        scheduled_for: str | datetime,
        source_attributions: Sequence[dict[str, Any] | str],
        subject: str,
        persona: str,
        actor: str = 'pipeline',
        status: str = 'brouillon',
    ) -> QueueEntry:
        excluded = find_excluded_topic(
            ' '.join((subject, title, description, ' '.join(keywords)))
        )
        if excluded:
            reason, keyword = excluded
            with self._transaction(immediate=True) as connection:
                audit = self._audit(
                    connection,
                    'sujet_refusé',
                    actor,
                    None,
                    {
                        'subject': subject,
                        'keyword': keyword,
                        'reason': reason,
                        'platform': platform,
                    },
                )
            self._append_jsonl(audit)
            raise EditorialPolicyError(
                f'sujet refusé par la politique éditoriale : {keyword} ({reason})'
            )
        if platform not in PLATFORMS:
            raise QueueError(f'plateforme inconnue : {platform}')
        if status not in ('brouillon', 'à_valider'):
            raise QueueError(
                'une nouvelle entrée ne peut être que brouillon ou à_valider'
            )
        if not title.strip() or not description.strip() or not subject.strip():
            raise QueueError('sujet, titre et description sont obligatoires')
        if persona.lower() not in ('lisa', 'ambre'):
            raise QueueError('persona attendue : Lisa ou Ambre')

        video = Path(video_file).expanduser().resolve()
        image = Path(thumbnail).expanduser().resolve()
        if not video.is_file():
            raise QueueError(f'vidéo introuvable : {video}')
        if not image.is_file():
            raise QueueError(f'miniature introuvable : {image}')
        mime = mimetypes.guess_type(video.name)[0] or ''
        if not mime.startswith('video/'):
            raise QueueError(f'le fichier ne ressemble pas à une vidéo : {video}')
        if isinstance(scheduled_for, datetime):
            schedule = iso_utc(scheduled_for)
        else:
            schedule = iso_utc(parse_datetime(scheduled_for))
        attributions = normalise_attributions(source_attributions)
        content_hash = file_sha256(video)
        identifier = str(uuid.uuid4())
        now = iso_utc()
        duration = media_duration(video)
        try:
            with self._transaction(immediate=True) as connection:
                connection.execute(
                    """
                    INSERT INTO entries(
                      id, video_file, platform, title, description,
                      keywords_json, thumbnail, scheduled_for,
                      ai_declaration, ai_declared, source_attributions_json,
                      subject, persona, status, duration_seconds, content_hash,
                      created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        identifier,
                        str(video),
                        platform,
                        title.strip(),
                        description.strip(),
                        json.dumps(
                            [word.strip() for word in keywords if word.strip()],
                            ensure_ascii=False,
                        ),
                        str(image),
                        schedule,
                        AI_DECLARATION,
                        json.dumps(attributions, ensure_ascii=False),
                        subject.strip(),
                        persona.capitalize(),
                        status,
                        duration,
                        content_hash,
                        now,
                        now,
                    ),
                )
                audit = self._audit(
                    connection,
                    'entrée_créée',
                    actor,
                    identifier,
                    {'status': status, 'platform': platform},
                )
        except sqlite3.IntegrityError as error:
            if 'UNIQUE constraint failed' in str(error):
                raise DuplicateEntryError(
                    f'cette vidéo est déjà en file pour {platform}'
                ) from error
            raise
        self._append_jsonl(audit)
        return self.get(identifier)

    def get(self, entry_id: str) -> QueueEntry:
        with self._connection() as connection:
            row = connection.execute(
                'SELECT * FROM entries WHERE id = ?',
                (entry_id,),
            ).fetchone()
        if row is None:
            raise QueueError(f'entrée inconnue : {entry_id}')
        return QueueEntry.from_row(row)

    def list(
        self,
        statuses: Sequence[str] | None = None,
        limit: int | None = None,
    ) -> list[QueueEntry]:
        query = 'SELECT * FROM entries'
        parameters: list[Any] = []
        if statuses:
            unknown = set(statuses) - set(STATUSES)
            if unknown:
                raise QueueError(f'état inconnu : {", ".join(sorted(unknown))}')
            placeholders = ','.join('?' for _ in statuses)
            query += f' WHERE status IN ({placeholders})'
            parameters.extend(statuses)
        query += ' ORDER BY scheduled_for, created_at'
        if limit is not None:
            query += ' LIMIT ?'
            parameters.append(limit)
        with self._connection() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [QueueEntry.from_row(row) for row in rows]

    def transition(
        self,
        entry_id: str,
        target: str,
        *,
        actor: str,
        details: dict[str, Any] | None = None,
    ) -> QueueEntry:
        if target == 'approuvé':
            raise InvalidTransitionError(
                'l’approbation exige approve() et une identité humaine'
            )
        with self._transaction(immediate=True) as connection:
            row = connection.execute(
                'SELECT status FROM entries WHERE id = ?',
                (entry_id,),
            ).fetchone()
            if row is None:
                raise QueueError(f'entrée inconnue : {entry_id}')
            source = row['status']
            if target not in GENERIC_TRANSITIONS[source]:
                raise InvalidTransitionError(
                    f'transition interdite : {source} → {target}'
                )
            now = iso_utc()
            updates = ['status = ?', 'updated_at = ?']
            values: list[Any] = [target, now]
            if target == 'publié':
                updates.append('published_at = ?')
                values.append(now)
            values.append(entry_id)
            connection.execute(
                f'UPDATE entries SET {", ".join(updates)} WHERE id = ?',
                values,
            )
            audit = self._audit(
                connection,
                'état_modifié',
                actor,
                entry_id,
                {'from': source, 'to': target, **(details or {})},
            )
        self._append_jsonl(audit)
        return self.get(entry_id)

    def submit_for_review(
        self,
        entry_id: str,
        *,
        actor: str = 'pipeline',
    ) -> QueueEntry:
        return self.transition(entry_id, 'à_valider', actor=actor)

    def approve(self, entry_id: str, *, approver: str) -> QueueEntry:
        """Approuve après le seul point de contrôle humain obligatoire."""
        if not approver.strip():
            raise QueueError("le nom de l'approbateur est obligatoire")
        with self._transaction(immediate=True) as connection:
            row = connection.execute(
                'SELECT status FROM entries WHERE id = ?',
                (entry_id,),
            ).fetchone()
            if row is None:
                raise QueueError(f'entrée inconnue : {entry_id}')
            if row['status'] != 'à_valider':
                raise InvalidTransitionError(
                    f"seule une entrée à_valider est approuvable, pas {row['status']}"
                )
            now = iso_utc()
            connection.execute(
                """
                UPDATE entries
                SET status = 'approuvé', approved_by = ?, approved_at = ?,
                    updated_at = ?, retry_at = NULL, last_error = NULL
                WHERE id = ?
                """,
                (approver.strip(), now, now, entry_id),
            )
            audit = self._audit(
                connection,
                'lot_approuvé',
                approver.strip(),
                entry_id,
                {'from': 'à_valider', 'to': 'approuvé'},
            )
        self._append_jsonl(audit)
        return self.get(entry_id)

    def reject(
        self,
        entry_id: str,
        *,
        approver: str,
        reason: str = 'non retenu lors de la revue du lot',
    ) -> QueueEntry:
        if not approver.strip():
            raise QueueError("le nom de l'approbateur est obligatoire")
        entry = self.get(entry_id)
        if entry.status != 'à_valider':
            raise InvalidTransitionError(
                f"seule une entrée à_valider est rejetable, pas {entry.status}"
            )
        return self.transition(
            entry_id,
            'rejeté',
            actor=approver.strip(),
            details={'reason': reason},
        )

    def apply_review_decisions(
        self,
        entry_ids: Sequence[str],
        approved_ids: Sequence[str],
        *,
        approver: str,
    ) -> dict[str, str]:
        """Écrit tout un lot atomiquement : cochée = approuvée, sinon rejetée."""
        if not approver.strip():
            raise QueueError("le nom de l'approbateur est obligatoire")
        identifiers = list(dict.fromkeys(entry_ids))
        approved = set(approved_ids)
        if not identifiers:
            raise QueueError('le lot de revue est vide')
        if not approved.issubset(identifiers):
            raise QueueError('la décision contient une entrée étrangère au lot')
        placeholders = ','.join('?' for _ in identifiers)
        with self._transaction(immediate=True) as connection:
            rows = connection.execute(
                f'SELECT id, status FROM entries WHERE id IN ({placeholders})',
                identifiers,
            ).fetchall()
            states = {row['id']: row['status'] for row in rows}
            missing = set(identifiers) - set(states)
            if missing:
                raise QueueError(
                    f'entrées inconnues : {", ".join(sorted(missing))}'
                )
            invalid = {
                identifier: state
                for identifier, state in states.items()
                if state != 'à_valider'
            }
            if invalid:
                rendered = ', '.join(
                    f'{identifier}={state}'
                    for identifier, state in sorted(invalid.items())
                )
                raise InvalidTransitionError(
                    f'le lot a changé depuis son ouverture : {rendered}'
                )
            now = iso_utc()
            audits = []
            decisions = {}
            for identifier in identifiers:
                target = 'approuvé' if identifier in approved else 'rejeté'
                decisions[identifier] = target
                if target == 'approuvé':
                    connection.execute(
                        """
                        UPDATE entries
                        SET status = 'approuvé', approved_by = ?,
                            approved_at = ?, updated_at = ?,
                            retry_at = NULL, last_error = NULL
                        WHERE id = ?
                        """,
                        (approver.strip(), now, now, identifier),
                    )
                    event = 'lot_approuvé'
                else:
                    connection.execute(
                        """
                        UPDATE entries SET status = 'rejeté', updated_at = ?
                        WHERE id = ?
                        """,
                        (now, identifier),
                    )
                    event = 'lot_rejeté'
                audits.append(
                    self._audit(
                        connection,
                        event,
                        approver.strip(),
                        identifier,
                        {'from': 'à_valider', 'to': target},
                    )
                )
        for audit in audits:
            self._append_jsonl(audit)
        return decisions

    def record_attempt(
        self,
        entry_id: str,
        *,
        actor: str,
        now: datetime | None = None,
    ) -> QueueEntry:
        with self._transaction(immediate=True) as connection:
            row = connection.execute(
                'SELECT status FROM entries WHERE id = ?',
                (entry_id,),
            ).fetchone()
            if row is None:
                raise QueueError(f'entrée inconnue : {entry_id}')
            if row['status'] != 'approuvé':
                raise InvalidTransitionError(
                    "un envoi ne peut démarrer qu'à l'état approuvé"
                )
            now_iso = iso_utc(now or utc_now())
            connection.execute(
                """
                UPDATE entries
                SET attempt_count = attempt_count + 1,
                    last_attempt_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (now_iso, now_iso, entry_id),
            )
            audit = self._audit(
                connection,
                'envoi_démarré',
                actor,
                entry_id,
                {},
            )
        self._append_jsonl(audit)
        return self.get(entry_id)

    def checkpoint_remote(
        self,
        entry_id: str,
        *,
        remote_state: dict[str, Any],
        external_id: str | None = None,
        actor: str,
    ) -> QueueEntry:
        entry = self.get(entry_id)
        merged = {**entry.remote_state, **remote_state}
        with self._transaction(immediate=True) as connection:
            connection.execute(
                """
                UPDATE entries
                SET remote_state_json = ?, external_id = COALESCE(?, external_id),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    json.dumps(merged, ensure_ascii=False),
                    external_id,
                    iso_utc(),
                    entry_id,
                ),
            )
            audit = self._audit(
                connection,
                'point_de_reprise_distant',
                actor,
                entry_id,
                {
                    'external_id': external_id,
                    'remote_keys': sorted(remote_state),
                },
            )
        self._append_jsonl(audit)
        return self.get(entry_id)

    def mark_published(
        self,
        entry_id: str,
        *,
        external_id: str,
        external_url: str | None,
        actor: str,
    ) -> QueueEntry:
        if not external_id:
            raise QueueError("l'identifiant de publication est obligatoire")
        with self._transaction(immediate=True) as connection:
            row = connection.execute(
                'SELECT status FROM entries WHERE id = ?',
                (entry_id,),
            ).fetchone()
            if row is None:
                raise QueueError(f'entrée inconnue : {entry_id}')
            if row['status'] not in ('approuvé', 'programmé'):
                raise InvalidTransitionError(
                    f"publication impossible depuis l'état {row['status']}"
                )
            now = iso_utc()
            connection.execute(
                """
                UPDATE entries
                SET status = 'publié', external_id = ?, external_url = ?,
                    published_at = ?, updated_at = ?, retry_at = NULL,
                    last_error = NULL, claim_token = NULL, claimed_until = NULL
                WHERE id = ?
                """,
                (external_id, external_url, now, now, entry_id),
            )
            audit = self._audit(
                connection,
                'publication_confirmée',
                actor,
                entry_id,
                {'external_id': external_id, 'external_url': external_url},
            )
        self._append_jsonl(audit)
        return self.get(entry_id)

    def mark_scheduled(
        self,
        entry_id: str,
        *,
        external_id: str,
        actor: str,
    ) -> QueueEntry:
        entry = self.transition(
            entry_id,
            'programmé',
            actor=actor,
            details={'external_id': external_id},
        )
        with self._transaction(immediate=True) as connection:
            connection.execute(
                """
                UPDATE entries SET external_id = ?, claim_token = NULL,
                  claimed_until = NULL WHERE id = ?
                """,
                (external_id, entry_id),
            )
        return self.get(entry_id)

    def mark_failed(
        self,
        entry_id: str,
        *,
        error: str,
        actor: str,
        retry_after: timedelta | None,
        now: datetime | None = None,
    ) -> QueueEntry:
        entry = self.get(entry_id)
        if entry.status not in ('approuvé', 'programmé'):
            raise InvalidTransitionError(
                f"échec d'envoi impossible depuis l'état {entry.status}"
            )
        instant = now or utc_now()
        retry_at = iso_utc(instant + retry_after) if retry_after else None
        with self._transaction(immediate=True) as connection:
            now_iso = iso_utc(instant)
            connection.execute(
                """
                UPDATE entries
                SET status = 'échec', last_error = ?, retry_at = ?,
                    updated_at = ?, claim_token = NULL, claimed_until = NULL
                WHERE id = ?
                """,
                (error[:4000], retry_at, now_iso, entry_id),
            )
            audit = self._audit(
                connection,
                'envoi_échoué',
                actor,
                entry_id,
                {'error': error[:1000], 'retry_at': retry_at},
            )
        self._append_jsonl(audit)
        return self.get(entry_id)

    def revive_due_failures(self, now: datetime | None = None) -> int:
        instant = iso_utc(now or utc_now())
        with self._transaction(immediate=True) as connection:
            rows = connection.execute(
                """
                SELECT id FROM entries
                WHERE status = 'échec' AND retry_at IS NOT NULL AND retry_at <= ?
                """,
                (instant,),
            ).fetchall()
            audits = []
            for row in rows:
                connection.execute(
                    """
                    UPDATE entries SET status = 'approuvé', updated_at = ?,
                      retry_at = NULL WHERE id = ?
                    """,
                    (instant, row['id']),
                )
                audits.append(
                    self._audit(
                        connection,
                        'reprise_planifiée',
                        'planificateur',
                        row['id'],
                        {'to': 'approuvé'},
                    )
                )
        for audit in audits:
            self._append_jsonl(audit)
        return len(rows)

    def claim_due(
        self,
        *,
        now: datetime | None = None,
        limit: int = 10,
        lease: timedelta = timedelta(minutes=15),
    ) -> list[QueueEntry]:
        instant = now or utc_now()
        instant_iso = iso_utc(instant)
        claimed_until = iso_utc(instant + lease)
        token = str(uuid.uuid4())
        with self._transaction(immediate=True) as connection:
            rows = connection.execute(
                """
                SELECT id FROM entries
                WHERE status = 'approuvé'
                  AND scheduled_for <= ?
                  AND (claimed_until IS NULL OR claimed_until < ?)
                ORDER BY scheduled_for, created_at
                LIMIT ?
                """,
                (instant_iso, instant_iso, limit),
            ).fetchall()
            identifiers = [row['id'] for row in rows]
            for identifier in identifiers:
                connection.execute(
                    """
                    UPDATE entries SET claim_token = ?, claimed_until = ?
                    WHERE id = ?
                    """,
                    (token, claimed_until, identifier),
                )
        return [self.get(identifier) for identifier in identifiers]

    def release_claim(self, entry_id: str) -> None:
        with self._transaction(immediate=True) as connection:
            connection.execute(
                """
                UPDATE entries SET claim_token = NULL, claimed_until = NULL
                WHERE id = ?
                """,
                (entry_id,),
            )

    def latest_platform_attempt(self, platform: str) -> datetime | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT MAX(last_attempt_at) AS value FROM entries
                WHERE platform = ? AND last_attempt_at IS NOT NULL
                """,
                (platform,),
            ).fetchone()
        return parse_datetime(row['value']) if row and row['value'] else None

    def audit_events(self, entry_id: str | None = None) -> list[dict[str, Any]]:
        query = 'SELECT * FROM audit_events'
        parameters: tuple[Any, ...] = ()
        if entry_id:
            query += ' WHERE entry_id = ?'
            parameters = (entry_id,)
        query += ' ORDER BY sequence'
        with self._connection() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [
            {
                'sequence': row['sequence'],
                'occurred_at': row['occurred_at'],
                'entry_id': row['entry_id'],
                'event': row['event'],
                'actor': row['actor'],
                'details': json.loads(row['details_json']),
            }
            for row in rows
        ]

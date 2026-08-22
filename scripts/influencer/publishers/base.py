"""Socle HTTP, OAuth et garde de sécurité commun aux plateformes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from typing import Any, Callable
import urllib.error
import urllib.parse
import urllib.request

from publish_queue import QueueEntry


CREDENTIALS_DIR = Path('~/.codebuddy/influencer-oauth').expanduser()
REAL_PUBLISH_ENV = 'INFLUENCER_REAL_PUBLISH'
REAL_PUBLISH_CONFIRMATION = 'JE_COMPRENDS_ET_J_AUTORISE'
Checkpoint = Callable[[dict[str, Any], str | None], None]


class PublishError(RuntimeError):
    """Erreur attendue d'un connecteur."""

    retryable = False

    def __init__(
        self,
        message: str,
        *,
        retry_after: timedelta | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class MissingCredentials(PublishError):
    """Jetons OAuth absents : l'entrée doit rester en file."""


class LivePublishingDisabled(PublishError):
    """Double garde d'envoi réel non levée."""


class RetryablePublishError(PublishError):
    retryable = True


class PermanentPublishError(PublishError):
    pass


@dataclass(frozen=True)
class PublishResult:
    external_id: str
    external_url: str | None = None
    processing: bool = False
    remote_state: dict[str, Any] | None = None


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> dict[str, Any]:
        if not self.body:
            return {}
        try:
            value = json.loads(self.body.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RetryablePublishError(
                f'réponse distante non JSON (HTTP {self.status})'
            ) from error
        if not isinstance(value, dict):
            raise RetryablePublishError('réponse distante JSON inattendue')
        return value


class HttpTransport:
    """Transport injectable ; aucune requête n'est faite dans les tests."""

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
        timeout: int = 120,
        accepted: tuple[int, ...] = (200, 201, 202),
    ) -> HttpResponse:
        request = urllib.request.Request(
            url,
            data=body,
            headers=headers or {},
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                result = HttpResponse(
                    status=response.status,
                    headers={key.lower(): value for key, value in response.headers.items()},
                    body=response.read(),
                )
        except urllib.error.HTTPError as error:
            result = HttpResponse(
                status=error.code,
                headers={key.lower(): value for key, value in error.headers.items()},
                body=error.read(),
            )
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise RetryablePublishError(
                f'réseau indisponible : {error}',
                retry_after=timedelta(minutes=15),
            ) from error
        if result.status not in accepted:
            self._raise_http(result)
        return result

    @staticmethod
    def _raise_http(response: HttpResponse) -> None:
        body = response.body.decode('utf-8', errors='replace')[:1000]
        retry_after = response.headers.get('retry-after')
        delay = None
        if retry_after and retry_after.isdigit():
            delay = timedelta(seconds=int(retry_after))
        message = f'HTTP {response.status} : {body or "erreur sans détail"}'
        quota_markers = (
            'quota',
            'rate_limit',
            'ratelimit',
            'too many requests',
            'spam_risk',
        )
        quota_limited = any(marker in body.lower() for marker in quota_markers)
        if response.status == 429 or response.status >= 500 or quota_limited:
            raise RetryablePublishError(
                message,
                retry_after=delay or (
                    timedelta(hours=6) if quota_limited else timedelta(minutes=30)
                ),
            )
        raise PermanentPublishError(message)

    def json_request(
        self,
        method: str,
        url: str,
        *,
        token: str | None = None,
        payload: dict[str, Any] | None = None,
        form: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        accepted: tuple[int, ...] = (200, 201, 202),
    ) -> HttpResponse:
        request_headers = dict(headers or {})
        if token:
            request_headers['Authorization'] = f'Bearer {token}'
        if payload is not None:
            body = json.dumps(payload).encode('utf-8')
            request_headers['Content-Type'] = 'application/json; charset=UTF-8'
        elif form is not None:
            body = urllib.parse.urlencode(form).encode('utf-8')
            request_headers['Content-Type'] = 'application/x-www-form-urlencoded'
        else:
            body = b''
        return self.request(
            method,
            url,
            headers=request_headers,
            body=body,
            accepted=accepted,
        )


def credential_path(platform: str) -> Path:
    return CREDENTIALS_DIR / f'{platform}.json'


def load_credentials(platform: str, path: Path | None = None) -> dict[str, Any]:
    target = (path or credential_path(platform)).expanduser().resolve()
    if not target.is_file():
        raise MissingCredentials(
            f'jetons {platform} absents : créer {target} (hors dépôt)'
        )
    try:
        value = json.loads(target.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise MissingCredentials(
            f'jetons {platform} illisibles : {error}'
        ) from error
    if not isinstance(value, dict):
        raise MissingCredentials(f'format de jetons {platform} invalide')
    return value


def save_credentials(platform: str, value: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def token_expired(credentials: dict[str, Any], margin_seconds: int = 120) -> bool:
    expires_at = credentials.get('expires_at')
    if not expires_at:
        return False
    try:
        expiry = datetime.fromisoformat(str(expires_at).replace('Z', '+00:00'))
    except ValueError:
        return True
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry <= datetime.now(timezone.utc) + timedelta(seconds=margin_seconds)


def ensure_entry_publishable(entry: QueueEntry, platform: str) -> None:
    # Assertion de défense en profondeur demandée explicitement : un connecteur
    # ne touche jamais au réseau pour un brouillon, un rejet ou un « à_valider ».
    if entry.status != 'approuvé':
        raise PermanentPublishError(
            f"publication refusée : état {entry.status}, « approuvé » requis"
        )
    if entry.platform != platform:
        raise PermanentPublishError(
            f'connecteur {platform} incompatible avec {entry.platform}'
        )
    if not entry.ai_declared or not entry.ai_declaration:
        raise PermanentPublishError('déclaration IA absente : publication refusée')
    if not Path(entry.video_file).is_file():
        raise PermanentPublishError(f'vidéo introuvable : {entry.video_file}')


def ensure_real_allowed(allow_real: bool) -> None:
    if (
        not allow_real
        or os.environ.get(REAL_PUBLISH_ENV) != REAL_PUBLISH_CONFIRMATION
    ):
        raise LivePublishingDisabled(
            'envoi réel désactivé : utiliser --autoriser-envoi-reel ET définir '
            f'{REAL_PUBLISH_ENV}={REAL_PUBLISH_CONFIRMATION}'
        )


class BasePublisher:
    platform = ''

    def __init__(
        self,
        *,
        credentials_path: Path | None = None,
        transport: HttpTransport | None = None,
        allow_real: bool = False,
    ) -> None:
        self.credentials_path = (
            credentials_path or credential_path(self.platform)
        )
        self.transport = transport or HttpTransport()
        self.allow_real = allow_real

    def credentials(self) -> dict[str, Any]:
        return load_credentials(self.platform, self.credentials_path)

    def publish(
        self,
        entry: QueueEntry,
        *,
        checkpoint: Checkpoint | None = None,
    ) -> PublishResult:
        ensure_entry_publishable(entry, self.platform)
        credentials = self.credentials()
        # Vérifier les jetons avant la garde facilite le diagnostic « jetons
        # absents » sans autoriser la moindre requête.
        ensure_real_allowed(self.allow_real)
        return self._publish(entry, credentials, checkpoint or (lambda _a, _b: None))

    def _publish(
        self,
        entry: QueueEntry,
        credentials: dict[str, Any],
        checkpoint: Checkpoint,
    ) -> PublishResult:
        raise NotImplementedError

    def check_status(self, entry: QueueEntry) -> PublishResult:
        credentials = self.credentials()
        ensure_real_allowed(self.allow_real)
        return self._check_status(entry, credentials)

    def _check_status(
        self,
        entry: QueueEntry,
        credentials: dict[str, Any],
    ) -> PublishResult:
        if not entry.external_id:
            raise PermanentPublishError('identifiant distant absent')
        return PublishResult(entry.external_id, processing=False)

"""Publication YouTube par envoi reprenable avec déclaration IA native."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import mimetypes
from pathlib import Path
from typing import Any
import urllib.parse

from publish_queue import QueueEntry
from .base import (
    BasePublisher,
    Checkpoint,
    MissingCredentials,
    PermanentPublishError,
    PublishResult,
    RetryablePublishError,
    save_credentials,
    token_expired,
)


UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos'
TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'


class YouTubePublisher(BasePublisher):
    platform = 'youtube'

    def _access_token(self, credentials: dict[str, Any]) -> str:
        token = str(credentials.get('access_token', ''))
        if token and not token_expired(credentials):
            return token
        required = ('refresh_token', 'client_id', 'client_secret')
        if any(not credentials.get(key) for key in required):
            raise MissingCredentials(
                'YouTube : access_token valide ou refresh_token/client_id/'
                'client_secret requis'
            )
        response = self.transport.json_request(
            'POST',
            TOKEN_ENDPOINT,
            form={
                'client_id': credentials['client_id'],
                'client_secret': credentials['client_secret'],
                'refresh_token': credentials['refresh_token'],
                'grant_type': 'refresh_token',
            },
        ).json()
        token = str(response.get('access_token', ''))
        if not token:
            raise MissingCredentials('YouTube : rafraîchissement OAuth sans jeton')
        credentials['access_token'] = token
        credentials['expires_at'] = (
            datetime.now(timezone.utc)
            + timedelta(seconds=int(response.get('expires_in', 3600)))
        ).isoformat(timespec='seconds')
        save_credentials(self.platform, credentials, self.credentials_path)
        return token

    def _publish(
        self,
        entry: QueueEntry,
        credentials: dict[str, Any],
        checkpoint: Checkpoint,
    ) -> PublishResult:
        token = self._access_token(credentials)
        remote_id = entry.external_id or entry.remote_state.get('video_id')
        if not remote_id:
            video = Path(entry.video_file)
            mime = mimetypes.guess_type(video.name)[0] or 'video/mp4'
            schedule = datetime.fromisoformat(
                entry.scheduled_for.replace('Z', '+00:00')
            )
            future = schedule > datetime.now(timezone.utc) + timedelta(minutes=1)
            status: dict[str, Any] = {
                'privacyStatus': 'private' if future else 'public',
                'selfDeclaredMadeForKids': False,
                # Champ officiel videos.status.containsSyntheticMedia.
                'containsSyntheticMedia': True,
            }
            if future:
                status['publishAt'] = schedule.isoformat(timespec='seconds')
            metadata = {
                'snippet': {
                    'title': entry.title[:100],
                    'description': entry.description[:5000],
                    'tags': list(entry.keywords)[:500],
                    'categoryId': str(credentials.get('category_id', '22')),
                    'defaultLanguage': str(credentials.get('language', 'fr')),
                },
                'status': status,
            }
            query = urllib.parse.urlencode(
                {'uploadType': 'resumable', 'part': 'snippet,status'}
            )
            response = self.transport.json_request(
                'POST',
                f'{UPLOAD_ENDPOINT}?{query}',
                token=token,
                payload=metadata,
                headers={
                    'X-Upload-Content-Length': str(video.stat().st_size),
                    'X-Upload-Content-Type': mime,
                },
            )
            upload_url = response.headers.get('location')
            if not upload_url:
                raise RetryablePublishError(
                    "YouTube n'a pas fourni d'URL d'envoi reprenable"
                )
            checkpoint({'upload_url': upload_url}, None)
            uploaded = self.transport.request(
                'PUT',
                upload_url,
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': mime,
                    'Content-Length': str(video.stat().st_size),
                },
                body=video.read_bytes(),
                timeout=900,
                accepted=(200, 201),
            ).json()
            remote_id = str(uploaded.get('id', ''))
            if not remote_id:
                raise RetryablePublishError(
                    "YouTube n'a pas retourné d'identifiant vidéo"
                )
            checkpoint({'video_id': remote_id, 'uploaded': True}, remote_id)

        thumbnail = Path(entry.thumbnail)
        if thumbnail.is_file() and not entry.remote_state.get('thumbnail_uploaded'):
            mime = mimetypes.guess_type(thumbnail.name)[0] or 'image/jpeg'
            query = urllib.parse.urlencode({'videoId': remote_id})
            self.transport.request(
                'POST',
                f'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?{query}',
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': mime,
                },
                body=thumbnail.read_bytes(),
                accepted=(200,),
            )
            checkpoint({'thumbnail_uploaded': True}, remote_id)
        scheduled = datetime.fromisoformat(
            entry.scheduled_for.replace('Z', '+00:00')
        ) > datetime.now(timezone.utc) + timedelta(minutes=1)
        return PublishResult(
            external_id=remote_id,
            external_url=f'https://youtu.be/{remote_id}',
            processing=scheduled,
            remote_state={'platform_schedule': scheduled},
        )

    def _check_status(
        self,
        entry: QueueEntry,
        credentials: dict[str, Any],
    ) -> PublishResult:
        token = self._access_token(credentials)
        query = urllib.parse.urlencode(
            {
                'part': 'status,processingDetails',
                'id': entry.external_id,
            }
        )
        response = self.transport.json_request(
            'GET',
            f'https://www.googleapis.com/youtube/v3/videos?{query}',
            token=token,
        ).json()
        items = response.get('items', [])
        if not items:
            raise PermanentPublishError(
                f'YouTube : vidéo distante introuvable ({entry.external_id})'
            )
        item = items[0]
        processing = item.get('processingDetails', {}).get('processingStatus')
        if processing in ('failed', 'terminated'):
            raise PermanentPublishError(
                f'YouTube : traitement vidéo {processing}'
            )
        schedule = datetime.fromisoformat(
            entry.scheduled_for.replace('Z', '+00:00')
        )
        waiting = (
            processing not in (None, 'succeeded')
            or schedule > datetime.now(timezone.utc)
        )
        return PublishResult(
            external_id=str(entry.external_id),
            external_url=f'https://youtu.be/{entry.external_id}',
            processing=waiting,
        )

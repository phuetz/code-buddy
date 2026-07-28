"""Publication TikTok Content Posting API avec ``is_aigc=true``."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

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


API = 'https://open.tiktokapis.com/v2'
TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/'


class TikTokPublisher(BasePublisher):
    platform = 'tiktok'

    def _access_token(self, credentials: dict[str, Any]) -> str:
        token = str(credentials.get('access_token', ''))
        if token and not token_expired(credentials):
            return token
        required = ('refresh_token', 'client_key', 'client_secret')
        if any(not credentials.get(key) for key in required):
            raise MissingCredentials(
                'TikTok : access_token valide ou refresh_token/client_key/'
                'client_secret requis'
            )
        response = self.transport.json_request(
            'POST',
            TOKEN_ENDPOINT,
            form={
                'client_key': credentials['client_key'],
                'client_secret': credentials['client_secret'],
                'grant_type': 'refresh_token',
                'refresh_token': credentials['refresh_token'],
            },
        ).json()
        token = str(response.get('access_token', ''))
        if not token:
            raise MissingCredentials('TikTok : rafraîchissement OAuth sans jeton')
        credentials.update(
            {
                'access_token': token,
                'refresh_token': response.get(
                    'refresh_token',
                    credentials['refresh_token'],
                ),
                'expires_at': (
                    datetime.now(timezone.utc)
                    + timedelta(seconds=int(response.get('expires_in', 86400)))
                ).isoformat(timespec='seconds'),
            }
        )
        save_credentials(self.platform, credentials, self.credentials_path)
        return token

    @staticmethod
    def _caption(entry: QueueEntry) -> str:
        tags = ' '.join(
            f'#{word.lstrip("#").replace(" ", "")}'
            for word in entry.keywords
            if word.strip()
        )
        return f'{entry.title}\n\n{entry.description}\n\n{tags}'.strip()[:2200]

    def _publish(
        self,
        entry: QueueEntry,
        credentials: dict[str, Any],
        checkpoint: Checkpoint,
    ) -> PublishResult:
        token = self._access_token(credentials)
        publish_id = entry.external_id or entry.remote_state.get('publish_id')
        upload_url = entry.remote_state.get('upload_url')
        if not publish_id:
            creator = self.transport.json_request(
                'POST',
                f'{API}/post/publish/creator_info/query/',
                token=token,
                payload={},
            ).json().get('data', {})
            privacy_options = creator.get('privacy_level_options', [])
            privacy = str(credentials.get('privacy_level', 'SELF_ONLY'))
            if privacy not in privacy_options:
                raise PermanentPublishError(
                    f'TikTok : confidentialité {privacy} non autorisée pour ce compte'
                )
            if creator.get('is_posting_limit_reached'):
                raise RetryablePublishError(
                    'TikTok : limite de publication du créateur atteinte',
                    retry_after=timedelta(hours=6),
                )
            if (
                entry.duration_seconds is not None
                and creator.get('max_video_post_duration_sec')
                and entry.duration_seconds
                > float(creator['max_video_post_duration_sec'])
            ):
                raise PermanentPublishError(
                    'TikTok : durée supérieure à la limite du compte'
                )
            video = Path(entry.video_file)
            size = video.stat().st_size
            chunk_size = min(size, 64 * 1024 * 1024)
            chunks = max(1, (size + chunk_size - 1) // chunk_size)
            response = self.transport.json_request(
                'POST',
                f'{API}/post/publish/video/init/',
                token=token,
                payload={
                    'post_info': {
                        'title': self._caption(entry),
                        'privacy_level': privacy,
                        'disable_duet': bool(
                            credentials.get('disable_duet', False)
                        ),
                        'disable_comment': bool(
                            credentials.get('disable_comment', False)
                        ),
                        'disable_stitch': bool(
                            credentials.get('disable_stitch', False)
                        ),
                        # Déclaration native obligatoire de contenu généré IA.
                        'is_aigc': True,
                    },
                    'source_info': {
                        'source': 'FILE_UPLOAD',
                        'video_size': size,
                        'chunk_size': chunk_size,
                        'total_chunk_count': chunks,
                    },
                },
            ).json()
            data = response.get('data', {})
            publish_id = str(data.get('publish_id', ''))
            upload_url = str(data.get('upload_url', ''))
            if not publish_id or not upload_url:
                raise RetryablePublishError(
                    "TikTok n'a pas retourné de session d'envoi"
                )
            checkpoint(
                {'publish_id': publish_id, 'upload_url': upload_url},
                publish_id,
            )

        if upload_url and not entry.remote_state.get('uploaded'):
            video = Path(entry.video_file)
            size = video.stat().st_size
            # Les Shorts habituels tiennent dans un bloc. Le découpage reste
            # correct pour les fichiers plus grands et conserve Content-Range.
            chunk_size = min(size, 64 * 1024 * 1024)
            with video.open('rb') as stream:
                offset = 0
                while offset < size:
                    body = stream.read(chunk_size)
                    end = offset + len(body) - 1
                    self.transport.request(
                        'PUT',
                        str(upload_url),
                        headers={
                            'Content-Type': 'video/mp4',
                            'Content-Length': str(len(body)),
                            'Content-Range': f'bytes {offset}-{end}/{size}',
                        },
                        body=body,
                        timeout=900,
                        accepted=(200, 201, 206),
                    )
                    offset = end + 1
            checkpoint({'uploaded': True}, str(publish_id))
        return PublishResult(
            external_id=str(publish_id),
            processing=True,
            remote_state={'uploaded': True},
        )

    def _check_status(
        self,
        entry: QueueEntry,
        credentials: dict[str, Any],
    ) -> PublishResult:
        token = self._access_token(credentials)
        response = self.transport.json_request(
            'POST',
            f'{API}/post/publish/status/fetch/',
            token=token,
            payload={'publish_id': entry.external_id},
        ).json()
        data = response.get('data', {})
        status = str(data.get('status', ''))
        if status == 'PUBLISH_COMPLETE':
            public_ids = data.get('publicaly_available_post_id', [])
            public_id = str(public_ids[0]) if public_ids else entry.external_id
            return PublishResult(
                external_id=public_id or str(entry.external_id),
                processing=False,
            )
        if status == 'FAILED':
            raise PermanentPublishError(
                f'TikTok : {data.get("fail_reason", "publication refusée")}'
            )
        return PublishResult(
            external_id=str(entry.external_id),
            processing=True,
        )

"""Publication de Reels Instagram professionnels via l'API Meta.

L'API Content Publishing ne propose pas, à ce jour, le commutateur natif de
déclaration IA exposé dans l'application Instagram. Pour ne jamais publier sans
déclaration, ce connecteur force donc une mention visible en première ligne de
la légende. Il ne prétend pas cocher un champ que Meta n'expose pas.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
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


AI_CAPTION = '🤖 Contenu créé avec l’aide de l’IA.'


class InstagramPublisher(BasePublisher):
    platform = 'instagram'

    def _access_token(self, credentials: dict[str, Any]) -> str:
        token = str(credentials.get('access_token', ''))
        if not token:
            raise MissingCredentials('Instagram : access_token absent')
        if token_expired(credentials):
            response = self.transport.json_request(
                'GET',
                'https://graph.instagram.com/refresh_access_token?'
                + urllib.parse.urlencode(
                    {'grant_type': 'ig_refresh_token', 'access_token': token}
                ),
            ).json()
            token = str(response.get('access_token', ''))
            if not token:
                raise MissingCredentials(
                    'Instagram : rafraîchissement OAuth sans jeton'
                )
            credentials['access_token'] = token
            credentials['expires_at'] = (
                datetime.now(timezone.utc)
                + timedelta(seconds=int(response.get('expires_in', 5184000)))
            ).isoformat(timespec='seconds')
            save_credentials(self.platform, credentials, self.credentials_path)
        return token

    @staticmethod
    def _video_url(entry: QueueEntry, credentials: dict[str, Any]) -> str:
        urls = credentials.get('video_urls', {})
        if isinstance(urls, dict) and urls.get(entry.video_file):
            return str(urls[entry.video_file])
        template = credentials.get('video_url_template')
        if template:
            return str(template).format(filename=entry.video_file.rsplit('/', 1)[-1])
        raise MissingCredentials(
            'Instagram exige une URL HTTPS publique de la vidéo : renseigner '
            'video_urls ou video_url_template dans instagram.json'
        )

    def _publish(
        self,
        entry: QueueEntry,
        credentials: dict[str, Any],
        checkpoint: Checkpoint,
    ) -> PublishResult:
        token = self._access_token(credentials)
        user_id = str(credentials.get('ig_user_id', ''))
        if not user_id:
            raise MissingCredentials('Instagram : ig_user_id absent')
        version = str(credentials.get('api_version', ''))
        if not version:
            raise MissingCredentials(
                'Instagram : api_version absente ; choisir la version active '
                'dans le tableau de bord Meta'
            )
        base = f'https://graph.instagram.com/{version}'
        container_id = entry.external_id or entry.remote_state.get('container_id')
        if not container_id:
            caption = f'{AI_CAPTION}\n\n{entry.description}'.strip()[:2200]
            response = self.transport.json_request(
                'POST',
                f'{base}/{user_id}/media',
                token=token,
                form={
                    'media_type': 'REELS',
                    'video_url': self._video_url(entry, credentials),
                    'caption': caption,
                    'share_to_feed': str(
                        bool(credentials.get('share_to_feed', True))
                    ).lower(),
                },
            ).json()
            container_id = str(response.get('id', ''))
            if not container_id:
                raise RetryablePublishError(
                    "Instagram n'a pas retourné d'identifiant de conteneur"
                )
            checkpoint({'container_id': container_id}, container_id)

        status = self.transport.json_request(
            'GET',
            f'{base}/{container_id}?'
            + urllib.parse.urlencode(
                {'fields': 'status_code,status', 'access_token': token}
            ),
        ).json()
        code = str(status.get('status_code', ''))
        if code in ('ERROR', 'EXPIRED'):
            raise PermanentPublishError(
                f'Instagram : {status.get("status", code)}'
            )
        if code != 'FINISHED':
            raise RetryablePublishError(
                f'Instagram prépare encore le Reel ({code or "état inconnu"})',
                retry_after=timedelta(minutes=5),
            )
        published = self.transport.json_request(
            'POST',
            f'{base}/{user_id}/media_publish',
            token=token,
            form={'creation_id': container_id},
        ).json()
        media_id = str(published.get('id', ''))
        if not media_id:
            raise RetryablePublishError(
                "Instagram n'a pas retourné d'identifiant de média"
            )
        checkpoint(
            {'container_id': container_id, 'media_id': media_id},
            media_id,
        )
        return PublishResult(external_id=media_id, processing=False)

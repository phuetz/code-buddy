"""Tests sans réseau des déclarations IA envoyées aux trois plateformes."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT_DIR = (
    Path(__file__).resolve().parents[3] / 'scripts' / 'influencer'
)
sys.path.insert(0, str(SCRIPT_DIR))

from publish_queue import PublicationQueue  # noqa: E402
from publishers.instagram import AI_CAPTION, InstagramPublisher  # noqa: E402
from publishers.tiktok import TikTokPublisher  # noqa: E402
from publishers.youtube import YouTubePublisher  # noqa: E402


class FakeResponse:
    def __init__(self, value=None, headers=None):
        self.value = value or {}
        self.headers = headers or {}

    def json(self):
        return self.value


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def json_request(self, method, url, **kwargs):
        self.calls.append(('json', method, url, kwargs))
        return self.responses.pop(0)

    def request(self, method, url, **kwargs):
        self.calls.append(('binary', method, url, kwargs))
        return self.responses.pop(0)


class PublishersDisclosureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.video = root / 'video.mp4'
        self.video.write_bytes(b'video-test')
        self.thumbnail = root / 'thumb.jpg'
        self.thumbnail.write_bytes(b'image-test')
        queue = PublicationQueue(root / 'queue.sqlite3', root / 'audit.jsonl')
        entry = queue.add(
            video_file=self.video,
            platform='youtube',
            title='Une IA locale',
            description='Description sourcée.',
            keywords=['IA locale'],
            thumbnail=self.thumbnail,
            scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=1),
            source_attributions=['source : example.test'],
            subject='Une IA locale',
            persona='Lisa',
            status='à_valider',
        )
        self.queue = queue
        self.entry = queue.approve(entry.id, approver='Patrice')

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def for_platform(self, platform):
        if platform == 'youtube':
            return self.entry
        other_video = Path(self.temporary.name) / f'{platform}.mp4'
        other_video.write_bytes(f'video-{platform}'.encode())
        entry = self.queue.add(
            video_file=other_video,
            platform=platform,
            title='Une IA locale',
            description='Description sourcée.',
            keywords=['IA locale'],
            thumbnail=self.thumbnail,
            scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=1),
            source_attributions=['source : example.test'],
            subject='Une IA locale',
            persona='Lisa',
            status='à_valider',
        )
        return self.queue.approve(entry.id, approver='Patrice')

    def test_youtube_sets_native_synthetic_media_flag(self) -> None:
        transport = FakeTransport(
            [
                FakeResponse(headers={'location': 'https://upload.test/session'}),
                FakeResponse({'id': 'yt-123'}),
                FakeResponse({}),
            ]
        )
        publisher = YouTubePublisher(transport=transport)
        publisher._publish(
            self.entry,
            {'access_token': 'test'},
            lambda _state, _identifier: None,
        )

        metadata = transport.calls[0][3]['payload']
        self.assertIs(
            metadata['status']['containsSyntheticMedia'],
            True,
        )

    def test_tiktok_sets_native_aigc_flag(self) -> None:
        entry = self.for_platform('tiktok')
        transport = FakeTransport(
            [
                FakeResponse(
                    {
                        'data': {
                            'privacy_level_options': ['SELF_ONLY'],
                            'max_video_post_duration_sec': 600,
                        }
                    }
                ),
                FakeResponse(
                    {
                        'data': {
                            'publish_id': 'tt-123',
                            'upload_url': 'https://upload.test/tiktok',
                        }
                    }
                ),
                FakeResponse({}),
            ]
        )
        publisher = TikTokPublisher(transport=transport)
        publisher._publish(
            entry,
            {'access_token': 'test', 'privacy_level': 'SELF_ONLY'},
            lambda _state, _identifier: None,
        )

        init_payload = transport.calls[1][3]['payload']
        self.assertIs(init_payload['post_info']['is_aigc'], True)

    def test_instagram_forces_visible_ai_disclosure(self) -> None:
        entry = self.for_platform('instagram')
        transport = FakeTransport(
            [
                FakeResponse({'id': 'container-123'}),
                FakeResponse({'status_code': 'FINISHED'}),
                FakeResponse({'id': 'ig-123'}),
            ]
        )
        publisher = InstagramPublisher(transport=transport)
        publisher._publish(
            entry,
            {
                'access_token': 'test',
                'ig_user_id': 'user-123',
                'api_version': 'v-test',
                'video_urls': {
                    entry.video_file: 'https://media.test/video.mp4',
                },
            },
            lambda _state, _identifier: None,
        )

        create_form = transport.calls[0][3]['form']
        self.assertTrue(create_form['caption'].startswith(AI_CAPTION))


if __name__ == '__main__':
    unittest.main()

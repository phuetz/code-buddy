import argparse
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts' / 'influencer' / 'veille-youtube.py'
SPEC = importlib.util.spec_from_file_location('veille_youtube', SCRIPT)
veille = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = veille
SPEC.loader.exec_module(veille)

class TestVeilleYoutubeBugs(unittest.TestCase):
    def setUp(self):
        self.channel = veille.Channel('Test', 'UCtest123', 'fr', 'test')
        self.video = veille.Video('12345678901', 'Test', 'UCtest123', 'Title', datetime.now(timezone.utc).isoformat(), 'url')
        self.args = argparse.Namespace(
            force=False,
            video_id=[],
            backfill=False,
            days=14,
            channel=None,
            max_videos=10,
            max_retries=3,
            workdir=Path('/tmp'),
            cookies=None,
            cookies_from_browser=None,
            whisper_model='small'
        )
        self.state = veille.default_state()
        self.inventory = []

    def test_bug_endless_retry(self):
        with patch.object(veille, 'fetch_channel_videos', return_value=[self.video]):
            selected = veille.choose_videos((self.channel,), self.args, self.state, self.inventory)
            self.assertEqual(len(selected), 1, "Should select unseen video initially")

            if 'failed_videos' not in self.state:
                self.state['failed_videos'] = {}
            self.state['failed_videos'][self.video.video_id] = {'count': 5, 'reason': 'Error', 'durable': True}

            selected_after_fail = veille.choose_videos((self.channel,), self.args, self.state, self.inventory)

            self.assertEqual(len(selected_after_fail), 0, "Should NOT select video that failed permanently")

    def test_missing_subtitles_retries_are_bounded(self):
        for attempt in range(1, 4):
            durable = veille.record_failure(
                self.state, self.args, self.video.video_id, 'pas de sous-titres'
            )
            self.assertEqual(durable, attempt == 3)
            with patch.object(veille, 'fetch_channel_videos', return_value=[self.video]):
                selected = veille.choose_videos(
                    (self.channel,), self.args, self.state, self.inventory
                )
            self.assertEqual(bool(selected), attempt < 3)

    @patch('shutil.which')
    @patch('subprocess.run')
    @patch('pathlib.Path.glob')
    def test_bug_no_subtitles(self, mock_glob, mock_run, mock_which):
        mock_which.return_value = '/usr/bin/yt-dlp'
        mock_glob.return_value = []
        mock_run.return_value = MagicMock(returncode=1, stderr="No subtitles", stdout="")
        self.args.workdir = Path('/tmp')

        try:
            with patch.dict('sys.modules', {'faster_whisper': None}):
                try:
                    veille.download_transcript(self.video, self.args)
                    self.fail("Should have raised an exception")
                except Exception as e:
                    self.assertIsInstance(e, ValueError, f"Got {type(e)}: {e}")
                    self.assertEqual(str(e), "pas de sous-titres")
        except AssertionError as e:
            raise e

if __name__ == '__main__':
    unittest.main()

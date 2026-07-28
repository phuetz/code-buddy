"""Tests du catalogue Flow/Veo Lisa + Ambre."""

from pathlib import Path
import sys
import unittest


SCRIPT_DIR = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
)
sys.path.insert(0, str(SCRIPT_DIR))

import flow_veo_campaign_2026_07_28 as campaign


class FlowVeoCampaignTest(unittest.TestCase):
    def test_requested_catalogue_sizes_and_formats(self) -> None:
        self.assertEqual(len(campaign.AMBRE_AUTOMNE_BASE), 24)
        self.assertEqual(len(campaign.LISA_TECH_BASE), 16)
        self.assertEqual(
            sum(ratio == '9:16' for _, _, ratio in campaign.AMBRE_AUTOMNE_BASE),
            6,
        )
        self.assertTrue(
            all(ratio == '16:9' for _, _, ratio in campaign.LISA_TECH_BASE)
        )

    def test_take_ids_are_unique_and_round_robin(self) -> None:
        all_prompts = campaign.AMBRE_AUTOMNE + campaign.LISA_TECH
        ids = [prompt_id for prompt_id, _, _ in all_prompts]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(campaign.AMBRE_AUTOMNE), 144)
        self.assertEqual(len(campaign.LISA_TECH), 96)
        self.assertTrue(
            all(prompt_id.endswith('-take01') for prompt_id, _, _ in campaign.LISA_TECH[:16])
        )

    def test_every_prompt_enforces_empty_clear_center(self) -> None:
        for prompt_id, prompt, _ in (
            campaign.AMBRE_AUTOMNE_BASE + campaign.LISA_TECH_BASE
        ):
            with self.subTest(prompt_id=prompt_id):
                self.assertIn('no person', prompt)
                self.assertIn('no human silhouette', prompt)
                self.assertIn('center', prompt)
                self.assertIn('no logo', prompt)
                self.assertIn('no readable text', prompt)

    def test_outputs_target_cowork_media_video_directories(self) -> None:
        ambre_dir = campaign.CAMPAIGN_QUEUES['ambre-automne'][2]
        lisa_dir = campaign.CAMPAIGN_QUEUES['lisa-tech'][2]
        self.assertEqual(ambre_dir.name, 'ambre-automne')
        self.assertEqual(lisa_dir.name, 'lisa-tech')
        self.assertEqual(ambre_dir.parent.name, 'media-video')
        self.assertEqual(lisa_dir.parent.name, 'media-video')


if __name__ == '__main__':
    unittest.main()

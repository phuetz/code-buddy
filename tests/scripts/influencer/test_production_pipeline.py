"""Tests des garde-fous de raccordement Lisa et Ambre."""

from pathlib import Path
import sys
import os
from unittest import mock
import unittest


SCRIPT_DIR = (
    Path(__file__).resolve().parents[3] / 'scripts' / 'influencer'
)
sys.path.insert(0, str(SCRIPT_DIR))

from production_pipeline import (  # noqa: E402
    PipelineError,
    validate_editorial,
    validate_format,
)


class ProductionPipelineTest(unittest.TestCase):
    def test_lisa_requires_the_validated_3_10_45_60_structure(self) -> None:
        with self.assertRaisesRegex(PipelineError, '3/10/45/60'):
            validate_format(
                {
                    'persona': 'Lisa',
                    'structure': {'0-3': 'accroche seulement'},
                }
            )

        validate_format(
            {
                'persona': 'Lisa',
                'structure': {
                    '0-3': 'rupture',
                    '3-10': 'contexte',
                    '10-45': 'preuves',
                    '45-60': 'conséquence',
                },
            }
        )

    def test_ambre_requires_soft_retention_rules(self) -> None:
        with self.assertRaisesRegex(PipelineError, 'douceur'):
            validate_format({'persona': 'Ambre'})

        validate_format(
            {
                'persona': 'Ambre',
                'registre': 'douceur',
                'plan_duration_seconds': 2.7,
                'no_hard_effects': True,
            }
        )

    def test_editorial_policy_runs_before_production(self) -> None:
        # La liste des sujets écartés est PRIVÉE : elle vit dans l'environnement, pas dans
        # le dépôt (celui-ci est public, et publier la liste dirait ce qu'on cherche à
        # taire). Le test pose donc la sienne, au lieu de dépendre de la machine — sans
        # quoi il passerait chez Patrice et échouerait en intégration continue.
        with mock.patch.dict(os.environ, {'INFLUENCER_EXCLUDED_TOPICS': 'organisme témoin'}):
            with self.assertRaisesRegex(PipelineError, 'sujet interdit'):
                validate_editorial(
                    {
                        'subject': 'Organisme témoin : de nouveaux contrôles',
                        'persona': 'Lisa',
                    }
                )

    def test_editorial_policy_lets_a_neutral_subject_through(self) -> None:
        with mock.patch.dict(os.environ, {'INFLUENCER_EXCLUDED_TOPICS': 'organisme témoin'}):
            validate_editorial({'subject': 'DeepSeek sort V4 Flash', 'persona': 'Lisa'})


if __name__ == '__main__':
    unittest.main()

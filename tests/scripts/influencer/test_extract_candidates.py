"""Tests de l'extracteur local et explicable de candidats sujets."""

from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sys

import pytest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'extract-candidates.py'
)
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location('extract_candidates', SCRIPT)
assert SPEC and SPEC.loader
extract_candidates = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = extract_candidates
SPEC.loader.exec_module(extract_candidates)

UTC = timezone.utc


def video(
    video_id: str,
    published: datetime,
    *,
    views: int = 100,
    title: str | None = None,
) -> dict:
    return {
        'video_id': video_id,
        'channel_id': extract_candidates.VISION_IA_CHANNEL_ID,
        'channel_name': 'Vision IA',
        'title': title or f'Vidéo {video_id}',
        'published': published.isoformat(),
        'upload_date': published.strftime('%Y%m%d'),
        'duration': 600,
        'view_count': views,
        'url': f'https://www.youtube.com/watch?v={video_id}',
        'description': '',
    }


def test_corrected_performance_uses_age_cohorts_and_robust_evidence() -> None:
    observed = datetime(2026, 7, 28, tzinfo=UTC)
    videos = [
        video('low', observed - timedelta(days=10), views=100),
        video('middle', observed - timedelta(days=12), views=1_000),
        video('high', observed - timedelta(days=20), views=10_000),
        video('old', observed - timedelta(days=500), views=1_000_000),
    ]

    performance, cohorts = extract_candidates.compute_video_performance(
        videos,
        observed,
    )

    assert performance['low']['cohort'] == '8-30j'
    assert performance['low']['percentile'] == 0
    assert performance['middle']['percentile'] == 0.5
    assert performance['high']['percentile'] == 1
    assert performance['old']['cohort'] == 'plus-de-365j'
    assert performance['old']['percentile'] == 0.5
    assert cohorts['8-30j']['video_count'] == 3
    assert 'robust_z' in performance['high']


def test_recurrence_rewards_persistence_over_a_same_week_burst() -> None:
    observed = datetime(2026, 7, 28, tzinfo=UTC)
    persistent = [
        video(f'p{index}', observed - timedelta(days=30 * index))
        for index in range(1, 7)
    ]
    burst = [
        video(f'b{index}', observed - timedelta(days=index))
        for index in range(1, 7)
    ]
    videos_by_id = {
        item['video_id']: item for item in [*persistent, *burst]
    }

    persistent_score = extract_candidates.recurrence_component(
        {item['video_id'] for item in persistent},
        videos_by_id,
        observed,
    )
    burst_score = extract_candidates.recurrence_component(
        {item['video_id'] for item in burst},
        videos_by_id,
        observed,
    )

    assert persistent_score['score'] > burst_score['score']
    assert persistent_score['evidence']['active_months']
    assert persistent_score['evidence']['median_delay_days'] == pytest.approx(
        30,
    )
    assert burst_score['evidence']['active_quarters'] == ['2026-T3']


def test_entity_momentum_rewards_a_rising_recent_rate() -> None:
    observed = datetime(2026, 7, 28, tzinfo=UTC)
    corpus = [
        video(f'v{days}', observed - timedelta(days=days))
        for days in range(5, 270, 10)
    ]
    rising_ids = {
        item['video_id']
        for item in corpus
        if (
            observed - extract_candidates.parse_datetime(item['published'])
        ).days < 90
    }
    falling_ids = {
        item['video_id']
        for item in corpus
        if 90 <= (
            observed - extract_candidates.parse_datetime(item['published'])
        ).days < 270
    }

    rising = extract_candidates.momentum_component(
        rising_ids,
        corpus,
        observed,
        'Entité montante',
    )
    falling = extract_candidates.momentum_component(
        falling_ids,
        corpus,
        observed,
        'Entité en recul',
    )

    assert rising['measured'] is True
    assert falling['measured'] is True
    assert rising['score'] > 0.5
    assert falling['score'] < 0.5
    assert rising['score'] > falling['score']
    assert rising['evidence']['recent_90_days']['mention_videos'] > 0


def test_freshness_stays_null_without_verified_announcement_date() -> None:
    published = datetime(2026, 7, 20, tzinfo=UTC)
    result = extract_candidates.freshness_component(
        [
            {
                'url': 'https://example.test/announcement',
                'announced_at': None,
            }
        ],
        [video('fresh', published)],
    )

    assert result['score'] is None
    assert result['measured'] is False
    assert 'reste null' in result['evidence']['reason']


def test_freshness_measures_an_explicit_reaction_delay() -> None:
    announced = datetime(2026, 7, 10, tzinfo=UTC)
    result = extract_candidates.freshness_component(
        [
            {
                'url': 'https://example.test/announcement',
                'announced_at': announced.isoformat(),
            }
        ],
        [video('reaction', announced + timedelta(days=2))],
    )

    assert result['measured'] is True
    assert result['score'] == pytest.approx(1 - 2 / 14, abs=1e-4)
    assert (
        result['evidence']['reactions'][0]['reaction_delay_days']
        == pytest.approx(2)
    )


def test_external_corroboration_is_neutral_if_watch_file_is_absent() -> None:
    neutral = extract_candidates.corroboration_component(
        'Suivi de Claude',
        ['Claude'],
        [],
        [],
        False,
    )
    corroborated = extract_candidates.corroboration_component(
        'Suivi de Claude',
        ['Claude'],
        [],
        [
            extract_candidates.ExternalSubject(
                'Claude découvre une faille Linux',
                (
                    {'label': 'Korben', 'url': 'https://korben.info/claude'},
                    {
                        'label': 'Numerama',
                        'url': 'https://numerama.com/claude',
                    },
                ),
            )
        ],
        True,
    )

    assert neutral['score'] == 0.5
    assert neutral['measured'] is False
    assert corroborated['score'] == pytest.approx(2 / 3, abs=1e-4)
    assert corroborated['evidence']['distinct_external_sources'] == 2


def test_penalties_are_separate_and_primary_source_absence_costs_points() -> None:
    penalties = extract_candidates.penalty_components(
        duplicate_count=1,
        distinct_videos=4,
        primary_sources=[],
        excluded=None,
    )

    assert penalties['doublon']['points'] == 2.5
    assert penalties['source_primaire_absente']['points'] == 8
    assert penalties['sujet_exclu_ou_sensible']['points'] == 0


def test_only_identifiable_official_or_academic_links_count_as_primary() -> None:
    assert extract_candidates.is_likely_primary_url(
        'https://www.anthropic.com/news/model'
    )
    assert extract_candidates.is_likely_primary_url(
        'https://www.science.org/doi/example'
    )
    assert not extract_candidates.is_likely_primary_url(
        'https://vision-ia.teachizy.fr/formations/n8n'
    )
    assert not extract_candidates.is_likely_primary_url(
        'https://bit.ly/affiliate'
    )


def test_entity_scan_ignores_ambiguous_and_generic_index_labels(
    tmp_path: Path,
) -> None:
    observed = datetime(2026, 7, 28, tzinfo=UTC)
    videos = [
        video(
            'calendar',
            observed - timedelta(days=2),
            title='Le bilan du mois de mai',
        ),
        video(
            'model',
            observed - timedelta(days=1),
            title='MAI-Image-2.5-Pro améliore la génération',
        ),
    ]
    groups = extract_candidates.build_entity_groups(
        {
            'aliases': {},
            'items': {
                'mai': {
                    'name': 'MAI-Image-2.5-Pro',
                    'family': 'MAI',
                    'kind': 'modèle',
                },
                'generic': {
                    'name': 'Unia',
                    'family': 'réseau de neurones non supervisé',
                    'kind': 'modèle',
                },
            },
        }
    )

    mentions, _, _ = extract_candidates.scan_entity_mentions(
        videos,
        tmp_path,
        groups,
    )
    mai_group = next(group for group in groups if 'mai' in group.item_keys)
    generic_group = next(
        group for group in groups if 'generic' in group.item_keys
    )

    assert mentions[mai_group.key] == {'model'}
    assert generic_group.key not in mentions
    assert 'mai' not in mai_group.patterns
    assert 'reseau de neurones non supervise' not in generic_group.patterns


def test_entity_scan_ignores_transcript_only_promotional_outro(
    tmp_path: Path,
) -> None:
    observed = datetime(2026, 7, 28, tzinfo=UTC)
    videos = [
        video('outro', observed - timedelta(days=2)),
        video('central', observed - timedelta(days=1)),
    ]
    filler = 'contenu principal sans mention ' * 100
    (tmp_path / 'outro.txt').write_text(
        f'{filler} module de formation utilisant n8n',
        encoding='utf-8',
    )
    (tmp_path / 'central.txt').write_text(
        f'{filler[: len(filler) // 2]} n8n '
        f'{filler[len(filler) // 2 :]}',
        encoding='utf-8',
    )
    groups = extract_candidates.build_entity_groups(
        {
            'aliases': {},
            'items': {
                'n8n': {
                    'name': 'n8n',
                    'family': 'n8n',
                    'kind': 'outil',
                }
            },
        }
    )

    mentions, evidence, stats = extract_candidates.scan_entity_mentions(
        videos,
        tmp_path,
        groups,
    )

    assert mentions[groups[0].key] == {'central'}
    assert evidence[groups[0].key][0]['transcript_relative_positions'] == [
        pytest.approx(0.5, abs=0.01)
    ]
    assert stats['boundary_transcript_mentions_ignored'] == 1


def test_editorial_policy_is_applied_before_queue_ranking(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # La liste des sujets écartés vit dans l'environnement, pas dans le dépôt : celui-ci
    # est public, et y publier la liste dirait exactement ce qu'on cherche à taire. Le
    # test pose la sienne, sinon il passerait sur la machine de Patrice et échouerait
    # partout ailleurs.
    monkeypatch.setenv('INFLUENCER_EXCLUDED_TOPICS', 'organisme témoin')
    observed = datetime(2026, 7, 28, tzinfo=UTC)
    inventory = {
        'updated_at': observed.isoformat(),
        'count': 2,
        'videos': [
            video(
                'excluded',
                observed - timedelta(days=2),
                title='Organisme témoin automatise un nouveau contrôle',
            ),
            video(
                'eligible',
                observed - timedelta(days=3),
                title='Un modèle local réduit les coûts',
            ),
        ],
    }
    queue = extract_candidates.build_queue(
        inventory,
        {'items': {}, 'aliases': {}},
        tmp_path,
    )

    assert len(queue['audit']['excluded_before_ranking']) == 1
    assert queue['source_snapshot']['eligible_vision_ia_entries'] == 1
    assert all(
        candidate['status'] == 'à_examiner'
        for candidate in queue['candidates']
    )
    encoded = json.dumps(queue, ensure_ascii=False)
    assert '"approved"' not in encoded
    assert all(
        'Organisme témoin automatise'
        not in json.dumps(candidate, ensure_ascii=False)
        for candidate in queue['candidates']
    )


def test_real_inventory_integration_if_present() -> None:
    veille = Path.home() / '.codebuddy' / 'veille'
    inventory_path = veille / 'inventaire-vision-ia.json'
    index_path = veille / 'index.json'
    if not inventory_path.is_file() or not index_path.is_file():
        pytest.skip('fichiers réels de veille absents')

    inventory = json.loads(inventory_path.read_text(encoding='utf-8'))
    index_payload = json.loads(index_path.read_text(encoding='utf-8'))
    queue = extract_candidates.build_queue(
        inventory,
        index_payload,
        veille / 'transcripts',
    )

    assert queue['source_snapshot']['vision_ia_channel_id'] == (
        extract_candidates.VISION_IA_CHANNEL_ID
    )
    assert queue['source_snapshot']['vision_ia_entries'] > 0
    assert queue['source_snapshot']['vision_ia_entries'] < len(
        inventory['videos']
    )
    assert queue['candidates']
    assert [candidate['rank'] for candidate in queue['candidates']] == list(
        range(1, len(queue['candidates']) + 1)
    )
    assert all(
        left['score_total'] >= right['score_total']
        for left, right in zip(
            queue['candidates'],
            queue['candidates'][1:],
        )
    )
    encoded = json.dumps(queue, ensure_ascii=False)
    assert '"approved"' not in encoded
    assert all(
        candidate['status'] == 'à_examiner'
        for candidate in queue['candidates']
    )

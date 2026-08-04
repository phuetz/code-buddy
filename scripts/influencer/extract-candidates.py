#!/usr/bin/env python3
"""Construit une file locale et explicable de candidats sujets.

L'extracteur joint l'inventaire Vision IA, l'index d'entités et, lorsqu'elle
existe, la sortie locale de ``find-subjects.py``. Il ne fait aucun appel réseau
et n'utilise aucun LLM. Le score ne constitue jamais une autorisation : tous
les candidats produits portent le statut ``à_examiner``.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import statistics
import sys
import tempfile
import unicodedata
import urllib.parse

from editorial_policy import find_excluded_topic


VISION_IA_CHANNEL_ID = 'UCyc03X3uRuxM9n7fyRH_gIw'
DEFAULT_VEILLE_DIR = Path.home() / '.codebuddy' / 'veille'
DEFAULT_WORK_DIR = Path.home() / '.codebuddy' / 'influencer-work'
DEFAULT_OUTPUT = DEFAULT_WORK_DIR / 'candidats-sujets.json'
DEFAULT_MARKDOWN = DEFAULT_WORK_DIR / 'candidats-sujets.md'
DEFAULT_RSS_OUTPUT = DEFAULT_WORK_DIR / 'sujets-du-jour.md'

SCORE_WEIGHTS = {
    'performance_corrigee': 25.0,
    'recurrence_persistance': 20.0,
    'momentum_entites': 15.0,
    # Les 15 % « corroboration externe et fraîcheur » de l'étude sont
    # volontairement séparés pour rendre les deux absences visibles.
    'corroboration_externe': 7.5,
    'fraicheur_reaction': 7.5,
    'adequation_public': 15.0,
    'contribution_originale': 10.0,
}

AGE_COHORTS = (
    ('0-7j', 0, 7),
    ('8-30j', 8, 30),
    ('31-90j', 31, 90),
    ('91-365j', 91, 365),
    ('plus-de-365j', 366, None),
)

RECAP_PATTERNS = (
    r'\bcette semaine\b',
    r'\bla semaine\b',
    r'\brecap',
    r'\brécap',
    r'\bactualites? ia\b',
    r'\bactualités? ia\b',
    r'\bnews ia\b',
    r'\bresume de la semaine\b',
    r'\brésumé de la semaine\b',
)

TECHNICAL_KEYWORDS = {
    'architecture',
    'api',
    'code',
    'codex',
    'agent',
    'agents',
    'infrastructure',
    'securite',
    'cybersecurite',
    'benchmark',
    'donnees',
    'modele',
    'open source',
}
SOVEREIGNTY_KEYWORDS = {
    'local',
    'confidentialite',
    'vie privee',
    'souverainete',
    'open source',
}
DECISION_KEYWORDS = {
    'cout',
    'prix',
    'productivite',
    'equipe',
    'comparaison',
    'benchmark',
    'entreprise',
}
CREATIVE_KEYWORDS = {
    'ecriture',
    'auteur',
    'roman',
    'narration',
    'personnage',
    'video',
    'image',
    'voix',
    'film',
}
GENERAL_INTEREST_KEYWORDS = {
    'robot',
    'science',
    'sante',
    'emploi',
    'education',
    'securite',
    'espace',
}

AMBIGUOUS_ENTITY_PATTERNS = {
    'ai',
    'box',
    'carbon',
    'flux',
    'ia',
    'mai',
    'mama',
    'muse',
    'soul',
    'unia',
    'wan',
}
GENERIC_ENTITY_PREFIXES = (
    'annonce ',
    'etude de ',
    'formation ',
    'jeu de donnees ',
    'methode ',
    'modele ',
    'outil d ',
    'outil de ',
    'programme d ',
    'preuve ',
    'recherche ',
    'reseau de ',
)
PRIMARY_SOURCE_HOSTS = {
    'anthropic.com',
    'arcprize.org',
    'arxiv.org',
    'bfl.ai',
    'blog.google',
    'chatgpt.com',
    'claude.com',
    'higgsfield.ai',
    'kimi.com',
    'krea.ai',
    'lambda.ai',
    'microsoft.ai',
    'nature.com',
    'openai.com',
    'science.org',
    'transformer-circuits.pub',
}


@dataclass(frozen=True)
class ExternalSubject:
    title: str
    origins: tuple[dict, ...]
    published_at: str | None = None


@dataclass
class EntityGroup:
    key: str
    label: str
    item_keys: list[str]
    names: list[str]
    families: list[str]
    kinds: list[str]
    patterns: set[str]
    primary_sources: list[dict]
    cited_sources: list[dict]


def parse_datetime(value: str | None) -> datetime | None:
    """Parse une date ISO en UTC, sans inventer de fuseau autre qu'UTC."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def isoformat(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def round_score(value: float | None, digits: int = 4) -> float | None:
    return None if value is None else round(value, digits)


def normalise_text(value: str) -> str:
    """Même normalisation lexicale que ``find-subjects.py``."""
    decomposed = unicodedata.normalize('NFKD', html.unescape(value))
    without_accents = ''.join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
    return ' '.join(
        re.sub(r'[^a-z0-9]+', ' ', without_accents.lower()).split()
    )


def titles_are_similar(left: str, right: str) -> bool:
    """Même cascade SequenceMatcher/Jaccard que ``find-subjects.py``."""
    if left == right:
        return True
    ratio = SequenceMatcher(None, left, right).ratio()
    if ratio >= 0.9:
        return True
    left_words, right_words = set(left.split()), set(right.split())
    if not left_words or not right_words:
        return False
    jaccard = len(left_words & right_words) / len(left_words | right_words)
    return ratio >= 0.82 and jaccard >= 0.78


def canonical_key(prefix: str, value: str) -> str:
    normalised = normalise_text(value).replace(' ', '-').strip('-')
    digest = hashlib.sha256(value.encode('utf-8')).hexdigest()[:12]
    readable = normalised[:64].rstrip('-') or 'sujet'
    return f'{prefix}-{readable}-{digest}'


def clean_topic_title(value: str) -> str:
    """Nettoie la forme sans prétendre réécrire factuellement le titre."""
    value = re.sub(r'[\U00010000-\U0010ffff]', ' ', value)
    value = re.sub(
        r'^\s*(urgent|incroyable|alerte|breaking)\s*[:!—-]+\s*',
        '',
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r'\s+', ' ', value).strip(' \t\r\n-–—')
    return value[:240]


def entity_pattern_is_safe(value: str) -> bool:
    """Écarte les libellés génériques et mots français trop ambigus."""
    normalised = normalise_text(value)
    if len(normalised) < 3 or normalised in AMBIGUOUS_ENTITY_PATTERNS:
        return False
    return not normalised.startswith(GENERIC_ENTITY_PREFIXES)


def age_cohort(age_days: int) -> str:
    for label, minimum, maximum in AGE_COHORTS:
        if age_days >= minimum and (maximum is None or age_days <= maximum):
            return label
    return '0-7j'


def median_and_mad(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    median = statistics.median(values)
    mad = statistics.median(abs(value - median) for value in values)
    return median, mad


def percentile_ranks(values: list[float]) -> list[float]:
    """Rangs centiles avec moyenne des rangs pour les ex æquo."""
    if len(values) <= 1:
        return [0.5 for _ in values]
    ordered = sorted(enumerate(values), key=lambda pair: pair[1])
    result = [0.0] * len(values)
    index = 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][1] == ordered[index][1]:
            end += 1
        average_rank = (index + end - 1) / 2
        percentile = average_rank / (len(values) - 1)
        for position in range(index, end):
            result[ordered[position][0]] = percentile
        index = end
    return result


def compute_video_performance(
    videos: list[dict],
    observed_at: datetime,
) -> tuple[dict[str, dict], dict[str, dict]]:
    """Calcule percentile et z robuste de chaque vidéo dans sa cohorte d'âge."""
    grouped: dict[str, list[tuple[dict, float, int]]] = defaultdict(list)
    for video in videos:
        published = parse_datetime(video.get('published'))
        views = video.get('view_count')
        if published is None or not isinstance(views, (int, float)) or views < 0:
            continue
        age_days = max(0, int((observed_at - published).total_seconds() // 86400))
        grouped[age_cohort(age_days)].append((video, math.log1p(views), age_days))

    by_video: dict[str, dict] = {}
    cohort_evidence: dict[str, dict] = {}
    for cohort, entries in grouped.items():
        log_views = [entry[1] for entry in entries]
        median, mad = median_and_mad(log_views)
        percentiles = percentile_ranks(log_views)
        cohort_evidence[cohort] = {
            'video_count': len(entries),
            'median_log1p_views': round(median, 6),
            'mad_log1p_views': round(mad, 6),
        }
        for (video, logged_views, age_days), percentile in zip(
            entries,
            percentiles,
        ):
            robust_z = None
            if mad > 0:
                robust_z = (logged_views - median) / (1.4826 * mad)
            elif logged_views == median:
                robust_z = 0.0
            by_video[video['video_id']] = {
                'video_id': video['video_id'],
                'published_at': video['published'],
                'view_count': video['view_count'],
                'age_days': age_days,
                'cohort': cohort,
                'log1p_views': round(logged_views, 6),
                'cohort_median_log1p_views': round(median, 6),
                'cohort_mad_log1p_views': round(mad, 6),
                'robust_z': round_score(robust_z),
                'percentile': round(percentile, 4),
            }
    return by_video, cohort_evidence


def performance_component(
    video_ids: set[str],
    performance_by_video: dict[str, dict],
) -> dict:
    evidence = [
        performance_by_video[video_id]
        for video_id in sorted(video_ids)
        if video_id in performance_by_video
    ]
    if not evidence:
        return {
            'score': 0.5,
            'measured': False,
            'evidence': {
                'reason': 'aucun compteur de vues exploitable',
                'videos': [],
            },
        }
    score = statistics.median(item['percentile'] for item in evidence)
    return {
        'score': round(score, 4),
        'measured': True,
        'evidence': {
            'aggregation': 'médiane des percentiles par cohorte d’âge',
            'measured_videos': len(evidence),
            'videos': evidence,
        },
    }


def quarter_index(value: datetime) -> int:
    return value.year * 4 + (value.month - 1) // 3


def is_recap(title: str) -> bool:
    return any(
        re.search(pattern, title, flags=re.IGNORECASE)
        for pattern in RECAP_PATTERNS
    )


def recurrence_component(
    video_ids: set[str],
    videos_by_id: dict[str, dict],
    observed_at: datetime,
    performance_by_video: dict[str, dict] | None = None,
) -> dict:
    dated = []
    for video_id in video_ids:
        video = videos_by_id.get(video_id)
        published = parse_datetime(video.get('published') if video else None)
        if video and published:
            dated.append((published, video))
    dated.sort(key=lambda pair: pair[0])
    if not dated:
        return {
            'score': 0.0,
            'measured': False,
            'evidence': {'reason': 'aucune vidéo datée', 'video_ids': []},
        }

    months = {published.strftime('%Y-%m') for published, _ in dated}
    quarters = {
        f'{published.year}-T{((published.month - 1) // 3) + 1}'
        for published, _ in dated
    }
    delays = [
        (dated[index][0] - dated[index - 1][0]).total_seconds() / 86400
        for index in range(1, len(dated))
    ]
    first_quarter = quarter_index(dated[0][0])
    last_observable_quarter = quarter_index(observed_at)
    observable_quarters = max(1, last_observable_quarter - first_quarter + 1)
    persistence = len(quarters) / observable_quarters
    recap_count = sum(is_recap(video['title']) for _, video in dated)
    distinct_count = len({video['video_id'] for _, video in dated})

    volume_score = min(distinct_count / 10, 1.0)
    breadth_score = min(len(months) / 6, 1.0)
    mono_subject_share = 1 - recap_count / distinct_count
    score = (
        0.40 * volume_score
        + 0.25 * breadth_score
        + 0.25 * clamp(persistence)
        + 0.10 * mono_subject_share
    )
    measured_performance = []
    if performance_by_video:
        measured_performance = [
            performance_by_video[video_id]['percentile']
            for video_id in video_ids
            if video_id in performance_by_video
        ]
    return {
        'score': round(score, 4),
        'measured': True,
        'evidence': {
            'distinct_videos': distinct_count,
            'active_months': sorted(months),
            'active_quarters': sorted(quarters),
            'observable_quarters_since_first_mention': observable_quarters,
            'persistence': round(clamp(persistence), 4),
            'median_delay_days': (
                round(statistics.median(delays), 2) if delays else None
            ),
            'recap_count': recap_count,
            'recap_share': round(recap_count / distinct_count, 4),
            'mono_subject_share': round(mono_subject_share, 4),
            'median_corrected_performance': (
                round(statistics.median(measured_performance), 4)
                if measured_performance
                else None
            ),
            'videos': [
                {
                    'video_id': video['video_id'],
                    'title': video['title'],
                    'published_at': video['published'],
                    'is_recap': is_recap(video['title']),
                }
                for _, video in dated
            ],
        },
    }


def _period_count(
    videos: list[dict],
    start: datetime,
    end: datetime,
) -> int:
    return sum(
        1
        for video in videos
        if (
            (published := parse_datetime(video.get('published'))) is not None
            and start <= published < end
        )
    )


def _monthly_rates(
    entity_video_ids: set[str],
    videos: list[dict],
    observed_at: datetime,
) -> list[dict]:
    rates = []
    for offset in range(5, -1, -1):
        end = observed_at - timedelta(days=30 * offset)
        start = end - timedelta(days=30)
        denominator = _period_count(videos, start, end)
        mentions = sum(
            1
            for video in videos
            if video.get('video_id') in entity_video_ids
            and (
                (published := parse_datetime(video.get('published'))) is not None
                and start <= published < end
            )
        )
        rates.append(
            {
                'start': isoformat(start),
                'end': isoformat(end),
                'mention_videos': mentions,
                'published_videos': denominator,
                'rate_per_100_videos': (
                    round(100 * mentions / denominator, 4)
                    if denominator
                    else None
                ),
            }
        )
    return rates


def _linear_slope(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean_x = (len(values) - 1) / 2
    mean_y = statistics.mean(values)
    numerator = sum(
        (index - mean_x) * (value - mean_y)
        for index, value in enumerate(values)
    )
    denominator = sum((index - mean_x) ** 2 for index in range(len(values)))
    return numerator / denominator if denominator else 0.0


def momentum_component(
    entity_video_ids: set[str],
    all_videos: list[dict],
    observed_at: datetime,
    entity_label: str | None = None,
) -> dict:
    """Compare 90 jours récents aux 180 jours précédents, puis la pente 6 mois."""
    recent_start = observed_at - timedelta(days=90)
    previous_start = observed_at - timedelta(days=270)
    recent_total = _period_count(all_videos, recent_start, observed_at)
    previous_total = _period_count(all_videos, previous_start, recent_start)
    recent_mentions = _period_count(
        [
            video
            for video in all_videos
            if video.get('video_id') in entity_video_ids
        ],
        recent_start,
        observed_at,
    )
    previous_mentions = _period_count(
        [
            video
            for video in all_videos
            if video.get('video_id') in entity_video_ids
        ],
        previous_start,
        recent_start,
    )
    recent_rate = 100 * recent_mentions / recent_total if recent_total else None
    previous_rate = (
        100 * previous_mentions / previous_total if previous_total else None
    )
    monthly = _monthly_rates(entity_video_ids, all_videos, observed_at)
    valid_monthly_rates = [
        item['rate_per_100_videos']
        for item in monthly
        if item['rate_per_100_videos'] is not None
    ]
    slope = _linear_slope(valid_monthly_rates)
    evidence = {
        'entity': entity_label,
        'minimum_distinct_videos': 3,
        'distinct_mention_videos': len(entity_video_ids),
        'recent_90_days': {
            'mention_videos': recent_mentions,
            'published_videos': recent_total,
            'rate_per_100_videos': round_score(recent_rate),
        },
        'previous_180_days': {
            'mention_videos': previous_mentions,
            'published_videos': previous_total,
            'rate_per_100_videos': round_score(previous_rate),
        },
        'six_month_windows': monthly,
        'six_month_rate_slope': round(slope, 4),
    }
    if (
        len(entity_video_ids) < 3
        or recent_rate is None
        or previous_rate is None
    ):
        evidence['reason'] = (
            'momentum non mesuré : moins de trois vidéos distinctes '
            'ou fenêtre de comparaison incomplète'
        )
        return {'score': 0.5, 'measured': False, 'evidence': evidence}

    rate_score = (
        0.5
        if recent_rate == 0 and previous_rate == 0
        else recent_rate / (recent_rate + previous_rate)
    )
    slope_score = 0.5 + 0.5 * (slope / (abs(slope) + 5))
    score = 0.75 * rate_score + 0.25 * slope_score
    return {
        'score': round(clamp(score), 4),
        'measured': True,
        'evidence': evidence,
    }


def freshness_component(
    primary_sources: list[dict],
    videos: list[dict],
) -> dict:
    """Mesure le délai d'annonce uniquement avec un ``announced_at`` explicite."""
    dated_sources = []
    for source in primary_sources:
        announced = parse_datetime(source.get('announced_at'))
        if announced is not None:
            dated_sources.append((announced, source))
    dated_videos = [
        (published, video)
        for video in videos
        if (published := parse_datetime(video.get('published'))) is not None
    ]
    if not dated_sources:
        return {
            'score': None,
            'measured': False,
            'evidence': {
                'reason': (
                    'aucune date announced_at vérifiée localement ; '
                    'le délai de réaction reste null'
                ),
                'primary_sources': primary_sources,
                'video_publication_dates': [
                    {
                        'video_id': video['video_id'],
                        'published_at': video['published'],
                    }
                    for _, video in sorted(dated_videos)
                ],
            },
        }
    reactions = []
    for announced, source in dated_sources:
        eligible = [
            (published, video)
            for published, video in dated_videos
            if published >= announced
        ]
        if not eligible:
            continue
        published, video = min(eligible, key=lambda pair: pair[0])
        delay_days = (published - announced).total_seconds() / 86400
        reactions.append(
            {
                'source_url': source.get('url'),
                'announced_at': isoformat(announced),
                'video_id': video['video_id'],
                'video_published_at': video['published'],
                'reaction_delay_days': round(delay_days, 3),
            }
        )
    if not reactions:
        return {
            'score': None,
            'measured': False,
            'evidence': {
                'reason': 'aucune vidéo postérieure aux annonces datées',
                'primary_sources': primary_sources,
            },
        }
    median_delay = statistics.median(
        reaction['reaction_delay_days'] for reaction in reactions
    )
    score = clamp(1 - median_delay / 14)
    return {
        'score': round(score, 4),
        'measured': True,
        'evidence': {
            'median_reaction_delay_days': round(median_delay, 3),
            'normalisation': '1 à J0, 0 à J14 ou après',
            'reactions': reactions,
        },
    }


def parse_markdown_external_subjects(path: Path) -> list[ExternalSubject]:
    subjects = []
    current_title = None
    current_origins: list[dict] = []
    subject_pattern = re.compile(
        r'^SUJET\s+\d+(?:\s+\[C\d+\])?\s*:\s*(.+)$',
        flags=re.IGNORECASE,
    )
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        subject_match = subject_pattern.match(raw_line.strip())
        if subject_match:
            if current_title:
                subjects.append(
                    ExternalSubject(current_title, tuple(current_origins))
                )
            current_title = subject_match.group(1).strip()
            current_origins = []
            continue
        if current_title and raw_line.startswith('SOURCE:'):
            for origin_text in raw_line.removeprefix('SOURCE:').split(' ; '):
                label, separator, url = origin_text.strip().partition(' — ')
                if separator and url:
                    current_origins.append({'label': label, 'url': url})
    if current_title:
        subjects.append(ExternalSubject(current_title, tuple(current_origins)))
    return subjects


def parse_json_external_subjects(path: Path) -> list[ExternalSubject]:
    payload = json.loads(path.read_text(encoding='utf-8'))
    if isinstance(payload, dict):
        values = (
            payload.get('subjects')
            or payload.get('candidates')
            or payload.get('items')
            or []
        )
    else:
        values = payload
    result = []
    for value in values if isinstance(values, list) else []:
        if not isinstance(value, dict):
            continue
        title = (
            value.get('title')
            or value.get('canonical_topic')
            or value.get('topic')
        )
        if not title:
            continue
        origins = value.get('origins') or value.get('sources') or []
        if not origins and value.get('url'):
            origins = [
                {
                    'label': value.get('source_label') or value.get('source'),
                    'url': value['url'],
                }
            ]
        result.append(
            ExternalSubject(
                str(title),
                tuple(origin for origin in origins if isinstance(origin, dict)),
                value.get('published_at') or value.get('published'),
            )
        )
    return result


def load_external_subjects(path: Path | None) -> tuple[list[ExternalSubject], bool]:
    if path is None or not path.is_file():
        return [], False
    try:
        if path.suffix.lower() == '.json':
            return parse_json_external_subjects(path), True
        return parse_markdown_external_subjects(path), True
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f'Corroboration RSS illisible ({path}) : {error}', file=sys.stderr)
        return [], False


def canonical_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(html.unescape(value))
    host = parsed.netloc.lower().removeprefix('www.')
    path = re.sub(r'/+$', '', parsed.path) or '/'
    return urllib.parse.urlunsplit((parsed.scheme.lower(), host, path, '', ''))


def is_likely_primary_url(value: str) -> bool:
    """Classe seulement les domaines officiels/académiques identifiables localement."""
    host = urllib.parse.urlsplit(value).netloc.lower().split(':', 1)[0]
    host = host.removeprefix('www.')
    return any(
        host == allowed or host.endswith(f'.{allowed}')
        for allowed in PRIMARY_SOURCE_HOSTS
    )


def corroboration_component(
    topic: str,
    entity_names: list[str],
    representative_titles: list[str],
    external_subjects: list[ExternalSubject],
    source_available: bool,
) -> dict:
    if not source_available:
        return {
            'score': 0.5,
            'measured': False,
            'evidence': {
                'reason': (
                    'sortie locale de find-subjects.py absente ou illisible ; '
                    'composante neutre'
                ),
                'matches': [],
            },
        }

    variants = [
        normalise_text(value)
        for value in [topic, *representative_titles]
        if normalise_text(value)
    ]
    entity_tokens = {
        normalise_text(value)
        for value in entity_names
        if len(normalise_text(value)) >= 4
    }
    matches = []
    source_keys = set()
    for external in external_subjects:
        exclusion = find_excluded_topic(external.title)
        if exclusion:
            continue
        external_title = normalise_text(external.title)
        lexical_match = any(
            titles_are_similar(external_title, variant) for variant in variants
        )
        entity_match = any(
            f' {entity} ' in f' {external_title} '
            for entity in entity_tokens
        )
        if not lexical_match and not entity_match:
            continue
        origins = []
        for origin in external.origins:
            url = str(origin.get('url') or '')
            label = str(origin.get('label') or origin.get('source') or '')
            key = canonical_url(url) if url else label
            if key:
                source_keys.add(key)
            origins.append({'label': label, 'url': url})
        matches.append(
            {
                'title': external.title,
                'published_at': external.published_at,
                'match': 'lexical' if lexical_match else 'entity',
                'origins': origins,
            }
        )
    score = min(len(source_keys) / 3, 1.0)
    return {
        'score': round(score, 4),
        'measured': True,
        'evidence': {
            'distinct_external_sources': len(source_keys),
            'matched_subjects': len(matches),
            'matches': matches,
            'note': 'pression médiatique, pas demande de recherche',
        },
    }


def audience_fit_component(text: str) -> dict:
    normalised = normalise_text(text)

    def matches(words: set[str]) -> list[str]:
        return sorted(
            word
            for word in words
            if f' {normalise_text(word)} ' in f' {normalised} '
        )

    categories = {
        'architecture_technique': matches(TECHNICAL_KEYWORDS),
        'local_souverainete': matches(SOVEREIGNTY_KEYWORDS),
        'decision_couts': matches(DECISION_KEYWORDS),
        'creation_auteur_media': matches(CREATIVE_KEYWORDS),
        'interet_general': matches(GENERAL_INTEREST_KEYWORDS),
    }
    strategic_categories = sum(bool(value) for value in categories.values())
    score = clamp(0.25 + 0.15 * strategic_categories)
    return {
        'score': round(score, 4),
        'measured': True,
        'evidence': {
            'method': 'règles lexicales explicites issues de la matrice de routage',
            'matched_categories': categories,
        },
    }


def contribution_component(
    video_ids: set[str],
    videos_by_id: dict[str, dict],
    primary_sources: list[dict],
) -> dict:
    months = {
        published.strftime('%Y-%m')
        for video_id in video_ids
        if (video := videos_by_id.get(video_id))
        and (published := parse_datetime(video.get('published')))
    }
    distinct_videos = len(video_ids)
    longitudinal = (
        0.7 * min(distinct_videos / 10, 1.0)
        + 0.3 * min(len(months) / 6, 1.0)
    )
    source_depth = min(len(primary_sources) / 2, 1.0)
    score = 0.7 * longitudinal + 0.3 * source_depth
    if distinct_videos >= 10 and len(months) >= 3:
        proposal = (
            'Synthèse longitudinale de 10 vidéos ou plus, à recouper avec '
            'au moins deux sources primaires avant toute rédaction.'
        )
    elif distinct_videos >= 5:
        proposal = (
            'Comparaison temporelle de plusieurs traitements du sujet ; '
            'les sources primaires complémentaires restent à vérifier.'
        )
    elif primary_sources:
        proposal = (
            'Analyse factuelle d’une source primaire avec comparaison ou test '
            'original à définir humainement.'
        )
    else:
        proposal = (
            'Contribution originale non établie : angle, test ou comparaison '
            'à définir lors de l’examen humain.'
        )
    return {
        'score': round(clamp(score), 4),
        'measured': True,
        'evidence': {
            'distinct_videos': distinct_videos,
            'active_months': len(months),
            'primary_sources_present': len(primary_sources),
            'strong_longitudinal_pattern': (
                distinct_videos >= 10 and len(months) >= 3
            ),
            'proposed_contribution': proposal,
            'warning': (
                'capacité estimée seulement ; la contribution doit être '
                'déclarée et validée par Patrice'
            ),
        },
    }


def duplicate_title_evidence(
    video_ids: set[str],
    videos_by_id: dict[str, dict],
) -> tuple[int, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for video_id in video_ids:
        video = videos_by_id.get(video_id)
        if video:
            grouped[normalise_text(video['title'])].append(video)
    duplicates = []
    duplicate_count = 0
    for title, videos in sorted(grouped.items()):
        if title and len(videos) > 1:
            duplicate_count += len(videos) - 1
            duplicates.append(
                {
                    'canonical_title': title,
                    'video_ids': sorted(video['video_id'] for video in videos),
                }
            )
    return duplicate_count, duplicates


def penalty_components(
    *,
    duplicate_count: int,
    distinct_videos: int,
    primary_sources: list[dict],
    excluded: tuple[str, str] | None,
    duplicate_evidence: list[dict] | None = None,
    cited_sources: list[dict] | None = None,
) -> dict:
    duplicate_ratio = duplicate_count / max(1, distinct_videos)
    duplicate_points = min(10.0, 10.0 * duplicate_ratio)
    primary_points = 0.0 if primary_sources else 8.0
    excluded_points = 100.0 if excluded else 0.0
    return {
        'doublon': {
            'points': round(duplicate_points, 3),
            'evidence': {
                'duplicate_titles_after_normalisation': duplicate_count,
                'distinct_videos': distinct_videos,
                'groups': duplicate_evidence or [],
            },
        },
        'source_primaire_absente': {
            'points': primary_points,
            'evidence': {
                'primary_source_count': len(primary_sources),
                'primary_sources': primary_sources,
                'cited_but_unverified_links': [
                    source
                    for source in (cited_sources or [])
                    if source.get('classification') != 'likely_primary'
                ],
            },
        },
        'sujet_exclu_ou_sensible': {
            'points': excluded_points,
            'evidence': (
                {'reason': excluded[0], 'keyword': excluded[1]}
                if excluded
                else {'reason': None, 'keyword': None}
            ),
        },
    }


def score_components(
    components: dict[str, dict],
    penalties: dict[str, dict],
) -> tuple[float, dict[str, dict]]:
    scored = {}
    total = 0.0
    for name, weight in SCORE_WEIGHTS.items():
        component = components[name]
        raw_score = component.get('score')
        used_score = 0.5 if raw_score is None else clamp(float(raw_score))
        weighted_points = weight * used_score
        scored[name] = {
            **component,
            'weight_percent': weight,
            'score_used_for_ordering': round(used_score, 4),
            'weighted_points': round(weighted_points, 3),
        }
        total += weighted_points
    total -= sum(float(value['points']) for value in penalties.values())
    return round(clamp(total, 0.0, 100.0), 3), scored


def _union_find_groups(values: list[tuple[str, str]]) -> list[list[int]]:
    parents = list(range(len(values)))

    def root(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = root(left), root(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for left in range(len(values)):
        left_name, left_family = values[left]
        for right in range(left + 1, len(values)):
            right_name, right_family = values[right]
            if (
                titles_are_similar(left_name, right_name)
                or (
                    left_family
                    and right_family
                    and titles_are_similar(left_family, right_family)
                )
            ):
                union(left, right)
    grouped: dict[int, list[int]] = defaultdict(list)
    for index in range(len(values)):
        grouped[root(index)].append(index)
    return list(grouped.values())


def build_entity_groups(index_payload: dict) -> list[EntityGroup]:
    items = list((index_payload.get('items') or {}).items())
    descriptors = [
        (
            normalise_text(str(item.get('name') or key)),
            normalise_text(str(item.get('family') or '')),
        )
        for key, item in items
    ]
    groups = []
    item_to_group: dict[str, EntityGroup] = {}
    compact_to_group: dict[str, EntityGroup] = {}
    for indices in _union_find_groups(descriptors):
        selected = [items[index] for index in indices]
        item_keys = sorted(key for key, _ in selected)
        names = sorted(
            {str(item.get('name') or key) for key, item in selected}
        )
        families = sorted(
            {
                str(item.get('family'))
                for _, item in selected
                if item.get('family')
            }
        )
        kinds = sorted(
            {str(item.get('kind')) for _, item in selected if item.get('kind')}
        )
        safe_families = [
            family for family in families if entity_pattern_is_safe(family)
        ]
        label_candidates = safe_families or names
        label = min(label_candidates, key=lambda value: (len(value), value))
        patterns = {
            normalise_text(value)
            for value in [*names, *families]
            if entity_pattern_is_safe(value)
        }
        primary_sources = []
        cited_sources = []
        seen_urls = set()
        for key, item in selected:
            link = item.get('link')
            if not link:
                continue
            url = canonical_url(str(link))
            if url in seen_urls:
                continue
            seen_urls.add(url)
            source = {
                'url': str(link),
                'publisher': urllib.parse.urlsplit(str(link)).netloc,
                'announced_at': None,
                'date_status': 'non_disponible_localement',
                'entity_key': key,
                'classification': (
                    'likely_primary'
                    if is_likely_primary_url(str(link))
                    else 'cited_unverified'
                ),
            }
            cited_sources.append(source)
            if source['classification'] == 'likely_primary':
                primary_sources.append(source)
        group = EntityGroup(
            key=canonical_key('entite', '|'.join(item_keys)),
            label=label,
            item_keys=item_keys,
            names=names,
            families=families,
            kinds=kinds,
            patterns=patterns,
            primary_sources=primary_sources,
            cited_sources=cited_sources,
        )
        groups.append(group)
        for key, item in selected:
            item_to_group[key] = group
            for variant in (
                key,
                str(item.get('name') or ''),
                str(item.get('family') or ''),
            ):
                compact = normalise_text(variant).replace(' ', '')
                if compact:
                    compact_to_group[compact] = group

    for alias, target in (index_payload.get('aliases') or {}).items():
        target_group = (
            item_to_group.get(str(target))
            or compact_to_group.get(normalise_text(str(target)).replace(' ', ''))
        )
        if target_group and entity_pattern_is_safe(str(alias)):
            target_group.patterns.add(normalise_text(str(alias)))
    return sorted(groups, key=lambda group: group.key)


def compile_entity_pattern(
    groups: list[EntityGroup],
) -> tuple[re.Pattern[str] | None, dict[str, set[str]]]:
    pattern_to_groups: dict[str, set[str]] = defaultdict(set)
    for group in groups:
        for pattern in group.patterns:
            if pattern:
                pattern_to_groups[pattern].add(group.key)
    if not pattern_to_groups:
        return None, pattern_to_groups
    alternatives = '|'.join(
        re.escape(pattern)
        for pattern in sorted(pattern_to_groups, key=len, reverse=True)
    )
    return (
        re.compile(rf'(?<![a-z0-9])(?:{alternatives})(?![a-z0-9])'),
        pattern_to_groups,
    )


def scan_entity_mentions(
    videos: list[dict],
    transcripts_dir: Path,
    groups: list[EntityGroup],
) -> tuple[dict[str, set[str]], dict[str, list[dict]], dict]:
    regex, pattern_to_groups = compile_entity_pattern(groups)
    mentions: dict[str, set[str]] = defaultdict(set)
    mention_evidence: dict[str, list[dict]] = defaultdict(list)
    transcript_count = 0
    character_count = 0
    boundary_mentions_ignored = 0
    for video in videos:
        video_id = video['video_id']
        transcript_path = transcripts_dir / f'{video_id}.txt'
        bases: dict[str, str] = {'title': normalise_text(video['title'])}
        if transcript_path.is_file():
            try:
                transcript = transcript_path.read_text(
                    encoding='utf-8',
                    errors='replace',
                )
            except OSError as error:
                print(
                    f'Transcription illisible {transcript_path}: {error}',
                    file=sys.stderr,
                )
            else:
                transcript_count += 1
                character_count += len(transcript)
                bases['transcript'] = normalise_text(transcript)
        found: dict[str, set[str]] = defaultdict(set)
        positions: dict[str, list[float]] = defaultdict(list)
        if regex:
            for basis, text in bases.items():
                for match in regex.finditer(text):
                    position = match.start() / max(1, len(text))
                    # Les appels promotionnels répétés se trouvent massivement
                    # dans les introductions/conclusions. Un titre reste une
                    # preuve forte ; une mention de transcription en bordure
                    # seule ne suffit pas à étiqueter toute la vidéo.
                    if basis == 'transcript' and not 0.15 <= position <= 0.85:
                        boundary_mentions_ignored += 1
                        continue
                    for group_key in pattern_to_groups[match.group(0)]:
                        found[group_key].add(basis)
                        if basis == 'transcript':
                            positions[group_key].append(round(position, 4))
        for group_key, bases_found in found.items():
            mentions[group_key].add(video_id)
            mention_evidence[group_key].append(
                {
                    'video_id': video_id,
                    'title': video['title'],
                    'published_at': video['published'],
                    'view_count': video.get('view_count'),
                    'url': video.get('url'),
                    'mention_basis': sorted(bases_found),
                    'transcript_relative_positions': positions[group_key],
                }
            )
    return (
        mentions,
        mention_evidence,
        {
            'transcripts_scanned': transcript_count,
            'transcript_characters_scanned': character_count,
            'entity_groups': len(groups),
            'patterns': len(pattern_to_groups),
            'boundary_transcript_mentions_ignored': boundary_mentions_ignored,
            'transcript_evidence_window': '15%–85% de la transcription',
        },
    )


def cluster_unassigned_titles(
    videos: list[dict],
    assigned_video_ids: set[str],
) -> list[dict]:
    clusters: list[dict] = []
    canonical_titles: list[str] = []
    for video in videos:
        if video['video_id'] in assigned_video_ids:
            continue
        title = normalise_text(video['title'])
        match_index = next(
            (
                index
                for index, known_title in enumerate(canonical_titles)
                if titles_are_similar(title, known_title)
            ),
            None,
        )
        if match_index is None:
            clusters.append(
                {
                    'canonical_topic': clean_topic_title(video['title']),
                    'video_ids': {video['video_id']},
                    'entity_names': [],
                    'entity_keys': [],
                    'themes': ['titre-non-indexe'],
                    'primary_sources': [],
                    'cited_sources': [],
                    'mention_evidence': [],
                    'kind': 'title_cluster',
                }
            )
            canonical_titles.append(title)
        else:
            clusters[match_index]['video_ids'].add(video['video_id'])
    for cluster in clusters:
        cluster['canonical_key'] = canonical_key(
            'titre',
            normalise_text(cluster['canonical_topic']),
        )
    return clusters


def possible_outputs() -> dict:
    return {
        'shared_research': {
            'assets': [
                'sources et fact-checking',
                'chronologie et chiffres',
                'résultat d’un éventuel test maison',
            ],
            'human_validation': 'obligatoire',
        },
        'article_journal': {
            'format': '1 000–2 500 mots',
            'specific_assets': 'angle décideur, captures et tableaux, CTA lecture/contact',
            'status': 'à_examiner',
        },
        'video_longue_lisa': {
            'format': '15–20 min, 16:9',
            'specific_assets': (
                'script grand public, démonstration visuelle, rythme, voix, '
                'montage et CTA abonnement/épisode'
            ),
            'status': 'à_examiner',
        },
        'short_lisa': {
            'format': '45–75 s, 9:16',
            'specific_assets': (
                'une promesse, 1–2 chiffres, preuve visible, split-screen, '
                'sous-titres et CTA question/suite'
            ),
            'status': 'à_examiner',
        },
    }


def _candidate_from_spec(
    spec: dict,
    *,
    videos_by_id: dict[str, dict],
    all_videos: list[dict],
    observed_at: datetime,
    performance_by_video: dict[str, dict],
    external_subjects: list[ExternalSubject],
    external_available: bool,
) -> dict | None:
    video_ids = set(spec['video_ids'])
    videos = [videos_by_id[video_id] for video_id in video_ids]
    topic = spec['canonical_topic']
    searchable_policy_text = ' '.join(
        [topic, *[video['title'] for video in videos]]
    )
    exclusion = find_excluded_topic(searchable_policy_text)
    if exclusion:
        return None
    representative_titles = [
        video['title']
        for video in sorted(
            videos,
            key=lambda video: (
                parse_datetime(video.get('published'))
                or datetime.min.replace(tzinfo=timezone.utc)
            ),
            reverse=True,
        )[:10]
    ]
    components = {
        'performance_corrigee': performance_component(
            video_ids,
            performance_by_video,
        ),
        'recurrence_persistance': recurrence_component(
            video_ids,
            videos_by_id,
            observed_at,
            performance_by_video,
        ),
        'momentum_entites': momentum_component(
            video_ids if spec['entity_keys'] else set(),
            all_videos,
            observed_at,
            topic if spec['entity_keys'] else None,
        ),
        'corroboration_externe': corroboration_component(
            topic,
            spec['entity_names'],
            representative_titles,
            external_subjects,
            external_available,
        ),
        'fraicheur_reaction': freshness_component(
            spec['primary_sources'],
            videos,
        ),
        'adequation_public': audience_fit_component(
            ' '.join([topic, *spec['entity_names'], *representative_titles])
        ),
        'contribution_originale': contribution_component(
            video_ids,
            videos_by_id,
            spec['primary_sources'],
        ),
    }
    duplicate_count, duplicates = duplicate_title_evidence(
        video_ids,
        videos_by_id,
    )
    penalties = penalty_components(
        duplicate_count=duplicate_count,
        distinct_videos=len(video_ids),
        primary_sources=spec['primary_sources'],
        excluded=exclusion,
        duplicate_evidence=duplicates,
        cited_sources=spec.get('cited_sources', []),
    )
    score, scored_components = score_components(components, penalties)
    key = spec['canonical_key']
    return {
        'id': f'sig_{hashlib.sha256(key.encode("utf-8")).hexdigest()}',
        'canonical_key': key,
        'canonical_topic': topic,
        'status': 'à_examiner',
        'score_total': score,
        'components': scored_components,
        'penalties': penalties,
        'entities': spec['entity_names'],
        'entity_keys': spec['entity_keys'],
        'themes': spec['themes'],
        'primary_sources': spec['primary_sources'],
        'cited_sources': spec.get('cited_sources', []),
        'evidence': {
            'distinct_video_ids': sorted(video_ids),
            'videos': [
                {
                    'video_id': video['video_id'],
                    'title': video['title'],
                    'published_at': video['published'],
                    'view_count': video.get('view_count'),
                    'url': video.get('url'),
                }
                for video in sorted(
                    videos,
                    key=lambda video: video.get('published') or '',
                    reverse=True,
                )
            ],
            'entity_mentions': spec['mention_evidence'],
        },
        'possible_outputs': possible_outputs(),
    }


def build_queue(
    inventory_payload: dict,
    index_payload: dict,
    transcripts_dir: Path,
    external_subjects: list[ExternalSubject] | None = None,
    external_available: bool = False,
) -> dict:
    observed_at = (
        parse_datetime(inventory_payload.get('updated_at'))
        or datetime.now(timezone.utc)
    )
    raw_videos = inventory_payload.get('videos') or []
    channel_videos = [
        video
        for video in raw_videos
        if video.get('channel_id') == VISION_IA_CHANNEL_ID
        and video.get('video_id')
        and video.get('title')
    ]
    excluded_videos = []
    eligible_videos = []
    for video in channel_videos:
        exclusion = find_excluded_topic(video['title'])
        if exclusion:
            excluded_videos.append(
                {
                    'video_id': video['video_id'],
                    'title': video['title'],
                    'reason': exclusion[0],
                    'keyword': exclusion[1],
                }
            )
            print(
                f'EXCLU avant classement — vidéo={video["video_id"]} — '
                f'{exclusion[0]} — mot-clé {exclusion[1]!r} : '
                f'{video["title"]}',
                file=sys.stderr,
            )
        else:
            eligible_videos.append(video)

    # Une entrée dupliquée par identifiant est retirée avant tout calcul.
    videos_by_id = {}
    duplicate_video_ids = []
    for video in eligible_videos:
        video_id = video['video_id']
        if video_id in videos_by_id:
            duplicate_video_ids.append(video_id)
            continue
        videos_by_id[video_id] = video
    eligible_videos = list(videos_by_id.values())

    performance_by_video, cohort_evidence = compute_video_performance(
        eligible_videos,
        observed_at,
    )
    entity_groups = build_entity_groups(index_payload)
    mentions, mention_evidence, scan_stats = scan_entity_mentions(
        eligible_videos,
        transcripts_dir,
        entity_groups,
    )

    specs = []
    assigned_video_ids = set()
    group_by_key = {group.key: group for group in entity_groups}
    for group_key, video_ids in mentions.items():
        if not video_ids:
            continue
        group = group_by_key[group_key]
        assigned_video_ids.update(video_ids)
        specs.append(
            {
                'canonical_key': group.key,
                'canonical_topic': f'Suivi de {group.label}',
                'video_ids': video_ids,
                'entity_names': sorted(set([*group.names, *group.families])),
                'entity_keys': group.item_keys,
                'themes': sorted(set(group.kinds)),
                'primary_sources': group.primary_sources,
                'cited_sources': group.cited_sources,
                'mention_evidence': mention_evidence[group_key],
                'kind': 'entity',
            }
        )
    specs.extend(cluster_unassigned_titles(eligible_videos, assigned_video_ids))

    candidates = []
    excluded_candidates = []
    for spec in specs:
        exclusion = find_excluded_topic(spec['canonical_topic'])
        if exclusion:
            excluded_candidates.append(
                {
                    'canonical_topic': spec['canonical_topic'],
                    'reason': exclusion[0],
                    'keyword': exclusion[1],
                }
            )
            print(
                f'EXCLU avant classement — candidat={spec["canonical_topic"]} '
                f'— {exclusion[0]} — mot-clé {exclusion[1]!r}',
                file=sys.stderr,
            )
            continue
        candidate = _candidate_from_spec(
            spec,
            videos_by_id=videos_by_id,
            all_videos=eligible_videos,
            observed_at=observed_at,
            performance_by_video=performance_by_video,
            external_subjects=external_subjects or [],
            external_available=external_available,
        )
        if candidate:
            candidates.append(candidate)
    candidates.sort(
        key=lambda candidate: (
            -candidate['score_total'],
            candidate['canonical_key'],
        )
    )
    for rank, candidate in enumerate(candidates, 1):
        candidate['rank'] = rank

    return {
        'version': 1,
        # Stable tant que l'instantané d'entrée ne change pas.
        'generated_at': isoformat(observed_at),
        'queue_semantics': (
            'Le score ordonne une file d’examen humain et n’autorise aucune action.'
        ),
        'source_snapshot': {
            'inventory_updated_at': inventory_payload.get('updated_at'),
            'inventory_declared_count': inventory_payload.get('count'),
            'inventory_total_entries': len(raw_videos),
            'vision_ia_channel_id': VISION_IA_CHANNEL_ID,
            'vision_ia_entries': len(channel_videos),
            'eligible_vision_ia_entries': len(eligible_videos),
            'index_created_at': index_payload.get('created_at'),
            'index_items': len(index_payload.get('items') or {}),
            'external_watch_available': external_available,
            'external_subjects': len(external_subjects or []),
        },
        'scoring_method': {
            'weights_percent': SCORE_WEIGHTS,
            'performance': (
                'médiane des percentiles de log(1+vues) dans les cohortes '
                '0–7, 8–30, 31–90, 91–365 et >365 jours'
            ),
            'missing_signal_policy': (
                'un signal non mesurable utilise 0,5 uniquement pour '
                'l’ordonnancement et conserve score=null lorsqu’il est '
                'structurellement inconnu'
            ),
            'penalty_points': {
                'duplicate_titles': 'jusqu’à 10',
                'missing_primary_source': 8,
                'excluded_or_sensitive': (
                    '100, puis retrait avant classement conformément à la politique'
                ),
            },
        },
        'audit': {
            'excluded_before_ranking': [
                *excluded_videos,
                *excluded_candidates,
            ],
            'duplicate_inventory_video_ids': sorted(set(duplicate_video_ids)),
            'performance_cohorts': cohort_evidence,
            'entity_scan': scan_stats,
        },
        'candidates': candidates,
    }


def render_markdown(queue: dict, limit: int | None = None) -> str:
    candidates = queue['candidates']
    displayed = candidates if limit is None else candidates[:limit]
    lines = [
        '# Candidats sujets — file locale',
        '',
        f'Instantané : `{queue["generated_at"]}`  ',
        f'Candidats : **{len(candidates)}**  ',
        (
            'Statut unique : **à_examiner**. Le score ordonne cette file ; '
            'il ne constitue aucune autorisation.'
        ),
        '',
        '## Classement',
        '',
        (
            '| # | Sujet canonique | Total | Perf. | Récurr. | Momentum | '
            'Corrob. | Fraîch. | Public | Contribution | Pénalités |'
        ),
        '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ]
    for candidate in displayed:
        components = candidate['components']
        penalties = sum(
            penalty['points'] for penalty in candidate['penalties'].values()
        )

        def score(name: str) -> str:
            value = components[name]['score']
            return 'n/d' if value is None else f'{100 * value:.1f}'

        lines.append(
            f'| {candidate["rank"]} | {candidate["canonical_topic"]} | '
            f'**{candidate["score_total"]:.1f}** | '
            f'{score("performance_corrigee")} | '
            f'{score("recurrence_persistance")} | '
            f'{score("momentum_entites")} | '
            f'{score("corroboration_externe")} | '
            f'{score("fraicheur_reaction")} | '
            f'{score("adequation_public")} | '
            f'{score("contribution_originale")} | '
            f'-{penalties:.1f} |'
        )
    lines.extend(
        [
            '',
            '## Lecture des preuves',
            '',
            (
                'Le JSON voisin conserve, composante par composante, les IDs '
                'vidéo, dates, vues, cohortes, rangs, mois/trimestres actifs, '
                'taux de mentions, sources externes et pénalités.'
            ),
            '',
            '## Sorties possibles pour chaque dossier',
            '',
            (
                '- Article Journal : 1 000–2 500 mots, angle décideur, '
                'captures/tableaux et sources détaillées.'
            ),
            (
                '- Vidéo longue Lisa : 15–20 min en 16:9, script et '
                'démonstration visuelle propres.'
            ),
            (
                '- Short Lisa : 45–75 s en 9:16, une promesse, une ou deux '
                'preuves et des sous-titres adaptés.'
            ),
            '',
            (
                'Sources, chronologie et fact-checking sont mutualisables ; '
                'angle, texte/script, illustrations et validation restent '
                'propres à chaque sortie.'
            ),
            '',
            '## Limites de mesure',
            '',
            (
                '- Les vues sont un instantané unique : ni CTR, ni rétention, '
                'ni trajectoire J+1/J+7/J+30.'
            ),
            (
                '- La date primaire `announced_at` n’existe pas de façon '
                'fiable localement : la fraîcheur reste `null` dans ce cas.'
            ),
            (
                '- L’index d’entités ne couvre qu’une fraction du corpus ; '
                'les transcriptions automatiques peuvent déformer les noms.'
            ),
            (
                '- La sortie RSS mesure une corroboration médiatique, pas une '
                'demande de recherche ni une source primaire.'
            ),
            '',
        ]
    )
    return '\n'.join(lines)


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f'.{path.name}.',
        suffix='.tmp',
        text=True,
    )
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as temporary:
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--inventory',
        type=Path,
        default=DEFAULT_VEILLE_DIR / 'inventaire-vision-ia.json',
    )
    parser.add_argument(
        '--index',
        type=Path,
        default=DEFAULT_VEILLE_DIR / 'index.json',
    )
    parser.add_argument(
        '--transcripts',
        type=Path,
        default=DEFAULT_VEILLE_DIR / 'transcripts',
    )
    parser.add_argument(
        '--rss',
        type=Path,
        default=DEFAULT_RSS_OUTPUT,
        help='sortie locale Markdown ou JSON de find-subjects.py',
    )
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--markdown', type=Path, default=DEFAULT_MARKDOWN)
    return parser.parse_args(argv)


def load_json_object(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError as error:
        raise ValueError(f'{label} introuvable : {path}') from error
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f'{label} illisible : {path} ({error})') from error
    if not isinstance(value, dict):
        raise ValueError(f'{label} doit être un objet JSON : {path}')
    return value


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        inventory = load_json_object(args.inventory, 'inventaire')
        index_payload = load_json_object(args.index, 'index')
    except ValueError as error:
        print(f'Erreur : {error}', file=sys.stderr)
        return 2
    external_subjects, external_available = load_external_subjects(args.rss)
    queue = build_queue(
        inventory,
        index_payload,
        args.transcripts,
        external_subjects,
        external_available,
    )
    json_content = json.dumps(
        queue,
        ensure_ascii=False,
        indent=2,
        sort_keys=False,
    ) + '\n'
    markdown_content = render_markdown(queue)
    try:
        atomic_write_text(args.output, json_content)
        atomic_write_text(args.markdown, markdown_content)
    except OSError as error:
        print(f'Erreur d’écriture : {error}', file=sys.stderr)
        return 1

    print(render_markdown(queue, limit=10), end='')
    print(f'JSON : {args.output}', file=sys.stderr)
    print(f'Résumé : {args.markdown}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

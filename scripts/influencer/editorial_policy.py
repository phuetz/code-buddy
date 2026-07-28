#!/usr/bin/env python3
"""Politique éditoriale partagée par les chaînes Lisa et Ambre.

Les sujets où Patrice est personnellement partie prenante sont exclus avant
toute sélection, tout classement ou génération. La liste par défaut couvre
notamment France Travail / l'assurance chômage et la CCAS / l'action sociale.
Les clients et partenaires commerciaux supplémentaires doivent être ajoutés
avec ``INFLUENCER_EXCLUDED_TOPICS`` (valeurs séparées par virgules, points-
virgules ou retours à la ligne).
"""

import os
import re
import unicodedata


EXCLUDED_TOPICS: dict[str, tuple[str, ...]] = {
    'France Travail / assurance chômage (situation personnelle de Patrice)': (
        'france travail',
        'pôle emploi',
        'pole emploi',
        'assurance chômage',
        'assurance chomage',
        'chômage',
        'chomage',
        "demandeur d'emploi",
        "demandeurs d'emploi",
        'allocation chômage',
        'allocations chômage',
        'allocation chomage',
        'allocations chomage',
        'indemnisation chômage',
        'indemnisation chomage',
        'cumul ARE',
        'ARE',
        'radiation',
    ),
    'CCAS / action sociale (client de Patrice)': (
        'CCAS',
        "centre communal d'action sociale",
        "centres communaux d'action sociale",
        "caisse d'allocations",
        "caisses d'allocations",
        'action sociale',
        'aide sociale',
    ),
}

EXCLUDED_TOPICS_ENV = 'INFLUENCER_EXCLUDED_TOPICS'


def _normalise(value: str) -> str:
    decomposed = unicodedata.normalize('NFKD', value)
    without_accents = ''.join(
        character for character in decomposed
        if not unicodedata.combining(character)
    )
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', without_accents.lower()).split())


def _configured_topics() -> tuple[str, ...]:
    raw = os.environ.get(EXCLUDED_TOPICS_ENV, '')
    return tuple(
        topic.strip()
        for topic in re.split(r'[,;\n]+', raw)
        if topic.strip()
    )


def get_excluded_topics() -> dict[str, tuple[str, ...]]:
    """Retourne les exclusions par défaut enrichies par la configuration."""
    topics = dict(EXCLUDED_TOPICS)
    configured = _configured_topics()
    if configured:
        topics[
            'client ou partenaire commercial configuré localement'
        ] = configured
    return topics


def find_excluded_topic(text: str) -> tuple[str, str] | None:
    """Retourne ``(raison, mot-clé)`` au premier domaine exclu détecté."""
    normalised_text = f' {_normalise(text)} '
    for reason, keywords in get_excluded_topics().items():
        for keyword in keywords:
            normalised_keyword = _normalise(keyword)
            if normalised_keyword and f' {normalised_keyword} ' in normalised_text:
                return reason, keyword
    return None


def exclusion_policy_for_prompt() -> str:
    """Formate la politique pour une consigne LLM de défense en profondeur."""
    lines = []
    for reason, keywords in get_excluded_topics().items():
        lines.append(f'- {reason} : {", ".join(keywords)}')
    return '\n'.join(lines)

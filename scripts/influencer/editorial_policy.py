#!/usr/bin/env python3
"""Politique éditoriale partagée par les chaînes de la maison.

Un créateur ne traite pas les sujets où il est lui-même partie prenante :
son employeur, ses clients, sa situation administrative. Ce module écarte ces
sujets AVANT toute sélection, tout classement et toute génération — plutôt que
de compter sur une relecture qui, un jour, laissera passer.

**La liste est privée par construction.** Elle n'a pas sa place dans un dépôt
public : la publier reviendrait à documenter ce qu'on cherche justement à ne
pas exposer. Elle se déclare dans l'environnement, via
``INFLUENCER_EXCLUDED_TOPICS`` — un terme par ligne, ou séparés par des
virgules ou des points-virgules. Un thème peut porter un libellé avec
``libellé: terme1, terme2``.

Exemple, dans ~/.codebuddy/media.env ou l'environnement du shell :

    INFLUENCER_EXCLUDED_TOPICS="mon employeur: acme, acme corp; mon client: beta sa"

Sans cette variable, aucun sujet n'est exclu et un avertissement le dit : mieux
vaut une politique visiblement vide qu'une politique silencieusement inopérante.
"""

import os
import sys
from pathlib import Path
import re
import unicodedata


# Aucun sujet exclu par défaut : la liste réelle vit dans l'environnement (voir le
# docstring). Un dépôt public ne doit pas porter la liste des sujets qu'on évite —
# elle dirait exactement ce qu'on cherche à taire.
EXCLUDED_TOPICS: dict[str, tuple[str, ...]] = {}

EXCLUDED_TOPICS_ENV = 'INFLUENCER_EXCLUDED_TOPICS'

_MEDIA_ENV = Path('~/.codebuddy/media.env').expanduser()
_AVERTI = False


def _depuis_media_env() -> str:
    """Replie sur ~/.codebuddy/media.env quand la variable n'est pas exportée.

    Les scripts du pipeline sont lancés de contextes très différents — shell, cron,
    sous-processus d'un agent. Dépendre d'un `export` préalable, c'est accepter qu'un
    jour la politique soit silencieusement vide.
    """
    try:
        for ligne in _MEDIA_ENV.read_text(encoding='utf-8').splitlines():
            if ligne.startswith(f'{EXCLUDED_TOPICS_ENV}='):
                return ligne.split('=', 1)[1].strip().strip('\'"')
    except OSError:
        pass
    return ''


def _prevenir_politique_vide() -> None:
    global _AVERTI
    _AVERTI = True
    print(
        f'AVERTISSEMENT : {EXCLUDED_TOPICS_ENV} n\'est pas définie — aucun sujet n\'est '
        'écarté. Déclare-la dans ~/.codebuddy/media.env ou dans ton shell.',
        file=sys.stderr,
    )


def _normalise(value: str) -> str:
    decomposed = unicodedata.normalize('NFKD', value)
    without_accents = ''.join(
        character for character in decomposed
        if not unicodedata.combining(character)
    )
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', without_accents.lower()).split())


def _configured_topics() -> tuple[str, ...]:
    raw = os.environ.get(EXCLUDED_TOPICS_ENV) or _depuis_media_env()
    return tuple(
        topic.strip()
        for topic in re.split(r'[,;\n]+', raw)
        if topic.strip()
    )


def get_excluded_topics() -> dict[str, tuple[str, ...]]:
    """Les sujets à écarter, lus dans l'environnement.

    Prévient une seule fois quand la politique est vide : sans avertissement, une
    variable oubliée donnerait un filtre qui laisse tout passer en paraissant
    fonctionner — le pire des deux mondes.
    """
    topics = dict(EXCLUDED_TOPICS)
    configured = _configured_topics()
    if configured:
        topics['sujet exclu (configuration locale)'] = configured
    elif not _AVERTI:
        _prevenir_politique_vide()
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

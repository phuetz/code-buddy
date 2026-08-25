#!/usr/bin/env python3
"""Moisson quotidienne de sujets pour Lisa (influenceuse décryptage IA).

RÈGLE ÉDITORIALE — les chaînes Lisa/Ambre ne traitent jamais un sujet où
le créateur est personnellement partie prenante — employeur, clients, situation
administrative. La liste vit dans l'environnement (INFLUENCER_EXCLUDED_TOPICS),
jamais dans ce dépôt public. Les titres concernés sont
écartés et journalisés AVANT le classement. Les exclusions par défaut viennent
de ``EXCLUDED_TOPICS`` et peuvent être complétées avec la variable
``INFLUENCER_EXCLUDED_TOPICS``.

Flux RSS tech français + Google News RSS -> filtre de fraîcheur -> dédup ->
filtre éditorial -> classement par le LLM ($0 via buddy), au format Short
45-60s : HOOK ≤15 mots + PLAN 3 temps + POURQUOI + SOURCE vérifiable.

Usage: python3 find-subjects.py [nb_sujets] [--source nom] [--days N]
Sortie: ~/.codebuddy/influencer-work/sujets-du-jour.md (+ stdout)

C'est l'équivalent opérationnel de PostCommander getTrendingTopics
(services/llm/trending.ts) — même philosophie source-backed : aucun sujet
inventé hors des titres collectés. À terme, brancher directement les configs
autoblog de PostCommander (articleType news-comment) sur cette sortie.
"""

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from email.utils import parsedate_to_datetime
import html
import json
import os
import re
import subprocess
import sys
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from editorial_policy import exclusion_policy_for_prompt, find_excluded_topic


WORK = os.environ.get(
    'INFLUENCER_WORKDIR',
    os.path.expanduser('~/.codebuddy/influencer-work'),
)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DAYS = 7
DEFAULT_RANKING_LIMIT = 55
# Certains médias (notamment Journal du Geek et 01net) refusent les
# User-Agent applicatifs, même sur leur endpoint RSS public.
USER_AGENT = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 '
    'CodeBuddyInfluencer/1.0'
)


@dataclass(frozen=True)
class Feed:
    slug: str
    label: str
    url: str


# Ordre éditorial intentionnel : Korben est la première source française.
FRENCH_TECH_FEEDS = (
    Feed('korben', 'Korben', 'https://korben.info/feed'),
    Feed('numerama', 'Numerama', 'https://www.numerama.com/feed/'),
    Feed('frandroid', 'Frandroid', 'https://www.frandroid.com/feed'),
    Feed('next', 'Next', 'https://next.ink/feed/'),
    Feed(
        'journal-du-geek',
        'Journal du Geek',
        'https://www.journaldugeek.com/feed/',
    ),
    Feed('clubic', 'Clubic', 'https://www.clubic.com/feed/rss'),
    Feed('01net', '01net', 'https://www.01net.com/feed/'),
    Feed('usbek-rica', 'Usbek & Rica', 'https://usbeketrica.com/fr/rss'),
    Feed(
        'zdnet',
        'ZDNet.fr',
        'https://www.zdnet.fr/feeds/rss/actualites/',
    ),
)

GOOGLE_NEWS_FEED = Feed('google-news', 'Google News', '')
SOURCE_ALIASES = {
    'google': 'google-news',
    'jdg': 'journal-du-geek',
    'nextinpact': 'next',
    'next-impact': 'next',
    'next-ink': 'next',
    'usbek': 'usbek-rica',
    'zdnet-fr': 'zdnet',
}

QUERIES = {
    'ia-actu': 'intelligence+artificielle',
    'deepfake': 'deepfake+arnaque',
    'outils-ia': 'ChatGPT+OR+Gemini+OR+Claude+nouveaut%C3%A9',
    'ia-societe': 'IA+emploi+OR+ecole+OR+sant%C3%A9',
}


def configured_french_feeds() -> tuple[Feed, ...]:
    """Retourne les flux par défaut ou leur remplacement configuré en JSON.

    ``INFLUENCER_RSS_FEEDS`` accepte un tableau d'objets avec les champs
    ``slug``, ``label`` et ``url``. L'ordre du tableau est conservé.
    """
    raw = os.environ.get('INFLUENCER_RSS_FEEDS')
    if not raw:
        return FRENCH_TECH_FEEDS
    try:
        values = json.loads(raw)
        if not isinstance(values, list) or not values:
            raise ValueError('un tableau JSON non vide est requis')
        feeds = tuple(
            Feed(
                slug=str(value['slug']).strip(),
                label=str(value['label']).strip(),
                url=str(value['url']).strip(),
            )
            for value in values
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError(f'INFLUENCER_RSS_FEEDS invalide : {error}') from error
    if any(not feed.slug or not feed.label or not feed.url for feed in feeds):
        raise ValueError(
            'INFLUENCER_RSS_FEEDS contient un slug, label ou URL vide'
        )
    if len({feed.slug for feed in feeds}) != len(feeds):
        raise ValueError('INFLUENCER_RSS_FEEDS contient des slugs dupliqués')
    return feeds


def parse_args(
    argv: list[str] | None = None,
    feeds: tuple[Feed, ...] | None = None,
) -> argparse.Namespace:
    feeds = feeds or configured_french_feeds()
    source_names = ['google-news', *(feed.slug for feed in feeds)]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        'count',
        nargs='?',
        type=int,
        default=8,
        help='nombre de sujets proposés (défaut : 8)',
    )
    parser.add_argument(
        '--source',
        help=(
            'source unique ; valeurs : '
            + ', '.join(source_names)
            + ' (alias acceptés : '
            + ', '.join(sorted(SOURCE_ALIASES))
            + ')'
        ),
    )
    parser.add_argument(
        '--days',
        type=int,
        default=DEFAULT_DAYS,
        help=f'fraîcheur maximale en jours (défaut : {DEFAULT_DAYS})',
    )
    args = parser.parse_args(argv)
    if args.count < 1:
        parser.error('nb_sujets doit être supérieur ou égal à 1')
    if args.days < 1:
        parser.error('--days doit être supérieur ou égal à 1')
    if args.source:
        args.source = SOURCE_ALIASES.get(args.source.lower(), args.source.lower())
        if args.source not in source_names:
            parser.error(
                f'--source inconnu {args.source!r} ; '
                f'choisir parmi {", ".join(source_names)}'
            )
    return args


def fetch_xml(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            'Accept': 'application/rss+xml, application/atom+xml, text/xml, */*',
            'User-Agent': USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read()


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        result = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


def child_text(node: ET.Element, local_name: str) -> str:
    for child in node:
        if child.tag.rsplit('}', 1)[-1] == local_name:
            return (child.text or '').strip()
    return ''


def entry_link(node: ET.Element) -> str:
    direct = child_text(node, 'link')
    if direct:
        return direct
    for child in node:
        if child.tag.rsplit('}', 1)[-1] != 'link':
            continue
        href = child.attrib.get('href', '')
        rel = child.attrib.get('rel', 'alternate')
        if href and rel == 'alternate':
            return href
    return ''


def parse_feed(
    xml: bytes,
    feed: Feed,
    cutoff: datetime,
    theme: str = 'tech-fr',
) -> tuple[list[dict], int]:
    """Parse RSS/Atom et retourne ``(entrées fraîches, entrées périmées)``."""
    root = ET.fromstring(xml)
    nodes = [
        node
        for node in root.iter()
        if node.tag.rsplit('}', 1)[-1] in ('item', 'entry')
    ]
    items = []
    stale = 0
    for node in nodes:
        title = html.unescape(child_text(node, 'title')).strip()
        url = html.unescape(entry_link(node)).strip()
        published = parse_date(
            child_text(node, 'pubDate')
            or child_text(node, 'published')
            or child_text(node, 'date')
            or child_text(node, 'updated')
        )
        if not title or not url:
            continue
        if published is not None and published < cutoff:
            stale += 1
            continue
        publisher = html.unescape(child_text(node, 'source')).strip()
        label = feed.label
        if publisher and feed.slug == 'google-news':
            label = f'{feed.label} / {publisher}'
        origin = {'source': feed.slug, 'label': label, 'url': url}
        items.append(
            {
                'theme': theme,
                'title': title[:240],
                'url': url,
                'source': feed.slug,
                'source_label': label,
                'publisher': publisher,
                'published': published,
                'origins': [origin],
            }
        )
    return items, stale


def google_news_url(query: str, days: int) -> str:
    return (
        'https://news.google.com/rss/search'
        f'?q={query}+when:{days}d&hl=fr&gl=FR&ceid=FR:fr'
    )


def collect_items(
    feeds: tuple[Feed, ...],
    source: str | None,
    days: int,
    now: datetime | None = None,
) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    items = []

    selected_feeds = (
        tuple(feed for feed in feeds if feed.slug == source)
        if source and source != 'google-news'
        else (() if source == 'google-news' else feeds)
    )
    for feed in selected_feeds:
        try:
            fresh, stale = parse_feed(fetch_xml(feed.url), feed, cutoff)
            items.extend(fresh)
            print(
                f'{feed.label}: {len(fresh)} frais, {stale} hors fenêtre '
                f'({days} j)',
                file=sys.stderr,
            )
        except Exception as error:
            print(
                f'{feed.label}: RSS KO ({str(error)[:100]})',
                file=sys.stderr,
            )

    if source in (None, 'google-news'):
        for tag, query in QUERIES.items():
            try:
                fresh, stale = parse_feed(
                    fetch_xml(google_news_url(query, days)),
                    GOOGLE_NEWS_FEED,
                    cutoff,
                    theme=tag,
                )
                items.extend(fresh)
                print(
                    f'Google News/{tag}: {len(fresh)} frais, '
                    f'{stale} hors fenêtre ({days} j)',
                    file=sys.stderr,
                )
            except Exception as error:
                print(
                    f'Google News/{tag}: RSS KO ({str(error)[:100]})',
                    file=sys.stderr,
                )
    return items


def normalise_text(value: str) -> str:
    decomposed = unicodedata.normalize('NFKD', html.unescape(value))
    without_accents = ''.join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
    return ' '.join(
        re.sub(r'[^a-z0-9]+', ' ', without_accents.lower()).split()
    )


def canonical_title(item: dict) -> str:
    title = item['title']
    publisher = item.get('publisher', '')
    if publisher:
        title = re.sub(
            rf'\s*[-–—]\s*{re.escape(publisher)}\s*$',
            '',
            title,
            flags=re.IGNORECASE,
        )
    return normalise_text(title)


def canonical_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(html.unescape(value))
    host = parsed.netloc.lower().removeprefix('www.')
    path = re.sub(r'/+$', '', parsed.path) or '/'
    return urllib.parse.urlunsplit((parsed.scheme.lower(), host, path, '', ''))


def titles_are_similar(left: str, right: str) -> bool:
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


def deduplicate(items: list[dict]) -> list[dict]:
    unique = []
    canonical_titles = []
    canonical_urls = []
    for item in items:
        title = canonical_title(item)
        url = canonical_url(item['url'])
        duplicate_index = next(
            (
                index
                for index, (known_title, known_url) in enumerate(
                    zip(canonical_titles, canonical_urls)
                )
                if url == known_url or titles_are_similar(title, known_title)
            ),
            None,
        )
        if duplicate_index is None:
            unique.append(item)
            canonical_titles.append(title)
            canonical_urls.append(url)
            continue
        known_origins = {
            (origin['source'], canonical_url(origin['url']))
            for origin in unique[duplicate_index]['origins']
        }
        for origin in item['origins']:
            origin_key = (origin['source'], canonical_url(origin['url']))
            if origin_key not in known_origins:
                unique[duplicate_index]['origins'].append(origin)
                known_origins.add(origin_key)
    return unique


def apply_editorial_filter(items: list[dict]) -> list[dict]:
    eligible = []
    for item in items:
        exclusion = find_excluded_topic(item['title'])
        if exclusion:
            reason, keyword = exclusion
            print(
                f'EXCLU avant ranking — source={item["source_label"]} — '
                f'{reason} — mot-clé {keyword!r} : {item["title"]}',
                file=sys.stderr,
            )
        else:
            eligible.append(item)
    return eligible


def balanced_candidates(items: list[dict], limit: int) -> list[dict]:
    """Échantillonne en round-robin pour ne pas laisser un flux saturer le LLM."""
    queues: dict[str, list[dict]] = defaultdict(list)
    source_order = []
    for item in items:
        source = item['source']
        if source not in queues:
            source_order.append(source)
        queues[source].append(item)
    candidates = []
    while len(candidates) < limit:
        added = False
        for source in source_order:
            if queues[source]:
                candidates.append(queues[source].pop(0))
                added = True
                if len(candidates) == limit:
                    break
        if not added:
            break
    return candidates


def format_origins(item: dict) -> str:
    return ' ; '.join(
        f'{origin["label"]} — {origin["url"]}'
        for origin in item['origins']
    )


def build_prompt(candidates: list[dict], count: int, days: int) -> tuple[str, dict]:
    indexed = {}
    lines = []
    for index, item in enumerate(candidates, 1):
        candidate_id = f'C{index:03d}'
        indexed[candidate_id] = item
        lines.append(
            f'[{candidate_id}] [{item["theme"]}] {item["title"]}\n'
            f'  PROVENANCE: {format_origins(item)}'
        )
    titles = '\n'.join(lines)
    prompt = f"""Tu es le rédacteur en chef de Lisa, influenceuse IA francophone qui décrypte l'IA \
pour le grand public (format Shorts 45-60s, ton complice). Voici des titres d'actualité \
publiés dans les {days} derniers jours :

{titles}

RÈGLE ÉDITORIALE ABSOLUE : ne sélectionne jamais un sujet où Patrice est
personnellement partie prenante, notamment les domaines ci-dessous. Les titres
ont déjà été filtrés en amont ; cette consigne interdit aussi tout angle qui
réintroduirait ces sujets :
{exclusion_policy_for_prompt()}

Choisis les {count} MEILLEURS sujets pour des Shorts (intérêt grand public, potentiel de \
débat/partage, angle concret, fraîcheur). Chaque sujet doit provenir de la liste. Recopie \
obligatoirement son identifiant [Cxxx] exact. Pour chacun donne EXACTEMENT :

SUJET N [Cxxx]: <titre court>
HOOK: <accroche ≤15 mots>
PLAN: <3 temps séparés par ' / '>
POURQUOI: <1 ligne>

N'ajoute pas de ligne SOURCE : elle sera injectée automatiquement depuis le flux RSS.
Rien d'autre. Aucun sujet hors de la liste."""
    return prompt, indexed


def extract_result(stdout: str) -> str:
    try:
        value = json.loads(stdout)
        if isinstance(value, dict):
            return str(value.get('result', stdout))
    except json.JSONDecodeError:
        pass
    return stdout


def inject_verified_sources(output: str, indexed: dict) -> str:
    """Injecte la provenance locale après chaque SUJET et refuse les IDs inconnus."""
    lines = output.strip().splitlines()
    result = []
    seen_ids = []
    subject_pattern = re.compile(
        r'^(SUJET\s+\d+)\s+\[(C\d{3})\]\s*:\s*(.+)$',
        re.IGNORECASE,
    )
    for line in lines:
        match = subject_pattern.match(line.strip())
        if not match:
            result.append(line)
            continue
        candidate_id = match.group(2).upper()
        if candidate_id not in indexed:
            raise ValueError(f'identifiant LLM inconnu : {candidate_id}')
        if candidate_id in seen_ids:
            raise ValueError(f'identifiant LLM dupliqué : {candidate_id}')
        seen_ids.append(candidate_id)
        result.append(line)
        result.append(f'SOURCE: {format_origins(indexed[candidate_id])}')
    if not seen_ids:
        raise ValueError("le ranking LLM n'a renvoyé aucun identifiant de source")
    return '\n'.join(result).strip() + '\n'


def rank_candidates(candidates: list[dict], count: int, days: int) -> str:
    prompt, indexed = build_prompt(candidates, count, days)
    result = subprocess.run(
        [
            'node',
            os.path.join(REPO, 'dist/index.js'),
            '--permission-mode',
            'dontAsk',
            '-p',
            prompt,
        ],
        capture_output=True,
        text=True,
        timeout=240,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(
            f'ranking LLM en échec ({result.returncode}) : '
            f'{result.stderr.strip()[-500:]}'
        )
    output = inject_verified_sources(extract_result(result.stdout), indexed)
    final_exclusion = find_excluded_topic(output)
    if final_exclusion:
        reason, keyword = final_exclusion
        raise RuntimeError(
            f'contrôle éditorial final en échec : {reason}, mot-clé {keyword!r}'
        )
    print(
        f'Contrôle final exclusions: OK ; '
        f'{len(re.findall(r"^SOURCE:", output, re.MULTILINE))} sources vérifiées',
        file=sys.stderr,
    )
    return output


def main(argv: list[str] | None = None) -> int:
    try:
        feeds = configured_french_feeds()
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    args = parse_args(argv, feeds)
    items = collect_items(feeds, args.source, args.days)
    unique = deduplicate(items)
    eligible = apply_editorial_filter(unique)
    excluded_count = len(unique) - len(eligible)
    print(
        f'{len(items)} titres frais, {len(items) - len(unique)} doublons, '
        f'{excluded_count} exclus, {len(eligible)} éligibles au ranking',
        file=sys.stderr,
    )
    if not eligible:
        print('Aucun sujet éligible trouvé.', file=sys.stderr)
        return 1

    ranking_limit = int(
        os.environ.get('INFLUENCER_RANKING_LIMIT', DEFAULT_RANKING_LIMIT)
    )
    candidates = balanced_candidates(eligible, ranking_limit)
    try:
        output = rank_candidates(candidates, min(args.count, len(candidates)), args.days)
    except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError) as error:
        print(f'Erreur: {error}', file=sys.stderr)
        return 1

    os.makedirs(WORK, exist_ok=True)
    destination = os.path.join(WORK, 'sujets-du-jour.md')
    with open(destination, 'w', encoding='utf-8') as output_file:
        output_file.write(output)
    print(output, end='')
    print(f'\n-> {destination}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

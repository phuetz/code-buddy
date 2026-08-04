#!/usr/bin/env python3
"""Pilote de consommation des quotas média — finir chaque période à zéro.

Flow, ElevenLabs et HeyGen se rechargent à date fixe et **ne reportent rien** :
tout crédit non consommé à la veille du reset est perdu. Un quota à 92 % inutilisé
la veille du renouvellement n'est pas une économie, c'est un abonnement payé pour
rien.

Ce script ne consomme rien. Il mesure les trois soldes, compte les jours qui
restent avant chaque reset, et dit combien il faut dépenser **par jour** pour
arriver à zéro pile — puis traduit ce rythme en unités concrètes (plans de huit
secondes, minutes de narration, minutes d'avatar).

Rythme volontairement calculé sur `jours - 1` : viser le dernier jour ne laisse
aucune marge à une panne, or on vient d'en voir une (file d'attente Flow).

Usage :
    quota-plan.py [--json] [--env-file ~/.codebuddy/media.env]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_ENV = Path('~/.codebuddy/media.env').expanduser()
FLOW_JOURNAL = Path('~/.codebuddy/media-video/flow-daily-journal.jsonl').expanduser()

# Coûts unitaires mesurés, pour traduire un budget en production réelle.
FLOW_CREDITS_PER_PLAN = 15          # mode Agent, constaté dans flow-daily.py
ELEVEN_CHARS_PER_MINUTE = 900       # ~150 mots/min à ~6 caractères par mot
HEYGEN_CREDITS_PER_MINUTE = 20      # 1 500 crédits ≈ 75 min d'avatar


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        os.environ.setdefault(key.strip(), value.strip().strip('"\''))


def curl_json(url: str, header: str) -> dict | None:
    try:
        out = subprocess.run(['curl', '-s', '--max-time', '20', '-H', header, url],
                             capture_output=True, text=True, timeout=30)
        return json.loads(out.stdout)
    except Exception:
        return None


def days_until(day_of_month: int, today: dt.date) -> tuple[int, dt.date]:
    """Jours restants avant le prochain passage à `day_of_month`."""
    year, month = today.year, today.month
    try:
        target = dt.date(year, month, day_of_month)
    except ValueError:                       # jour absent d'un mois court
        target = dt.date(year, month, 28)
    if target <= today:
        month += 1
        if month > 12:
            month, year = 1, year + 1
        try:
            target = dt.date(year, month, day_of_month)
        except ValueError:
            target = dt.date(year, month, 28)
    return (target - today).days, target


def flow_balance() -> int | None:
    """Dernier solde connu, lu dans le journal du driver (aucun appel réseau)."""
    if not FLOW_JOURNAL.exists():
        return None
    last = None
    for line in FLOW_JOURNAL.read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        # `creditsRemaining` est le solde APRÈS la passe et fait foi ; `creditsStart`
        # n'est qu'un repli pour une passe en cours. Une ligne de fin porte les deux :
        # lire d'abord le repli écraserait la bonne valeur par l'ancienne.
        if isinstance(row.get('creditsRemaining'), int):
            last = row['creditsRemaining']
        elif isinstance(row.get('creditsStart'), int):
            last = row['creditsStart']
    return last


def eleven_balance() -> tuple[int, dt.date] | None:
    key = os.environ.get('ELEVENLABS_API_KEY')
    if not key:
        return None
    data = curl_json('https://api.elevenlabs.io/v1/user/subscription', f'xi-api-key: {key}')
    if not data or 'character_limit' not in data:
        return None
    remaining = int(data['character_limit']) - int(data.get('character_count', 0))
    stamp = data.get('next_character_count_reset_unix')
    reset = dt.datetime.fromtimestamp(stamp).date() if stamp else None
    return remaining, reset


def heygen_balance() -> int | None:
    """Crédits du PLAN. Le portefeuille API (`wallet`) est distinct et vaut 0 :
    la production passe par l'application web, pas par l'API."""
    key = os.environ.get('HEYGEN_API_KEY')
    if not key:
        return None
    data = curl_json('https://api.heygen.com/v2/user/remaining_quota', f'X-Api-Key: {key}')
    try:
        return int(data['data']['details']['plan_credit'])
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--env-file', type=Path, default=DEFAULT_ENV)
    ap.add_argument('--json', action='store_true', help='sortie machine')
    ap.add_argument('--today', help='date de simulation AAAA-MM-JJ (tests)')
    args = ap.parse_args()

    load_env(args.env_file)
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    rows: list[dict] = []

    flow = flow_balance()
    if flow is not None:
        days, target = days_until(28, today)
        usable = max(1, days - 1)
        rows.append({
            'service': 'Flow (Google AI Ultra)', 'remaining': flow, 'unit': 'crédits',
            'reset': target.isoformat(), 'daysLeft': days,
            'perDay': flow // usable,
            'detail': f'{flow // usable // FLOW_CREDITS_PER_PLAN} plans de 8 s par jour',
            'channel': 'application web via Brave CDP',
        })

    eleven = eleven_balance()
    if eleven:
        remaining, reset = eleven
        days = (reset - today).days if reset else 30
        usable = max(1, days - 1)
        per_day = remaining // usable
        rows.append({
            'service': 'ElevenLabs Pro', 'remaining': remaining, 'unit': 'caractères',
            'reset': reset.isoformat() if reset else '?', 'daysLeft': days,
            'perDay': per_day,
            'detail': f'≈ {per_day // ELEVEN_CHARS_PER_MINUTE} min de narration par jour',
            'channel': 'API',
        })

    heygen = heygen_balance()
    if heygen is not None:
        days, target = days_until(26, today)
        usable = max(1, days - 1)
        per_day = heygen // usable
        rows.append({
            'service': 'HeyGen (plan)', 'remaining': heygen, 'unit': 'crédits',
            'reset': target.isoformat(), 'daysLeft': days,
            'perDay': per_day,
            'detail': f'≈ {per_day // HEYGEN_CREDITS_PER_MINUTE} min d’avatar par jour',
            'channel': 'application web via Brave CDP (l’API est à sec)',
        })

    if args.json:
        print(json.dumps({'date': today.isoformat(), 'quotas': rows},
                         ensure_ascii=False, indent=2))
        return 0

    if not rows:
        print('Aucun quota mesurable (clés absentes ?).')
        return 1

    print(f'Quotas média au {today.isoformat()} — rien n’est reportable d’une période à l’autre.\n')
    width = max(len(r['service']) for r in rows)
    for r in rows:
        print(f'  {r["service"]:<{width}}  {r["remaining"]:>9,} {r["unit"]}'.replace(',', ' '))
        print(f'  {"":<{width}}  reset {r["reset"]} — {r["daysLeft"]} jour(s)')
        print(f'  {"":<{width}}  → {r["perDay"]:,} {r["unit"]}/jour pour finir à zéro'.replace(',', ' '))
        print(f'  {"":<{width}}    soit {r["detail"]}')
        print(f'  {"":<{width}}    voie : {r["channel"]}')
        print()
    print('Le rythme vise zéro un jour AVANT le reset : viser le dernier jour ne')
    print('laisse aucune marge si une passe échoue.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

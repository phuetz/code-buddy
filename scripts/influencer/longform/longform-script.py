#!/usr/bin/env python3
"""Génère et valide le plan éditorial d'une vidéo longue Lisa.

RÈGLE ÉDITORIALE — aucun sujet où Patrice est personnellement partie prenante :
France Travail / assurance chômage, CCAS, clients ou partenaires commerciaux.
Le sujet est contrôlé avant l'appel LLM et la règle est répétée dans le prompt.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

INFLUENCER_DIR = Path(__file__).resolve().parent.parent
if str(INFLUENCER_DIR) not in sys.path:
    sys.path.insert(0, str(INFLUENCER_DIR))

from editorial_policy import (  # noqa: E402
    exclusion_policy_for_prompt,
    find_excluded_topic,
)


MODEL = 'gemini-3.6-flash-high'
PHASES = (
    'hook',
    'cta_abo',
    'contexte',
    'decryptage',
    'demos',
    'nuance',
    'outro',
)
AVATAR_PHASES = {'hook', 'cta_abo', 'nuance', 'outro'}
DEMO_PROMISE_RE = re.compile(
    r'\b(d[ée]mo(?:s|nstration)?|exemples?|tests?|cas concret|'
    r'crash[- ]?test)\b',
    re.IGNORECASE,
)


class PlanValidationError(ValueError):
    """Le plan ne respecte pas le contrat éditorial long format."""


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(content)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def extract_json(raw: str) -> dict[str, Any]:
    """Extrait un objet JSON, même entouré de prose ou d'un bloc Markdown."""
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{', raw):
        try:
            value, _ = decoder.raw_decode(raw[match.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError('la réponse du LLM ne contient aucun objet JSON valide')


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\wÀ-ÖØ-öø-ÿ'’-]+\b", text, re.UNICODE))


def validate_plan(
    plan: dict[str, Any],
    target_minutes: float | None = None,
) -> dict[str, Any]:
    """Valide les contraintes du gabarit et retourne le plan inchangé."""
    errors: list[str] = []
    sections = plan.get('sections')
    if not isinstance(sections, list) or not sections:
        raise PlanValidationError('sections doit être une liste non vide')

    ids: set[str] = set()
    seen_phases: list[str] = []
    total_duration = 0.0
    voiceover_duration = 0.0
    total_words = 0
    avatar_phases: list[str] = []

    for index, section in enumerate(sections):
        label = f'sections[{index}]'
        if not isinstance(section, dict):
            errors.append(f'{label}: objet attendu')
            continue

        section_id = section.get('id')
        if not isinstance(section_id, str) or not re.fullmatch(
                r'[a-z0-9][a-z0-9_-]*', section_id):
            errors.append(f'{label}.id: identifiant kebab/snake ASCII requis')
        elif section_id in ids:
            errors.append(f'{label}.id: doublon {section_id!r}')
        else:
            ids.add(section_id)

        phase = section.get('phase')
        if phase not in PHASES:
            errors.append(f'{label}.phase: valeur invalide {phase!r}')
        elif not seen_phases or seen_phases[-1] != phase:
            seen_phases.append(phase)

        mode = section.get('mode')
        if mode not in {'avatar', 'voiceover'}:
            errors.append(f'{label}.mode: avatar ou voiceover attendu')
        if mode == 'avatar':
            if phase not in AVATAR_PHASES:
                errors.append(
                    f'{label}: avatar interdit dans la phase {phase!r}')
            elif isinstance(phase, str):
                avatar_phases.append(phase)

        duration = section.get('duree_cible_s')
        if not isinstance(duration, (int, float)) or isinstance(duration, bool):
            errors.append(f'{label}.duree_cible_s: nombre positif attendu')
            duration = 0.0
        elif duration <= 0:
            errors.append(f'{label}.duree_cible_s: doit être positif')
            duration = 0.0
        else:
            duration = float(duration)
            if mode == 'avatar' and not 15 <= duration <= 45:
                errors.append(
                    f'{label}: une section avatar doit durer 15 à 45 s')
        total_duration += duration
        if mode == 'voiceover':
            voiceover_duration += duration

        text = section.get('texte')
        if not isinstance(text, str) or not text.strip():
            errors.append(f'{label}.texte: texte français parlé requis')
        else:
            total_words += word_count(text)

        visuals = section.get('visuels')
        if not isinstance(visuals, list) or not visuals:
            errors.append(f'{label}.visuels: liste non vide requise')
        else:
            for visual_index, visual in enumerate(visuals):
                if not isinstance(visual, dict):
                    errors.append(
                        f'{label}.visuels[{visual_index}]: objet attendu')
                    continue
                if not isinstance(visual.get('description'), str):
                    errors.append(
                        f'{label}.visuels[{visual_index}].description requise')
                broll_id = visual.get('broll_id')
                if broll_id is not None and not isinstance(broll_id, str):
                    errors.append(
                        f'{label}.visuels[{visual_index}].broll_id: '
                        'chaîne ou null attendu')

    if seen_phases != list(PHASES):
        errors.append(
            'les sept phases doivent apparaître une fois dans cet ordre '
            f'(phases observées: {seen_phases})')

    for required_avatar_phase in ('hook', 'nuance', 'outro'):
        if required_avatar_phase not in avatar_phases:
            errors.append(
                f'la phase {required_avatar_phase!r} doit contenir '
                'une section avatar')
    if not 3 <= len(avatar_phases) <= 4:
        errors.append(
            f'3 à 4 sections avatar attendues, {len(avatar_phases)} trouvées')

    if total_duration <= 0:
        errors.append('durée totale nulle')
    else:
        voiceover_ratio = voiceover_duration / total_duration
        if voiceover_ratio < 0.70:
            errors.append(
                f'voix off insuffisante: {voiceover_ratio:.1%}, minimum 70 %')

        words_per_minute = total_words / (total_duration / 60)
        if not 110 <= words_per_minute <= 150:
            errors.append(
                f'débit global hors tolérance autour de 130 mots/min: '
                f'{words_per_minute:.1f}')

    if target_minutes is not None:
        target_seconds = target_minutes * 60
        if not target_seconds * 0.95 <= total_duration <= target_seconds * 1.05:
            errors.append(
                f'durée planifiée {total_duration:.1f}s hors tolérance ±5 % '
                f'autour de {target_seconds:.1f}s')

    hook_text = ' '.join(
        str(section.get('texte', ''))
        for section in sections
        if isinstance(section, dict) and section.get('phase') == 'hook'
    )
    if not DEMO_PROMISE_RE.search(hook_text):
        errors.append(
            'le hook doit promettre explicitement des démos/tests/exemples')

    demo_sections = [
        section for section in sections
        if isinstance(section, dict) and section.get('phase') == 'demos'
    ]
    if not demo_sections:
        errors.append('la phase demos promise dans le hook est absente')

    if errors:
        raise PlanValidationError('\n- ' + '\n- '.join(errors))
    return plan


def build_prompt(subject: str, duration_minutes: float) -> str:
    target_words = round(duration_minutes * 130)
    return f"""
Tu es la directrice éditoriale de Lisa, créatrice francophone experte en IA.
Produis UNIQUEMENT un objet JSON valide, sans Markdown ni commentaire.

Sujet : {subject}
Durée totale cible : {duration_minutes:g} minutes
Volume cible : environ {target_words} mots à 130 mots/minute.

Le JSON doit avoir cette forme exacte :
{{
  "sujet": "...",
  "titre": "...",
  "duree_cible_min": {duration_minutes:g},
  "sections": [
    {{
      "id": "01-hook-avatar",
      "phase": "hook",
      "mode": "avatar",
      "texte": "texte français parlé...",
      "duree_cible_s": 35,
      "visuels": [
        {{"description": "description exploitable", "broll_id": "b12"}}
      ]
    }}
  ]
}}

Contraintes impératives :
- Règle éditoriale absolue : ne traite jamais un sujet où Patrice est
  personnellement partie prenante et ne l'introduis ni comme exemple, ni comme
  comparaison, ni comme démonstration. Domaines exclus :
{exclusion_policy_for_prompt()}
- Couvrir exactement ces 7 phases, dans cet ordre, avec une ou plusieurs
  sections consécutives par phase : hook, cta_abo, contexte, decryptage,
  demos, nuance, outro.
- Style oral français de Lisa : complice, opinion assumée mais nuancée,
  experte accessible, phrases courtes à moyennes, aucun jargon non expliqué.
- Le hook contient une affirmation choc, un fait/preuve, une marque
  d'honnêteté et promet explicitement les démos/tests concrets de la phase
  demos pour créer une boucle de rétention.
- Avatar seulement pour hook, nuance, outro et éventuellement cta_abo.
  Chaque section avatar dure entre 15 et 45 secondes.
- Au moins 70 % de la durée totale est en mode voiceover. Vise 72 à 75 %.
- Débit global proche de 130 mots/minute et durée totale à ±5 % de la cible.
- Les visuels changent toutes les 6 à 12 secondes. Donne plusieurs visuels
  précis par section et un broll_id suggéré quand pertinent, sinon null.
- La phase demos apporte plusieurs preuves concrètes et tient la promesse
  exacte formulée dans le hook.
- Les ids sont uniques, ASCII, préfixés dans l'ordre (01-, 02-, etc.).
""".strip()


def call_llm(prompt: str) -> str:
    try:
        result = subprocess.run(
            ['agy', '--model', MODEL, '-p', prompt],
            check=True,
            capture_output=True,
            text=True,
            timeout=360,
        )
    except FileNotFoundError as exc:
        raise RuntimeError('commande agy introuvable') from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError('agy a dépassé le délai de 6 minutes') from exc
    except subprocess.CalledProcessError as exc:
        details = (exc.stderr or exc.stdout or '').strip()
        raise RuntimeError(f'échec agy: {details}') from exc
    return result.stdout


def render_script_md(plan: dict[str, Any]) -> str:
    phase_labels = {
        'hook': 'Hook & promesse',
        'cta_abo': "CTA d'abonnement",
        'contexte': 'Contexte & histoire',
        'decryptage': 'Décryptage',
        'demos': 'Démos & preuves',
        'nuance': 'Nuance & avis',
        'outro': 'Conclusion & CTA',
    }
    lines = [
        f'# {plan.get("titre") or plan.get("sujet") or "Vidéo longue Lisa"}',
        '',
        f'**Sujet :** {plan.get("sujet", "")}',
        '',
    ]
    elapsed = 0.0
    current_phase: str | None = None
    for section in plan['sections']:
        phase = section['phase']
        if phase != current_phase:
            lines.extend([f'## {phase_labels[phase]}', ''])
            current_phase = phase
        minutes, seconds = divmod(round(elapsed), 60)
        duration = float(section['duree_cible_s'])
        lines.extend([
            f'### {minutes:02d}:{seconds:02d} — {section["id"]} '
            f'({section["mode"]}, {duration:g} s)',
            '',
            section['texte'].strip(),
            '',
            '**Visuels :**',
            '',
        ])
        for visual in section['visuels']:
            suffix = (
                f' (`{visual["broll_id"]}`)'
                if visual.get('broll_id') else '')
            lines.append(f'- {visual["description"]}{suffix}')
        lines.append('')
        elapsed += duration

    total_minutes, total_seconds = divmod(round(elapsed), 60)
    lines.extend([
        '---',
        '',
        f'Durée planifiée : {total_minutes:02d}:{total_seconds:02d}.',
        '',
    ])
    return '\n'.join(lines)


def parse_duration(value: str) -> float:
    try:
        duration = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError('nombre de minutes attendu') from exc
    if not 10 <= duration <= 15:
        raise argparse.ArgumentTypeError(
            'la durée longue Lisa doit être comprise entre 10 et 15 minutes')
    return duration


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Génère le plan JSON en 7 phases d’une vidéo longue Lisa.')
    parser.add_argument('--sujet', required=True, help='sujet de la vidéo')
    parser.add_argument(
        '--duree', type=parse_duration, default=12.0, metavar='MIN',
        help='durée cible en minutes, entre 10 et 15 (défaut: 12)')
    parser.add_argument('--out', required=True, help='workdir de production')
    args = parser.parse_args()

    exclusion = find_excluded_topic(args.sujet)
    if exclusion:
        reason, keyword = exclusion
        sys.exit(
            f'sujet refusé avant appel LLM — {reason} '
            f'(mot-clé détecté : {keyword!r})'
        )

    workdir = Path(args.out).expanduser().resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    plan_path = workdir / 'plan.json'
    script_path = workdir / 'script.md'

    if plan_path.exists():
        print(f'SKIP plan existant: {plan_path}')
        try:
            plan = json.loads(plan_path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as exc:
            sys.exit(f'plan existant illisible (non écrasé): {exc}')
    else:
        print(f'Génération via agy / {MODEL}…')
        try:
            plan = extract_json(call_llm(build_prompt(args.sujet, args.duree)))
            validate_plan(plan, args.duree)
        except (RuntimeError, ValueError, PlanValidationError) as exc:
            sys.exit(f'plan refusé, aucun asset écrit: {exc}')
        atomic_write_text(
            plan_path,
            json.dumps(plan, ensure_ascii=False, indent=2) + '\n',
        )
        print(f'OK {plan_path}')

    validation_target = plan.get('duree_cible_min', args.duree)
    if not isinstance(validation_target, (int, float)):
        validation_target = args.duree
    try:
        validate_plan(plan, float(validation_target))
    except PlanValidationError as exc:
        sys.exit(f'plan invalide (non écrasé): {exc}')

    if script_path.exists():
        print(f'SKIP script existant: {script_path}')
    else:
        atomic_write_text(script_path, render_script_md(plan))
        print(f'OK {script_path}')


if __name__ == '__main__':
    main()

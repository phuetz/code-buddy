#!/usr/bin/env python3
"""Fabrique et catalogue un habillage de lieu réutilisable pour Lisa.

RÈGLE ÉDITORIALE NON NÉGOCIABLE
================================
Le décor est un HABILLAGE, jamais une prétention de présence ou de témoignage.
« Lisa décrypte le salon de Paris » est autorisé. « En direct de Paris »,
« Lisa était sur place » ou « elle a rencontré » sont refusés avant tout appel
de génération. Chaque description rappelle que Lisa est une créatrice
virtuelle.

La génération d'image passe exclusivement par ``codex exec`` et l'outil image
intégré à l'abonnement (mode ``identity-preserve``). Les clés OpenAI/xAI sont
retirées de l'environnement du sous-processus. Le script n'appelle donc jamais
les API image facturées. Deux ou trois variantes sont mesurées avec ArcFace et
``visual-gate.py --gate`` ; une variante sous 0,75 peut être régénérée une seule
fois avant abandon.

Exemple :

    python3 scripts/influencer/lisa-decor-a-la-demande.py \
      --lieu "Paris, salon technologique" \
      --tenue "blazer velours sapin" \
      --moment "matin" \
      --titre "Lisa décrypte le salon de Paris" \
      --description "Les annonces à retenir. Lisa est une créatrice virtuelle."

Pour rejouer le contrôle sur des sorties intégrées déjà générées :

    ... --variante-existante image-v1.png \
        --variante-existante image-v2.png \
        --variante-existante image-v3.png --sans-heygen

HeyGen utilise les opérations média non facturées pour créer la talking photo,
puis l'interface Avatar Shots reliée aux crédits mensuels pour l'animation. Le
script vérifie qu'aucun portefeuille facturé à l'usage n'est actif, mesure les
crédits du plan avant/après et applique un plafond strict. Une talking photo
est indexée par le SHA-256 exact de l'image : un décor validé n'est uploadé
qu'une fois et son identifiant est ensuite réutilisé.
"""

from __future__ import annotations

import argparse
import base64
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from typing import Any, Callable, Sequence


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REFERENCE = (
    Path.home()
    / '.codebuddy/personas/lisa/identity-kit/lisa-hotel-2.png'
)
DEFAULT_OUTPUT_ROOT = (
    Path.home()
    / '.codebuddy/personas/lisa/decors-a-la-demande'
)
DEFAULT_TALKING_PHOTOS = (
    Path.home() / '.codebuddy/personas/lisa/talking-photos.json'
)
DEFAULT_CATALOGUE = SCRIPT_DIR / 'decors-catalogue.json'
DEFAULT_VISUAL_GATE = SCRIPT_DIR / 'visual-gate.py'
DEFAULT_JOURNAL = DEFAULT_OUTPUT_ROOT / 'journal.jsonl'
DEFAULT_MEDIA_ENV = Path.home() / '.codebuddy/media.env'
DEFAULT_TEST_AUDIO = (
    Path.home()
    / '.codebuddy/personas/lisa/talking-photos-work/test-google-resume-25s.mp3'
)
DEFAULT_ARCFACE_TARGET = 0.75
DEFAULT_VARIANTS = 3
MAX_GENERATION_ATTEMPTS = 2
VIRTUAL_DISCLOSURE = 'Lisa est une créatrice virtuelle.'
IMAGE_SUFFIXES = ('.png', '.jpg', '.jpeg', '.webp')
HEYGEN_PROJECT_ITEMS_URL = (
    'https://api2.heygen.com/v1/project/items'
    '?limit=20'
    '&item_types=heygen_video'
    '&item_types=asset'
    '&asset_source_types=avatar_shots'
    '&sort_key=created_ts'
    '&sort_order=desc'
    '&is_trash=false'
)
SENSITIVE_IMAGE_API_ENV = frozenset({
    'OPENAI_API_KEY',
    'XAI_API_KEY',
    'CODEBUDDY_IMAGE_API_KEY',
    'CODEBUDDY_IMAGE_BASE_URL',
    'CODEBUDDY_IMAGE_MODEL',
    'CODEBUDDY_IMAGE_PROVIDER',
    'OPENAI_IMAGE_MODEL',
    'XAI_IMAGE_MODEL',
})

# Comparaison après retrait des accents et de la ponctuation. Les expressions
# couvrent aussi les équivalents évidents de témoignage direct, pas seulement
# les cinq exemples fournis dans la mission.
FORBIDDEN_EDITORIAL_PATTERNS: tuple[tuple[str, str], ...] = (
    (r'\ben direct\b', '« en direct »'),
    (r'\ben live\b', '« en live »'),
    (r'\bsur place\b', '« sur place »'),
    (r'\bj etais\b', '« j’étais »'),
    (r'\bj ai ete\b', '« j’ai été »'),
    (r'\bnous etions\b', '« nous étions »'),
    (r'\bnous avons ete\b', '« nous avons été »'),
    (r'\blisa etait\b', '« Lisa était »'),
    (r'\blisa s est rendue\b', '« Lisa s’est rendue »'),
    (r'\belle etait\b', '« elle était »'),
    (r'\belle a rencontre\b', '« elle a rencontré »'),
    (r'\bj ai rencontre\b', '« j’ai rencontré »'),
    (r'\bnous avons rencontre\b', '« nous avons rencontré »'),
    (r'\bj ai vu\b', '« j’ai vu »'),
    (r'\bnous avons vu\b', '« nous avons vu »'),
    (r'\bj ai constate\b', '« j’ai constaté »'),
    (r'\bnous avons constate\b', '« nous avons constaté »'),
    (r'\bje suis ici\b', '« je suis ici »'),
    (r'\bnous sommes ici\b', '« nous sommes ici »'),
    (r'\bdepuis (?:le |la |les |l )?(?:salon|conference|congres)\b',
     'formulation « depuis le salon »'),
)


class DecorError(RuntimeError):
    """Erreur attendue et exploitable par un appelant."""


@dataclass(frozen=True)
class EditorialCopy:
    title: str
    description: str


@dataclass
class Candidate:
    variant: int
    attempt: int
    path: str
    sha256: str
    gate_exit_code: int
    gate_verdict: str
    arcface: float | None
    accepted: bool
    rejection_reason: str | None
    image_cost_usd: float = 0.0


@dataclass(frozen=True)
class TalkingPhoto:
    talking_photo_id: str
    avatar_group_id: str | None
    source: str
    asset_id: str | None = None
    credits_used: float = 0.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalized_text(value: str) -> str:
    decomposed = unicodedata.normalize('NFKD', value)
    without_accents = ''.join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
    return ' '.join(
        re.sub(r'[^a-z0-9]+', ' ', without_accents.lower()).split()
    )


def slugify(value: str) -> str:
    slug = normalized_text(value).replace(' ', '-')
    return slug[:96].strip('-') or 'decor'


def validate_editorial_copy(
    title: str | None,
    description: str | None,
    lieu: str,
) -> EditorialCopy:
    safe_title = (title or f'Lisa décrypte {lieu}').strip()
    safe_description = (description or 'Les faits et annonces à retenir.').strip()
    for field_name, value in (
        ('titre', safe_title),
        ('description', safe_description),
    ):
        normalized = normalized_text(value)
        for pattern, label in FORBIDDEN_EDITORIAL_PATTERNS:
            if re.search(pattern, normalized):
                raise DecorError(
                    f'{field_name} refusé par la règle « jamais de faux vécu » : '
                    f'{label}. Le décor doit rester un habillage éditorial.'
                )
    if normalized_text(VIRTUAL_DISCLOSURE) not in normalized_text(safe_description):
        safe_description = f'{safe_description.rstrip()} {VIRTUAL_DISCLOSURE}'
    return EditorialCopy(safe_title, safe_description)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError) as error:
        raise DecorError(f'JSON illisible : {path} ({error})') from error


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f'.{path.name}.',
        suffix='.tmp',
        dir=path.parent,
    )
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def append_jsonl(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + '\n')


def display_path(path: Path) -> str:
    try:
        relative = path.expanduser().resolve().relative_to(Path.home())
        return f'~/{relative}'
    except ValueError:
        return str(path)


def build_prompt(
    lieu: str,
    tenue: str,
    moment: str,
    variant: int,
    attempt: int,
) -> str:
    compositions = (
        (
            'plan taille, Lisa centrée face caméra, tête droite, visage grand '
            'et parfaitement net, épaules dégagées'
        ),
        (
            'plan poitrine légèrement serré, Lisa face caméra, visage dominant '
            'dans le cadre, arrière-plan profond'
        ),
        (
            'plan mi-cuisse, Lisa très légèrement décentrée, regard droit vers '
            'l’objectif, mains hors cadre'
        ),
    )
    composition = compositions[(variant - 1) % len(compositions)]
    retry_note = (
        'Seconde tentative : renforcer encore la fidélité exacte du visage de '
        'référence et conserver ses proportions sans embellissement.'
        if attempt > 1
        else ''
    )
    return f"""Use case: identity-preserve
Asset type: photographie verticale 9:16 pour talking photo éditoriale HeyGen
Primary request: placer exactement la même femme que sur l'image de référence dans ce contexte : {lieu}. Elle porte {tenue}. Moment : {moment}.
Input images: l'image jointe est la référence d'identité canonique de Lisa ; préserver avec une fidélité maximale son visage, ses traits, sa carnation, ses yeux, sa ligne de cheveux et sa chevelure.
Scene/backdrop: décor crédible et immédiatement évocateur de {lieu}, avec profondeur de champ ; public secondaire très flou ; aucune marque ni enseigne lisible.
Style/medium: photographie de presse éditoriale photoréaliste naturelle, texture de peau réaliste, sans stylisation beauté excessive.
Composition/framing: vertical 9:16, {composition}, anatomie adaptée à une animation de parole.
Lighting/mood: lumière cohérente avec « {moment} », professionnelle, douce et uniforme sur le visage.
Constraints: identité strictement conservée ; une seule personne principale ; vêtements anatomiquement cohérents ; aucun texte lisible, logo, badge, filigrane, micro, oreillette ou matériel de duplex ; ne pas modifier l'âge ni les proportions du visage ; ce décor virtuel est un habillage éditorial et ne constitue jamais une preuve de présence réelle.
Avoid: reportage en direct, témoignage de terrain, bouche ouverte, visage de profil, mains devant le visage.
{retry_note}""".strip()


def scrub_image_api_environment() -> dict[str, str]:
    environment = dict(os.environ)
    for name in SENSITIVE_IMAGE_API_ENV:
        environment.pop(name, None)
    environment['CODEX_IMAGE_GENERATION_POLICY'] = 'builtin-subscription-only'
    return environment


def generate_with_integrated_image_tool(
    prompt: str,
    reference: Path,
    destination: Path,
    *,
    timeout: int = 900,
) -> None:
    """Demande une image au Codex connecté, sans aucune clé image d'API."""
    executable = shutil.which('codex')
    if executable is None:
        raise DecorError(
            'codex est introuvable : la génération intégrée sans clé ne peut '
            'pas être lancée'
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f'.{destination.stem}-',
        dir=destination.parent,
    ) as temporary:
        working_directory = Path(temporary)
        instruction = (
            'Utilise obligatoirement la compétence imagegen et son outil '
            'intégré, jamais un script CLI, jamais OPENAI_API_KEY, jamais xAI, '
            'jamais une API image directe. Génère exactement une image '
            'identity-preserve à partir de la référence jointe. Copie ensuite '
            f'le PNG final vers {destination.name!r} dans le dossier de '
            'travail, sans modifier la référence. Brief exact :\n\n'
            f'{prompt}'
        )
        command = [
            executable,
            'exec',
            '--ephemeral',
            '--sandbox',
            'workspace-write',
            '--color',
            'never',
            '-C',
            str(working_directory),
            '-i',
            str(reference),
            instruction,
        ]
        result = subprocess.run(
            command,
            cwd=working_directory,
            env=scrub_image_api_environment(),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
        )
        if result.returncode != 0:
            raise DecorError(
                'échec de la génération GPT Image intégrée '
                f'(code {result.returncode}) :\n{result.stdout[-2000:]}'
            )
        generated = working_directory / destination.name
        if not generated.exists():
            candidates = sorted(
                (
                    path
                    for path in working_directory.iterdir()
                    if (
                        path.is_file()
                        and path.suffix.lower() in IMAGE_SUFFIXES
                    )
                ),
                key=lambda path: path.stat().st_mtime_ns,
                reverse=True,
            )
            if not candidates:
                raise DecorError(
                    'la génération intégrée a terminé sans déposer de fichier '
                    'image dans son dossier candidat isolé'
                )
            generated = candidates[0]
        shutil.copy2(generated, destination)


def gate_sidecar(path: Path) -> Path:
    return path.with_suffix(path.suffix + '.qc.json')


def evaluate_candidate(
    path: Path,
    *,
    variant: int,
    attempt: int,
    visual_gate: Path,
    visual_gate_python: str,
    reference: Path,
    target: float,
    gate_journal: Path,
) -> Candidate:
    command = [
        visual_gate_python,
        str(visual_gate),
        str(path),
        '--persona',
        'lisa',
        '--reference',
        str(reference),
        '--gate',
        '--journal',
        str(gate_journal),
    ]
    result = subprocess.run(
        command,
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    sidecar = gate_sidecar(path)
    report = read_json(sidecar, {}) if sidecar.exists() else {}
    deterministic = report.get('deterministic', {})
    raw_arcface = deterministic.get('identity_arcface')
    arcface = (
        float(raw_arcface)
        if isinstance(raw_arcface, (int, float))
        else None
    )
    verdict = str(report.get('verdict') or 'ERREUR')
    reason: str | None = None
    if result.returncode != 0:
        reason = (
            f'visual-gate --gate a retourné {result.returncode}: '
            f'{result.stdout[-800:].strip()}'
        )
    elif arcface is None:
        reason = 'score ArcFace absent'
    elif arcface < target:
        reason = f'ArcFace {arcface:.3f} sous le seuil {target:.2f}'
    accepted = reason is None
    return Candidate(
        variant=variant,
        attempt=attempt,
        path=str(path),
        sha256=sha256_file(path),
        gate_exit_code=result.returncode,
        gate_verdict=verdict,
        arcface=arcface,
        accepted=accepted,
        rejection_reason=reason,
    )


def choose_best(candidates: Sequence[Candidate]) -> Candidate:
    accepted = [
        candidate
        for candidate in candidates
        if candidate.accepted and candidate.arcface is not None
    ]
    if not accepted:
        reasons = '; '.join(
            candidate.rejection_reason or 'rejet non précisé'
            for candidate in candidates
        )
        raise DecorError(f'aucune variante admissible : {reasons}')
    return max(accepted, key=lambda candidate: float(candidate.arcface))


def recursive_dicts(value: Any) -> list[dict[str, Any]]:
    dictionaries: list[dict[str, Any]] = []
    if isinstance(value, dict):
        dictionaries.append(value)
        for nested in value.values():
            dictionaries.extend(recursive_dicts(nested))
    elif isinstance(value, list):
        for nested in value:
            dictionaries.extend(recursive_dicts(nested))
    return dictionaries


def find_talking_photo(
    registry_path: Path,
    image_sha256: str,
) -> TalkingPhoto | None:
    """Accepte le schéma 1.0 prévu et reste compatible avec un registre voisin."""
    registry = read_json(registry_path, {}) if registry_path.exists() else {}
    for item in recursive_dicts(registry):
        digest = str(
            item.get('image_sha256')
            or item.get('prepared_sha256')
            or item.get('source_sha256')
            or item.get('sha256')
            or ''
        )
        if digest != image_sha256:
            continue
        identifier = str(
            item.get('talking_photo_id')
            or item.get('avatar_look_id')
            or item.get('look_id')
            or ''
        ).strip()
        if not identifier:
            continue
        group = (
            item.get('avatar_group_id')
            or item.get('group_id')
            or None
        )
        asset_id = item.get('asset_id')
        return TalkingPhoto(
            identifier,
            str(group) if group else None,
            'registry',
            str(asset_id) if asset_id else None,
        )
    return None


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError as error:
        raise DecorError(f'configuration illisible : {path} ({error})') from error
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


class HeyGenSubscriptionClient:
    """Client v3 borné aux crédits mensuels, sans portefeuille à l'usage."""

    BASE_URL = 'https://api.heygen.com'

    def __init__(
        self,
        media_env: Path,
        *,
        credit_cap: float,
        timeout: int,
    ) -> None:
        try:
            self.requests = importlib.import_module('requests')
        except ImportError as error:
            raise DecorError(
                'le backend HeyGen v3 requiert le paquet Python requests'
            ) from error
        self.api_key = load_env_file(media_env).get('HEYGEN_API_KEY', '')
        if not self.api_key:
            raise DecorError(f'HEYGEN_API_KEY absent de {media_env}')
        if credit_cap <= 0:
            raise DecorError('--plafond-credits doit être strictement positif')
        self.credit_cap = float(credit_cap)
        self.timeout = timeout
        self.baseline = self.credit_snapshot()
        self.assert_subscription_only(self.baseline)

    def headers(
        self,
        *,
        json_content: bool = False,
        idempotency_key: str | None = None,
    ) -> dict[str, str]:
        result = {'x-api-key': self.api_key}
        if json_content:
            result['Content-Type'] = 'application/json'
        if idempotency_key:
            result['Idempotency-Key'] = idempotency_key
        return result

    def request_json(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        response = self.requests.request(
            method,
            f'{self.BASE_URL}{path}',
            timeout=self.timeout,
            **kwargs,
        )
        try:
            payload = response.json()
        except ValueError:
            payload = {'raw': response.text[:1200]}
        if not response.ok:
            raise DecorError(
                f'HeyGen {method} {path} -> HTTP {response.status_code}: '
                f'{json.dumps(payload, ensure_ascii=False)}'
            )
        if not isinstance(payload, dict):
            raise DecorError(f'réponse HeyGen invalide pour {method} {path}')
        return payload

    def credit_snapshot(self) -> dict[str, Any]:
        legacy = self.request_json(
            'GET',
            '/v2/user/remaining_quota',
            headers=self.headers(),
        )
        current = self.request_json(
            'GET',
            '/v3/users/me',
            headers=self.headers(),
        )
        legacy_data = legacy.get('data') or {}
        details = legacy_data.get('details') or {}
        current_data = current.get('data') or {}
        raw_credit = details.get('plan_credit')
        if not isinstance(raw_credit, (int, float)):
            raise DecorError(
                'HeyGen ne retourne pas le solde plan_credit ; arrêt fermé'
            )
        return {
            'plan_credit': float(raw_credit),
            'wallet_remaining': (
                (current_data.get('wallet') or {}).get('remaining_balance')
            ),
            'usage_based': current_data.get('usage_based'),
        }

    @staticmethod
    def assert_subscription_only(snapshot: dict[str, Any]) -> None:
        wallet = snapshot.get('wallet_remaining')
        usage_based = snapshot.get('usage_based')
        if wallet not in (None, 0, 0.0) or usage_based not in (None, False):
            raise DecorError(
                'HeyGen paraît configuré en paiement à l’usage ; le script '
                'refuse conformément à « aucune API payante »'
            )

    def spent(self, snapshot: dict[str, Any] | None = None) -> float:
        current = snapshot or self.credit_snapshot()
        return max(
            0.0,
            float(self.baseline['plan_credit'])
            - float(current['plan_credit']),
        )

    def reserve(self, operation: str, credits: float) -> dict[str, Any]:
        snapshot = self.credit_snapshot()
        self.assert_subscription_only(snapshot)
        spent = self.spent(snapshot)
        if spent + credits > self.credit_cap:
            raise DecorError(
                f'garde-fou HeyGen : {spent:.2f} déjà consommé(s) + '
                f'{credits:.2f} réservé(s) > plafond {self.credit_cap:.2f} '
                f'pour {operation}'
            )
        if float(snapshot['plan_credit']) < credits:
            raise DecorError(
                f'solde HeyGen insuffisant pour réserver {credits:.2f} crédits'
            )
        return snapshot

    @staticmethod
    def stable_key(prefix: str, value: str) -> str:
        digest = hashlib.sha256(value.encode('utf-8')).hexdigest()[:24]
        return f'lisa-decor-{prefix}-{digest}'

    def upload_asset(self, path: Path) -> tuple[str, str | None]:
        before = self.reserve(f'upload_asset:{path.name}', 0.0)
        mime = (
            'audio/mpeg'
            if path.suffix.lower() == '.mp3'
            else 'image/png'
        )
        with path.open('rb') as handle:
            response = self.request_json(
                'POST',
                '/v3/assets',
                headers=self.headers(
                    idempotency_key=self.stable_key(
                        'asset',
                        sha256_file(path),
                    ),
                ),
                files={'file': (path.name, handle, mime)},
            )
        data = response.get('data') or {}
        asset_id = data.get('asset_id')
        if not isinstance(asset_id, str) or not asset_id:
            raise DecorError('HeyGen n’a pas renvoyé asset_id')
        after = self.credit_snapshot()
        if self.spent(after) > self.credit_cap:
            raise DecorError('plafond HeyGen dépassé après upload')
        # L'upload est normalement nul ; le delta reste vérifié par spent().
        _ = before
        return asset_id, data.get('url')

    def create_talking_photo(
        self,
        image_path: Path,
        name: str,
        avatar_group_id: str | None,
    ) -> TalkingPhoto:
        before = self.reserve(f'create_photo_avatar:{name}', 1.0)
        asset_id, _asset_url = self.upload_asset(image_path)
        body: dict[str, Any] = {
            'type': 'photo',
            'name': name[:100],
            'file': {'type': 'asset_id', 'asset_id': asset_id},
        }
        if avatar_group_id:
            body['avatar_group_id'] = avatar_group_id
        response = self.request_json(
            'POST',
            '/v3/avatars',
            headers=self.headers(
                json_content=True,
                idempotency_key=self.stable_key(
                    'avatar',
                    sha256_file(image_path),
                ),
            ),
            json=body,
        )
        data = response.get('data') or {}
        avatar_item = data.get('avatar_item') or {}
        avatar_group = data.get('avatar_group') or {}
        identifier = avatar_item.get('id')
        group_id = avatar_group.get('id') or avatar_group_id
        if not isinstance(identifier, str) or not identifier:
            raise DecorError('HeyGen n’a pas renvoyé avatar_item.id')
        after = self.credit_snapshot()
        self.assert_subscription_only(after)
        credits = max(
            0.0,
            float(before['plan_credit']) - float(after['plan_credit']),
        )
        if self.spent(after) > self.credit_cap:
            raise DecorError('plafond HeyGen dépassé après création de l’avatar')
        return TalkingPhoto(
            identifier,
            str(group_id) if group_id else None,
            'heygen-v3-subscription',
            asset_id,
            credits,
        )

    def wait_talking_photo(
        self,
        talking_photo: TalkingPhoto,
        *,
        timeout: int,
    ) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            response = self.request_json(
                'GET',
                f'/v3/avatars/looks/{talking_photo.talking_photo_id}',
                headers=self.headers(),
            )
            data = response.get('data') or {}
            status = data.get('status')
            if status == 'completed':
                return
            if status in ('failed', 'error'):
                raise DecorError(
                    f'création talking photo HeyGen échouée : {data.get("error")}'
                )
            time.sleep(5)
        raise DecorError(
            'talking photo HeyGen non prête avant le délai maximal'
        )

def registry_avatar_group(registry_path: Path) -> str | None:
    if not registry_path.exists():
        return None
    registry = read_json(registry_path, {})
    group = registry.get('avatar_group_id') if isinstance(registry, dict) else None
    return str(group) if group else None


def create_fifteen_second_audio(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise DecorError(f'audio de test en cache introuvable : {source}')
    ffmpeg = shutil.which('ffmpeg')
    if ffmpeg is None:
        raise DecorError('ffmpeg est requis pour borner le test à 15 secondes')
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            ffmpeg,
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            str(source),
            '-t',
            '15',
            '-c:a',
            'libmp3lame',
            '-b:a',
            '192k',
            str(destination),
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if result.returncode != 0:
        raise DecorError(f'échec du découpage audio : {result.stdout[-800:]}')


def import_heygen_batch() -> Any:
    path = SCRIPT_DIR / 'heygen-batch.py'
    specification = importlib.util.spec_from_file_location(
        'lisa_decor_heygen_batch',
        path,
    )
    if specification is None or specification.loader is None:
        raise DecorError(f'impossible de charger {path}')
    sys.path.insert(0, str(SCRIPT_DIR))
    try:
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        return module
    except (ImportError, OSError) as error:
        raise DecorError(f'helper HeyGen UI indisponible : {error}') from error
    finally:
        try:
            sys.path.remove(str(SCRIPT_DIR))
        except ValueError:
            pass


def extract_video_id(value: Any) -> str | None:
    for item in recursive_dicts(value):
        identifier = item.get('video_id')
        if isinstance(identifier, str) and identifier:
            return identifier
    return None


def cdp_await_json(client: Any, expression: str) -> Any:
    response = client.cmd(
        'Runtime.evaluate',
        {
            'expression': expression,
            'returnByValue': True,
            'awaitPromise': True,
        },
        to=30,
    )
    result = (response or {}).get('result') or {}
    remote = result.get('result') or {}
    raw = remote.get('value')
    if not isinstance(raw, str):
        exception = result.get('exceptionDetails')
        raise DecorError(
            'HeyGen UI n’a pas renvoyé les projets'
            + (f' : {exception}' if exception else '')
        )
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise DecorError('réponse projets HeyGen UI illisible') from error


def heygen_project_items(client: Any) -> list[dict[str, Any]]:
    expression = f"""(async()=>{{
      const response = await fetch(
        {json.dumps(HEYGEN_PROJECT_ITEMS_URL)},
        {{credentials: 'include'}}
      );
      const payload = await response.json();
      return JSON.stringify({{status: response.status, payload}});
    }})()"""
    result = cdp_await_json(client, expression)
    if result.get('status') != 200:
        raise DecorError(
            f'lecture projets HeyGen UI -> HTTP {result.get("status")}'
        )
    payload = result.get('payload') or {}
    data = payload.get('data') or {}
    items = data.get('items') or []
    return [item for item in items if isinstance(item, dict)]


def project_item_audio_url(item: dict[str, Any]) -> str:
    metadata = item.get('metadata') or {}
    avatar = metadata.get('avatar_iv_meta') or {}
    speech = avatar.get('extra_speech_meta') or {}
    audio = speech.get('audio_data') or {}
    url = audio.get('url')
    return str(url) if url else ''


def matching_project_video(
    items: Sequence[dict[str, Any]],
    *,
    audio_path: Path,
    excluded_ids: set[str] | None = None,
    video_id: str | None = None,
) -> dict[str, Any] | None:
    excluded = excluded_ids or set()
    audio_key = normalized_text(audio_path.stem)
    for item in items:
        identifier = item.get('video_id') or item.get('item_id')
        if not isinstance(identifier, str) or not identifier:
            continue
        if identifier in excluded or item.get('item_type') != 'heygen_video':
            continue
        if video_id is not None:
            if identifier == video_id:
                return item
            continue
        duration = item.get('duration')
        if (
            not isinstance(duration, (int, float))
            or not 12 <= float(duration) <= 16
        ):
            continue
        audio_url = normalized_text(project_item_audio_url(item))
        if audio_key and audio_key in audio_url:
            return item
    return None


def project_video_url(item: dict[str, Any]) -> str | None:
    variants = item.get('variants') or []
    for preferred in ('1080p', 'original', '720p'):
        for variant in variants:
            if (
                isinstance(variant, dict)
                and variant.get('name') == preferred
                and isinstance(variant.get('key'), str)
            ):
                return str(variant['key'])
    for key in ('video_download_url', 'video_url'):
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def select_talking_photo_in_heygen_ui(
    client: Any,
    talking_photo: TalkingPhoto,
) -> None:
    if not talking_photo.avatar_group_id:
        raise DecorError(
            'avatar_group_id requis pour sélectionner le décor dans HeyGen UI'
        )
    expression = f"""(()=>{{
      const key = 'pacific/GLOBAL_AVATAR_STATE';
      const state = JSON.parse(localStorage.getItem(key) || '{{}}');
      const entries = Object.values(state);
      if (!entries.length) return false;
      for (const item of entries) {{
        item.lastSelectedAvatarGroupId = {json.dumps(talking_photo.avatar_group_id)};
        item.lastSelectedPrivateAvatarGroupId = {json.dumps(talking_photo.avatar_group_id)};
        item.lastSelectedAvatarLookId = {json.dumps(talking_photo.talking_photo_id)};
        item.lastSelectedPrivateAvatarLookId = {json.dumps(talking_photo.talking_photo_id)};
      }}
      localStorage.setItem(key, JSON.stringify(state));
      return true;
    }})()"""
    if not client.ev(expression):
        raise DecorError(
            'état global HeyGen absent ; ouvrir Avatar Shots une première fois'
        )
    client.cmd(
        'Page.navigate',
        {'url': 'https://app.heygen.com/avatar/avatar-shots'},
    )
    time.sleep(10)
    raw = client.ev(
        "localStorage.getItem('pacific/GLOBAL_AVATAR_STATE')"
    ) or '{}'
    if (
        talking_photo.talking_photo_id not in raw
        or talking_photo.avatar_group_id not in raw
    ):
        raise DecorError(
            'HeyGen n’a pas conservé la sélection du décor exact ; '
            'animation refusée'
        )


def poll_ui_video(
    subscription: HeyGenSubscriptionClient,
    browser_client: Any,
    video_id: str,
    output_path: Path,
    *,
    timeout: int,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        item = matching_project_video(
            heygen_project_items(browser_client),
            audio_path=output_path.with_suffix('.mp3'),
            video_id=video_id,
        )
        if item is None:
            time.sleep(10)
            continue
        status = item.get('status')
        if status == 'completed':
            video_url = project_video_url(item)
            if not video_url:
                raise DecorError('vidéo HeyGen terminée sans URL')
            media = subscription.requests.get(
                video_url,
                timeout=subscription.timeout,
            )
            media.raise_for_status()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(media.content)
            return
        if status == 'failed':
            error = item.get('error_message') or item.get('reason')
            raise DecorError(f'vidéo HeyGen échouée : {error}')
        time.sleep(10)
    raise DecorError(f'vidéo HeyGen {video_id} non terminée à temps')


def generate_video_via_subscription_ui(
    subscription: HeyGenSubscriptionClient,
    talking_photo: TalkingPhoto,
    audio_path: Path,
    output_path: Path,
    *,
    title: str,
    timeout: int,
    resume_video_id: str | None = None,
    resume_credits: float = 0.0,
) -> dict[str, Any]:
    # Le backend API vidéo est volontairement exclu : le portefeuille API est
    # à zéro. L'interface Avatar Shots consomme uniquement le plan mensuel.
    reservation = 0.0 if resume_video_id else min(
        15.0,
        subscription.credit_cap,
    )
    before = subscription.reserve(f'generate_video_ui:{title}', reservation)
    cdp = import_cdp_module()
    tab = cdp.get_tab(match=('heygen',))
    if not tab:
        raise DecorError(
            'aucun onglet HeyGen connecté sur le port CDP 9222'
        )
    client = cdp.CDP(tab)
    client.cmd('Runtime.enable')
    client.cmd('Page.enable')
    if resume_video_id:
        video_id = resume_video_id
    else:
        install_heygen_response_capture(client)
        select_talking_photo_in_heygen_ui(client, talking_photo)
        existing_ids = {
            str(item.get('video_id') or item.get('item_id'))
            for item in heygen_project_items(client)
            if item.get('item_type') == 'heygen_video'
        }
        helper = import_heygen_batch()
        try:
            submitted = helper.submit(str(audio_path), slugify(title)[-48:])
        except SystemExit as error:
            raise DecorError(
                f'soumission HeyGen UI interrompue : {error}'
            ) from error
        if not submitted:
            raise DecorError('HeyGen UI n’a pas confirmé la génération')

        video_id = None
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline and video_id is None:
            video_id = extract_video_id(captured_heygen_payloads(client))
            if video_id is None:
                match = matching_project_video(
                    heygen_project_items(client),
                    audio_path=audio_path,
                    excluded_ids=existing_ids,
                )
                if match:
                    video_id = str(
                        match.get('video_id') or match.get('item_id')
                    )
            if video_id is None:
                time.sleep(2)
        if video_id is None:
            raise DecorError(
                'génération lancée mais video_id non retrouvé parmi les '
                'nouveaux projets Avatar Shots'
            )
    poll_ui_video(
        subscription,
        client,
        video_id,
        output_path,
        timeout=timeout,
    )
    after = subscription.credit_snapshot()
    subscription.assert_subscription_only(after)
    measured_credits = max(
        0.0,
        float(before['plan_credit']) - float(after['plan_credit']),
    )
    credits = resume_credits if resume_video_id else measured_credits
    if subscription.spent(after) > subscription.credit_cap:
        raise DecorError('plafond HeyGen dépassé après la vidéo UI')
    return {
        'video_id': video_id,
        'video_path': str(output_path),
        'video_sha256': sha256_file(output_path),
        'credits_used': credits,
        'plan_credit_before': before['plan_credit'],
        'plan_credit_after': after['plan_credit'],
        'backend': (
            'avatar-shots-plan-resume'
            if resume_video_id
            else 'avatar-shots-plan'
        ),
    }


def provision_heygen(
    args: argparse.Namespace,
    *,
    registry_path: Path,
    decor_key: str,
    image_path: Path,
    arcface: float,
    existing: TalkingPhoto | None,
) -> tuple[TalkingPhoto | None, dict[str, Any] | None, float]:
    talking_photo = existing
    if args.talking_photo_id:
        talking_photo = TalkingPhoto(
            args.talking_photo_id.strip(),
            args.avatar_group_id.strip() if args.avatar_group_id else None,
            'cli',
        )
    if args.sans_heygen:
        return talking_photo, None, 0.0

    client: HeyGenSubscriptionClient | None = None
    if args.heygen_backend == 'subscription-ui':
        client = HeyGenSubscriptionClient(
            args.media_env.expanduser(),
            credit_cap=args.plafond_credits,
            timeout=args.heygen_timeout,
        )
    if talking_photo is None:
        if client is not None:
            talking_photo = client.create_talking_photo(
                image_path,
                decor_key,
                registry_avatar_group(registry_path),
            )
            client.wait_talking_photo(
                talking_photo,
                timeout=args.heygen_timeout,
            )
        else:
            talking_photo = create_talking_photo_via_cdp(
                image_path,
                decor_key,
                timeout=args.heygen_timeout,
            )
    register_talking_photo(
        registry_path,
        decor_key=decor_key,
        image_path=image_path,
        talking_photo=talking_photo,
        arcface=arcface,
    )

    animation: dict[str, Any] | None = None
    if args.animer_15s:
        if client is None:
            raise DecorError(
                '--animer-15s requiert --heygen-backend subscription-ui'
            )
        audio_path = image_path.parent / f'{decor_key}-test-15s.mp3'
        create_fifteen_second_audio(
            args.audio_test.expanduser().resolve(),
            audio_path,
        )
        animation = generate_video_via_subscription_ui(
            client,
            talking_photo,
            audio_path,
            image_path.parent / f'{decor_key}-test-15s.mp4',
            title=f'{decor_key}-test-15s',
            timeout=args.attente_video,
            resume_video_id=args.reprendre_video_id,
            resume_credits=args.credits_video_repris,
        )
    credits = talking_photo.credits_used
    if animation:
        credits += float(animation['credits_used'])
    return talking_photo, animation, credits


def import_cdp_module() -> Any:
    sys.path.insert(0, str(SCRIPT_DIR))
    try:
        return importlib.import_module('cdp-lib')
    except (ImportError, OSError) as error:
        raise DecorError(f'bridge CDP HeyGen indisponible : {error}') from error
    finally:
        try:
            sys.path.remove(str(SCRIPT_DIR))
        except ValueError:
            pass


def cdp_click_matching(cdp_client: Any, pattern: str) -> bool:
    expression = f"""(()=>{{
      const regex = new RegExp({json.dumps(pattern)}, 'i');
      const elements = [...document.querySelectorAll(
        'button,[role=button],a,label,div[tabindex],span'
      )];
      const candidate = elements.find(element => {{
        const text = (element.innerText || element.getAttribute('aria-label') || '').trim();
        const rect = element.getBoundingClientRect();
        return regex.test(text) && rect.width > 4 && rect.height > 4 &&
          rect.bottom > 0 && rect.top < innerHeight;
      }});
      if (!candidate) return false;
      candidate.click();
      return true;
    }})()"""
    return bool(cdp_client.ev(expression))


def install_heygen_response_capture(cdp_client: Any) -> None:
    """Capture les réponses upload/submit sans lire ni exporter les cookies."""
    script = r"""(()=>{
      if (window.__lisaDecorCaptureInstalled) return;
      window.__lisaDecorCaptureInstalled = true;
      window.__lisaDecorResponses = [];
      const push = (url, body) => {
        if (/photar\.upload|avatar\/shortcut\/submit/i.test(url || '')) {
          window.__lisaDecorResponses.push({url, body, at: Date.now()});
        }
      };
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__lisaDecorUrl = String(url || '');
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', () => push(
          this.__lisaDecorUrl,
          this.responseText
        ));
        return originalSend.apply(this, arguments);
      };
      const originalFetch = window.fetch;
      window.fetch = async function() {
        const response = await originalFetch.apply(this, arguments);
        const url = String(arguments[0]?.url || arguments[0] || '');
        if (/photar\.upload|avatar\/shortcut\/submit/i.test(url)) {
          response.clone().text().then(body => push(url, body)).catch(() => {});
        }
        return response;
      };
    }})()"""
    cdp_client.cmd(
        'Page.addScriptToEvaluateOnNewDocument',
        {'source': script},
    )
    cdp_client.ev(script)


def captured_heygen_payloads(cdp_client: Any) -> list[dict[str, Any]]:
    raw = cdp_client.ev(
        'JSON.stringify(window.__lisaDecorResponses || [])'
    ) or '[]'
    try:
        captures = json.loads(raw)
    except json.JSONDecodeError:
        return []
    results: list[dict[str, Any]] = []
    for capture in captures:
        body = capture.get('body')
        try:
            payload = json.loads(body) if isinstance(body, str) else body
        except json.JSONDecodeError:
            payload = {'raw': body}
        results.append({'url': capture.get('url'), 'payload': payload})
    return results


def extract_talking_photo_from_payload(value: Any) -> TalkingPhoto | None:
    for item in recursive_dicts(value):
        identifier = str(
            item.get('look_id')
            or item.get('talking_photo_id')
            or item.get('avatar_look_id')
            or ''
        ).strip()
        if not identifier:
            continue
        group = item.get('group_id') or item.get('avatar_group_id') or None
        return TalkingPhoto(
            identifier,
            str(group) if group else None,
            'heygen-cdp',
        )
    return None


def create_talking_photo_via_cdp(
    image_path: Path,
    name: str,
    *,
    timeout: int = 180,
) -> TalkingPhoto:
    """Upload UI HeyGen : pas de clé, pas de login automatique, pas de vidéo."""
    cdp = import_cdp_module()
    tab = cdp.get_tab(match=('heygen',))
    if not tab:
        raise DecorError(
            'aucun onglet HeyGen connecté sur le port CDP 9222 ; ouvrir Brave '
            'et se connecter manuellement'
        )
    client = cdp.CDP(tab)
    client.cmd('Runtime.enable')
    client.cmd('Page.enable')
    client.cmd('DOM.enable')
    install_heygen_response_capture(client)
    client.cmd('Page.navigate', {'url': 'https://app.heygen.com/avatars'})
    time.sleep(8)
    client.ev('window.scrollTo(0, 0)')

    # L'interface a employé ces trois libellés dans ses variantes 2025–2026.
    for pattern in (
        r'create (?:new )?avatar|new avatar|créer un avatar',
        r'upload (?:a )?photo|photo avatar|importer une photo',
    ):
        if cdp_click_matching(client, pattern):
            time.sleep(2)

    document = client.cmd('DOM.getDocument', {'depth': -1})
    root = document['result']['root']['nodeId']
    query = client.cmd(
        'DOM.querySelectorAll',
        {
            'nodeId': root,
            'selector': 'input[type=file][accept*="image"],input[type=file]',
        },
    )
    nodes = query['result']['nodeIds']
    if not nodes:
        raise DecorError(
            'champ image HeyGen introuvable ; aucune talking photo créée'
        )
    client.cmd(
        'DOM.setFileInputFiles',
        {'files': [str(image_path.resolve())], 'nodeId': nodes[-1]},
    )
    time.sleep(3)
    # Certains déploiements uploadent immédiatement ; d'autres demandent une
    # confirmation. Ne cliquer que les libellés explicitement liés à l'upload.
    cdp_click_matching(
        client,
        r'create photo avatar|upload photo|importer|créer|continue|continuer',
    )

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        talking_photo = extract_talking_photo_from_payload(
            captured_heygen_payloads(client)
        )
        if talking_photo is not None:
            return talking_photo
        time.sleep(2)
    raise DecorError(
        f'HeyGen n’a pas renvoyé d’identifiant pour {name} après {timeout}s'
    )


def register_talking_photo(
    registry_path: Path,
    *,
    decor_key: str,
    image_path: Path,
    talking_photo: TalkingPhoto,
    arcface: float,
) -> None:
    registry = (
        read_json(registry_path, {})
        if registry_path.exists()
        else {
            'schema_version': '1.0',
            'updated_at': utc_now(),
            'items': [],
        }
    )
    collection_name = (
        'talking_photos'
        if isinstance(registry.get('talking_photos'), list)
        else 'items'
    )
    items = registry.setdefault(collection_name, [])
    if not isinstance(items, list):
        raise DecorError(
            f'le registre {registry_path} ne possède pas un tableau items'
        )
    digest = sha256_file(image_path)
    new_item = {
        'decor_key': decor_key,
        'image_path': display_path(image_path),
        'image_sha256': digest,
        'arcface': round(arcface, 6),
        'talking_photo_id': talking_photo.talking_photo_id,
        'avatar_id': talking_photo.talking_photo_id,
        'avatar_group_id': talking_photo.avatar_group_id,
        'status': 'completed',
        'avatar_type': 'photo_avatar',
        'created_at': utc_now(),
        'source': talking_photo.source,
    }
    if talking_photo.asset_id:
        new_item['asset_id'] = talking_photo.asset_id
    for index, item in enumerate(items):
        if (
            isinstance(item, dict)
            and (
                item.get('image_sha256') == digest
                or item.get('decor_key') == decor_key
            )
        ):
            new_item['created_at'] = item.get('created_at') or utc_now()
            items[index] = {**item, **new_item}
            break
    else:
        items.append(new_item)
    registry['updated_at'] = utc_now()
    write_json_atomic(registry_path, registry)


def update_catalogue_asset(
    catalogue_path: Path,
    *,
    decor_key: str,
    lieu: str,
    tenue: str,
    moment: str,
    editorial: EditorialCopy,
    selected_path: Path,
    selected_sha256: str,
    arcface: float,
    talking_photo: TalkingPhoto | None,
    animation: dict[str, Any] | None = None,
) -> None:
    catalogue = read_json(catalogue_path, {})
    if not isinstance(catalogue, dict):
        raise DecorError(f'catalogue invalide : {catalogue_path}')
    assets = catalogue.setdefault('assets', [])
    if not isinstance(assets, list):
        raise DecorError('le champ assets du catalogue doit être un tableau')
    asset = {
        'decor_key': decor_key,
        'lieu': lieu,
        'tenue': tenue,
        'moment': moment,
        'title': editorial.title,
        'description': editorial.description,
        'image_path': display_path(selected_path),
        'image_sha256': selected_sha256,
        'arcface': round(arcface, 6),
        'visual_gate': 'passed',
        'talking_photo_id': (
            talking_photo.talking_photo_id if talking_photo else None
        ),
        'avatar_group_id': (
            talking_photo.avatar_group_id if talking_photo else None
        ),
        'status': (
            'ready_animated'
            if animation
            else 'ready'
            if talking_photo
            else 'image_validated_talking_photo_pending'
        ),
        'updated_at': utc_now(),
    }
    if animation:
        asset.update({
            'last_animation_video_id': animation.get('video_id'),
            'last_animation_path': animation.get('video_path'),
            'last_animation_credits': animation.get('credits_used'),
        })
    for index, existing in enumerate(assets):
        if isinstance(existing, dict) and existing.get('decor_key') == decor_key:
            assets[index] = {**existing, **asset}
            break
    else:
        assets.append(asset)
    catalogue['updated_at'] = utc_now()
    write_json_atomic(catalogue_path, catalogue)


def existing_catalogue_asset(
    catalogue_path: Path,
    decor_key: str,
) -> dict[str, Any] | None:
    catalogue = read_json(catalogue_path, {})
    for asset in catalogue.get('assets', []) if isinstance(catalogue, dict) else []:
        if isinstance(asset, dict) and asset.get('decor_key') == decor_key:
            return asset
    return None


def resolve_visual_gate_python(requested: str | None) -> str:
    executable = requested or sys.executable
    if not Path(executable).exists() and shutil.which(executable) is None:
        raise DecorError(f'Python visual-gate introuvable : {executable}')
    return executable


def run_pipeline(
    args: argparse.Namespace,
    *,
    generator: Callable[[str, Path, Path], None] | None = None,
) -> dict[str, Any]:
    lieu = args.lieu.strip()
    tenue = args.tenue.strip()
    moment = args.moment.strip()
    if not lieu or not tenue or not moment:
        raise DecorError('--lieu, --tenue et --moment ne peuvent pas être vides')
    if args.variantes not in (2, 3):
        raise DecorError('--variantes doit valoir 2 ou 3')
    if args.sans_heygen and args.animer_15s:
        raise DecorError('--sans-heygen est incompatible avec --animer-15s')
    if args.reprendre_video_id and not args.animer_15s:
        raise DecorError('--reprendre-video-id requiert --animer-15s')
    if args.credits_video_repris < 0:
        raise DecorError('--credits-video-repris ne peut pas être négatif')
    if args.credits_video_repris > args.plafond_credits:
        raise DecorError(
            '--credits-video-repris dépasse --plafond-credits'
        )
    editorial = validate_editorial_copy(
        args.titre,
        args.description,
        lieu,
    )
    reference = args.reference.expanduser().resolve()
    if not reference.is_file():
        raise DecorError(f'référence Lisa introuvable : {reference}')
    output_root = args.output_root.expanduser()
    catalogue_path = args.catalogue.expanduser()
    registry_path = args.talking_photos.expanduser()
    journal_path = args.journal.expanduser()
    visual_gate = args.visual_gate.expanduser().resolve()
    if not visual_gate.is_file():
        raise DecorError(f'visual-gate introuvable : {visual_gate}')
    visual_gate_python = resolve_visual_gate_python(args.visual_gate_python)
    decor_key = slugify(f'{lieu}-{tenue}-{moment}')
    decor_directory = output_root / decor_key
    variants_directory = decor_directory / 'variants'
    gate_journal = output_root / 'visual-gate.jsonl'
    final_path = decor_directory / f'{decor_key}.png'

    previous = existing_catalogue_asset(catalogue_path, decor_key)
    if previous and not args.forcer and not args.variante_existante:
        previous_path = Path(str(previous.get('image_path', '')).replace('~', str(Path.home()), 1))
        previous_score = previous.get('arcface')
        if (
            previous_path.is_file()
            and isinstance(previous_score, (int, float))
            and float(previous_score) >= args.arcface_min
            and previous.get('visual_gate') == 'passed'
        ):
            talking_photo = find_talking_photo(
                registry_path,
                sha256_file(previous_path),
            )
            talking_photo, animation, heygen_credits = provision_heygen(
                args,
                registry_path=registry_path,
                decor_key=decor_key,
                image_path=previous_path,
                arcface=float(previous_score),
                existing=talking_photo,
            )
            update_catalogue_asset(
                catalogue_path,
                decor_key=decor_key,
                lieu=lieu,
                tenue=tenue,
                moment=moment,
                editorial=editorial,
                selected_path=previous_path,
                selected_sha256=sha256_file(previous_path),
                arcface=float(previous_score),
                talking_photo=talking_photo,
                animation=animation,
            )
            manifest_path = previous_path.parent / 'run.json'
            run_manifest = read_json(manifest_path, {})
            if not isinstance(run_manifest, dict):
                run_manifest = {}
            run_manifest.update({
                'schema_version': '1.0',
                'updated_at': utc_now(),
                'status': (
                    'ready_animated'
                    if animation
                    else 'ready'
                    if talking_photo
                    else 'image_ready_heygen_pending'
                ),
                'decor_key': decor_key,
                'inputs': {
                    'lieu': lieu,
                    'tenue': tenue,
                    'moment': moment,
                    'title': editorial.title,
                    'description': editorial.description,
                    'reference': str(reference),
                    'arcface_min': args.arcface_min,
                },
                'selected': {
                    'path': str(previous_path),
                    'sha256': sha256_file(previous_path),
                    'arcface': float(previous_score),
                    'visual_gate': previous.get('visual_gate'),
                    'talking_photo_id': (
                        talking_photo.talking_photo_id
                        if talking_photo
                        else None
                    ),
                    'avatar_group_id': (
                        talking_photo.avatar_group_id
                        if talking_photo
                        else None
                    ),
                },
                'cost': {
                    'image_api_usd': 0.0,
                    'heygen_credits': heygen_credits,
                    'note': (
                        'Crédits mensuels HeyGen mesurés ou repris depuis le '
                        'solde avant/après ; aucun portefeuille à l’usage.'
                    ),
                },
                'animation': animation,
            })
            write_json_atomic(manifest_path, run_manifest)
            result = {
                'status': 'reused',
                'decor_key': decor_key,
                'image_path': str(previous_path),
                'manifest_path': str(manifest_path),
                'arcface': float(previous_score),
                'talking_photo_id': (
                    talking_photo.talking_photo_id if talking_photo else None
                ),
                'image_cost_usd': 0.0,
                'heygen_credits': heygen_credits,
                'animation': animation,
                'title': editorial.title,
                'description': editorial.description,
            }
            append_jsonl(journal_path, {'at': utc_now(), **result})
            return result

    variants_directory.mkdir(parents=True, exist_ok=True)
    supplied = [path.expanduser().resolve() for path in args.variante_existante]
    if supplied and len(supplied) not in (2, 3):
        raise DecorError(
            '--variante-existante doit être fourni exactement 2 ou 3 fois'
        )
    if supplied:
        args.variantes = len(supplied)
        for path in supplied:
            if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
                raise DecorError(f'variante existante invalide : {path}')

    generation = generator or (
        lambda prompt, ref, destination: generate_with_integrated_image_tool(
            prompt,
            ref,
            destination,
            timeout=args.generation_timeout,
        )
    )
    candidates: list[Candidate] = []
    for variant in range(1, args.variantes + 1):
        attempts = 1 if supplied else MAX_GENERATION_ATTEMPTS
        for attempt in range(1, attempts + 1):
            path = variants_directory / (
                f'{decor_key}-v{variant}-a{attempt}.png'
            )
            if supplied:
                shutil.copy2(supplied[variant - 1], path)
            else:
                prompt = build_prompt(lieu, tenue, moment, variant, attempt)
                generation(prompt, reference, path)
            candidate = evaluate_candidate(
                path,
                variant=variant,
                attempt=attempt,
                visual_gate=visual_gate,
                visual_gate_python=visual_gate_python,
                reference=reference,
                target=args.arcface_min,
                gate_journal=gate_journal,
            )
            candidates.append(candidate)
            if candidate.accepted:
                break

    best = choose_best(candidates)
    selected_source = Path(best.path)
    decor_directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(selected_source, final_path)
    selected_sidecar = gate_sidecar(selected_source)
    if selected_sidecar.exists():
        shutil.copy2(selected_sidecar, gate_sidecar(final_path))
    selected_sha256 = sha256_file(final_path)
    best_arcface = float(best.arcface)

    talking_photo, animation, heygen_credits = provision_heygen(
        args,
        registry_path=registry_path,
        decor_key=decor_key,
        image_path=final_path,
        arcface=best_arcface,
        existing=find_talking_photo(registry_path, selected_sha256),
    )

    update_catalogue_asset(
        catalogue_path,
        decor_key=decor_key,
        lieu=lieu,
        tenue=tenue,
        moment=moment,
        editorial=editorial,
        selected_path=final_path,
        selected_sha256=selected_sha256,
        arcface=best_arcface,
        talking_photo=talking_photo,
        animation=animation,
    )
    run_manifest = {
        'schema_version': '1.0',
        'created_at': utc_now(),
        'status': (
            'ready_animated'
            if animation
            else 'ready'
            if talking_photo
            else 'image_ready_heygen_pending'
        ),
        'decor_key': decor_key,
        'inputs': {
            'lieu': lieu,
            'tenue': tenue,
            'moment': moment,
            'title': editorial.title,
            'description': editorial.description,
            'reference': str(reference),
            'arcface_min': args.arcface_min,
        },
        'candidates': [asdict(candidate) for candidate in candidates],
        'selected': {
            'path': str(final_path),
            'sha256': selected_sha256,
            'arcface': best_arcface,
            'visual_gate': best.gate_verdict,
            'talking_photo_id': (
                talking_photo.talking_photo_id if talking_photo else None
            ),
            'avatar_group_id': (
                talking_photo.avatar_group_id if talking_photo else None
            ),
        },
        'cost': {
            'image_api_usd': 0.0,
            'heygen_credits': heygen_credits,
            'note': (
                'Crédits mensuels HeyGen mesurés avant/après ; aucun '
                'portefeuille à l’usage autorisé.'
            ),
        },
        'animation': animation,
    }
    manifest_path = decor_directory / 'run.json'
    write_json_atomic(manifest_path, run_manifest)
    append_jsonl(
        journal_path,
        {
            'at': utc_now(),
            'event': 'decor_selected',
            'decor_key': decor_key,
            'image_path': str(final_path),
            'arcface': best_arcface,
            'gate_verdict': best.gate_verdict,
            'talking_photo_id': (
                talking_photo.talking_photo_id if talking_photo else None
            ),
            'image_cost_usd': 0.0,
            'heygen_credits': heygen_credits,
            'animation_video_id': (
                animation.get('video_id') if animation else None
            ),
        },
    )
    return {
        'status': run_manifest['status'],
        'decor_key': decor_key,
        'image_path': str(final_path),
        'manifest_path': str(manifest_path),
        'arcface': best_arcface,
        'gate_verdict': best.gate_verdict,
        'talking_photo_id': (
            talking_photo.talking_photo_id if talking_photo else None
        ),
        'image_cost_usd': 0.0,
        'heygen_credits': heygen_credits,
        'animation': animation,
        'title': editorial.title,
        'description': editorial.description,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            'Génère 2–3 décors identity-preserve, applique ArcFace + '
            'visual-gate et catalogue la talking photo HeyGen.'
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument('--lieu', required=True)
    parser.add_argument('--tenue', default='blazer velours sapin')
    parser.add_argument('--moment', default='matin')
    parser.add_argument('--titre')
    parser.add_argument('--description')
    parser.add_argument('--variantes', type=int, default=DEFAULT_VARIANTS)
    parser.add_argument(
        '--variante-existante',
        action='append',
        type=Path,
        default=[],
        help='importe une variante déjà produite par l’outil intégré (2 ou 3)',
    )
    parser.add_argument('--arcface-min', type=float, default=DEFAULT_ARCFACE_TARGET)
    parser.add_argument('--reference', type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument('--output-root', type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument('--catalogue', type=Path, default=DEFAULT_CATALOGUE)
    parser.add_argument(
        '--talking-photos',
        type=Path,
        default=DEFAULT_TALKING_PHOTOS,
    )
    parser.add_argument('--journal', type=Path, default=DEFAULT_JOURNAL)
    parser.add_argument('--visual-gate', type=Path, default=DEFAULT_VISUAL_GATE)
    parser.add_argument(
        '--visual-gate-python',
        help='Python du venv contenant insightface/opencv/onnxruntime',
    )
    parser.add_argument('--generation-timeout', type=int, default=900)
    parser.add_argument('--heygen-timeout', type=int, default=180)
    parser.add_argument(
        '--heygen-backend',
        choices=('subscription-ui', 'cdp'),
        default='subscription-ui',
        help=(
            'plan mensuel via Avatar Shots ou interface CDP seule'
        ),
    )
    parser.add_argument('--media-env', type=Path, default=DEFAULT_MEDIA_ENV)
    parser.add_argument(
        '--plafond-credits',
        type=float,
        default=16.0,
        help='plafond total ferme du run HeyGen',
    )
    parser.add_argument('--talking-photo-id')
    parser.add_argument('--avatar-group-id')
    parser.add_argument(
        '--animer-15s',
        action='store_true',
        help='anime le décor retenu avec 15 s d’audio déjà en cache',
    )
    parser.add_argument(
        '--audio-test',
        type=Path,
        default=DEFAULT_TEST_AUDIO,
        help='audio local existant ; aucune synthèse n’est lancée',
    )
    parser.add_argument(
        '--attente-video',
        type=int,
        default=1800,
        help='délai maximal de rendu de la vidéo test',
    )
    parser.add_argument(
        '--reprendre-video-id',
        help=(
            'reprend et télécharge un rendu Avatar Shots déjà lancé, sans '
            'soumettre une nouvelle génération'
        ),
    )
    parser.add_argument(
        '--credits-video-repris',
        type=float,
        default=0.0,
        help='crédits déjà débités du rendu repris, pour le journal exact',
    )
    parser.add_argument(
        '--sans-heygen',
        action='store_true',
        help='prépare et catalogue l’image sans upload ni crédit HeyGen',
    )
    parser.add_argument(
        '--forcer',
        action='store_true',
        help='ignore un décor identique déjà validé dans le catalogue',
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    try:
        result = run_pipeline(parse_args(argv))
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except (
        DecorError,
        OSError,
        subprocess.SubprocessError,
        TimeoutError,
    ) as error:
        print(f'ERREUR décor à la demande : {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

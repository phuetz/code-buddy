#!/usr/bin/env python3
"""Chaîne de contrôle rejouable : déterministe, détection, vérification, arbitrage.

La chaîne juge et annote. Elle ne modifie jamais la cible. Les modèles n'ont
jamais l'autorité de produire un REJET : cette décision appartient aux
contrôles déterministes certains et au registre humain.
"""

from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


VERSION = '1.0.0'
VERDICTS = ('OK', 'À REGARDER', 'REJET')
DEFAULT_REGISTRY = Path.home() / '.codebuddy/verdicts-humains.jsonl'
DEFAULT_JOURNAL = Path.home() / '.codebuddy/chaine-controle.jsonl'
DEFAULT_STAGE1_MODEL = 'qwen/qwen3.7-flash'
DEFAULT_STAGE2_MODEL = 'google/gemma-4-31b-it:free'
DEFAULT_STAGE2_OLLAMA_MODEL = 'gemma4:12b'
DEFAULT_STAGE2_AGY_MODEL = 'gemini-3.6-flash-high'
DEFAULT_STAGE3_MODEL = 'moonshotai/kimi-k3'
OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'
MODEL_RATES_USD_PER_MTOK = {
    DEFAULT_STAGE1_MODEL: (0.03, 0.13),
    DEFAULT_STAGE2_MODEL: (0.0, 0.0),
    DEFAULT_STAGE3_MODEL: (3.0, 15.0),
}
# Qwen applique des paliers de contexte au-delà de 32k et 256k tokens. Le
# comptage préventif par octets est volontairement pessimiste.
QWEN_RATE_TIERS = (
    (256_000, 0.20, 0.80),
    (32_000, 0.10, 0.40),
    (0, 0.03, 0.13),
)
TEXT_SUFFIXES = frozenset({
    '.csv', '.html', '.json', '.jsonl', '.md', '.rst', '.tex', '.txt',
    '.xml', '.yaml', '.yml',
})
CODE_SUFFIXES = frozenset({
    '.c', '.cc', '.cpp', '.css', '.go', '.h', '.hpp', '.html', '.java',
    '.js', '.json', '.jsx', '.mjs', '.php', '.py', '.rb', '.rs', '.sh',
    '.sql', '.ts', '.tsx', '.vue', '.yaml', '.yml',
})
IGNORED_DIRECTORIES = frozenset({
    '.git', '.idea', '.next', '.venv', '.vscode', '__pycache__', 'coverage',
    'dist', 'node_modules', 'vendor',
})
MAX_ITEM_BYTES = 400_000
MAX_BATCH_CHARS = 250_000
MAX_BATCH_ITEMS = 12


class ControlError(RuntimeError):
    """Erreur qui interdit de poursuivre la chaîne en sécurité."""


class BudgetError(ControlError):
    """Budget absent, épuisé ou dépassé."""


@dataclass(frozen=True)
class Item:
    identifier: str
    source: str
    content: str
    content_sha256: str
    byte_count: int
    truncated: bool = False


@dataclass(frozen=True)
class Finding:
    code: str
    message: str
    severity: str


@dataclass(frozen=True)
class StageDecision:
    verdict: str
    reasons: tuple[str, ...]
    stage: int
    actor: str
    status: str = 'completed'
    cost_usd: float = 0.0
    elapsed_seconds: float = 0.0
    raw_verdict: str | None = None


@dataclass
class BudgetLedger:
    """Plafonds durs vérifiables avant chaque appel, puis coûts réels."""

    total_limit_usd: float
    stage_limits_usd: dict[int, float]
    total_spent_usd: float = 0.0
    stage_spent_usd: dict[int, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        values = (
            self.total_limit_usd,
            self.total_spent_usd,
            *self.stage_limits_usd.values(),
            *self.stage_spent_usd.values(),
        )
        if any(not math.isfinite(value) or value < 0 for value in values):
            raise ValueError('les budgets et coûts doivent être finis et positifs')
        if any(
            limit > self.total_limit_usd
            for limit in self.stage_limits_usd.values()
        ):
            raise ValueError('un plafond d’étage dépasse le plafond total')

    def remaining(self, stage: int) -> float:
        total_remaining = self.total_limit_usd - self.total_spent_usd
        stage_limit = self.stage_limits_usd.get(stage, self.total_limit_usd)
        stage_remaining = stage_limit - self.stage_spent_usd.get(stage, 0.0)
        return max(0.0, min(total_remaining, stage_remaining))

    def authorize(self, stage: int, maximum_cost_usd: float) -> None:
        if not math.isfinite(maximum_cost_usd) or maximum_cost_usd < 0:
            raise ValueError('Le coût maximal doit être fini et positif')
        if maximum_cost_usd > self.remaining(stage) + 1e-12:
            raise BudgetError(
                f'étage {stage} bloqué : coût maximal ${maximum_cost_usd:.6f}, '
                f'restant dur ${self.remaining(stage):.6f}'
            )

    def record(self, stage: int, actual_cost_usd: float) -> None:
        if not math.isfinite(actual_cost_usd) or actual_cost_usd < 0:
            raise BudgetError('OpenRouter a retourné un coût invalide')
        if actual_cost_usd > self.remaining(stage) + 1e-12:
            raise BudgetError(
                f'étage {stage} a dépassé le plafond malgré la préautorisation : '
                f'${actual_cost_usd:.6f} > ${self.remaining(stage):.6f}'
            )
        self.total_spent_usd += actual_cost_usd
        self.stage_spent_usd[stage] = (
            self.stage_spent_usd.get(stage, 0.0) + actual_cost_usd
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            'total_limit_usd': self.total_limit_usd,
            'total_spent_usd': self.total_spent_usd,
            'total_remaining_usd': max(
                0.0, self.total_limit_usd - self.total_spent_usd
            ),
            'stage_limits_usd': {
                str(key): value
                for key, value in sorted(self.stage_limits_usd.items())
            },
            'stage_spent_usd': {
                str(key): value
                for key, value in sorted(self.stage_spent_usd.items())
            },
        }


class JsonlJournal:
    def __init__(self, path: Path) -> None:
        self.path = path.expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, event: dict[str, Any]) -> None:
        record = {
            'timestamp': utc_now(),
            'tool_version': VERSION,
            **event,
        }
        line = json.dumps(record, ensure_ascii=False, sort_keys=True)
        with self.path.open('a', encoding='utf-8') as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            handle.write(line + '\n')
            handle.flush()
            os.fsync(handle.fileno())
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


class HumanVerdictRegistry:
    """Registre append-only ; une ligne illisible bloque l'IA par sécurité."""

    def __init__(self, path: Path) -> None:
        self.path = path.expanduser()

    def load(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        latest: dict[str, dict[str, Any]] = {}
        try:
            lines = self.path.read_text(encoding='utf-8').splitlines()
        except OSError as error:
            raise ControlError(
                f'registre humain illisible, IA interdite : {error}'
            ) from error
        for line_number, raw in enumerate(lines, start=1):
            if not raw.strip():
                continue
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError as error:
                raise ControlError(
                    f'registre humain corrompu ligne {line_number}, '
                    'IA interdite'
                ) from error
            digest = entry.get('content_sha256')
            verdict = entry.get('verdict')
            reason = entry.get('reason')
            if (
                not isinstance(digest, str)
                or not re.fullmatch(r'[0-9a-f]{64}', digest)
                or verdict not in ('OK', 'REJET')
                or not isinstance(reason, str)
            ):
                raise ControlError(
                    f'registre humain invalide ligne {line_number}, '
                    'IA interdite'
                )
            latest[digest] = entry
        return latest

    def append(
        self,
        item: Item,
        verdict: str,
        reason: str,
        content_type: str,
        author: str = 'Patrice',
    ) -> dict[str, Any]:
        if verdict not in ('OK', 'REJET'):
            raise ValueError('Un verdict humain définitif doit être OK ou REJET')
        entry = {
            'schema_version': 1,
            'timestamp': utc_now(),
            'author': author,
            'verdict': verdict,
            'reason': reason.strip(),
            'content_sha256': item.content_sha256,
            'content_type': content_type,
            'source': item.source,
            'byte_count': item.byte_count,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(entry, ensure_ascii=False, sort_keys=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
        descriptor = os.open(self.path, flags, 0o600)
        try:
            with os.fdopen(descriptor, 'a', encoding='utf-8') as handle:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                handle.write(line + '\n')
                handle.flush()
                os.fsync(handle.fileno())
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            raise
        return entry


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalize_verdict(value: Any, *, ai: bool = False) -> str:
    normalized = unicodedata.normalize('NFC', str(value)).upper().strip()
    aliases = {
        'A REGARDER': 'À REGARDER',
        'WARNING': 'À REGARDER',
        'WARN': 'À REGARDER',
        'PASS': 'OK',
        'FAIL': 'REJET',
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in VERDICTS:
        raise ValueError(f'verdict invalide : {value!r}')
    if ai and normalized == 'REJET':
        return 'À REGARDER'
    return normalized


def human_override(
    proposed_verdict: str,
    human_entry: dict[str, Any] | None,
) -> str:
    """Le verdict humain est définitif, même contre un contrôle déterministe."""
    proposed = normalize_verdict(proposed_verdict)
    if human_entry is None:
        return proposed
    return normalize_verdict(human_entry['verdict'])


def aggregate_verdicts(
    deterministic: StageDecision,
    ai_decisions: Sequence[StageDecision],
    human_entry: dict[str, Any] | None = None,
) -> tuple[str, int, str]:
    """Agrège sans jamais donner à une IA le pouvoir de rejeter."""
    if human_entry is not None:
        verdict = human_override(deterministic.verdict, human_entry)
        return verdict, 4, f'verdict humain définitif : {human_entry["reason"]}'
    if deterministic.verdict == 'REJET':
        return 'REJET', 0, '; '.join(deterministic.reasons)
    review_reasons: list[str] = []
    for decision in ai_decisions:
        if decision.status not in ('completed', 'disabled'):
            review_reasons.append(
                f'étage {decision.stage} incomplet : '
                f'{"; ".join(decision.reasons)}'
            )
        if normalize_verdict(decision.verdict, ai=True) == 'À REGARDER':
            review_reasons.extend(
                decision.reasons
                or (f'étage {decision.stage} demande une vérification',)
            )
    if deterministic.verdict == 'À REGARDER':
        review_reasons.extend(deterministic.reasons)
    if review_reasons:
        return 'À REGARDER', max(
            (decision.stage for decision in ai_decisions
             if normalize_verdict(decision.verdict, ai=True) == 'À REGARDER'),
            default=0,
        ), '; '.join(dict.fromkeys(review_reasons))
    deciding_stage = max(
        (
            decision.stage
            for decision in ai_decisions
            if decision.status == 'completed'
        ),
        default=0,
    )
    return 'OK', deciding_stage, 'aucun défaut détecté'


def needs_arbitration(
    stage1: StageDecision,
    stage2: StageDecision,
) -> bool:
    if stage1.status != 'completed' or stage2.status != 'completed':
        return False
    left = normalize_verdict(stage1.verdict, ai=True)
    right = normalize_verdict(stage2.verdict, ai=True)
    return left != right


def decisions_after_arbitration(
    stage1: StageDecision,
    stage2: StageDecision,
    stage3: StageDecision | None,
) -> tuple[StageDecision, ...]:
    """Un arbitrage réussi remplace les avis IA, sans lever l'étage 0."""
    if stage3 is not None and stage3.status == 'completed':
        return (stage3,)
    if stage3 is not None:
        return (stage1, stage2, stage3)
    return (stage1, stage2)


def maximum_openrouter_cost(
    prompt: str,
    max_tokens: int,
    input_usd_per_mtok: float,
    output_usd_per_mtok: float,
    reasoning_max_tokens: int = 0,
) -> float:
    """Borne conservatrice : un octet UTF-8 compte comme un token d'entrée."""
    if max_tokens < 0 or reasoning_max_tokens < 0:
        raise ValueError('les plafonds de tokens doivent être positifs')
    input_token_upper_bound = len(prompt.encode('utf-8')) + 4096
    return (
        input_token_upper_bound * input_usd_per_mtok / 1_000_000
        + (max_tokens + reasoning_max_tokens)
        * output_usd_per_mtok / 1_000_000
    )


def model_rates_for_prompt(model: str, prompt: str) -> tuple[float, float]:
    rates = MODEL_RATES_USD_PER_MTOK.get(model)
    if rates is None:
        raise ControlError(
            f'tarifs inconnus pour {model}; appel interdit sans borne de budget'
        )
    if model == DEFAULT_STAGE1_MODEL:
        input_upper = len(prompt.encode('utf-8')) + 4096
        for threshold, prompt_rate, completion_rate in QWEN_RATE_TIERS:
            if input_upper >= threshold:
                return prompt_rate, completion_rate
    return rates


def deterministic_audit(
    item: Item,
    content_type: str,
    strict: bool,
) -> StageDecision:
    started = time.monotonic()
    findings: list[Finding] = []
    content = item.content
    if item.truncated:
        findings.append(Finding(
            'content-truncated',
            f'contenu IA tronqué à {MAX_ITEM_BYTES} octets',
            'warning',
        ))
    if not content.strip():
        findings.append(Finding('empty', 'contenu vide', 'warning'))
    if '\x00' in content:
        findings.append(Finding(
            'nul-byte', 'octet NUL dans un contenu textuel', 'reject'
        ))
    conflict = re.search(
        r'(?m)^(<{7}(?: .*)?|={7}|>{7}(?: .*)?)$',
        content,
    )
    if conflict:
        findings.append(Finding(
            'merge-conflict', 'marqueur de conflit Git résiduel', 'reject'
        ))
    if re.search(r'[\u200b\u200c\u200d\u2060\ufeff]', content):
        findings.append(Finding(
            'invisible-unicode',
            'caractère Unicode invisible ou BOM interne',
            'warning',
        ))
    if re.search(r'(?m)[ \t]+$', content):
        findings.append(Finding(
            'trailing-whitespace', 'espaces de fin de ligne', 'warning'
        ))
    if '\r\n' in content and re.search(r'(?<!\r)\n', content):
        findings.append(Finding(
            'mixed-newlines', 'fins de ligne CRLF et LF mélangées', 'warning'
        ))
    if content and not content.endswith(('\n', '\r')):
        findings.append(Finding(
            'missing-final-newline', 'fin de fichier sans saut de ligne', 'warning'
        ))
    if re.search(
        r'(?im)^\s*(?://|#|/\*)?\s*(?:\.\.\.\s*)?'
        r'(?:rest|remaining|reste)(?:\s+(?:of|du|de))?\s+'
        r'(?:the\s+)?(?:code|implementation)\s*(?:\.\.\.)?\s*(?:\*/)?$',
        content,
    ):
        findings.append(Finding(
            'omission-placeholder',
            'placeholder probable à la place d’un contenu complet',
            'warning',
        ))

    raw_tokens = re.findall(r'[^\W\d_]{3,}', content, flags=re.UNICODE)
    normalized_variants: dict[str, set[str]] = {}
    for token in raw_tokens:
        key = unicodedata.normalize('NFC', token).casefold()
        normalized_variants.setdefault(key, set()).add(token)
    inconsistent = [
        sorted(variants)
        for variants in normalized_variants.values()
        if len(variants) > 1
        and any(unicodedata.normalize('NFC', value) != value for value in variants)
    ]
    if inconsistent:
        findings.append(Finding(
            'unicode-name-variants',
            f'noms Unicode incohérents : {inconsistent[:3]}',
            'warning',
        ))

    suffix = Path(item.source).suffix.lower()
    if content_type == 'code':
        findings.extend(code_syntax_findings(content, suffix))
    elif content_type == 'traduction':
        findings.extend(translation_deterministic_findings(content))

    rejects = [finding.message for finding in findings
               if finding.severity == 'reject']
    warnings = [finding.message for finding in findings
                if finding.severity == 'warning']
    if strict:
        rejects.extend(warnings)
    verdict = 'REJET' if rejects else ('À REGARDER' if warnings else 'OK')
    reasons = tuple(dict.fromkeys(rejects if rejects else warnings))
    return StageDecision(
        verdict=verdict,
        reasons=reasons,
        stage=0,
        actor='contrôles déterministes',
        elapsed_seconds=time.monotonic() - started,
    )


def translation_deterministic_findings(content: str) -> list[Finding]:
    """Compare les invariants copiables quand source et cible sont étiquetées."""
    match = re.search(
        r'(?is)\bSOURCE\s*:\s*(.*?)\n'
        r'\s*(?:TRADUCTION(?:\s+PUBLI[ÉE]E?)?|TARGET|CIBLE)\s*:\s*(.*)',
        content,
    )
    if not match:
        return []
    source, target = match.groups()
    findings: list[Finding] = []

    def invariant_tokens(value: str) -> set[str]:
        urls = re.findall(r'https?://[^\s<>]+', value)
        emails = re.findall(
            r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b',
            value,
            flags=re.IGNORECASE,
        )
        placeholders = re.findall(
            r'(?:\{\{[^{}]+\}\}|\{[A-Za-z_][^{}]*\}|'
            r'%\([^)]+\)[a-zA-Z]|%[sdif]|'
            r'\$\{[^{}]+\}|<[A-Z][A-Z0-9_-]*>)',
            value,
        )
        return set((*urls, *emails, *placeholders))

    source_invariants = invariant_tokens(source)
    target_invariants = invariant_tokens(target)
    missing = sorted(source_invariants - target_invariants)
    added = sorted(target_invariants - source_invariants)
    if missing or added:
        findings.append(Finding(
            'translation-invariant-mismatch',
            f'URL, e-mail ou placeholder modifié : '
            f'manquants={missing}, ajoutés={added}',
            'reject',
        ))

    number_pattern = r'(?<![\w])[-+]?\d+(?:[.,]\d+)*(?![\w])'

    def normalized_numbers(value: str) -> list[str]:
        return sorted(
            token.replace(',', '.')
            for token in re.findall(number_pattern, value)
        )

    source_numbers = normalized_numbers(source)
    target_numbers = normalized_numbers(target)
    if source_numbers != target_numbers:
        findings.append(Finding(
            'translation-number-mismatch',
            f'nombres différents : source={source_numbers}, '
            f'cible={target_numbers}',
            'warning',
        ))
    return findings


def code_syntax_findings(content: str, suffix: str) -> list[Finding]:
    findings: list[Finding] = []
    try:
        if suffix == '.py':
            ast.parse(content)
        elif suffix == '.json':
            json.loads(content)
        elif suffix in ('.js', '.mjs', '.cjs') and shutil_which('node'):
            process = subprocess.run(
                ['node', '--check', '-'],
                input=content,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            if process.returncode != 0:
                message = last_nonempty_line(process.stderr)
                findings.append(Finding(
                    'syntax-error', f'syntaxe JavaScript invalide : {message}',
                    'reject',
                ))
        elif suffix == '.sh' and shutil_which('bash'):
            process = subprocess.run(
                ['bash', '-n'],
                input=content,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            if process.returncode != 0:
                message = last_nonempty_line(process.stderr)
                findings.append(Finding(
                    'syntax-error', f'syntaxe shell invalide : {message}', 'reject'
                ))
    except (SyntaxError, json.JSONDecodeError) as error:
        findings.append(Finding(
            'syntax-error', f'syntaxe invalide : {error}', 'reject'
        ))
    except (OSError, subprocess.SubprocessError) as error:
        findings.append(Finding(
            'syntax-check-unavailable',
            f'contrôle de syntaxe indisponible : {error}',
            'warning',
        ))
    return findings


def shutil_which(command: str) -> str | None:
    for directory in os.environ.get('PATH', '').split(os.pathsep):
        candidate = Path(directory) / command
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def last_nonempty_line(value: str) -> str:
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    return lines[-1] if lines else 'erreur non détaillée'


def collect_items(target: str, content_type: str) -> list[Item]:
    path = Path(target).expanduser()
    if target == '-':
        raw = sys.stdin.buffer.read()
        return [item_from_bytes('stdin', '-', raw)]
    if not path.exists():
        raise ControlError(f'cible introuvable : {path}')
    if path.is_file():
        return [item_from_path(path)]
    suffixes = CODE_SUFFIXES if content_type == 'code' else TEXT_SUFFIXES
    paths = [
        candidate
        for candidate in path.rglob('*')
        if candidate.is_file()
        and not any(part in IGNORED_DIRECTORIES for part in candidate.parts)
        and candidate.suffix.lower() in suffixes
    ]
    if not paths:
        raise ControlError(f'aucun fichier {content_type} trouvé dans {path}')
    return [item_from_path(candidate) for candidate in sorted(paths)]


def ensure_auxiliary_paths_outside_target(
    target: str,
    auxiliary_paths: Sequence[Path | None],
) -> None:
    """Interdit aux journaux et rapports de modifier la cible ou son dossier."""
    if target == '-':
        return
    target_path = Path(target).expanduser().resolve()
    for raw_path in auxiliary_paths:
        if raw_path is None:
            continue
        path = raw_path.expanduser().resolve()
        collision = (
            path == target_path
            if target_path.is_file()
            else path == target_path or path.is_relative_to(target_path)
        )
        if collision:
            raise ControlError(
                f'chemin auxiliaire interdit dans la cible : {raw_path}'
            )


def item_from_path(path: Path) -> Item:
    raw = path.read_bytes()
    try:
        raw.decode('utf-8')
    except UnicodeDecodeError as error:
        raise ControlError(f'{path} n’est pas un texte UTF-8 : {error}') from error
    content = raw[:MAX_ITEM_BYTES].decode('utf-8', errors='ignore')
    return Item(
        identifier=str(path),
        source=str(path),
        content=content,
        content_sha256=sha256_bytes(raw),
        byte_count=len(raw),
        truncated=len(raw) > MAX_ITEM_BYTES,
    )


def item_from_bytes(identifier: str, source: str, raw: bytes) -> Item:
    try:
        raw.decode('utf-8')
    except UnicodeDecodeError as error:
        raise ControlError(f'{source} n’est pas un texte UTF-8 : {error}') from error
    content = raw[:MAX_ITEM_BYTES].decode('utf-8', errors='ignore')
    return Item(
        identifier=identifier,
        source=source,
        content=content,
        content_sha256=sha256_bytes(raw),
        byte_count=len(raw),
        truncated=len(raw) > MAX_ITEM_BYTES,
    )


def batches(items: Sequence[Item]) -> Iterable[list[Item]]:
    current: list[Item] = []
    current_chars = 0
    for item in items:
        size = len(item.content)
        if current and (
            len(current) >= MAX_BATCH_ITEMS
            or current_chars + size > MAX_BATCH_CHARS
        ):
            yield current
            current = []
            current_chars = 0
        current.append(item)
        current_chars += size
    if current:
        yield current


def system_prompt(stage: int, content_type: str, strict: bool) -> str:
    focus = {
        'texte': (
            'exactitude factuelle interne, contradictions, ambiguïtés graves, '
            'promesses non étayées et défauts de lisibilité'
        ),
        'code': (
            'bugs, régressions, sécurité, invariants rompus, tests complaisants '
            'et comportement différent de la promesse'
        ),
        'traduction': (
            'contresens, faux amis, omissions, ajouts, terminologie, nombres, '
            'noms propres et registre'
        ),
    }[content_type]
    role = {
        1: 'détecteur adversarial à haut rappel',
        2: 'vérificateur indépendant à l’aveugle',
        3: 'arbitre de désaccords',
    }[stage]
    strict_note = (
        'Le mode strict est actif : signale aussi les défauts plausibles.'
        if strict
        else 'Ne signale que les défauts concrets ou raisonnablement probables.'
    )
    return (
        f'Tu es un {role}. Analyse du contenu de type {content_type}. '
        f'Cherche : {focus}. {strict_note} '
        'Tu ne peux pas rejeter : OK signifie aucun défaut trouvé ; '
        'À REGARDER signifie qu’un humain doit examiner un défaut précis. '
        'Réponds uniquement par un objet JSON '
        '{"items":[{"id":"identifiant","verdict":"OK|À REGARDER",'
        '"reasons":["raison factuelle et localisée"]}]}. '
        'Rends exactement un résultat par identifiant, sans markdown.'
    )


def items_payload(items: Sequence[Item]) -> str:
    return json.dumps(
        {
            'items': [
                {
                    'id': item.identifier,
                    'sha256': item.content_sha256,
                    'content': item.content,
                }
                for item in items
            ]
        },
        ensure_ascii=False,
    )


def parse_model_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*```$', '', cleaned)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find('{')
        end = cleaned.rfind('}')
        if start < 0 or end <= start:
            raise ControlError('réponse modèle sans objet JSON')
        try:
            value = json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError as error:
            raise ControlError(f'JSON modèle invalide : {error}') from error
    if not isinstance(value, dict) or not isinstance(value.get('items'), list):
        raise ControlError('réponse modèle sans liste items')
    return value


def decisions_from_response(
    response: dict[str, Any],
    items: Sequence[Item],
    stage: int,
    actor: str,
    cost_usd: float,
    elapsed_seconds: float,
) -> dict[str, StageDecision]:
    expected = {item.identifier for item in items}
    parsed: dict[str, StageDecision] = {}
    for value in response['items']:
        if not isinstance(value, dict) or value.get('id') not in expected:
            continue
        identifier = value['id']
        try:
            raw_verdict = normalize_verdict(value.get('verdict', ''), ai=False)
        except ValueError:
            raw_verdict = 'À REGARDER'
        verdict = normalize_verdict(raw_verdict, ai=True)
        reasons_value = value.get('reasons', [])
        reasons = (
            tuple(str(reason).strip() for reason in reasons_value
                  if str(reason).strip())
            if isinstance(reasons_value, list)
            else ('raisons du modèle mal formées',)
        )
        if raw_verdict == 'REJET':
            reasons = (*reasons, 'REJET modèle neutralisé en À REGARDER')
        parsed[identifier] = StageDecision(
            verdict=verdict,
            reasons=reasons,
            stage=stage,
            actor=actor,
            cost_usd=cost_usd,
            elapsed_seconds=elapsed_seconds,
            raw_verdict=raw_verdict,
        )
    for identifier in expected - parsed.keys():
        parsed[identifier] = StageDecision(
            verdict='À REGARDER',
            reasons=('résultat absent de la réponse modèle',),
            stage=stage,
            actor=actor,
            status='error',
            cost_usd=cost_usd,
            elapsed_seconds=elapsed_seconds,
        )
    return parsed


def load_openrouter_key() -> str | None:
    if os.environ.get('OPENROUTER_API_KEY'):
        return os.environ['OPENROUTER_API_KEY'].strip()
    candidates = (
        Path.cwd() / '.env',
        Path(__file__).resolve().parents[1] / '.env',
        Path.home() / 'code-buddy/.env',
    )
    for path in candidates:
        if not path.is_file():
            continue
        for line in path.read_text(encoding='utf-8').splitlines():
            if line.startswith('OPENROUTER_API_KEY='):
                return line.partition('=')[2].strip().strip('"\'')
    return None


def openrouter_chat(
    *,
    stage: int,
    model: str,
    prompt: str,
    max_tokens: int,
    reasoning_max_tokens: int,
    ledger: BudgetLedger,
    api_key: str,
    journal: JsonlJournal,
) -> tuple[str, float, float, dict[str, Any]]:
    rates = model_rates_for_prompt(model, prompt)
    maximum_cost = maximum_openrouter_cost(
        prompt,
        max_tokens,
        rates[0],
        rates[1],
        reasoning_max_tokens,
    )
    ledger.authorize(stage, maximum_cost)
    body = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': max_tokens,
        'temperature': 0.1,
        'reasoning': (
            {
                'max_tokens': reasoning_max_tokens,
                'exclude': True,
            }
            if reasoning_max_tokens
            else {'enabled': False, 'exclude': True}
        ),
        'provider': {
            'require_parameters': True,
            'max_price': {
                'prompt': rates[0],
                'completion': rates[1],
            },
        },
    }).encode('utf-8')
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=body,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
    )
    started = time.monotonic()
    data: dict[str, Any] | None = None
    last_error: BaseException | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                data = json.load(response)
            break
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code == 429 and attempt < 2:
                time.sleep(30 * (attempt + 1))
                continue
            raise ControlError(
                f'OpenRouter HTTP {error.code} pour {model}'
            ) from error
        except (OSError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            raise ControlError(f'échec OpenRouter pour {model} : {error}') from error
    if data is None:
        raise ControlError(f'échec OpenRouter pour {model} : {last_error}')
    elapsed = time.monotonic() - started
    usage = data.get('usage')
    if not isinstance(usage, dict) or 'cost' not in usage:
        raise ControlError(
            f'OpenRouter n’a pas fourni usage.cost pour {model}; arrêt sûr'
        )
    try:
        cost = float(usage['cost'])
    except (TypeError, ValueError) as error:
        raise ControlError('usage.cost OpenRouter invalide') from error
    ledger.record(stage, cost)
    choices = data.get('choices')
    if not isinstance(choices, list) or not choices:
        raise ControlError(f'réponse OpenRouter vide pour {model}')
    content = choices[0].get('message', {}).get('content')
    if not isinstance(content, str) or not content.strip():
        raise ControlError(f'contenu OpenRouter vide pour {model}')
    journal.write({
        'event': 'model_call',
        'stage': stage,
        'provider': 'openrouter',
        'model': model,
        'status': 'completed',
        'maximum_authorized_cost_usd': maximum_cost,
        'actual_cost_usd': cost,
        'elapsed_seconds': elapsed,
        'usage': usage,
    })
    return content, cost, elapsed, usage


def free_verifier_chat(
    provider: str,
    model: str,
    prompt: str,
    api_key: str | None,
    ledger: BudgetLedger,
    journal: JsonlJournal,
) -> tuple[str, float, float]:
    if provider == 'openrouter':
        if not api_key:
            raise ControlError('OPENROUTER_API_KEY absent pour l’étage 2')
        content, cost, elapsed, _ = openrouter_chat(
            stage=2,
            model=model,
            prompt=prompt,
            max_tokens=2500,
            reasoning_max_tokens=0,
            ledger=ledger,
            api_key=api_key,
            journal=journal,
        )
        return content, cost, elapsed
    started = time.monotonic()
    if provider == 'agy':
        process = subprocess.run(
            ['agy', '--model', model, '-p', prompt],
            text=True,
            capture_output=True,
            timeout=600,
            check=False,
        )
        if process.returncode != 0:
            raise ControlError(f'échec agy : {last_nonempty_line(process.stderr)}')
        content = process.stdout.strip()
    elif provider == 'ollama':
        body = json.dumps({
            'model': model,
            'messages': [{'role': 'user', 'content': prompt}],
            'stream': False,
            'format': 'json',
        }).encode('utf-8')
        request = urllib.request.Request(
            OLLAMA_URL,
            data=body,
            headers={'Content-Type': 'application/json'},
        )
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                data = json.load(response)
        except (OSError, urllib.error.HTTPError, json.JSONDecodeError) as error:
            raise ControlError(f'échec Ollama : {error}') from error
        content = data.get('message', {}).get('content', '')
    else:
        raise ValueError(f'fournisseur étage 2 inconnu : {provider}')
    elapsed = time.monotonic() - started
    if not content:
        raise ControlError(f'réponse vide du vérificateur {provider}/{model}')
    journal.write({
        'event': 'model_call',
        'stage': 2,
        'provider': provider,
        'model': model,
        'status': 'completed',
        'maximum_authorized_cost_usd': 0.0,
        'actual_cost_usd': 0.0,
        'elapsed_seconds': elapsed,
    })
    return content, 0.0, elapsed


def unavailable_decisions(
    items: Sequence[Item],
    stage: int,
    actor: str,
    status: str,
    reason: str,
) -> dict[str, StageDecision]:
    return {
        item.identifier: StageDecision(
            verdict='À REGARDER',
            reasons=(reason,),
            stage=stage,
            actor=actor,
            status=status,
        )
        for item in items
    }


def merge_repeated_decisions(
    passes: Sequence[dict[str, StageDecision]],
    items: Sequence[Item],
    actor: str,
) -> dict[str, StageDecision]:
    merged: dict[str, StageDecision] = {}
    for item in items:
        values = [result[item.identifier] for result in passes]
        review = [value for value in values if value.verdict == 'À REGARDER']
        statuses = [value.status for value in values]
        reasons = tuple(dict.fromkeys(
            reason for value in values for reason in value.reasons
        ))
        merged[item.identifier] = StageDecision(
            verdict='À REGARDER' if review else 'OK',
            reasons=reasons,
            stage=1,
            actor=actor,
            status='completed' if all(
                status == 'completed' for status in statuses
            ) else next(
                status for status in statuses if status != 'completed'
            ),
            cost_usd=sum(value.cost_usd for value in values),
            elapsed_seconds=sum(value.elapsed_seconds for value in values),
        )
    return merged


def run_stage1(
    items: Sequence[Item],
    content_type: str,
    strict: bool,
    passes_count: int,
    model: str,
    api_key: str | None,
    ledger: BudgetLedger,
    journal: JsonlJournal,
) -> dict[str, StageDecision]:
    actor = f'OpenRouter/{model}'
    if not api_key:
        return unavailable_decisions(
            items, 1, actor, 'unavailable', 'OPENROUTER_API_KEY absent'
        )
    all_passes: list[dict[str, StageDecision]] = []
    for pass_index in range(passes_count):
        pass_results: dict[str, StageDecision] = {}
        for batch in batches(items):
            prompt = (
                system_prompt(1, content_type, strict)
                + f'\nPasse indépendante {pass_index + 1}/{passes_count}.'
                + '\n\n'
                + items_payload(batch)
            )
            try:
                raw, cost, elapsed, _ = openrouter_chat(
                    stage=1,
                    model=model,
                    prompt=prompt,
                    max_tokens=1500,
                    reasoning_max_tokens=2500,
                    ledger=ledger,
                    api_key=api_key,
                    journal=journal,
                )
                parsed = parse_model_json(raw)
                pass_results.update(decisions_from_response(
                    parsed, batch, 1, actor, cost, elapsed
                ))
            except BudgetError as error:
                journal.write({
                    'event': 'budget_stop',
                    'stage': 1,
                    'model': model,
                    'status': 'budget_exhausted',
                    'reason': str(error),
                    'budget': ledger.snapshot(),
                })
                pass_results.update(unavailable_decisions(
                    batch, 1, actor, 'budget_exhausted', str(error)
                ))
            except ControlError as error:
                journal.write({
                    'event': 'stage_error',
                    'stage': 1,
                    'model': model,
                    'status': 'error',
                    'reason': str(error),
                })
                pass_results.update(unavailable_decisions(
                    batch, 1, actor, 'error', str(error)
                ))
        all_passes.append(pass_results)
    return merge_repeated_decisions(all_passes, items, actor)


def run_stage2_blind(
    items: Sequence[Item],
    content_type: str,
    strict: bool,
    provider: str,
    model: str,
    api_key: str | None,
    ledger: BudgetLedger,
    journal: JsonlJournal,
) -> dict[str, StageDecision]:
    """Ne reçoit par construction aucun résultat de l'étage 1."""
    actor = f'{provider}/{model}'
    results: dict[str, StageDecision] = {}
    for batch in batches(items):
        prompt = (
            system_prompt(2, content_type, strict)
            + '\nTu ne disposes d’aucun verdict ni constat d’un autre modèle.'
            + '\n\n'
            + items_payload(batch)
        )
        try:
            raw, cost, elapsed = free_verifier_chat(
                provider, model, prompt, api_key, ledger, journal
            )
            results.update(decisions_from_response(
                parse_model_json(raw), batch, 2, actor, cost, elapsed
            ))
        except (BudgetError, ControlError, subprocess.SubprocessError) as error:
            journal.write({
                'event': 'stage_error',
                'stage': 2,
                'model': model,
                'provider': provider,
                'status': 'error',
                'reason': str(error),
            })
            results.update(unavailable_decisions(
                batch, 2, actor, 'error', str(error)
            ))
    return results


def run_stage3(
    disagreements: Sequence[tuple[Item, StageDecision, StageDecision]],
    content_type: str,
    strict: bool,
    model: str,
    api_key: str | None,
    ledger: BudgetLedger,
    journal: JsonlJournal,
) -> dict[str, StageDecision]:
    if not disagreements:
        return {}
    actor = f'OpenRouter/{model}'
    items = [entry[0] for entry in disagreements]
    if not api_key:
        return unavailable_decisions(
            items, 3, actor, 'unavailable', 'OPENROUTER_API_KEY absent'
        )
    results: dict[str, StageDecision] = {}
    for offset in range(0, len(disagreements), MAX_BATCH_ITEMS):
        group = disagreements[offset:offset + MAX_BATCH_ITEMS]
        payload = {
            'desaccords': [
                {
                    'id': item.identifier,
                    'content': item.content,
                    'avis_a': {
                        'verdict': stage1.verdict,
                        'reasons': stage1.reasons,
                    },
                    'avis_b': {
                        'verdict': stage2.verdict,
                        'reasons': stage2.reasons,
                    },
                }
                for item, stage1, stage2 in group
            ]
        }
        prompt = (
            system_prompt(3, content_type, strict)
            + '\nLes avis A et B sont anonymisés. Tranche sur le fond.'
            + '\n\n'
            + json.dumps(payload, ensure_ascii=False)
        )
        batch_items = [entry[0] for entry in group]
        try:
            raw, cost, elapsed, _ = openrouter_chat(
                stage=3,
                model=model,
                prompt=prompt,
                max_tokens=2500,
                reasoning_max_tokens=0,
                ledger=ledger,
                api_key=api_key,
                journal=journal,
            )
            results.update(decisions_from_response(
                parse_model_json(raw), batch_items, 3, actor, cost, elapsed
            ))
        except (BudgetError, ControlError) as error:
            journal.write({
                'event': 'stage_error',
                'stage': 3,
                'model': model,
                'status': 'budget_exhausted'
                if isinstance(error, BudgetError) else 'error',
                'reason': str(error),
            })
            results.update(unavailable_decisions(
                batch_items,
                3,
                actor,
                'budget_exhausted'
                if isinstance(error, BudgetError) else 'error',
                str(error),
            ))
    return results


def disabled_decision(stage: int) -> StageDecision:
    return StageDecision(
        verdict='OK',
        reasons=('étage désactivé',),
        stage=stage,
        actor='désactivé',
        status='disabled',
    )


def execute_check_commands(
    commands: Sequence[str],
    target: str,
    journal: JsonlJournal,
) -> StageDecision | None:
    if not commands:
        return None
    reasons: list[str] = []
    elapsed = 0.0
    for command in commands:
        started = time.monotonic()
        process = subprocess.run(
            command,
            shell=True,
            cwd=str(Path(target).expanduser()) if Path(target).is_dir() else None,
            text=True,
            capture_output=True,
            timeout=1800,
            check=False,
        )
        duration = time.monotonic() - started
        elapsed += duration
        journal.write({
            'event': 'deterministic_command',
            'stage': 0,
            'command': command,
            'returncode': process.returncode,
            'elapsed_seconds': duration,
            'stdout_tail': process.stdout[-2000:],
            'stderr_tail': process.stderr[-2000:],
        })
        if process.returncode != 0:
            reasons.append(
                f'commande déterministe échouée ({process.returncode}) : {command}'
            )
    return StageDecision(
        verdict='REJET' if reasons else 'OK',
        reasons=tuple(reasons),
        stage=0,
        actor='commandes déterministes',
        elapsed_seconds=elapsed,
    )


def combine_deterministic(
    item_decision: StageDecision,
    command_decision: StageDecision | None,
) -> StageDecision:
    if command_decision is None or command_decision.verdict == 'OK':
        return item_decision
    return StageDecision(
        verdict='REJET',
        reasons=tuple(dict.fromkeys(
            (*item_decision.reasons, *command_decision.reasons)
        )),
        stage=0,
        actor='contrôles et commandes déterministes',
        elapsed_seconds=(
            item_decision.elapsed_seconds + command_decision.elapsed_seconds
        ),
    )


def execute_chain(
    *,
    items: Sequence[Item],
    content_type: str,
    strict: bool,
    enabled_stages: set[int],
    stage1_passes: int,
    stage1_model: str,
    stage2_provider: str,
    stage2_model: str,
    stage3_model: str,
    registry_entries: dict[str, dict[str, Any]],
    ledger: BudgetLedger,
    journal: JsonlJournal,
    command_decision: StageDecision | None = None,
) -> dict[str, Any]:
    run_id = f'{int(time.time())}-{os.getpid()}'
    started = time.monotonic()
    deterministic: dict[str, StageDecision] = {}
    unlocked: list[Item] = []
    human: dict[str, dict[str, Any]] = {}
    for item in items:
        entry = registry_entries.get(item.content_sha256)
        if entry is not None:
            human[item.identifier] = entry
        if 0 in enabled_stages:
            deterministic[item.identifier] = combine_deterministic(
                deterministic_audit(item, content_type, strict),
                command_decision,
            )
        else:
            deterministic[item.identifier] = disabled_decision(0)
        if entry is None:
            unlocked.append(item)

    api_key = load_openrouter_key()
    if 1 in enabled_stages:
        stage1 = run_stage1(
            unlocked, content_type, strict, stage1_passes, stage1_model,
            api_key, ledger, journal,
        )
    else:
        stage1 = {item.identifier: disabled_decision(1) for item in unlocked}
    if 2 in enabled_stages:
        stage2 = run_stage2_blind(
            unlocked, content_type, strict, stage2_provider, stage2_model,
            api_key, ledger, journal,
        )
    else:
        stage2 = {item.identifier: disabled_decision(2) for item in unlocked}

    disagreements = [
        (item, stage1[item.identifier], stage2[item.identifier])
        for item in unlocked
        if needs_arbitration(
            stage1[item.identifier],
            stage2[item.identifier],
        )
    ]
    stage3 = (
        run_stage3(
            disagreements, content_type, strict, stage3_model, api_key,
            ledger, journal,
        )
        if 3 in enabled_stages
        else {
            item.identifier: disabled_decision(3)
            for item, _, _ in disagreements
        }
    )

    results: list[dict[str, Any]] = []
    for item in items:
        human_entry = human.get(item.identifier)
        ai: list[StageDecision] = []
        if human_entry is None:
            ai.extend(decisions_after_arbitration(
                stage1[item.identifier],
                stage2[item.identifier],
                stage3.get(item.identifier),
            ))
        verdict, deciding_stage, reason = aggregate_verdicts(
            deterministic[item.identifier], ai, human_entry
        )
        result = {
            'id': item.identifier,
            'source': item.source,
            'content_sha256': item.content_sha256,
            'verdict': verdict,
            'deciding_stage': deciding_stage,
            'reason': reason,
            'human_lock': human_entry,
            'stages': {
                '0': asdict(deterministic[item.identifier]),
                '1': (
                    asdict(stage1[item.identifier])
                    if human_entry is None else {
                        'status': 'skipped_human_lock',
                        'reason': 'registre humain consulté avant IA',
                    }
                ),
                '2': (
                    asdict(stage2[item.identifier])
                    if human_entry is None else {
                        'status': 'skipped_human_lock',
                        'reason': 'registre humain consulté avant IA',
                    }
                ),
                '3': (
                    asdict(stage3[item.identifier])
                    if item.identifier in stage3 else {
                        'status': 'not_needed',
                        'reason': 'aucun désaccord admissible',
                    }
                ),
                '4': {
                    'status': 'locked' if human_entry else 'no_known_verdict',
                    'verdict': human_entry.get('verdict')
                    if human_entry else None,
                },
            },
        }
        results.append(result)

    report = {
        'schema_version': 1,
        'tool': 'chaine-controle',
        'tool_version': VERSION,
        'run_id': run_id,
        'timestamp': utc_now(),
        'content_type': content_type,
        'strict': strict,
        'enabled_stages': sorted(enabled_stages),
        'rules': {
            'human_registry_checked_before_ai': True,
            'ai_can_reject': False,
            'stage2_blind_to_stage1': True,
            'content_modified': False,
        },
        'summary': {
            verdict: sum(result['verdict'] == verdict for result in results)
            for verdict in VERDICTS
        },
        'disagreement_count': len(disagreements),
        'budget': ledger.snapshot(),
        'elapsed_seconds': time.monotonic() - started,
        'items': results,
    }
    journal.write({
        'event': 'run_completed',
        'run_id': run_id,
        'summary': report['summary'],
        'budget': report['budget'],
        'elapsed_seconds': report['elapsed_seconds'],
        'decisions': [
            {
                'id': result['id'],
                'content_sha256': result['content_sha256'],
                'verdict': result['verdict'],
                'deciding_stage': result['deciding_stage'],
                'reason': result['reason'],
                'stages': result['stages'],
            }
            for result in results
        ],
    })
    return report


def load_calibration_dataset(path: Path) -> tuple[list[Item], dict[str, dict[str, Any]]]:
    items: list[Item] = []
    truth: dict[str, dict[str, Any]] = {}
    for line_number, raw_line in enumerate(
        path.read_text(encoding='utf-8').splitlines(), start=1
    ):
        if not raw_line.strip():
            continue
        try:
            value = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise ControlError(
                f'jeu de calibration JSONL invalide ligne {line_number}'
            ) from error
        identifier = value.get('id')
        content = value.get('content')
        expected = value.get('truth')
        if (
            not isinstance(identifier, str)
            or not isinstance(content, str)
            or expected not in VERDICTS
        ):
            raise ControlError(
                f'jeu de calibration incomplet ligne {line_number}'
            )
        if identifier in truth:
            raise ControlError(
                f'identifiant de calibration dupliqué ligne {line_number} : '
                f'{identifier}'
            )
        raw = content.encode('utf-8')
        items.append(item_from_bytes(identifier, str(path), raw))
        truth[identifier] = {
            'truth': expected,
            'authority': value.get('authority', 'non précisée'),
            'domain': value.get('domain', 'général'),
        }
    if not items:
        raise ControlError('jeu de calibration vide')
    return items, truth


def calibration_metrics(
    report: dict[str, Any],
    truth: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    comparisons: list[dict[str, Any]] = []
    for item in report['items']:
        identifier = item['id']
        stage1 = item['stages']['1']
        stage2 = item['stages']['2']
        stage1_completed = stage1.get('status', 'completed') == 'completed'
        stage2_completed = stage2.get('status', 'completed') == 'completed'
        expected_issue = truth[identifier]['truth'] != 'OK'
        stage1_issue = stage1.get('verdict') == 'À REGARDER'
        stage2_issue = stage2.get('verdict') == 'À REGARDER'
        comparisons.append({
            'id': identifier,
            'truth': truth[identifier]['truth'],
            'authority': truth[identifier]['authority'],
            'domain': truth[identifier]['domain'],
            'stage1': stage1.get('verdict'),
            'stage2': stage2.get('verdict'),
            'stage1_status': stage1.get('status', 'completed'),
            'stage2_status': stage2.get('status', 'completed'),
            'models_agree': (
                stage1.get('verdict') == stage2.get('verdict')
                if stage1_completed and stage2_completed else None
            ),
            'stage1_correct': (
                stage1_issue == expected_issue if stage1_completed else None
            ),
            'stage2_correct': (
                stage2_issue == expected_issue if stage2_completed else None
            ),
            'stage1_false_positive': (
                stage1_issue and not expected_issue
                if stage1_completed else None
            ),
            'stage2_false_positive': (
                stage2_issue and not expected_issue
                if stage2_completed else None
            ),
            'stage1_false_negative': (
                not stage1_issue and expected_issue
                if stage1_completed else None
            ),
            'stage2_false_negative': (
                not stage2_issue and expected_issue
                if stage2_completed else None
            ),
        })
    count = len(comparisons)

    def count_true(field: str) -> int:
        return sum(value[field] is True for value in comparisons)

    stage1_evaluated = sum(
        value['stage1_correct'] is not None for value in comparisons
    )
    stage2_evaluated = sum(
        value['stage2_correct'] is not None for value in comparisons
    )
    jointly_evaluated = sum(
        value['models_agree'] is not None for value in comparisons
    )

    stage1_wins = [
        value['id'] for value in comparisons
        if value['stage1_correct'] is True
        and value['stage2_correct'] is False
    ]
    stage2_wins = [
        value['id'] for value in comparisons
        if value['stage2_correct'] is True
        and value['stage1_correct'] is False
    ]
    return {
        'sample_count': count,
        'jointly_evaluated_count': jointly_evaluated,
        'agreement_rate': (
            count_true('models_agree') / jointly_evaluated
            if jointly_evaluated else None
        ),
        'stage1': {
            'evaluated_count': stage1_evaluated,
            'accuracy': (
                count_true('stage1_correct') / stage1_evaluated
                if stage1_evaluated else None
            ),
            'false_positives': count_true('stage1_false_positive'),
            'false_negatives': count_true('stage1_false_negative'),
        },
        'stage2': {
            'evaluated_count': stage2_evaluated,
            'accuracy': (
                count_true('stage2_correct') / stage2_evaluated
                if stage2_evaluated else None
            ),
            'false_positives': count_true('stage2_false_positive'),
            'false_negatives': count_true('stage2_false_negative'),
        },
        'authority_on_disagreements': {
            'stage1_correct_ids': stage1_wins,
            'stage2_correct_ids': stage2_wins,
            'human_or_deterministic_truth': [
                {
                    'id': value['id'],
                    'authority': value['authority'],
                    'domain': value['domain'],
                }
                for value in comparisons
                if value['models_agree'] is False
            ],
        },
        'items': comparisons,
    }


def parse_stage_budgets(
    total_budget: float,
    values: Sequence[str],
) -> dict[int, float]:
    budgets = {1: total_budget, 2: total_budget, 3: total_budget}
    for value in values:
        key, separator, raw_amount = value.partition('=')
        if not separator or key not in ('1', '2', '3'):
            raise ControlError(
                f'budget d’étage invalide {value!r}, attendu ETAGE=MONTANT'
            )
        try:
            amount = float(raw_amount)
        except ValueError as error:
            raise ControlError(f'budget invalide : {value!r}') from error
        if not math.isfinite(amount) or amount < 0 or amount > total_budget:
            raise ControlError(
                f'budget étage {key} hors plafond total : ${amount}'
            )
        budgets[int(key)] = amount
    return budgets


def parse_stages(value: str) -> set[int]:
    try:
        stages = {int(item.strip()) for item in value.split(',') if item.strip()}
    except ValueError as error:
        raise argparse.ArgumentTypeError('étages attendus : 0,1,2,3') from error
    if not stages.issubset({0, 1, 2, 3}):
        raise argparse.ArgumentTypeError(
            'seuls les étages 0,1,2,3 sont configurables; le verrou 4 est permanent'
        )
    return stages


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='chaine-controle',
        description='Juge et annote un contenu sans jamais le corriger.',
    )
    parser.add_argument('cible', help='fichier, dossier, JSONL de calibration ou -')
    parser.add_argument(
        '--type',
        required=True,
        choices=('texte', 'code', 'traduction'),
        dest='content_type',
    )
    parser.add_argument('--strict', action='store_true')
    parser.add_argument(
        '--budget',
        type=float,
        default=0.0,
        help='plafond dur total en USD; 0 interdit tout modèle payant',
    )
    parser.add_argument(
        '--budget-etage',
        action='append',
        default=[],
        metavar='ETAGE=USD',
        help='plafond dur supplémentaire pour un étage (répétable)',
    )
    parser.add_argument(
        '--etages',
        type=parse_stages,
        default={0, 1, 2, 3},
        help='liste parmi 0,1,2,3; le verrou humain 4 reste toujours actif',
    )
    parser.add_argument('--passes-detection', type=int, default=2)
    parser.add_argument('--modele-detection', default=DEFAULT_STAGE1_MODEL)
    parser.add_argument(
        '--verificateur',
        choices=('openrouter', 'agy', 'ollama'),
        default='openrouter',
    )
    parser.add_argument('--modele-verification')
    parser.add_argument('--modele-arbitrage', default=DEFAULT_STAGE3_MODEL)
    parser.add_argument('--registre', type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument('--journal', type=Path, default=DEFAULT_JOURNAL)
    parser.add_argument('--sortie', type=Path)
    parser.add_argument('--calibrate', action='store_true')
    parser.add_argument(
        '--verdict-humain',
        choices=('OK', 'REJET'),
        help='enregistre le verdict pour une cible fichier unique',
    )
    parser.add_argument('--raison', default='')
    parser.add_argument('--auteur', default='Patrice')
    parser.add_argument(
        '--check-command',
        action='append',
        default=[],
        help='commande déterministe de test/lint; un échec produit REJET',
    )
    parser.add_argument(
        '--gate',
        action='store_true',
        help='retourne 1 si au moins un REJET est produit',
    )
    parser.add_argument('--version', action='version', version=VERSION)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not math.isfinite(args.budget) or args.budget < 0:
        parser.error('--budget doit être fini et positif')
    if args.passes_detection < 1:
        parser.error('--passes-detection doit être >= 1')
    try:
        ensure_auxiliary_paths_outside_target(
            args.cible,
            (args.registre, args.journal, args.sortie),
        )
        stage_budgets = parse_stage_budgets(args.budget, args.budget_etage)
        ledger = BudgetLedger(args.budget, stage_budgets)
        journal = JsonlJournal(args.journal)
        registry = HumanVerdictRegistry(args.registre)
        registry_entries = registry.load()
        truth: dict[str, dict[str, Any]] | None = None
        if args.calibrate:
            items, truth = load_calibration_dataset(
                Path(args.cible).expanduser()
            )
            enabled_stages = {1, 2}
        else:
            items = collect_items(args.cible, args.content_type)
            enabled_stages = set(args.etages)
        journal.write({
            'event': 'run_started',
            'target': args.cible,
            'content_type': args.content_type,
            'enabled_stages': sorted(enabled_stages),
            'strict': args.strict,
            'budget': ledger.snapshot(),
            'registry': str(args.registre.expanduser()),
        })

        if args.verdict_humain:
            if args.calibrate or len(items) != 1:
                raise ControlError(
                    '--verdict-humain exige une cible fichier unique hors calibration'
                )
            if not args.raison.strip():
                raise ControlError('--raison est obligatoire avec --verdict-humain')
            entry = registry.append(
                items[0],
                args.verdict_humain,
                args.raison,
                args.content_type,
                args.auteur,
            )
            registry_entries[items[0].content_sha256] = entry
            journal.write({
                'event': 'human_verdict_recorded',
                'content_sha256': items[0].content_sha256,
                'verdict': args.verdict_humain,
                'author': args.auteur,
            })

        command_decision = (
            execute_check_commands(args.check_command, args.cible, journal)
            if 0 in enabled_stages
            else None
        )
        verification_model = args.modele_verification or {
            'openrouter': DEFAULT_STAGE2_MODEL,
            'agy': DEFAULT_STAGE2_AGY_MODEL,
            'ollama': DEFAULT_STAGE2_OLLAMA_MODEL,
        }[args.verificateur]
        report = execute_chain(
            items=items,
            content_type=args.content_type,
            strict=args.strict,
            enabled_stages=enabled_stages,
            stage1_passes=args.passes_detection,
            stage1_model=args.modele_detection,
            stage2_provider=args.verificateur,
            stage2_model=verification_model,
            stage3_model=args.modele_arbitrage,
            registry_entries=registry_entries,
            ledger=ledger,
            journal=journal,
            command_decision=command_decision,
        )
        if truth is not None:
            report['calibration'] = calibration_metrics(report, truth)
        rendered = json.dumps(report, ensure_ascii=False, indent=2)
        if args.sortie:
            args.sortie.parent.mkdir(parents=True, exist_ok=True)
            args.sortie.write_text(rendered + '\n', encoding='utf-8')
        print(rendered)
        if args.gate and report['summary']['REJET']:
            return 1
        return 0
    except (ControlError, OSError, subprocess.SubprocessError) as error:
        print(
            json.dumps({
                'tool': 'chaine-controle',
                'status': 'error',
                'error': str(error),
            }, ensure_ascii=False),
            file=sys.stderr,
        )
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

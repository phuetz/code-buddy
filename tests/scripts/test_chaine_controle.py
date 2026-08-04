"""Tests des invariants purs de la chaîne de contrôle."""

from __future__ import annotations

import importlib.util
import inspect
import json
from pathlib import Path
import subprocess
import sys
from unittest import mock

import pytest
from scripts import claude_forfait


SCRIPT = (
    Path(__file__).resolve().parents[2]
    / 'scripts'
    / 'chaine-controle.py'
)
SPEC = importlib.util.spec_from_file_location('chaine_controle', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
chaine = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = chaine
SPEC.loader.exec_module(chaine)


def decision(
    verdict: str,
    stage: int,
    *,
    status: str = 'completed',
    reason: str = 'constat',
):
    return chaine.StageDecision(
        verdict=verdict,
        reasons=(reason,),
        stage=stage,
        actor=f'étage-{stage}',
        status=status,
    )


def test_disagreement_alone_triggers_arbitration() -> None:
    assert chaine.needs_arbitration(
        decision('OK', 1),
        decision('À REGARDER', 2),
    )
    assert not chaine.needs_arbitration(
        decision('À REGARDER', 1),
        decision('À REGARDER', 2),
    )
    assert not chaine.needs_arbitration(
        decision('OK', 1, status='error'),
        decision('À REGARDER', 2),
    )


def test_successful_arbitration_replaces_both_ai_opinions() -> None:
    selected = chaine.decisions_after_arbitration(
        decision('À REGARDER', 1),
        decision('OK', 2),
        decision('OK', 3, reason='faux positif levé'),
    )
    assert len(selected) == 1
    assert selected[0].stage == 3
    verdict, stage, _ = chaine.aggregate_verdicts(
        decision('OK', 0),
        selected,
    )
    assert verdict == 'OK'
    assert stage == 3


def test_failed_arbitration_keeps_disagreement_visible() -> None:
    selected = chaine.decisions_after_arbitration(
        decision('À REGARDER', 1),
        decision('OK', 2),
        decision('À REGARDER', 3, status='budget_exhausted'),
    )
    verdict, _, reason = chaine.aggregate_verdicts(
        decision('OK', 0),
        selected,
    )
    assert verdict == 'À REGARDER'
    assert 'incomplet' in reason


def test_ai_rejection_is_always_downgraded() -> None:
    assert chaine.normalize_verdict('REJET', ai=True) == 'À REGARDER'


def test_ai_review_without_reason_cannot_silently_become_ok() -> None:
    verdict, stage, reason = chaine.aggregate_verdicts(
        decision('OK', 0),
        [
            chaine.StageDecision(
                verdict='À REGARDER',
                reasons=(),
                stage=1,
                actor='modèle',
            )
        ],
    )
    assert verdict == 'À REGARDER'
    assert stage == 1
    assert 'demande une vérification' in reason


def test_aggregation_only_deterministic_can_reject_without_human() -> None:
    verdict, stage, _ = chaine.aggregate_verdicts(
        decision('REJET', 0, reason='syntaxe invalide'),
        [decision('OK', 1), decision('OK', 2)],
    )
    assert verdict == 'REJET'
    assert stage == 0

    verdict, stage, _ = chaine.aggregate_verdicts(
        decision('OK', 0),
        [decision('REJET', 1, reason='avis modèle')],
    )
    assert verdict == 'À REGARDER'
    assert stage == 1


def test_human_approval_dominates_even_a_deterministic_rejection() -> None:
    human = {'verdict': 'OK', 'reason': 'validé par Patrice'}
    verdict, stage, reason = chaine.aggregate_verdicts(
        decision('REJET', 0, reason='conflit certain'),
        [decision('REJET', 1), decision('REJET', 2)],
        human,
    )
    assert verdict == 'OK'
    assert stage == 4
    assert 'Patrice' in reason


def test_human_rejection_is_definitive() -> None:
    human = {'verdict': 'REJET', 'reason': 'contresens confirmé'}
    verdict, stage, _ = chaine.aggregate_verdicts(
        decision('OK', 0),
        [decision('OK', 1), decision('OK', 2)],
        human,
    )
    assert verdict == 'REJET'
    assert stage == 4


def test_human_locked_content_never_reaches_ai_and_never_rejects(
    tmp_path: Path,
) -> None:
    raw = b'<<<<<<< ours\ncontenu\n=======\nautre\n>>>>>>> theirs\n'
    item = chaine.item_from_bytes('verrouille', 'fixture.md', raw)
    human = {
        'verdict': 'OK',
        'reason': 'forme volontaire validée par Patrice',
        'content_sha256': item.content_sha256,
    }
    report = chaine.execute_chain(
        items=[item],
        content_type='texte',
        strict=True,
        enabled_stages={0, 1, 2, 3},
        stage1_passes=2,
        stage1_model=chaine.DEFAULT_STAGE1_MODEL,
        stage2_provider='openrouter',
        stage2_model=chaine.DEFAULT_STAGE2_MODEL,
        stage3_model=chaine.DEFAULT_STAGE3_MODEL,
        registry_entries={item.content_sha256: human},
        ledger=chaine.BudgetLedger(0.0, {1: 0.0, 2: 0.0, 3: 0.0}),
        journal=chaine.JsonlJournal(tmp_path / 'journal.jsonl'),
    )
    result = report['items'][0]
    assert result['stages']['0']['verdict'] == 'REJET'
    assert result['stages']['1']['status'] == 'skipped_human_lock'
    assert result['stages']['2']['status'] == 'skipped_human_lock'
    assert result['verdict'] == 'OK'
    assert report['summary']['REJET'] == 0
    assert report['budget']['total_spent_usd'] == 0.0


def test_registry_roundtrip_and_latest_verdict_wins(tmp_path: Path) -> None:
    registry = chaine.HumanVerdictRegistry(tmp_path / 'verdicts.jsonl')
    item = chaine.item_from_bytes('x', 'x.txt', b'contenu')
    registry.append(item, 'REJET', 'premier avis', 'texte')
    registry.append(item, 'OK', 'validation finale', 'texte')
    loaded = registry.load()
    assert loaded[item.content_sha256]['verdict'] == 'OK'
    assert loaded[item.content_sha256]['reason'] == 'validation finale'


def test_corrupt_registry_fails_closed_before_ai(tmp_path: Path) -> None:
    path = tmp_path / 'verdicts.jsonl'
    path.write_text('{pas du json}\n', encoding='utf-8')
    with pytest.raises(chaine.ControlError, match='IA interdite'):
        chaine.HumanVerdictRegistry(path).load()


def test_registry_entry_without_reason_fails_closed(tmp_path: Path) -> None:
    path = tmp_path / 'verdicts.jsonl'
    path.write_text(
        '{"content_sha256":"' + 'a' * 64 + '","verdict":"OK"}\n',
        encoding='utf-8',
    )
    with pytest.raises(chaine.ControlError, match='IA interdite'):
        chaine.HumanVerdictRegistry(path).load()


def test_budget_authorization_and_hard_stage_cap() -> None:
    ledger = chaine.BudgetLedger(
        total_limit_usd=0.10,
        stage_limits_usd={1: 0.03, 2: 0.0, 3: 0.08},
    )
    ledger.authorize(1, 0.02)
    ledger.record(1, 0.015)
    assert ledger.remaining(1) == pytest.approx(0.015)
    with pytest.raises(chaine.BudgetError):
        ledger.authorize(1, 0.016)
    ledger.authorize(3, 0.08)
    ledger.record(3, 0.08)
    assert ledger.total_spent_usd == pytest.approx(0.095)
    with pytest.raises(chaine.BudgetError):
        ledger.authorize(3, 0.001)


def test_zero_budget_allows_free_model_but_not_paid_model() -> None:
    ledger = chaine.BudgetLedger(0.0, {1: 0.0, 2: 0.0, 3: 0.0})
    ledger.authorize(2, 0.0)
    with pytest.raises(chaine.BudgetError):
        ledger.authorize(1, 0.000001)


def test_non_finite_budget_and_usage_are_rejected() -> None:
    with pytest.raises(ValueError):
        chaine.BudgetLedger(float('nan'), {1: 0.0})
    ledger = chaine.BudgetLedger(1.0, {1: 1.0})
    with pytest.raises(chaine.BudgetError):
        ledger.record(1, float('nan'))


def test_maximum_cost_is_conservative_and_includes_output() -> None:
    cost = chaine.maximum_openrouter_cost(
        'é' * 100,
        max_tokens=1000,
        input_usd_per_mtok=1.0,
        output_usd_per_mtok=2.0,
    )
    expected = (200 + 4096) / 1_000_000 + 2000 / 1_000_000
    assert cost == pytest.approx(expected)


def test_maximum_cost_includes_hidden_reasoning_tokens() -> None:
    cost = chaine.maximum_openrouter_cost(
        'x',
        max_tokens=1000,
        input_usd_per_mtok=0.0,
        output_usd_per_mtok=1.0,
        reasoning_max_tokens=2500,
    )
    assert cost == pytest.approx(0.0035)


def test_stage2_api_cannot_receive_stage1_verdict() -> None:
    parameters = inspect.signature(chaine.run_stage2_blind).parameters
    assert 'stage1' not in parameters
    assert 'stage1_results' not in parameters


def test_stage3_defaults_to_claude_forfait() -> None:
    args = chaine.build_parser().parse_args(['x.txt', '--type', 'texte'])
    assert args.arbitre == 'claude-forfait'


def test_claude_forfait_retries_once_and_counts_each_invocation() -> None:
    events: list[dict] = []
    runner = claude_forfait.ClaudeForfaitRunner(
        max_calls=3,
        min_interval_seconds=0,
        event_sink=events.append,
    )
    responses = [
        subprocess.CompletedProcess([], 1, '', 'erreur temporaire'),
        subprocess.CompletedProcess([], 0, '{"items": []}', ''),
    ]
    with mock.patch.object(
        claude_forfait.subprocess, 'run', side_effect=responses
    ) as mocked:
        result = runner.run('prompt', label='test')
    assert result.content == '{"items": []}'
    assert mocked.call_count == 2
    assert runner.calls_started == 2
    assert runner.calls_succeeded == 1
    assert sum(
        event.get('event') == 'claude_forfait_call_started'
        for event in events
    ) == 2


def test_claude_quota_is_not_retried_and_large_prompt_uses_tempfile() -> None:
    events: list[dict] = []
    runner = claude_forfait.ClaudeForfaitRunner(
        max_calls=2,
        min_interval_seconds=0,
        large_prompt_chars=1,
        event_sink=events.append,
    )
    response = subprocess.CompletedProcess(
        [], 1, '', "You've hit your usage limit; resets in 1 hour"
    )
    with mock.patch.object(
        claude_forfait.subprocess, 'run', return_value=response
    ) as mocked:
        with pytest.raises(claude_forfait.ClaudeQuotaError):
            runner.run('prompt volumineux', label='quota')
    assert mocked.call_count == 1
    assert mocked.call_args.kwargs['stdin'] is not None
    assert any(
        event.get('prompt_transport') == 'temporary_file_stdin'
        for event in events
    )


def test_claude_local_call_cap_stops_cleanly() -> None:
    runner = claude_forfait.ClaudeForfaitRunner(
        max_calls=1,
        min_interval_seconds=0,
    )
    response = subprocess.CompletedProcess([], 0, '{}', '')
    with mock.patch.object(
        claude_forfait.subprocess, 'run', return_value=response
    ):
        runner.run('premier', label='one')
        with pytest.raises(claude_forfait.ClaudeCallLimitReached):
            runner.run('second', label='two')


def test_stage3_claude_quota_falls_back_to_warned_qwen(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    item = chaine.item_from_bytes('x', 'x.txt', b'contenu')
    stage1 = decision('OK', 1)
    stage2 = decision('À REGARDER', 2)
    runner = mock.Mock()
    runner.run.side_effect = chaine.ClaudeQuotaError('quota')
    response = json.dumps({
        'items': [{'id': 'x', 'verdict': 'OK', 'reasons': ['arbitré']}],
    })
    with mock.patch.object(
        chaine,
        'openrouter_chat',
        return_value=(response, 0.001, 0.5, {'cost': 0.001}),
    ) as fallback:
        results = chaine.run_stage3(
            [(item, stage1, stage2)],
            'texte',
            False,
            'claude-forfait',
            'opus',
            'secret',
            chaine.BudgetLedger(1.0, {3: 1.0}),
            chaine.JsonlJournal(tmp_path / 'journal.jsonl'),
            runner,
        )
    assert results['x'].status == 'completed'
    assert chaine.DEFAULT_STAGE3_FALLBACK_MODEL in results['x'].actor
    assert 'PAYANT' in capsys.readouterr().err
    assert fallback.call_args.kwargs['model'] == chaine.DEFAULT_STAGE3_FALLBACK_MODEL


def test_truncation_never_cuts_utf8_as_an_input_error() -> None:
    raw = b'x' * (chaine.MAX_ITEM_BYTES - 1) + '€'.encode() + b'end'
    item = chaine.item_from_bytes('large', 'large.txt', raw)
    assert item.truncated
    assert item.content.endswith('x')
    assert item.content_sha256 == chaine.sha256_bytes(raw)


def test_output_and_journal_cannot_be_written_inside_target(
    tmp_path: Path,
) -> None:
    target = tmp_path / 'target'
    target.mkdir()
    with pytest.raises(chaine.ControlError, match='chemin auxiliaire'):
        chaine.ensure_auxiliary_paths_outside_target(
            str(target),
            (target / 'rapport.json',),
        )
    chaine.ensure_auxiliary_paths_outside_target(
        str(target),
        (tmp_path / 'outside.json',),
    )


def test_deterministic_invalid_python_rejects() -> None:
    item = chaine.item_from_bytes('bad.py', 'bad.py', b'def broken(:\n')
    result = chaine.deterministic_audit(item, 'code', strict=False)
    assert result.verdict == 'REJET'
    assert any('syntaxe invalide' in reason for reason in result.reasons)


def test_translation_placeholders_are_deterministic_rejections() -> None:
    item = chaine.item_from_bytes(
        'translation',
        'translation.txt',
        (
            'SOURCE : Bonjour {customer}, voir https://example.test/a\n'
            'TRADUCTION : Hello customer, see https://example.test/b\n'
        ).encode(),
    )
    result = chaine.deterministic_audit(
        item,
        'traduction',
        strict=False,
    )
    assert result.verdict == 'REJET'
    assert any('placeholder' in reason for reason in result.reasons)


def test_translation_number_difference_is_review_not_rejection() -> None:
    item = chaine.item_from_bytes(
        'translation',
        'translation.txt',
        b'SOURCE : 18 pieces\nTRADUCTION : 80 parts\n',
    )
    result = chaine.deterministic_audit(
        item,
        'traduction',
        strict=False,
    )
    assert result.verdict == 'À REGARDER'
    assert any('nombres différents' in reason for reason in result.reasons)


def test_calibration_metrics_counts_false_positives_and_authority() -> None:
    report = {
        'items': [
            {
                'id': 'ok',
                'stages': {
                    '1': {'verdict': 'À REGARDER'},
                    '2': {'verdict': 'OK'},
                },
            },
            {
                'id': 'issue',
                'stages': {
                    '1': {'verdict': 'OK'},
                    '2': {'verdict': 'À REGARDER'},
                },
            },
        ]
    }
    truth = {
        'ok': {'truth': 'OK', 'authority': 'humain', 'domain': 'style'},
        'issue': {
            'truth': 'À REGARDER',
            'authority': 'déterministe',
            'domain': 'syntaxe',
        },
    }
    metrics = chaine.calibration_metrics(report, truth)
    assert metrics['agreement_rate'] == 0.0
    assert metrics['stage1']['false_positives'] == 1
    assert metrics['stage1']['false_negatives'] == 1
    assert metrics['stage2']['accuracy'] == 1.0
    assert metrics['authority_on_disagreements']['stage2_correct_ids'] == [
        'ok',
        'issue',
    ]


def test_calibration_excludes_incomplete_stages() -> None:
    report = {
        'items': [
            {
                'id': 'x',
                'stages': {
                    '1': {'verdict': 'À REGARDER', 'status': 'error'},
                    '2': {'verdict': 'OK', 'status': 'completed'},
                },
            },
        ]
    }
    truth = {
        'x': {'truth': 'OK', 'authority': 'humain', 'domain': 'style'},
    }
    metrics = chaine.calibration_metrics(report, truth)
    assert metrics['jointly_evaluated_count'] == 0
    assert metrics['agreement_rate'] is None
    assert metrics['stage1']['evaluated_count'] == 0
    assert metrics['stage1']['accuracy'] is None
    assert metrics['stage2']['accuracy'] == 1.0

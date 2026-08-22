"""Tests ciblés du batch quotidien Flow Agent."""

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT = (
    Path(__file__).resolve().parents[3]
    / 'scripts'
    / 'influencer'
    / 'flow-daily.py'
)
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location('flow_daily', SCRIPT)
assert SPEC and SPEC.loader
flow_daily = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = flow_daily
SPEC.loader.exec_module(flow_daily)


class FlowDailyTest(unittest.TestCase):
    def test_budget_keeps_the_unspendable_remainder(self) -> None:
        self.assertEqual(flow_daily.compute_plan_target(84, 75, 9), 5)
        self.assertEqual(flow_daily.compute_plan_target(50, 50, 0), 3)
        self.assertEqual(flow_daily.compute_plan_target(14, 50, 0), 0)

    def test_resume_target_uses_live_balance_and_existing_successes(self) -> None:
        self.assertEqual(
            flow_daily.compute_run_target(
                balance=65,
                successes_today=5,
                reserve=0,
                budget=None,
                max_plans=None,
            ),
            9,
        )
        self.assertEqual(
            flow_daily.compute_run_target(
                balance=17,
                successes_today=9,
                reserve=0,
                budget=None,
                max_plans=None,
            ),
            10,
        )
        self.assertEqual(
            flow_daily.compute_run_target(
                balance=65,
                successes_today=5,
                reserve=5,
                budget=30,
                max_plans=8,
            ),
            7,
        )
        self.assertEqual(
            flow_daily.compute_run_target(
                balance=65,
                successes_today=5,
                reserve=0,
                budget=None,
                max_plans=9,
            ),
            9,
        )

    def test_cli_overrides_are_not_hidden_by_defaults(self) -> None:
        defaults = flow_daily.parse_args([])
        explicit = flow_daily.parse_args(
            ['--daily-budget', '60', '--max-plans', '9', '--resume']
        )

        self.assertIsNone(defaults.daily_budget)
        self.assertIsNone(defaults.max_plans)
        self.assertEqual(explicit.daily_budget, 60)
        self.assertEqual(explicit.max_plans, 9)
        self.assertTrue(explicit.resume)

    def test_queue_parser_supports_explicit_and_simple_lines(self) -> None:
        items = flow_daily.parse_queue_text(
            '# File\n'
            '```text\n'
            '- [ ] exemple | 16:9 | Ne pas traiter.\n'
            '```\n'
            '- [ ] demo-diner | 16:9 | Une table pour huit.\n'
            '- [x] déjà-fait | 16:9 | Ignorer.\n'
            '- [ ] Une plaque verticale vide. [9:16]\n'
        )

        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].prompt_id, 'demo-diner')
        self.assertEqual(items[0].ratio, '16:9')
        self.assertEqual(items[1].ratio, '9:16')
        self.assertTrue(items[1].prompt_id.startswith('queue-'))

    def test_mark_queue_item_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'queue.md'
            path.write_text('- [ ] shot-1 | 16:9 | Une ville vide.\n')
            item = flow_daily.parse_queue_text(path.read_text())[0]

            flow_daily.mark_queue_item(path, item)
            flow_daily.mark_queue_item(path, item)

            self.assertEqual(
                path.read_text(),
                '- [x] shot-1 | 16:9 | Une ville vide.\n',
            )

    def test_default_rotation_has_stable_dated_ids(self) -> None:
        state = {'defaultCursor': 0}
        first = flow_daily.default_items(state, 3)
        second = flow_daily.default_items(
            state,
            2,
            exclude={item.prompt_id for item in first},
        )

        self.assertEqual(len(first), 3)
        self.assertEqual(len(second), 2)
        self.assertTrue(all(item.source == 'default' for item in first + second))
        self.assertTrue(
            set(item.prompt_id for item in first).isdisjoint(
                item.prompt_id for item in second
            )
        )


if __name__ == '__main__':
    unittest.main()

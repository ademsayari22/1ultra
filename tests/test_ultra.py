import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / 'scripts' / 'ultra.py'
spec = importlib.util.spec_from_file_location('ultra', MODULE)
ultra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ultra)


class UltraTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ['data', 'context', 'schemas', '.codex/agents', 'simulations']:
            (self.root / name).mkdir(parents=True)
        self.write('data/payments.json', [
            {'id': 'owed', 'mode': 'real', 'status': 'owed', 'amount_minor': None,
             'currency': 'TND', 'receipt_evidence': None},
            {'id': 'cash', 'mode': 'real', 'status': 'received', 'amount_minor': 150125,
             'currency': 'TND', 'receipt_evidence': 'receipt-1'},
        ])
        self.write('data/tasks.json', [
            {'id': 'T1', 'title': 'Get payment details', 'owner': 'Adem',
             'priority': 100, 'status': 'blocked_on_owner', 'phase': 0},
        ])
        self.write('data/leads.json', [])
        self.write('data/budget.json', {'incremental_spend_limit_tnd': 0,
                                       'status': 'provisional', 'live_timeout_seconds': 180})
        self.write('simulations/scenarios.json', [
            {'id': 'messy-pilot', 'mode': 'simulation', 'buyer': 'FICTIONAL',
             'budget_tnd': 300, 'requested_pages': 200, 'offer_limit_pages': 20},
        ])
        self.write('schemas/agent_result.schema.json', {'type': 'object'})
        self.write('data/exclusions.json', {'companies': []})
        (self.root / 'context/FOUNDER.md').write_text('Minimal founder evidence.\n')
        (self.root / 'STATE.md').write_text('Phase 0.\n')
        for role in ['ultra_sales', 'ultra_customer']:
            (self.root / f'.codex/agents/{role}.toml').write_text(
                f'name = "{role}"\ndescription = "Test role"\n'
                'developer_instructions = "Return a draft."\n')

    def write(self, relative, obj):
        (self.root / relative).write_text(json.dumps(obj))

    def records(self):
        return json.loads((self.root / 'data/payments.json').read_text())

    def real_hash_input(self):
        return {p.name: p.read_bytes() for p in (self.root / 'data').glob('*.json')}

    def good_result(self, role='ultra_sales', mode='draft'):
        return {'role': role, 'mode': mode, 'summary': 'A draft for owner review.',
                'evidence': [], 'actions': [{'kind': 'needs_owner', 'text': 'Contact buyer.'}],
                'owner_actions': ['Review the draft.'], 'unknowns': ['Buyer need']}

    def test_received_cash_requires_evidence_and_excludes_simulation(self):
        records = self.records() + [
            {'id': 'fiction', 'mode': 'simulation', 'status': 'received',
             'amount_minor': 9000000, 'currency': 'TND', 'receipt_evidence': 'fake'},
            {'id': 'claim', 'mode': 'real', 'status': 'received',
             'amount_minor': 400000, 'currency': 'TND', 'receipt_evidence': None},
        ]
        result = ultra.cash_summary(records)
        self.assertIsInstance(result, dict)
        self.assertEqual(result['received_minor'], {'TND': 150125})
        self.assertEqual(result['unknown_owed'], 1)
        self.assertEqual(result['unverified_receipts'], 1)
        self.assertEqual(result['ignored_simulation'], 1)

    def test_duplicate_receipt_cannot_inflate_cash(self):
        duplicated = self.records() + [self.records()[1].copy()]
        with self.assertRaises(ValueError):
            ultra.cash_summary(duplicated)

    def test_daily_actions_exclude_unmet_dependencies(self):
        self.write('data/tasks.json', [
            {'id': 'blocked', 'title': 'Deliver paid job', 'owner': 'Adem',
             'priority': 100, 'status': 'blocked', 'phase': 2, 'depends_on': ['ready']},
            {'id': 'ready', 'title': 'Select opening offer', 'owner': 'Adem',
             'priority': 80, 'status': 'todo', 'phase': 0, 'depends_on': []},
        ])
        brief = (ultra.prepare(self.root) / 'brief.md').read_text()
        actions = brief.split('## Next actions (up to three)', 1)[1].split('## Blocked / later', 1)[0]
        self.assertIn('Select opening offer', actions)
        self.assertNotIn('Deliver paid job', actions)
        self.assertIn('ready', brief.split('## Blocked / later', 1)[1])

    def test_done_without_evidence_does_not_unlock_follow_on(self):
        self.write('data/tasks.json', [
            {'id': 'prior', 'title': 'Client accepts', 'owner': 'Adem', 'priority': 100,
             'status': 'done', 'phase': 2, 'completion_evidence': None, 'depends_on': []},
            {'id': 'next', 'title': 'Sell recurring service', 'owner': 'Adem', 'priority': 80,
             'status': 'todo', 'phase': 3, 'depends_on': ['prior']},
        ])
        brief = (ultra.prepare(self.root) / 'brief.md').read_text()
        actions = brief.split('## Next actions (up to three)', 1)[1].split('## Blocked / later', 1)[0]
        self.assertNotIn('Sell recurring service', actions)

    def test_separate_currency_totals(self):
        result = ultra.cash_summary(self.records() + [
            {'mode': 'real', 'status': 'received', 'amount_minor': 1250,
             'currency': 'USD', 'receipt_evidence': 'usd-receipt'},
        ])
        self.assertIsInstance(result, dict)
        self.assertEqual(result['received_minor'], {'TND': 150125, 'USD': 1250})

    def test_tnd_fraction_and_unknown_amount(self):
        self.assertEqual(ultra.money(150125, 'TND'), '150.125 TND')
        self.assertEqual(ultra.money(1250, 'USD'), '12.50 USD')
        self.assertEqual(ultra.money(None, 'TND'), 'unknown (TND)')

    def test_invalid_money_is_rejected(self):
        for value in [True, -1, 1.2, '100']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                ultra.money(value, 'TND')
        with self.assertRaises(ValueError):
            ultra.money(100, 'NOT_A_CURRENCY')

    def test_prepare_outputs_brief_without_mutating_real_records(self):
        before = self.real_hash_input()
        folder = ultra.prepare(self.root)
        self.assertIsInstance(folder, Path)
        self.assertTrue((folder / 'brief.md').is_file())
        self.assertIn('Get payment details', (folder / 'brief.md').read_text())
        self.assertEqual(self.real_hash_input(), before)

    def test_simulation_never_updates_real_cash(self):
        before = self.real_hash_input()
        folder = ultra.simulate(self.root, 'messy-pilot')
        self.assertIsInstance(folder, Path)
        scenario = json.loads((folder / 'scenario.json').read_text())
        self.assertEqual(scenario['mode'], 'simulation')
        self.assertTrue((folder / 'role_prompts.md').is_file())
        self.assertEqual(self.real_hash_input(), before)

    def test_unknown_scenario_rejected_before_writes(self):
        with self.assertRaises(ValueError):
            ultra.simulate(self.root, '../../data/payments')
        self.assertFalse((self.root / 'runs').exists())

    def test_dry_agent_does_not_invoke_model(self):
        before = self.real_hash_input()
        def forbidden(*args, **kwargs):
            self.fail('A dry run invoked a model process')
        self.write('data/exclusions.json',{'companies':[]})
        before=self.real_hash_input()
        folder = ultra.agent(self.root, 'ultra_sales', runner=forbidden,judgment_reason='Interpret a novel buyer objection after the template check')
        self.assertIsInstance(folder, Path)
        info = json.loads((folder / 'run.json').read_text())
        self.assertEqual(info['status'], 'dry_run')
        self.assertFalse((folder / 'result.json').exists())
        self.assertEqual(self.real_hash_input(), before)

    def test_optional_execution_returns_draft_with_bounded_command(self):
        before = self.real_hash_input()
        def local_codex(argv, **kwargs):
            self.assertIsInstance(argv, list)
            self.assertFalse(kwargs.get('shell', False))
            self.assertEqual(kwargs['timeout'], 180)
            self.assertEqual(argv[argv.index('--sandbox') + 1], 'read-only')
            self.assertIn('agents.enabled=false', argv)
            out = Path(argv[argv.index('--output-last-message') + 1])
            out.write_text(json.dumps(self.good_result()))
            return subprocess.CompletedProcess(argv, 0, stdout='{}\n', stderr='')
        folder = ultra.agent(self.root, 'ultra_sales', execute=True, judgment_reason="Interpret a novel buyer objection after the template check", runner=local_codex)
        self.assertIsInstance(folder, Path)
        info = json.loads((folder / 'run.json').read_text())
        self.assertEqual(info['status'], 'draft_ready')
        self.assertEqual(self.real_hash_input(), before)

    def test_failed_execution_is_not_recorded_as_success(self):
        before = self.real_hash_input()
        def failed(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 1, stdout='', stderr='Account unavailable')
        with self.assertRaises(RuntimeError):
            ultra.agent(self.root, 'ultra_sales', execute=True, judgment_reason="Interpret a novel buyer objection after the template check", runner=failed)
        runs = list((self.root / 'runs').glob('agent-*'))
        self.assertEqual(len(runs), 1)
        self.assertEqual(json.loads((runs[0] / 'run.json').read_text())['status'], 'failed')
        self.assertEqual(self.real_hash_input(), before)

    def test_invalid_real_or_wrong_role_result_is_rejected(self):
        for result in [self.good_result(mode='real'), self.good_result(role='ultra_customer')]:
            def wrong(argv, **kwargs):
                Path(argv[argv.index('--output-last-message') + 1]).write_text(json.dumps(result))
                return subprocess.CompletedProcess(argv, 0, stdout='', stderr='')
            with self.subTest(result=result), self.assertRaises(RuntimeError):
                ultra.agent(self.root, 'ultra_sales', execute=True, judgment_reason="Interpret a novel buyer objection after the template check", runner=wrong)

    def test_missing_result_is_failure(self):
        def missing(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 0, stdout='', stderr='')
        with self.assertRaises(RuntimeError):
            ultra.agent(self.root, 'ultra_sales', execute=True, judgment_reason="Interpret a novel buyer objection after the template check", runner=missing)

    def test_unknown_role_cannot_escape_project(self):
        with self.assertRaises(ValueError):
            ultra.agent(self.root, '../../data/payments')
        self.assertFalse((self.root / 'runs').exists())

    def test_simulated_customer_requires_fictional_scenario(self):
        with self.assertRaises(ValueError):
            ultra.agent(self.root, 'ultra_customer')

    def test_run_directory_cannot_escape_via_symlink(self):
        with tempfile.TemporaryDirectory() as outside:
            (self.root / 'runs').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                ultra.prepare(self.root)
            self.assertEqual(list(Path(outside).iterdir()), [])


if __name__ == '__main__':
    unittest.main()

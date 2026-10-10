import copy
import datetime
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import automation
import ultra_ui


class BusinessWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.put('tasks', [self.task('F01', 100), self.task('S01', 90), self.task('R01', 80)])
        self.put('budget', {'incremental_spend_limit_tnd': 0, 'status': 'existing_tools_only'})
        self.put('payments', [{'id': 'owed', 'mode': 'real', 'status': 'owed', 'currency': 'TND', 'amount_minor': None}])
        self.put('leads', [{'id': 'a', 'company': 'Example', 'mode': 'real', 'kind': 'service_prospect', 'status': 'discovered', 'contact_sent': False}])
        self.put('exclusions', {'companies': [{'company': 'Blocked'}]})
        self.workspace = ultra_ui.Workspace(self.root, self.root)

    def task(self, id, priority, date=None, minutes=20):
        return {'id': id, 'title': id, 'priority': priority, 'phase': 0, 'owner': 'Adem', 'status': 'todo',
                'depends_on': [], 'completion_evidence': None, 'next_action_on': date, 'timebox_minutes': minutes}

    def put(self, name, value):
        (self.root / f'data/{name}.json').write_text(json.dumps(value))

    def read(self, name):
        return json.loads((self.root / f'data/{name}.json').read_text())

    def update(self, collection, id, body, version=None):
        self.assertTrue(callable(getattr(self.workspace, 'update_record', None)), 'Versioned business record editor missing')
        return self.workspace.update_record(collection, id, body, version or self.workspace.record_version(collection))

    def test_reopening_preserves_prior_evidence_without_xp(self):
        self.workspace.update_task('S01', {'status': 'done', 'completion_evidence': 'source-1', 'owner_confirmed': True}, self.workspace.task_version())
        self.workspace.update_task('S01', {'status': 'in_progress', 'completion_evidence': 'Correction underway'}, self.workspace.task_version())
        task = next(t for t in self.read('tasks') if t['id'] == 'S01')
        self.assertTrue(task.get('history'), 'Reopening discarded the completion history')
        self.assertEqual(task['history'][-1]['before']['completion_evidence'], 'source-1')
        self.assertEqual(task['completion_evidence'], 'Correction underway')
        self.assertEqual(automation.quests.effective_done(self.read('tasks'), real=True), set())

    def test_task_dates_are_editable_and_invalid_dates_do_not_write(self):
        body = {'status': 'todo', 'next_action_on': '2026-10-05', 'timebox_minutes': 15}
        self.workspace.update_task('S01', body, self.workspace.task_version())
        self.assertEqual(self.read('tasks')[1]['next_action_on'], '2026-10-05')
        before = (self.root / 'data/tasks.json').read_bytes()
        with self.assertRaises(ultra_ui.RequestError):
            self.workspace.update_task('S01', {**body, 'next_action_on': '2026-02-30'}, self.workspace.task_version())
        self.assertEqual(before, (self.root / 'data/tasks.json').read_bytes())

    def test_overdue_tasks_precede_high_priority_undated_work(self):
        yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        self.put('tasks', [self.task('future', 100, tomorrow), self.task('undated', 90), self.task('overdue', 10, yesterday)])
        result = automation.next_quests(self.root)
        self.assertEqual([t['id'] for t in result['next']], ['overdue', 'undated'])
        self.assertEqual([t['id'] for t in result['scheduled']], ['future'])

    def test_daily_minutes_limit_selection_and_report_unestimated_work(self):
        self.put('budget', {'daily_minutes': 30})
        self.put('tasks', [self.task('large', 100, minutes=45), self.task('small', 90, minutes=20), self.task('unknown', 80, minutes=None)])
        result = automation.next_quests(self.root)
        self.assertEqual([t['id'] for t in result['next']], ['small'])
        self.assertEqual(result['planned_minutes'], 20)
        self.assertEqual([t['id'] for t in result['unestimated']], ['unknown'])
        self.assertIn('large', [t['id'] for t in result['over_capacity']])

    def test_billing_deferral_preserves_real_task_records(self):
        self.put('budget', {'defer_billing': True})
        before = (self.root / 'data/tasks.json').read_bytes()
        result = automation.next_quests(self.root)
        self.assertNotIn('F01', [t['id'] for t in result['next']])
        self.assertIn('F01', [t['id'] for t in result['deferred']])
        self.assertEqual(before, (self.root / 'data/tasks.json').read_bytes())

    def test_scope_requires_sample_output_and_start_terms(self):
        scope = {'input_permission': True, 'fields': ['id'], 'quantity': 20, 'exceptions': 'Flag ambiguity',
                 'price_minor': 100000, 'currency': 'TND', 'deadline': 'After funded start', 'acceptance': 'Check all rows'}
        result = automation.check_scope(scope)
        self.assertFalse(result['ready'])
        self.assertTrue({'sample_reference', 'output_format', 'payment_terms', 'start_condition'} <= set(result['missing']))
        complete = {**scope, 'sample_reference': 'permitted/sample.csv', 'output_format': 'CSV and exceptions list',
                    'payment_terms': '50% upfront, balance after acceptance', 'start_condition': 'Cleared deposit and written acceptance'}
        self.assertTrue(automation.check_scope(complete)['ready'])

    def test_unknown_payment_can_be_saved_without_billing_fields(self):
        self.update('payments', 'owed', {'description': 'Consulting payment', 'amount_minor': None, 'currency': 'TND', 'status': 'owed'})
        payment = self.read('payments')[0]
        self.assertIsNone(payment['amount_minor'])
        self.assertNotIn('invoice_reference', payment)
        self.assertEqual(automation.ultra.cash_summary(self.read('payments'))['received_minor'], {})

    def test_receipt_requires_owner_confirmation_and_rejects_duplicates(self):
        receipt = {'description': 'Pilot deposit', 'status': 'deposit_received', 'amount_minor': 1250, 'currency': 'TND',
                   'receipt_evidence': 'transfer-123', 'obligation_reference': 'scope-123'}
        with self.assertRaises(ultra_ui.RequestError):
            self.update('payments', None, receipt)
        self.update('payments', None, {**receipt, 'owner_confirmed': True})
        before = (self.root / 'data/payments.json').read_bytes()
        with self.assertRaises(ultra_ui.RequestError):
            self.update('payments', None, {**receipt, 'owner_confirmed': True})
        self.assertEqual(before, (self.root / 'data/payments.json').read_bytes())
        self.assertEqual(automation.ultra.cash_summary(self.read('payments'))['deposit_minor'], {'TND': 1250})

    def test_record_edits_reject_stale_versions(self):
        self.assertTrue(callable(getattr(self.workspace, 'record_version', None)), 'Record version missing')
        version = self.workspace.record_version('leads')
        self.update('leads', 'a', {'notes': 'First note'}, version)
        with self.assertRaises(ultra_ui.RequestError) as error:
            self.update('leads', 'a', {'notes': 'Stale note'}, version)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.read('leads')[0]['notes'], 'First note')

    def test_contact_outcomes_require_evidence_and_do_not_update_quests(self):
        body = {'status': 'contacted', 'contacted_on': datetime.date.today().isoformat()}
        with self.assertRaises(ultra_ui.RequestError):
            self.update('leads', 'a', body)
        tasks = self.read('tasks')
        self.update('leads', 'a', {**body, 'status_evidence': 'Owner call note', 'owner_confirmed': True})
        self.assertTrue(self.read('leads')[0]['contact_sent'])
        self.assertTrue(self.read('leads')[0]['history'])
        self.assertEqual(tasks, self.read('tasks'))

    def test_planning_edits_cannot_authorize_spending(self):
        self.update('budget', None, {'available_hours_this_week': 12.5, 'daily_minutes': 60, 'defer_billing': True})
        with self.assertRaises(ultra_ui.RequestError):
            self.update('budget', None, {'incremental_spend_limit_tnd': 100})
        self.assertEqual(self.read('budget')['incremental_spend_limit_tnd'], 0)

    def test_excluded_and_unknown_companies_cannot_record_positive_progress(self):
        for company in ('Blocked', None):
            with self.subTest(company=company), self.assertRaises(ultra_ui.RequestError):
                self.update('leads', 'a', {'company': company, 'status': 'contacted',
                            'contacted_on': automation.records.local_today().isoformat(),
                            'status_evidence': 'Call note', 'owner_confirmed': True})
        self.assertFalse(self.read('leads')[0]['contact_sent'])

    def test_false_confirmation_does_not_erase_existing_receipt_confirmation(self):
        body = {'status': 'received', 'amount_minor': 1000, 'currency': 'TND', 'receipt_evidence': 'r1', 'owner_confirmed': True}
        result = self.update('payments', None, body)
        self.update('payments', result['record']['id'], {'notes': 'Receipt note', 'owner_confirmed': False})
        receipt = self.read('payments')[-1]
        self.assertTrue(receipt['owner_confirmed'])

    def test_removing_receipt_from_cash_requires_confirmed_correction(self):
        result = self.update('payments', None, {'status': 'received', 'amount_minor': 1000, 'currency': 'TND', 'receipt_evidence': 'r1', 'owner_confirmed': True})
        with self.assertRaises(ultra_ui.RequestError):
            self.update('payments', result['record']['id'], {'status': 'owed'})

    def test_capacity_expires_after_its_recorded_day(self):
        self.put('budget', {'daily_minutes': 0, 'daily_minutes_on': '2026-10-04'})
        self.assertTrue(automation.next_quests(self.root, today='2026-10-05')['next'])

    def test_explicit_zero_capacity_does_not_schedule_unknown_duration(self):
        self.put('budget', {'daily_minutes': 0})
        self.put('tasks', [self.task('unknown', 100, minutes=None)])
        self.assertEqual(automation.next_quests(self.root)['next'], [])

    def test_malformed_payment_status_and_duplicate_ids_fail_record_validation(self):
        self.put('payments', [{'id': 'p', 'mode': 'real', 'status': 'recieved', 'currency': 'TND', 'amount_minor': 5000},
                              {'id': 'p', 'mode': 'real', 'status': 'owed', 'currency': 'TND', 'amount_minor': 5000}])
        result = automation.validate_records(self.root)
        self.assertFalse(result['valid'])
        self.assertTrue(any('status' in error.lower() for error in result['errors']))
        self.assertTrue(any('duplicate' in error.lower() for error in result['errors']))

    def test_due_followups_are_reported_without_sending_or_awarding_xp(self):
        self.put('leads', [{'id': 'a', 'company': 'Example', 'mode': 'real', 'status': 'contacted',
                           'next_action_on': '2026-10-04', 'next_action': 'Ask about the sample'}])
        before = self.read('leads')
        result = automation.next_quests(self.root, today='2026-10-05')
        self.assertEqual(result['follow_ups'][0]['next_action'], 'Ask about the sample')
        self.assertEqual(before, self.read('leads'))

    def test_daily_report_starts_with_actions_and_keeps_details_separate(self):
        self.put('budget', {'defer_billing': True})
        folder = automation.run(self.root, 'daily-pack')
        report = (folder / 'report.md').read_text()
        self.assertIn('## Next actions', report)
        self.assertIn('Billing preparation is deferred', report)
        self.assertNotIn('```json', report)
        self.assertTrue((folder / 'result.json').is_file())
        self.assertEqual(self.read('tasks')[0]['status'], 'todo')

    def test_daily_brief_keeps_deposit_obligations_visible(self):
        self.put('payments', [{'id': 'deposit', 'description': 'Pilot', 'mode': 'real', 'status': 'deposit_received',
                              'amount_minor': 1250, 'currency': 'TND', 'receipt_evidence': 'r1',
                              'obligation_reference': 'scope-1'}])
        folder = automation.run(self.root, 'daily-pack')
        brief = (folder / 'brief.md').read_text()
        self.assertIn('Deposits included in cash', brief)
        self.assertIn('1.250 TND', brief)
        self.assertIn('delivery/refund obligations', brief)


if __name__ == '__main__':
    unittest.main()

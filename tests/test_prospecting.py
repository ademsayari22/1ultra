import csv
import io
import sys
import unittest
import json
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
try:
    import prospecting
except ImportError:
    prospecting = None
import ultra_ui
import records


def lead(**changes):
    return {'id': 'one', 'company': 'Local Tools', 'kind': 'service_prospect', 'country': 'TN',
            'location': 'Sfax', 'source_url': 'https://example.tn', 'checked_date': '2026-10-05',
            'contact_route': 'contact@example.tn', 'observed_fact': 'Publie un catalogue industriel.',
            'status': 'discovered', 'contact_sent': False, 'mode': 'real', **changes}


class ProspectingTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(prospecting, 'The bounded prospecting service is missing')

    def test_country_scope_requires_explicit_tunisian_business_location(self):
        values = [lead(), lead(id='foreign', country='FR', location='Tunis'),
                  lead(id='unknown', country=None), lead(id='job', kind='job_discovery')]
        self.assertEqual([r['id'] for r in prospecting.in_scope(values)], ['one'])

    def test_import_uses_company_country_and_rejects_exclusions_duplicates_and_unknowns(self):
        text = ('Company Name,Company Country,Country,Company City,Website,Email,Industry\n'
                'Fresh,Tunisia,France,Tunis,https://fresh.tn,hello@fresh.tn,Software\n'
                'Fresh,Tunisia,Tunisia,Tunis,https://fresh.tn,other@fresh.tn,Software\n'
                'Local Tools,Tunisia,Tunisia,Sfax,https://example.tn,,Tools\n'
                'Outside,France,Tunisia,Paris,https://out.fr,,Software\n'
                'Unknown,,Tunisia,Tunis,https://unknown.tn,,Software\n'
                'Blocked,Tunisia,Tunisia,Tunis,https://blocked.tn,,Software\n')
        result = prospecting.preview_import(text, [lead()], {'companies': [{'company': 'Blocked'}]}, '2026-10-05')
        self.assertEqual([r['company'] for r in result['accepted']], ['Fresh'])
        self.assertEqual(len(result['rejected']), 5)
        self.assertEqual(result['accepted'][0]['status'], 'discovered')
        self.assertFalse(result['accepted'][0]['contact_sent'])
        self.assertEqual(result['accepted'][0]['country'], 'TN')
        self.assertIn('CSV row 2', result['accepted'][0]['source_reference'])

    def test_import_is_bounded_and_rejects_malformed_input(self):
        for value in ('', 'x,y\na,b', 'Company Name,Company Country\nA,Tunisia,extra'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                prospecting.preview_import(value, [], {}, '2026-10-05')
        with self.assertRaises(ValueError):
            prospecting.preview_import('Company Name,Company Country\n' + 'A,Tunisia\n' * 501, [], {}, '2026-10-05')

    def test_import_handles_null_websites_and_uses_source_url_for_duplicates(self):
        existing = [lead(website=None), lead(id='unknown-source', company='Unknown Source', website=None, source_url=None)]
        text = ('Company Name,Company Country,Website\n'
                'Fresh,Tunisia,https://fresh.tn\n'
                'Other,Tunisia,https://example.tn/\n')
        result = prospecting.preview_import(text, existing, {'companies': []}, '2026-10-11')
        self.assertEqual([row['company'] for row in result['accepted']], ['Fresh'])
        self.assertEqual(result['rejected'], [{'row': 3, 'company': 'Other', 'reason': 'Duplicate company website'}])

    def test_draft_uses_observation_and_small_offer_without_claiming_a_sale(self):
        draft = prospecting.make_draft(lead(), 'catalogue', {}, '2026-10-05')
        self.assertIn('Publie un catalogue industriel.', draft['body'])
        self.assertIn('20', draft['body'])
        self.assertIn('échantillon autorisé', draft['body'])
        self.assertEqual(draft['status'], 'draft')
        self.assertNotIn('99.92', draft['body'])
        for record in (lead(country='FR'), lead(contact_sent=True), lead(company='Blocked')):
            with self.assertRaises(ValueError):
                prospecting.make_draft(record, 'catalogue', {'companies': [{'company': 'Blocked'}]}, '2026-10-05')

    def test_stages_distinguish_preparation_from_buyer_outcomes(self):
        self.assertEqual(prospecting.stage(lead(shortlisted=True)), 'shortlist')
        self.assertEqual(prospecting.stage(lead(draft={'body': 'draft'})), 'pitch')
        self.assertEqual(prospecting.stage(lead(status='contacted', contact_sent=True)), 'contact')
        self.assertEqual(prospecting.stage(lead(status='replied', contact_sent=True)), 'conversation')
        self.assertEqual(prospecting.stage(lead(status='accepted', contact_sent=True)), 'pilot')

    def test_export_is_tunisia_only_and_spreadsheet_safe(self):
        text = prospecting.export_csv([lead(company='=1+1'), lead(id='foreign', country='FR')])
        rows = list(csv.DictReader(io.StringIO(text)))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['company'], "'=1+1")
        self.assertEqual(rows[0]['country'], 'Tunisia')

    def test_offer_choice_is_saved_without_authorizing_spending(self):
        before = {'available_hours_this_week': 30, 'new_purchase_authorized': False}
        value = records.planning_edit(before, {'opening_offer': 'catalogue'})
        self.assertEqual(value['opening_offer'], 'catalogue')
        self.assertFalse(value['new_purchase_authorized'])
        with self.assertRaises(ValueError):
            records.planning_edit(before, {'opening_offer': 'unbounded-automation'})


class ProspectingActionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'data').mkdir()
        for name, value in {'leads': [lead()], 'exclusions': {'companies': []}, 'tasks': [], 'payments': []}.items():
            (self.root / 'data' / (name + '.json')).write_text(json.dumps(value))
        self.workspace = ultra_ui.Workspace(self.root, self.root)

    def act(self, action, body, version=None):
        self.assertTrue(hasattr(self.workspace, 'prospect_action'), 'Guided prospect actions are missing')
        return self.workspace.prospect_action(action, body, version or self.workspace.record_version('leads'))

    def test_shortlist_and_draft_change_no_contact_task_or_cash(self):
        before = (self.root / 'data/tasks.json').read_bytes(), (self.root / 'data/payments.json').read_bytes()
        result = self.act('shortlist', {'id': 'one', 'selected': True})
        self.assertTrue(result['record']['shortlisted'])
        result = self.act('draft', {'id': 'one', 'offer': 'catalogue'})
        self.assertEqual(result['record']['draft']['status'], 'draft')
        self.assertEqual(result['record']['status'], 'discovered')
        self.assertFalse(result['record']['contact_sent'])
        self.assertEqual(len(result['record']['history']), 2)
        self.assertEqual(before, ((self.root / 'data/tasks.json').read_bytes(), (self.root / 'data/payments.json').read_bytes()))

    def test_stale_import_and_shortlist_are_rejected(self):
        version = self.workspace.record_version('leads')
        self.act('shortlist', {'id': 'one', 'selected': True})
        for action, body in [('shortlist', {'id': 'one', 'selected': False}),
                             ('import', {'csv_text': 'Company Name,Company Country\nNew,Tunisia\n'})]:
            with self.subTest(action=action), self.assertRaises(ultra_ui.RequestError) as error:
                self.act(action, body, version)
            self.assertEqual(error.exception.status, 409)

    def test_preview_does_not_mutate_and_commit_retains_source_artifact(self):
        body = {'csv_text': 'Company Name,Company Country,Website,Email\nNew,Tunisia,https://new.tn,info@new.tn\n'}
        before = (self.root / 'data/leads.json').read_bytes()
        result = self.act('preview', body)
        self.assertEqual(len(result['accepted']), 1)
        self.assertEqual((self.root / 'data/leads.json').read_bytes(), before)
        result = self.act('import', body)
        self.assertEqual(result['imported'], 1)
        source = self.root / result['source_path']
        self.assertEqual(source.read_text(), body['csv_text'])
        rows = json.loads((self.root / 'data/leads.json').read_text())
        self.assertEqual(rows[-1]['source_reference'], str(source.relative_to(self.root)) + ' · CSV row 2')

    def test_draft_edits_clear_review_and_reject_unsupported_automation(self):
        self.act('draft', {'id': 'one', 'offer': 'catalogue'})
        result = self.act('review-draft', {'id': 'one', 'confirmed': True})
        self.assertTrue(result['record']['draft']['reviewed'])
        result = self.act('draft-edit', {'id': 'one', 'subject': 'Small test', 'body': 'Edited pitch'})
        self.assertFalse(result['record']['draft']['reviewed'])
        for action, body in [('send', {'id': 'one'}), ('draft', {'id': 'one', 'offer': 'catalogue', 'execute': True})]:
            with self.assertRaises(ultra_ui.RequestError):
                self.act(action, body)

    def test_excluded_company_cannot_enter_shortlist_or_export(self):
        (self.root / 'data/exclusions.json').write_text(json.dumps({'companies': [{'company': 'Local Tools'}]}))
        with self.assertRaises(ultra_ui.RequestError):
            self.act('shortlist', {'id': 'one', 'selected': True})
        rows = [lead(shortlisted=True)]
        (self.root / 'data/leads.json').write_text(json.dumps(rows))
        with self.assertRaises(ultra_ui.RequestError):
            self.act('export', {'selected_only': True})


if __name__ == '__main__':
    unittest.main()

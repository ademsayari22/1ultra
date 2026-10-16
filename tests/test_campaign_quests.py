import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import campaign
import records
from ultra_ui import Workspace


class CampaignQuestTests(unittest.TestCase):
    """An owner-confirmed "Send pitch" quest records exactly one real contact event through the worker."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.lead = {'id': 'tn', 'company': 'Local ERP', 'kind': 'service_prospect', 'country': 'TN',
            'mode': 'real', 'status': 'discovered', 'recommended_offer': 'catalogue', 'industry': 'ERP',
            'source_url': 'https://example.tn', 'observed_fact': 'Published ERP services',
            'pitch_hook': 'Votre site présente des services ERP.', 'checked_date': '2026-10-05',
            'contact_route': 'info@example.tn', 'exclusion_check': 'not_excluded', 'source_live_checked': True,
            'draft': {'subject': 'Petit lot', 'body': 'Bonjour, un petit lot de PDF en tableau vérifié ?', 'reviewed': True}}
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead]))
        (self.root / 'data/exclusions.json').write_text('{"companies":[]}')
        self.store = campaign.Campaign(Workspace(self.root, self.root))
        self.key = 'ultra:send:tn:' + campaign.draft_version(self.lead)

    def tearDown(self):
        self.temp.cleanup()

    def sent_events(self):
        return [e for e in self.store.read()['events'] if e['kind'] == 'sent']

    def test_send_quest_records_one_sent_event(self):
        body = {'quest_id': 'q:1', 'key': self.key, 'evidence': '2026-10-16 email to info@example.tn'}
        first = self.store.record_quest_event(body)
        self.assertIs(first['recorded'], True)
        event = first['event']
        self.assertEqual((event['kind'], event['quest_id'], event['confirmed'], event['text']), ('sent', 'q:1', True, 'Petit lot'))
        self.assertEqual(event['evidence'], '2026-10-16 email to info@example.tn')
        self.assertEqual(event['on'], records.local_today().isoformat())
        second = self.store.record_quest_event(body)
        self.assertIs(second['recorded'], False)
        self.assertEqual(second['event']['id'], event['id'])
        self.assertEqual(len(self.sent_events()), 1)

    def test_changed_draft_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'draft changed since you approved it'):
            self.store.record_quest_event({'quest_id': 'q:2', 'key': 'ultra:send:tn:0123456789abcdef', 'evidence': '2026-10-16 email sent'})
        self.assertEqual(self.sent_events(), [])

    def test_short_evidence_bad_key_unknown_lead_are_refused(self):
        bad = [{'quest_id': 'q:3', 'key': self.key, 'evidence': 'sent'},
               {'quest_id': 'q:4', 'key': 'ultra:send:tn', 'evidence': '2026-10-16 email sent'},
               {'quest_id': 'q:5', 'key': 'ultra:pay:tn:0123456789abcdef', 'evidence': '2026-10-16 email sent'},
               {'quest_id': 'q:6', 'key': 'ultra:send:missing:0123456789abcdef', 'evidence': '2026-10-16 email sent'}]
        for body in bad:
            with self.subTest(body=body), self.assertRaises(ValueError):
                self.store.record_quest_event(body)
        self.assertEqual(self.sent_events(), [])

    def test_suppressed_company_is_refused(self):
        self.store.action('event', {'lead_id': 'tn', 'kind': 'do_not_contact', 'on': records.local_today().isoformat(),
            'evidence': 'Asked us not to write again', 'confirmed': True, 'scope': 'company'}, self.store.version())
        with self.assertRaisesRegex(ValueError, '[Ss]uppressed'):
            self.store.record_quest_event({'quest_id': 'q:7', 'key': self.key, 'evidence': '2026-10-16 email to info@example.tn'})
        self.assertEqual(self.sent_events(), [])

    def test_worker_route_records_through_dispatch(self):
        import campaign_rpc
        out = campaign_rpc.dispatch(self.store.workspace, {'route': '/api/hooks/quest-event', 'method': 'POST',
            'body': {'quest_id': 'q:8', 'key': self.key, 'evidence': '2026-10-16 email to info@example.tn'}, 'version': ''})
        self.assertIs(out['recorded'], True)
        self.assertEqual(len(self.sent_events()), 1)

    def test_worker_process_reports_why_a_quest_was_refused(self):
        import subprocess
        request = {'id': 1, 'route': '/api/hooks/quest-event', 'method': 'POST', 'version': '',
                   'body': {'quest_id': 'q:9', 'key': 'ultra:send:tn:0123456789abcdef', 'evidence': '2026-10-16 email sent'}}
        script = Path(__file__).resolve().parents[1] / 'scripts/campaign_rpc.py'
        out = subprocess.run([sys.executable, str(script), '--root', str(self.root), '--once'], input=json.dumps(request) + '\n',
                             capture_output=True, text=True, timeout=60)
        reply = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertEqual(reply['status'], 400)
        self.assertIn('draft changed since you approved it', reply['value']['error'])

    def test_snapshot_lists_draft_versions(self):
        self.assertEqual(self.store.snapshot()['draft_versions'], {'tn': campaign.draft_version(self.lead)})
        self.assertIsNone(campaign.draft_version({**self.lead, 'draft': {}}))


if __name__ == '__main__':
    unittest.main()

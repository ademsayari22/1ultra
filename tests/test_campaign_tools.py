import json
import io
from contextlib import redirect_stdout
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import campaign
import campaign_tools
import campaign_rpc
from ultra_ui import Workspace


class CampaignToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.lead = {'id': 'tn', 'company': 'Local ERP', 'kind': 'service_prospect', 'country': 'TN', 'location': 'Sfax',
            'mode': 'real', 'status': 'discovered', 'recommended_offer': 'catalogue', 'industry': 'ERP',
            'website': 'https://example.tn', 'source_url': 'https://example.tn/services', 'observed_fact': 'Published ERP services',
            'observed_text': 'Nous proposons des services ERP.', 'pitch_hook': 'Votre site présente des services ERP.',
            'checked_date': '2026-10-05', 'contact_route': 'ceo@example.tn; +216 20 000 000', 'exclusion_check': 'not_excluded',
            'source_live_checked': True, 'raw_import': {'Email': 'ceo@example.tn'}, 'history': [{'note': 'private'}]}
        self.foreign = {**self.lead, 'id': 'fr', 'company': 'Paris SA', 'country': 'FR'}
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead, self.foreign]))
        (self.root / 'data/exclusions.json').write_text('{"companies":[]}')
        self.store = campaign.Campaign(Workspace(self.root, self.root))
        self.store.action('contact', {'lead_id': 'tn', 'name': 'Sami Ben Ali', 'role': 'Directeur', 'route': 'email',
            'source_url': 'https://example.tn/equipe', 'checked_on': '2026-10-05', 'relationship': 'none'}, self.store.version())

    def tearDown(self):
        self.temp.cleanup()

    def test_leads_lists_only_tunisian_companies_ranked(self):
        out = campaign_tools.leads(self.store, {})
        self.assertEqual([r['id'] for r in out['leads']], ['tn'])
        row = out['leads'][0]
        self.assertEqual(set(row), {'id', 'company', 'location', 'industry', 'stage', 'score', 'shortlisted', 'suppressed', 'has_draft', 'crew_drafts'})

    def test_packet_never_carries_private_fields(self):
        packet = campaign_tools.packet(self.store, {'id': 'tn'})
        text = json.dumps(packet, ensure_ascii=False)
        for secret in ('ceo@example.tn', '+216 20 000 000', 'Sami Ben Ali', 'raw_import', 'private'):
            self.assertNotIn(secret, text)
        self.assertEqual(set(packet['lead']), set(campaign_tools.PACKET_FIELDS) & set(self.lead) | {'has_contact_route'})
        self.assertIs(packet['lead']['has_contact_route'], True)
        self.assertEqual(packet['contacts'], [{'role': 'Directeur', 'route': 'email', 'source_url': 'https://example.tn/equipe', 'checked_on': '2026-10-05'}])
        self.assertEqual(packet['source_version'], campaign.fingerprint(self.lead))

    def test_packet_refuses_unknown_and_out_of_scope_companies(self):
        with self.assertRaises(ValueError): campaign_tools.packet(self.store, {'id': 'missing'})
        with self.assertRaises(ValueError): campaign_tools.packet(self.store, {'id': 'fr'})

    def test_leads_preserves_ranking_and_filters_before_limit(self):
        other = {**self.lead, 'id': 'tn2', 'company': 'Another Company', 'location': 'Tunis',
                 'industry': 'Retail', 'contact_route': None, 'shortlisted': True}
        (self.root / 'data/leads.json').write_text(json.dumps([other, self.lead, self.foreign]))
        out = campaign_tools.leads(self.store, {'offer': 'catalogue', 'limit': '1'})
        self.assertEqual(out['offer'], 'catalogue')
        self.assertEqual(out['count'], 1)
        self.assertEqual(out['leads'][0]['id'], 'tn')
        self.assertEqual(out['leads'][0]['score'], self.store.snapshot('catalogue')['rankings'][0]['score'])
        for query in ('aNoThEr', 'tUNis', 'rETail'):
            filtered = campaign_tools.leads(self.store, {'query': query, 'limit': 1})
            self.assertEqual([r['id'] for r in filtered['leads']], ['tn2'])
            self.assertEqual(filtered['leads'][0]['stage'], 'shortlist')
            self.assertIs(filtered['leads'][0]['shortlisted'], True)
        self.assertEqual(campaign_tools.leads(self.store, {'query': 'missing'})['count'], 0)

    def test_leads_validates_offer_query_and_limit(self):
        for args in ({'offer': 'missing'}, {'query': 'x' * 101}, {'query': 1},
                     {'limit': 0}, {'limit': 51}, {'limit': 'bad'}, {'limit': 1.5}, {'limit': True}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                campaign_tools.leads(self.store, args)
        for args in ({'query': 'x' * 100}, {'limit': 50}, {'limit': '20'}):
            campaign_tools.leads(self.store, args)
        self.assertEqual(campaign_tools.leads(self.store, {})['offer'], 'documents')

    def test_packet_filters_collections_and_uses_current_reviews_without_writes(self):
        draft = {'subject': 'Pilot', 'body': 'A small checked sample', 'reviewed': True,
                 'reviewed_source_version': 'stale', 'private_notes': 'private'}
        lead = {**self.lead, 'draft': draft}
        (self.root / 'data/leads.json').write_text(json.dumps([lead, self.foreign]))
        self.store.action('signal', {'lead_id': 'tn', 'text': 'Public ERP launch',
            'source_url': 'https://example.tn/news', 'checked_on': '2026-10-05',
            'hypothesis': 'May need catalogue help'}, self.store.version())
        proof = self.store.action('proof', {'lead_id': 'tn', 'offer': 'catalogue'}, self.store.version())['proof']
        self.store.action('review-proof', {'id': proof['id'], 'confirmed': True}, self.store.version())
        self.store.action('event', {'lead_id': 'tn', 'kind': 'do_not_contact', 'on': '2026-10-05',
            'evidence': 'Fixture owner evidence', 'confirmed': True}, self.store.version())
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        packet = campaign_tools.packet(self.store, {'id': 'tn'})
        listing = campaign_tools.leads(self.store, {})['leads'][0]
        self.assertEqual(packet['ranking'], {k: self.store.snapshot()['rankings'][0][k]
                                            for k in ('score', 'factors', 'unknowns')})
        self.assertEqual(packet['signals'], [{'text': 'Public ERP launch', 'source_url': 'https://example.tn/news',
            'checked_on': '2026-10-05', 'hypothesis': 'May need catalogue help'}])
        self.assertEqual(packet['proofs'], [{'id': proof['id'], 'offer': 'catalogue',
                                           'reviewed': True, 'review_current': True}])
        self.assertEqual(packet['draft'], {'subject': 'Pilot', 'body': 'A small checked sample', 'reviewed': False})
        self.assertEqual(packet['crew_drafts'], [])
        self.assertIs(packet['suppressed'], True)
        self.assertIs(listing['suppressed'], True)
        self.assertIs(listing['has_draft'], True)
        self.assertEqual(listing['crew_drafts'], 0)
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_packet_missing_optional_data_and_ranking(self):
        (self.root / 'data/exclusions.json').write_text('{"companies":[{"company":"Local ERP"}]}')
        lead = {k: v for k, v in self.lead.items() if k != 'contact_route'}
        (self.root / 'data/leads.json').write_text(json.dumps([lead]))
        packet = campaign_tools.packet(self.store, {'id': 'tn'})
        self.assertIsNone(packet['ranking'])
        self.assertIsNone(packet['draft'])
        self.assertIs(packet['lead']['has_contact_route'], False)
        self.assertIs(packet['suppressed'], False)

    def test_private_worker_routes_decode_args_and_reject_unknown_company(self):
        workspace = self.store.workspace
        out = campaign_rpc.dispatch(workspace, {'route': '/api/tools/leads?offer=catalogue&query=sFaX&limit=1'})
        self.assertEqual(out, campaign_tools.leads(self.store, {'offer': 'catalogue', 'query': 'sFaX', 'limit': '1'}))
        packet = campaign_rpc.dispatch(workspace, {'route': '/api/tools/lead?id=tn'})
        self.assertEqual(packet, campaign_tools.packet(self.store, {'id': 'tn'}))
        for route in ('/api/tools/lead?id=missing', '/api/tools/lead?id=fr', '/api/tools/leads?limit=51'):
            with self.subTest(route=route), self.assertRaises(ValueError):
                campaign_rpc.dispatch(workspace, {'route': route})

    def test_worker_keeps_its_normal_400_answer_for_tool_value_errors(self):
        request = {'id': 7, 'route': '/api/tools/lead?id=missing', 'method': 'GET', 'body': None, 'version': ''}
        output = io.StringIO()
        with patch.object(sys, 'argv', ['campaign_rpc.py', '--root', str(self.root), '--once']), \
                patch.object(sys, 'stdin', io.StringIO(json.dumps(request) + '\n')), redirect_stdout(output):
            campaign_rpc.main()
        self.assertEqual(json.loads(output.getvalue()), {'id': 7, 'status': 400,
                                                        'value': {'error': 'Invalid campaign request.'}})


if __name__ == '__main__':
    unittest.main()

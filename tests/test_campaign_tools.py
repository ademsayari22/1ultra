import json
import datetime
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
import prospecting
import records
from ultra_ui import Workspace, RequestError


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

    def write_kit(self, text=None):
        (self.root / 'sales').mkdir(exist_ok=True)
        source = Path(__file__).resolve().parents[1] / 'sales/pitch-kit.json'
        (self.root / 'sales/pitch-kit.json').write_text(text if text is not None else source.read_text())

    def test_pitch_kit_serves_adem_facts_offers_and_example(self):
        self.write_kit()
        kit = campaign_tools.pitch_kit(self.store, {})
        self.assertEqual(kit['sender']['fr'], 'Adem Sayari, ingénieur IA et data science, basé à Sousse')
        self.assertEqual([r['id'] for r in kit['references']], ['cour-des-comptes', 'stb'])
        self.assertEqual([o['id'] for o in kit['offers']], ['spreadsheet-cleanup', 'pdf-batch', 'automation'])
        self.assertIn('Objet :', kit['example_email_fr'])
        self.assertNotIn('99.92', json.dumps(kit, ensure_ascii=False))

    def test_pitch_kit_missing_or_malformed_is_a_readable_error(self):
        with self.assertRaisesRegex(ValueError, 'pitch kit'): campaign_tools.pitch_kit(self.store, {})
        self.write_kit('{not json')
        with self.assertRaisesRegex(ValueError, 'pitch kit'): campaign_tools.pitch_kit(self.store, {})

    def test_check_draft_notes_never_block_saving(self):
        body = 'Bonjour, pour 500 DT nous garantissons 99 % de précision en 48h, comme pour nos clients actuels.'
        out = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': body})
        self.assertFalse(out['ok'])
        self.assertEqual({n['rule'] for n in out['notes']}, {'price', 'percentage', 'time_promise', 'guarantee', 'invented_clients'})
        saved = campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'subject': 'Offre', 'body': body}, 'sales')
        self.assertEqual(saved['status'], 'proposed')
        self.assertEqual({n['rule'] for n in saved['notes']}, {'price', 'percentage', 'time_promise', 'guarantee', 'invented_clients'})

    def test_check_draft_claim_notes_describe_mentions_for_adems_review(self):
        cases = [
            ('price', '500 DT', 'Mentions a price (500 DT); Adem usually agrees prices after seeing a sample.'),
            ('percentage', '99 %', 'Mentions a percentage (99 %); source results do not establish accuracy for this company.'),
            ('time_promise', 'en 48h', 'Mentions a delivery timeframe (en 48h); Adem usually agrees delivery dates after reviewing the scope.'),
            ('guarantee', 'garanti', 'Contains guarantee wording (garanti); supporting evidence is for Adem to review.'),
            ('invented_clients', 'nos clients', 'Mentions clients or prior work (nos clients); supporting references are for Adem to review.'),
        ]
        for rule, mention, observation in cases:
            with self.subTest(rule=rule):
                args = {'lead_id': 'tn', 'subject': mention, 'body': 'Bonjour'}
                checked = campaign_tools.check_draft(self.store, args)
                self.assertEqual(checked['notes'], [{'rule': rule, 'text': observation}])
                saved = campaign_tools.save_draft(self.store, args, 'sales')
                self.assertEqual(saved['notes'], checked['notes'])
                self.assertEqual(saved['subject'], mention)
                self.assertEqual(saved['status'], 'proposed')

    def test_check_draft_source_and_exclusion_notes_are_observations(self):
        self.lead.update(exclusion_check=None, checked_date='invalid')
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead]))
        checked = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'})
        self.assertEqual(checked['notes'], [
            {'rule': 'excluded', 'text': "Company exclusion status is unchecked or matches an exclusion; for Adem's review."},
            {'rule': 'stale_source', 'text': "Source observation is missing, invalid or older than 180 days; for Adem's review."},
        ])

    def test_pitch_kit_private_rpc_reads_kit_without_writing_records(self):
        self.write_kit()
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        request = {'id': 11, 'route': '/api/tools/pitch-kit', 'method': 'GET', 'body': None, 'version': ''}
        response = self.rpc_response(request)
        self.assertEqual(response, {'id': 11, 'status': 200,
                                   'value': json.loads((self.root / 'sales/pitch-kit.json').read_text())})
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_pitch_kit_private_rpc_explains_missing_and_invalid_kit(self):
        request = {'id': 12, 'route': '/api/tools/pitch-kit', 'method': 'GET', 'body': None, 'version': ''}
        expected = {'id': 12, 'status': 400,
                    'value': {'error': 'The pitch kit sales/pitch-kit.json is missing or invalid.'}}
        self.assertEqual(self.rpc_response(request), expected)
        self.write_kit('{not json')
        self.assertEqual(self.rpc_response(request), expected)

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
        self.assertEqual(packet['contacts'], [{'role': 'Directeur', 'channel': 'email', 'source_url': 'https://example.tn/equipe', 'checked_on': '2026-10-05'}])
        self.assertEqual(packet['source_version'], campaign.fingerprint(self.lead))

    def test_model_text_redacts_contact_details_without_changing_stored_drafts(self):
        private = 'Sami Ben Ali sami@example.tn +216 20 000 000 https://www.linkedin.com/in/sami'
        lead = {**self.lead, **{key: private for key in
            ('observed_fact', 'observed_text', 'need_hypothesis', 'pitch_hook')},
            'draft': {'subject': private, 'body': private, 'reviewed': False}}
        path = self.root / 'data/leads.json'
        path.write_text(json.dumps([lead, self.foreign], ensure_ascii=False))
        self.store.action('signal', {'lead_id': 'tn', 'text': private, 'hypothesis': private,
            'source_url': 'https://example.tn/news', 'checked_on': '2026-10-05'}, self.store.version())
        campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'subject': private, 'body': private}, 'sales')
        before = {path: path.read_bytes(), self.store.path: self.store.path.read_bytes()}

        packet = campaign_tools.packet(self.store, {'id': 'tn'})
        text = json.dumps(packet, ensure_ascii=False)
        for secret in ('Sami Ben Ali', 'sami@example.tn', '+216 20 000 000', 'https://www.linkedin.com/in/sami'):
            self.assertNotIn(secret, text)
        expected = '[contact] [email] [phone] [profile]'
        for key in ('observed_fact', 'observed_text', 'need_hypothesis', 'pitch_hook'):
            self.assertEqual(packet['lead'][key], expected)
        for row, keys in [(packet['draft'], ('subject', 'body')), (packet['signals'][0], ('text', 'hypothesis')),
                          (packet['crew_drafts'][0], ('subject', 'body'))]:
            for key in keys:
                self.assertEqual(row[key], expected)
        self.assertEqual(before, {p: p.read_bytes() for p in before}, 'stored owner and crew drafts stay byte-identical')

    def test_redaction_covers_list_text_urls_phone_formats_and_company_contact_names(self):
        text = ('sAmI bEn aLi; Sami Ben Alina; sami@example.tn; 20000000; (20) 000-000; '
                '+216 (20) 000.000; https://facebook.com/sami; https://wa.me/21620000000')
        lead = {**self.lead, 'location': text, 'industry': text,
                'source_url': 'https://www.linkedin.com/in/sami'}
        other = {**self.lead, 'id': 'other', 'company': 'Other ERP', 'location': 'Sami Ben Ali'}
        (self.root / 'data/leads.json').write_text(json.dumps([lead, other]))
        before = (self.root / 'data/leads.json').read_bytes()
        expected = '[contact]; Sami Ben Alina; [email]; [phone]; [phone]; [phone]; [profile]; [profile]'
        listing = {row['id']: row for row in campaign_tools.leads(self.store, {})['leads']}
        self.assertEqual(listing['tn']['location'], expected)
        self.assertEqual(listing['tn']['industry'], expected)
        self.assertEqual(listing['other']['location'], 'Sami Ben Ali', 'names belong to their company')
        packet = campaign_tools.packet(self.store, {'id': 'tn'})
        self.assertEqual(packet['lead']['source_url'], '[profile]')
        self.assertTrue(all(row['source_url'] == '[profile]' for row in packet['ranking']['factors']))
        self.assertEqual(packet['lead']['checked_date'], '2026-10-05')
        self.assertEqual(packet['source_version'], campaign.fingerprint(lead))
        self.assertEqual((self.root / 'data/leads.json').read_bytes(), before)

    def test_packet_replaces_private_contact_routes_with_channel_labels(self):
        state = self.store.read()
        state['contacts'] = []
        self.store.path.write_text(json.dumps(state))
        routes = ['sami@example.tn', '+216 20 000 000', 'https://www.linkedin.com/in/sami']
        for route in routes:
            self.store.action('contact', {'lead_id': 'tn', 'name': 'Sami Ben Ali', 'role': 'Directeur',
                'route': route, 'source_url': 'https://example.tn/equipe', 'checked_on': '2026-10-05'},
                self.store.version())
        packet = campaign_tools.packet(self.store, {'id': 'tn'})
        text = json.dumps(packet, ensure_ascii=False)
        for route in routes:
            self.assertNotIn(route, text)
        self.assertEqual([contact['channel'] for contact in packet['contacts']], ['email', 'phone', 'linkedin'])
        for contact in packet['contacts']:
            self.assertEqual(set(contact), {'role', 'channel', 'source_url', 'checked_on'})

    def test_packet_classifies_route_labels_without_echoing_unknown_text(self):
        cases = [('EMAIL', 'email'), ('phone', 'phone'), ('Téléphone', 'phone'), ('TEL', 'phone'),
                 ('+216 (20) 000-000', 'phone'), ('linkedin', 'linkedin'),
                 ('https://example.tn/contact', 'website'), ('http://example.tn', 'website'),
                 ('form', 'website'), ('WEBSITE', 'website'), ('Ask Sami privately', 'other')]
        for route, channel in cases:
            self.store.action('contact', {'lead_id': 'tn', 'name': 'Sami', 'route': route,
                'source_url': 'https://example.tn/equipe', 'checked_on': '2026-10-05'}, self.store.version())
        contacts = campaign_tools.packet(self.store, {'id': 'tn'})['contacts'][1:]
        self.assertEqual([contact['channel'] for contact in contacts], [channel for _, channel in cases])
        self.assertTrue(all('route' not in contact for contact in contacts))
        self.assertNotIn('Ask Sami privately', json.dumps(contacts))

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

    def test_packet_refuses_excluded_company(self):
        (self.root / 'data/exclusions.json').write_text('{"companies":[{"company":"Local ERP"}]}')
        self.assertEqual(campaign_tools.leads(self.store, {})['leads'], [])
        with self.assertRaisesRegex(ValueError, r'^Company excluded\.$'):
            campaign_tools.packet(self.store, {'id': 'tn'})

    def test_company_name_exclusion_is_normalized_for_listing_and_packet(self):
        exclusions = {'companies': [{'company': ' LÓCAL-ERP '}]}
        (self.root / 'data/exclusions.json').write_text(json.dumps(exclusions))
        self.assertEqual(campaign_tools.leads(self.store, {}), {'offer': 'documents', 'count': 0, 'leads': []})
        with self.assertRaisesRegex(ValueError, r'^Company excluded\.$'):
            campaign_tools.packet(self.store, {'id': 'tn'})

    def test_company_alias_exclusion_is_normalized_for_listing_and_packet(self):
        exclusions = {'companies': [{'company': 'Parent Company', 'aliases': [' Lócal.E R P ']}]}
        (self.root / 'data/exclusions.json').write_text(json.dumps(exclusions))
        self.assertEqual(campaign_tools.leads(self.store, {}), {'offer': 'documents', 'count': 0, 'leads': []})
        with self.assertRaisesRegex(ValueError, r'^Company excluded\.$'):
            campaign_tools.packet(self.store, {'id': 'tn'})

    def test_unknown_company_is_ineligible_for_listing_and_packet(self):
        lead = {**self.lead, 'company': ' '}
        (self.root / 'data/leads.json').write_text(json.dumps([lead]))
        self.assertEqual(campaign_tools.leads(self.store, {})['leads'], [])
        with self.assertRaisesRegex(ValueError, r'^Unknown or out-of-scope company\.$'):
            campaign_tools.packet(self.store, {'id': 'tn'})

    def test_packet_missing_optional_data(self):
        lead = {k: v for k, v in self.lead.items() if k != 'contact_route'}
        (self.root / 'data/leads.json').write_text(json.dumps([lead]))
        packet = campaign_tools.packet(self.store, {'id': 'tn'})
        self.assertIsNotNone(packet['ranking'])
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

    def rpc_response(self, request):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['campaign_rpc.py', '--root', str(self.root), '--once']), \
                patch.object(sys, 'stdin', io.StringIO(json.dumps(request) + '\n')), redirect_stdout(output):
            campaign_rpc.main()
        return json.loads(output.getvalue())

    def test_worker_returns_deliberate_tool_value_error_in_400_envelope(self):
        request = {'id': 7, 'route': '/api/tools/lead?id=missing', 'method': 'GET', 'body': None, 'version': ''}
        self.assertEqual(self.rpc_response(request), {'id': 7, 'status': 400,
                         'value': {'error': 'Unknown or out-of-scope company.'}})

    def test_worker_explains_foreign_company_refusal_through_complete_rpc_path(self):
        response = self.rpc_response({'id': 8, 'route': '/api/tools/propose-lead', 'method': 'POST',
                                      'body': self.proposal_args(country='France')})
        self.assertEqual((response['id'], response['status']), (8, 400))
        self.assertIn('outside Tunisia', response['value']['error'])

    def test_worker_keeps_unexpected_tool_exceptions_generic(self):
        for error, status, message in [(RuntimeError('private detail'), 500, 'Campaign action failed. Inspect local files before retrying.'),
                                       (KeyError('private detail'), 400, 'Invalid campaign request.'),
                                       (TypeError('private detail'), 400, 'Invalid campaign request.')]:
            with self.subTest(error=type(error).__name__), patch.object(campaign_tools, 'propose_lead', side_effect=error):
                response = self.rpc_response({'id': 9, 'route': '/api/tools/propose-lead', 'method': 'POST', 'body': {}})
                self.assertEqual(response, {'id': 9, 'status': status, 'value': {'error': message}})

    def test_worker_keeps_non_tool_value_errors_generic(self):
        with patch.object(Workspace, 'update_record', side_effect=ValueError('private detail')):
            response = self.rpc_response({'id': 10, 'route': '/api/planning', 'method': 'POST', 'body': {}})
        self.assertEqual(response, {'id': 10, 'status': 400, 'value': {'error': 'Invalid campaign request.'}})

    def test_check_draft_names_each_broken_rule(self):
        bad = ('Bonjour, pour 500 DT nous garantissons 99 % de précision en 48h, '
               'comme pour nos clients actuels.')
        out = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': bad})
        self.assertFalse(out['ok'])
        self.assertEqual({p['rule'] for p in out['notes']}, {'price', 'percentage', 'time_promise', 'guarantee', 'invented_clients'})
        good = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour, votre site présente des services ERP. Un court échange vous intéresserait-il ?'})
        self.assertTrue(good['ok'], good['notes'])

    def test_check_draft_flags_scope_suppression_and_stale_source(self):
        with self.assertRaises(ValueError): campaign_tools.check_draft(self.store, {'lead_id': 'fr', 'body': 'Bonjour'})
        old = {**self.lead, 'id': 'old', 'company': 'Old SARL', 'checked_date': '2025-01-01'}
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead, old]))
        out = campaign_tools.check_draft(self.store, {'lead_id': 'old', 'body': 'Bonjour, une question courte.'})
        self.assertIn('stale_source', {p['rule'] for p in out['notes']})

    def test_save_draft_keeps_notes_and_an_unreviewed_draft(self):
        before = (self.root / 'data/leads.json').read_bytes()
        noted = campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'body': 'Garanti à 100 %.'}, 'sales')
        self.assertEqual({n['rule'] for n in noted['notes']}, {'percentage', 'guarantee'})
        self.assertEqual((noted['reviewed'], noted['status']), (False, 'proposed'))
        saved = campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'subject': 'Services ERP', 'body': 'Bonjour, votre site présente des services ERP.'}, 'sales')
        self.assertEqual((saved['lead_id'], saved['agent_id'], saved['reviewed'], saved['status']), ('tn', 'sales', False, 'proposed'))
        self.assertEqual(saved['notes'], [])
        self.assertEqual(saved['source_version'], campaign.fingerprint(self.lead))
        self.assertEqual((self.root / 'data/leads.json').read_bytes(), before, 'an agent never writes leads.json')
        drafts = campaign_tools.packet(self.store, {'id': 'tn'})['crew_drafts']
        self.assertEqual([d['id'] for d in drafts], [noted['id'], saved['id']])
        self.assertEqual(drafts[0]['notes'], noted['notes'])

    def test_propose_lead_refuses_duplicates_exclusions_and_foreign_companies(self):
        base = {'company': 'Nouvelle Data SARL', 'country': 'Tunisia', 'location': 'Tunis', 'website': 'https://nouvelle.tn',
                'source_url': 'https://nouvelle.tn/a-propos', 'observed_on': '2026-10-10', 'quote': 'Nous numérisons des archives pour nos clients.'}
        made = campaign_tools.propose_lead(self.store, base, 'research')
        self.assertEqual((made['status'], made['agent_id']), ('proposed', 'research'))
        for change, reason in [({'company': 'Local ERP', 'website': 'https://other.tn'}, 'Duplicate company'),
                               ({'company': 'Other Co', 'website': 'https://example.tn'}, 'Duplicate company website'),
                               ({}, 'Already proposed'),
                               ({'company': 'Lyon SA', 'website': 'https://lyon.fr', 'country': 'France'}, 'outside Tunisia')]:
            with self.assertRaisesRegex(ValueError, reason): campaign_tools.propose_lead(self.store, {**base, **change}, 'research')
        (self.root / 'data/exclusions.json').write_text('{"companies":[{"company":"Blocked SA"}]}')
        with self.assertRaisesRegex(ValueError, 'Company excluded'): campaign_tools.propose_lead(self.store, {**base, 'company': 'Blocked SA', 'website': 'https://blocked.tn'}, 'research')

    def test_owner_accepts_a_proposal_into_leads_and_rejects_another(self):
        made = campaign_tools.propose_lead(self.store, {'company': 'Nouvelle Data SARL', 'country': 'Tunisia', 'location': 'Tunis', 'website': 'https://nouvelle.tn',
            'source_url': 'https://nouvelle.tn/a-propos', 'observed_on': '2026-10-10', 'quote': 'Nous numérisons des archives.'}, 'research')
        self.store.action('accept-proposal', {'id': made['id']}, self.store.version())
        added = [l for l in json.loads((self.root / 'data/leads.json').read_text()) if l['company'] == 'Nouvelle Data SARL'][0]
        self.assertEqual((added['source_type'], added['status'], added['source_live_checked'], added['contact_route'], added['country']), ('crew_proposal', 'discovered', False, None, 'TN'))
        self.assertEqual(added['observed_text'], 'Nous numérisons des archives.')
        other = campaign_tools.propose_lead(self.store, {'company': 'Autre SARL', 'country': 'TN', 'location': 'Sousse', 'source_url': 'https://autre.tn',
            'observed_on': '2026-10-10', 'quote': 'Archives papier à numériser.'}, 'research')
        self.store.action('proposal-status', {'id': other['id'], 'status': 'rejected', 'reason': 'Too small'}, self.store.version())
        self.assertEqual(self.store.read()['proposals'][-1]['status'], 'rejected')


    def proposal_args(self, **changes):
        return {**{'company': 'Nouvelle Data SARL', 'country': 'TN', 'location': 'Tunis',
                   'website': 'https://nouvelle.tn', 'source_url': 'https://nouvelle.tn/about',
                   'observed_on': '2026-10-10', 'quote': 'Nous numérisons des archives.'}, **changes}

    def test_claim_rules_cover_french_english_and_subject_claims(self):
        cases = {'price': ['500 DT', '10 TND', '20 dinars', '5 €', '10 EUR', '12 euros', '5 $', '6 USD'],
                 'percentage': ['99 %', '12.5%'],
                 'time_promise': ['en 2 heures', 'in 3 days', 'within 1 week', 'sous 2 jours', '24h', '48h', '72h'],
                 'guarantee': ['garantissons', 'guaranteed', '100 %'],
                 'invented_clients': ['nos clients', 'our clients', 'déjà travaillé avec', 'already worked with', 'références clients']}
        for rule, texts in cases.items():
            for text in texts:
                with self.subTest(rule=rule, text=text):
                    result = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': text.upper()})
                    self.assertIn(rule, {p['rule'] for p in result['notes']})
        result = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'subject': 'Garanti', 'body': 'Bonjour'})
        self.assertIn('guarantee', {p['rule'] for p in result['notes']})

    def test_draft_bounds_and_freshness_boundary(self):
        for args in ({'body': ''}, {'body': None}, {'body': 'x' * 8001}, {'body': 'Bonjour', 'subject': 'x' * 201},
                     {'body': 'Bonjour', 'subject': 3}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                campaign_tools.check_draft(self.store, {'lead_id': 'tn', **args})
        today = datetime.date(2026, 10, 11)
        with patch.object(records, 'local_today', return_value=today):
            for age, expected in [(180, True), (181, False)]:
                lead = {**self.lead, 'checked_date': (today - datetime.timedelta(days=age)).isoformat()}
                (self.root / 'data/leads.json').write_text(json.dumps([lead]))
                result = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'subject': 'x' * 200, 'body': 'x' * 8000})
                self.assertEqual(result['ok'], expected)
            for date in (None, 'invalid'):
                (self.root / 'data/leads.json').write_text(json.dumps([{**self.lead, 'checked_date': date}]))
                self.assertIn('stale_source', {p['rule'] for p in campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'})['notes']})

    def test_draft_checks_exclusions_and_suppression_without_writes(self):
        (self.root / 'data/exclusions.json').write_text('{"companies":[{"company":"Parent", "aliases":["LÓCAL-ERP"]}]}')
        state = self.store.read()
        state['events'].append({'lead_id': 'tn', 'kind': 'do_not_contact', 'confirmed': True})
        self.store.path.write_text(json.dumps(state))
        before = self.store.path.read_bytes()
        out = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'})
        self.assertEqual({p['rule'] for p in out['notes']}, {'excluded', 'suppressed'})
        self.assertEqual(self.store.path.read_bytes(), before)
        saved = campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'}, 'sales')
        self.assertEqual(saved['notes'], out['notes'])
        self.assertEqual(self.store.read()['crew_drafts'], [saved])
        (self.root / 'data/exclusions.json').write_text('{"companies":[]}')
        (self.root / 'data/leads.json').write_text(json.dumps([{**self.lead, 'exclusion_check': None}]))
        self.assertIn('excluded', {p['rule'] for p in campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'})['notes']})

    def test_draft_checks_note_closed_leads_and_allow_saving(self):
        for status in ('declined', 'rejected'):
            with self.subTest(status=status):
                (self.root / 'data/leads.json').write_text(json.dumps([{**self.lead, 'status': status}]))
                before = self.store.path.read_bytes()
                checked = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'})
                self.assertIn('closed', {p['rule'] for p in checked['notes']})
                self.assertEqual(self.store.path.read_bytes(), before)
                saved = campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'}, 'sales')
                self.assertEqual(saved['notes'], checked['notes'])
                self.assertEqual(self.store.read()['crew_drafts'][-1], saved)

    def test_draft_checks_note_the_current_suppressed_contact_route_and_allow_saving(self):
        state = self.store.read()
        state['contacts'][0]['route'] = 'ceo@example.tn'
        state['events'].append({'lead_id': 'tn', 'kind': 'do_not_contact', 'confirmed': True,
                                'scope': 'contact', 'contact_id': state['contacts'][0]['id']})
        self.store.path.write_text(json.dumps(state))
        self.assertFalse(campaign.suppressed(state, 'tn'), 'fixture is a contact-only opt-out')
        self.assertTrue(campaign.route_suppressed(state, self.lead))
        before = self.store.path.read_bytes()
        checked = campaign_tools.check_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'})
        self.assertIn('suppressed', {p['rule'] for p in checked['notes']})
        self.assertEqual(self.store.path.read_bytes(), before)
        saved = campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'body': 'Bonjour'}, 'sales')
        self.assertEqual(saved['notes'], checked['notes'])
        self.assertEqual(self.store.read()['crew_drafts'], [saved])

    def test_save_draft_still_refuses_out_of_scope_or_invalid_inputs_without_writes(self):
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        for args in ({'lead_id': 'fr', 'body': 'Bonjour'}, {'lead_id': 'missing', 'body': 'Bonjour'},
                     {'lead_id': 'tn', 'body': ''}, {'lead_id': 'tn', 'body': 'x' * 8001},
                     {'lead_id': 'tn', 'body': 'Bonjour', 'subject': 'x' * 201}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                campaign_tools.save_draft(self.store, args, 'sales')
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_save_keeps_newest_five_per_lead_and_owner_reviews_with_version(self):
        other = {**self.lead, 'id': 'other', 'company': 'Other'}
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead, other]))
        old_version = self.store.version()
        kept = campaign_tools.save_draft(self.store, {'lead_id': 'other', 'body': 'Bonjour'}, 'sales')
        saved = [campaign_tools.save_draft(self.store, {'lead_id': 'tn', 'body': f'Bonjour {i}', 'language': 'en'}, 'sales') for i in range(7)]
        state = self.store.read()
        self.assertEqual([r['id'] for r in state['crew_drafts']], [kept['id'], *[r['id'] for r in saved[-5:]]])
        self.assertEqual({r['id']: r['crew_drafts'] for r in campaign_tools.leads(self.store, {})['leads']}, {'tn': 5, 'other': 1})
        self.assertEqual(saved[-1]['language'], 'en')
        with self.assertRaises(RequestError) as conflict:
            self.store.action('crew-draft-status', {'id': saved[-1]['id'], 'status': 'adopted'}, old_version)
        self.assertEqual(conflict.exception.status, 409)
        for draft, status in [(saved[-1], 'adopted'), (saved[-2], 'dismissed')]:
            self.store.action('crew-draft-status', {'id': draft['id'], 'status': status}, self.store.version())
        self.assertEqual([r['status'] for r in self.store.read()['crew_drafts'][-2:]], ['dismissed', 'adopted'])
        self.assertTrue(all(r['reviewed'] for r in self.store.read()['crew_drafts'][-2:]))

    def test_proposal_bounds_normalization_and_open_limit(self):
        before = (self.root / 'data/leads.json').read_bytes()
        for changes in ({'company': 'x'}, {'company': ' x '}, {'company': 'x' * 201}, {'country': 'Tunis'}, {'source_url': 'file:///tmp/x'},
                        {'website': 'https://'}, {'observed_on': '2999-01-01'}, {'observed_on': ''},
                        {'quote': 'short'}, {'quote': 'x' * 1001}, {'location': 'x' * 101}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                campaign_tools.propose_lead(self.store, self.proposal_args(**changes), 'research')
        with self.assertRaisesRegex(ValueError, 'Duplicate company'):
            campaign_tools.propose_lead(self.store, self.proposal_args(company=' LÓCAL-ERP '), 'research')
        (self.root / 'data/exclusions.json').write_text('{"companies":[{"company":"Parent", "aliases":["Nouvelle Data SARL"]}]}')
        with self.assertRaisesRegex(ValueError, 'outside Tunisia'):
            campaign_tools.propose_lead(self.store, self.proposal_args(country='France'), 'research')
        with self.assertRaisesRegex(ValueError, 'Company excluded'):
            campaign_tools.propose_lead(self.store, self.proposal_args(), 'research')
        (self.root / 'data/exclusions.json').write_text('{"companies":[]}')
        made = campaign_tools.propose_lead(self.store, self.proposal_args(country='تونس'), 'research')
        with self.assertRaisesRegex(ValueError, 'Already proposed'):
            campaign_tools.propose_lead(self.store, self.proposal_args(company='Other', website='https://nouvelle.tn/'), 'research')
        state = self.store.read()
        state['proposals'] = [{**made, 'id': f'pl-{i}', 'company': f'Company {i}', 'website': None} for i in range(200)]
        state['proposals'].append({**made, 'status': 'rejected'})
        self.store.path.write_text(json.dumps(state))
        with self.assertRaises(ValueError):
            campaign_tools.propose_lead(self.store, self.proposal_args(), 'research')
        self.assertEqual((self.root / 'data/leads.json').read_bytes(), before)

    def test_acceptance_rechecks_duplicates_exclusions_and_writes_csv_shape(self):
        made = campaign_tools.propose_lead(self.store, self.proposal_args(location=''), 'research')
        for added in ({**self.lead, 'id': 'new', 'company': 'Nouvelle-Data SARL', 'website': None},
                      {**self.lead, 'id': 'new', 'company': 'Another', 'website': 'https://nouvelle.tn/'}):
            (self.root / 'data/leads.json').write_text(json.dumps([self.lead, added]))
            with self.assertRaises(RequestError):
                self.store.action('accept-proposal', {'id': made['id']}, self.store.version())
            self.assertEqual(self.store.read()['proposals'][0]['status'], 'proposed')
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead]))
        (self.root / 'data/exclusions.json').write_text('{"companies":[{"company":"Nouvelle Data SARL"}]}')
        with self.assertRaises(RequestError):
            self.store.action('accept-proposal', {'id': made['id']}, self.store.version())

        (self.root / 'data/exclusions.json').write_text('{"companies":[]}')
        self.store.action('accept-proposal', {'id': made['id']}, self.store.version())
        added = json.loads((self.root / 'data/leads.json').read_text())[-1]
        self.assertRegex(added['id'], r'^lead-[0-9a-f]{12}$')
        self.assertEqual(added['location'], 'Tunisia')
        self.assertEqual(added['source_reference'], 'Crew proposal ' + made['id'] + ' by research')
        self.assertEqual(added['observed_fact'], 'Nous numérisons des archives.')
        self.assertNotIn('raw_import', added)
        self.assertNotIn('import_row', added)
        self.assertEqual(added['history'][0]['after']['company'], 'Nouvelle Data SARL')
        with self.assertRaises(RequestError):
            self.store.action('accept-proposal', {'id': made['id']}, self.store.version())

    def test_csv_preview_after_accepting_proposal_without_website(self):
        made = campaign_tools.propose_lead(self.store, self.proposal_args(website=None), 'research')
        self.store.action('accept-proposal', {'id': made['id']}, self.store.version())
        path = self.root / 'data/leads.json'
        before = path.read_bytes()
        leads = json.loads(before)
        self.assertIsNone(leads[-1]['website'])
        out = prospecting.preview_import('Company Name,Company Country,Website\nFresh,Tunisia,https://fresh.tn\n',
                                        leads, {'companies': []}, '2026-10-11')
        self.assertEqual([row['company'] for row in out['accepted']], ['Fresh'])
        self.assertEqual(out['rejected'], [])
        self.assertEqual(path.read_bytes(), before)

    def test_proposal_duplicate_website_uses_source_when_known_website_is_none(self):
        (self.root / 'data/leads.json').write_text(json.dumps([{**self.lead, 'website': None}]))
        with self.assertRaisesRegex(ValueError, '^Duplicate company website$'):
            campaign_tools.propose_lead(self.store, self.proposal_args(website='https://example.tn/services/'), 'research')

    def test_acceptance_recovers_after_workbench_write_fails(self):
        made = campaign_tools.propose_lead(self.store, self.proposal_args(), 'research')
        workspace = self.store.workspace
        atomic_json = workspace.atomic_json
        failed = False

        def fail_workbench_once(path, value, prefix):
            nonlocal failed
            if path == self.store.path and not failed:
                failed = True
                raise OSError('Injected workbench write failure')
            return atomic_json(path, value, prefix)

        with patch.object(workspace, 'atomic_json', side_effect=fail_workbench_once):
            version = self.store.version()
            with self.assertRaisesRegex(OSError, 'Injected workbench write failure'):
                self.store.action('accept-proposal', {'id': made['id']}, version)
            self.assertTrue(failed)
            path = self.root / 'data/leads.json'
            after_first_write = path.read_bytes()
            matches = [row for row in json.loads(after_first_write) if row['company'] == made['company']]
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches[0]['source_reference'], 'Crew proposal ' + made['id'] + ' by research')
            self.assertEqual(self.store.read()['proposals'][0]['status'], 'proposed')
            self.assertEqual(self.store.version(), version)
            retried = self.store.action('accept-proposal', {'id': made['id']}, version)['record']

        self.assertEqual((retried['status'], retried['lead_id']), ('accepted', matches[0]['id']))
        self.assertEqual(self.store.read()['proposals'][0]['lead_id'], matches[0]['id'])
        self.assertEqual(path.read_bytes(), after_first_write, 'recovery must not rewrite or append leads')
        matches = [row for row in json.loads(path.read_text()) if row['company'] == made['company']]
        self.assertEqual(len(matches), 1)

    def test_private_drafting_routes_use_host_agent_and_owner_status_is_bounded(self):
        workspace = self.store.workspace
        def post(route, body):
            return campaign_rpc.dispatch(workspace, {'route': '/api/tools/' + route, 'method': 'POST', 'body': body})
        self.assertTrue(post('check-draft', {'lead_id': 'tn', 'body': 'Bonjour', 'agent_id': 'sales'})['ok'])
        saved = post('save-draft', {'lead_id': 'tn', 'body': 'Bonjour', 'agent_id': 'sales'})
        self.assertEqual(saved['agent_id'], 'sales')
        made = post('propose-lead', self.proposal_args())
        self.assertEqual(made['agent_id'], 'unknown')
        for action, body in [('crew-draft-status', {'id': saved['id'], 'status': 'sent'}),
                             ('proposal-status', {'id': made['id'], 'status': 'accepted', 'reason': 'No fit'}),
                             ('proposal-status', {'id': made['id'], 'status': 'rejected', 'reason': 'No'}),
                             ('proposal-status', {'id': made['id'], 'status': 'rejected', 'reason': 'x' * 301})]:
            with self.subTest(action=action, body=body), self.assertRaises(RequestError):
                self.store.action(action, body, self.store.version())


if __name__ == '__main__':
    unittest.main()

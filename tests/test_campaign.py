import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import campaign
from ultra_ui import Workspace, RequestError


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.lead = {'id': 'tn', 'company': 'Local ERP', 'kind': 'service_prospect', 'country': 'TN',
            'mode': 'real', 'status': 'discovered', 'recommended_offer': 'catalogue', 'industry': 'ERP',
            'source_url': 'https://example.tn', 'observed_fact': 'Published ERP services',
            'pitch_hook': 'Votre site présente des services ERP.', 'checked_date': '2026-10-05',
            'contact_route': 'info@example.tn', 'exclusion_check': 'not_excluded', 'source_live_checked': True}
        (self.root / 'data/leads.json').write_text(json.dumps([self.lead]))
        (self.root / 'data/exclusions.json').write_text('{"companies":[]}')
        self.workspace = Workspace(self.root, self.root)
        self.store = campaign.Campaign(self.workspace)

    def tearDown(self):
        self.temp.cleanup()

    def action(self, name, body):
        return self.store.action(name, body, self.store.version())

    def test_ranking_excludes_foreign_and_excluded_and_explains_unknown(self):
        rows = [self.lead, {**self.lead, 'id': 'fr', 'country': 'FR'},
                {**self.lead, 'id': 'blocked', 'company': 'Excluded'},
                {**self.lead, 'id': 'unknown', 'contact_route': None, 'checked_date': None}]
        result = campaign.rank(rows, {'companies': [{'company': 'Excluded'}]}, campaign.DEFAULT_WEIGHTS, 'catalogue', '2026-10-05')
        self.assertEqual({r['id'] for r in result}, {'tn', 'unknown'})
        self.assertEqual(result[0]['score'], sum(f['points'] for f in result[0]['factors']))
        self.assertIn('contact', result[1]['unknowns'])
        changed = campaign.rank(rows, {'companies': [{'company': 'Excluded'}]}, {**campaign.DEFAULT_WEIGHTS, 'contact': 0}, 'catalogue', '2026-10-05')
        self.assertLess(changed[0]['score'], result[0]['score'])

    def test_events_require_evidence_and_original_reply_survives_correction(self):
        with self.assertRaises(RequestError):
            self.action('event', {'lead_id': 'tn', 'kind': 'reply', 'text': 'Send an example'})
        saved = self.action('event', {'lead_id': 'tn', 'kind': 'reply', 'text': 'Send an example',
            'on': '2026-10-05', 'evidence': 'owner mailbox reply', 'confirmed': True})['event']
        self.assertEqual(saved['interpretation'], 'example')
        self.assertFalse(saved['interpretation_confirmed'])
        self.action('interpret', {'id': saved['id'], 'intent': 'wrong_person', 'confirmed': True})
        event = self.store.snapshot()['events'][0]
        self.assertEqual(event['text'], 'Send an example')
        self.assertEqual(event['branch']['action'], 'contacts')
        leads = json.loads((self.root / 'data/leads.json').read_text())
        self.assertEqual(leads, [self.lead])

    def test_stale_writes_and_suppression(self):
        version = self.store.version()
        self.action('event', {'lead_id': 'tn', 'kind': 'reply', 'text': 'Do not contact us',
            'on': '2026-10-05', 'evidence': 'mailbox', 'confirmed': True})
        with self.assertRaises(RequestError) as ctx:
            self.store.action('contact', {'lead_id': 'tn'}, version)
        self.assertEqual(ctx.exception.status, 409)
        self.assertTrue(self.store.suppressed('tn'))
        with self.assertRaises(RequestError):
            self.action('proof', {'lead_id': 'tn', 'offer': 'catalogue'})

    def test_checked_proof_and_review_invalidation(self):
        result = self.action('proof', {'lead_id': 'tn', 'offer': 'catalogue'})
        proof = result['proof']
        self.assertTrue(all(c['passed'] for c in proof['checks']))
        self.assertIn('SYNTHETIC', (self.root / proof['path']).read_text())
        self.action('review-proof', {'id': proof['id'], 'confirmed': True})
        self.assertTrue(self.store.snapshot()['proofs'][0]['review_current'])
        changed = {**self.lead, 'observed_fact': 'Changed source observation'}
        (self.root / 'data/leads.json').write_text(json.dumps([changed]))
        self.assertFalse(self.store.snapshot()['proofs'][0]['review_current'])

    def test_company_funnel_deduplicates_and_zero_rates_unknown(self):
        events = [{'lead_id': 'tn', 'kind': 'sent', 'confirmed': True, 'on': '2026-10-05'}] * 3
        result = campaign.funnel([self.lead], events, '2026-10-01', '2026-10-05')
        self.assertEqual(result['counts']['contacted'], 1)
        self.assertEqual(result['attempts'], 3)
        self.assertIsNone(result['rates']['qualified_to_pilot'])

    def test_proof_review_tracks_pitch_edits_and_selected_offer(self):
        draft = {'body': 'Catalogue pitch', 'offer': 'catalogue'}
        (self.root / 'data/leads.json').write_text(json.dumps([{**self.lead, 'draft': draft}]))
        proof = self.action('proof', {'lead_id': 'tn', 'offer': 'cleanup'})['proof']
        self.assertNotIn('Catalogue pitch', (self.root / proof['path']).read_text())
        self.action('review-proof', {'id': proof['id'], 'confirmed': True})
        draft['body'] = 'Edited source pitch'
        (self.root / 'data/leads.json').write_text(json.dumps([{**self.lead, 'draft': draft}]))
        self.assertFalse(self.store.snapshot()['proofs'][0]['review_current'])

    def test_contact_opt_out_blocks_followup_and_mixed_reply(self):
        contact = self.action('contact', {'lead_id': 'tn', 'name': 'Operations', 'route': 'ops@example.tn',
            'source_url': 'https://example.tn/team', 'checked_on': '2026-10-05'})['record']
        self.action('event', {'lead_id': 'tn', 'contact_id': contact['id'], 'scope': 'contact', 'kind': 'reply',
            'text': 'Do not contact me about your example', 'on': '2026-10-05', 'evidence': 'fixture opt-out', 'confirmed': True})
        self.assertTrue(self.store.suppressed('tn', contact['id']))
        self.assertFalse(self.store.suppressed('tn'))
        with self.assertRaises(RequestError):
            self.action('followup', {'lead_id': 'tn', 'contact_id': contact['id'], 'text': 'Ask again'})

    def test_variants_invalidate_and_experiments_use_actual_events(self):
        draft = {'subject': 'Test', 'body': 'Small pilot', 'offer': 'cleanup', 'reviewed': True}
        (self.root / 'data/leads.json').write_text(json.dumps([{**self.lead, 'draft': draft}]))
        variant = self.action('variant', {'lead_id': 'tn', 'language': 'ar-TN', 'channel': 'whatsapp'})['variant']
        self.action('review-variant', {'id': variant['id'], 'confirmed': True})
        self.assertTrue(self.store.snapshot()['variants'][0]['review_current'])
        experiment = self.action('experiment', {'name': 'ERP openings', 'lead_ids': ['tn'], 'a': 'Opening A', 'b': 'Opening B',
            'start': '2026-10-01', 'end': '2026-10-30'})['experiment']
        self.assertEqual(sum(r['sent'] for r in self.store.snapshot()['experiment_results'][0]['variants']), 0)
        draft['body'] = 'Changed pilot'
        (self.root / 'data/leads.json').write_text(json.dumps([{**self.lead, 'draft': draft}]))
        self.assertFalse(self.store.snapshot()['variants'][0]['review_current'])

    def test_followup_proposals_and_contact_maps_leave_real_stages_unchanged(self):
        self.action('contact', {'lead_id': 'tn', 'name': 'Published contact', 'role': 'operations', 'route': 'info@example.tn',
            'source_url': 'https://example.tn/team', 'checked_on': '2026-10-05', 'relationship': 'Role published; authority unknown'})
        self.action('followup', {'lead_id': 'tn', 'on': '2026-10-10', 'text': 'Ask about sample'})
        self.assertEqual(self.store.snapshot()['analytics']['counts']['contacted'], 0)
        self.assertEqual(json.loads((self.root / 'data/leads.json').read_text()), [self.lead])

    def test_contact_opt_out_blocks_matching_published_route_export(self):
        lead={**self.lead,'shortlisted':True}
        (self.root/'data/leads.json').write_text(json.dumps([lead]))
        contact=self.action('contact',{'lead_id':'tn','name':'Operations','route':'info@example.tn',
            'source_url':'https://example.tn/team','checked_on':'2026-10-05'})['record']
        self.action('event',{'lead_id':'tn','kind':'do_not_contact','contact_id':contact['id'],'scope':'contact',
            'on':'2026-10-05','evidence':'fixture opt-out','confirmed':True})
        csv=self.workspace.prospect_action('export',{'selected_only':True},'')['csv_text']
        self.assertNotIn('info@example.tn',csv)

    def test_new_reply_invalidates_prepared_outreach(self):
        draft={'body':'Small pilot','offer':'catalogue','reviewed':True}
        (self.root/'data/leads.json').write_text(json.dumps([{**self.lead,'draft':draft}]))
        proof=self.action('proof',{'lead_id':'tn','offer':'catalogue'})['proof']
        variant=self.action('variant',{'lead_id':'tn','language':'fr','channel':'email'})['variant']
        self.action('review-proof',{'id':proof['id'],'confirmed':True})
        self.action('review-variant',{'id':variant['id'],'confirmed':True})
        self.action('followup',{'lead_id':'tn','on':'2026-10-05','text':'Check proposed follow-up'})
        self.action('event',{'lead_id':'tn','kind':'reply','on':'2026-10-05','text':'Send an example',
            'evidence':'fixture reply','confirmed':True})
        snapshot=self.store.snapshot()
        self.assertFalse(snapshot['proofs'][0]['review_current'])
        self.assertFalse(snapshot['variants'][0]['review_current'])
        self.assertTrue(snapshot['followups'][0]['needs_review'])

    def test_pitch_recipe_requires_three_current_checked_proofs(self):
        leads=[{**self.lead,'id':'tn'+str(i),'company':'Fixture '+str(i),'shortlisted':True} for i in range(3)]
        (self.root/'data/leads.json').write_text(json.dumps(leads))
        requirement={'kind':'pitches','lead_ids':[l['id'] for l in leads]}
        self.assertFalse(self.store.preflight(requirement)['ready'])
        for l in leads:
            p=self.action('proof',{'lead_id':l['id'],'offer':'catalogue'})['proof']
            self.action('review-proof',{'id':p['id'],'confirmed':True})
        self.assertTrue(self.store.preflight(requirement)['ready'])
        self.action('event',{'lead_id':'tn0','kind':'reply','on':'2026-10-05','text':'Later',
            'evidence':'Fixture reply','confirmed':True})
        self.assertFalse(self.store.preflight(requirement)['ready'])

    def test_focus_plan_accounts_for_due_work_and_unknown_estimates(self):
        tasks = [{'id': 'a', 'title': 'Small review', 'ready': True, 'timebox_minutes': 15},
                 {'id': 'b', 'title': 'Large check', 'ready': True, 'timebox_minutes': 45},
                 {'id': 'c', 'title': 'Unknown effort', 'ready': True, 'timebox_minutes': None},
                 {'id': 'd', 'title': 'Blocked', 'ready': False, 'timebox_minutes': 5}]
        result = campaign.focus_plan(tasks, [{'id': 'follow', 'lead_id': 'tn', 'on': '2026-10-05', 'text': 'Review follow-up'}], 20, '2026-10-05')
        self.assertEqual(result['planned_minutes'], 20)
        self.assertEqual([s['id'] for s in result['steps']], ['follow', 'a'])
        self.assertEqual(result['unknown_estimates'], ['c'])
        self.assertFalse(result['awards_xp'])


if __name__ == '__main__':
    unittest.main()

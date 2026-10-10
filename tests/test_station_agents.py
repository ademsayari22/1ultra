"""Agent transport uses a local CLI fixture; no provider calls in this suite."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import station_agents
from ultra_ui import Workspace, RequestError

PROJECT = Path(__file__).resolve().parents[1]


class StationAgentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='ultra-agent-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name in ['STATE.md', 'data', 'context/FOUNDER.md', '.codex/agents', '.agents/skills']:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            source = PROJECT / name
            if source.is_dir(): shutil.copytree(source, target)
            else: shutil.copy2(source, target)
        self.workspace = Workspace(self.root, PROJECT / 'web')
        self.lead = json.loads((self.root / 'data/leads.json').read_text())[0]
        self.body = {'desk': 'sales', 'kind': 'pitch', 'lead_id': self.lead['id'], 'offer': 'documents',
                     'reason': 'Choose a persuasive angle and natural French wording from the published company facts.'}
        self.before = {p.name: p.read_bytes() for p in (self.root / 'data').glob('*.json')}

    def result(self):
        return {'summary': 'A tailored French introduction.', 'answer': 'The source supports the opening; the need is unconfirmed.',
                'pitch': {'subject': 'Un petit exemple pour votre équipe', 'body': 'Bonjour, pouvons-nous examiner un échantillon autorisé ? Adem'},
                'evidence': [{'source': self.lead['source_url'], 'claim': self.lead['observed_fact']}],
                'unknowns': ['Buyer need'], 'owner_actions': ['Review source and claims before sending.']}

    def assert_records_unchanged(self):
        self.assertEqual(self.before, {p.name: p.read_bytes() for p in (self.root / 'data').glob('*.json')})

    def test_preflight_binds_company_offer_and_draft_without_overwriting_records(self):
        folder = station_agents.prepare(self.workspace, self.body, 'Prefer a short direct question.')
        context = json.loads((folder / 'context.json').read_text())
        self.assertEqual(context['lead']['id'], self.lead['id'])
        self.assertEqual(context['offer']['id'], 'documents')
        self.assertNotIn('history', context['lead'])
        self.assertNotIn('status_evidence', context['lead'])
        self.assertNotIn('contact_route', context['lead'])
        self.assertIn(self.lead['company'], context['template']['body'])
        self.assertTrue((self.root / context['script_preflight'] / 'result.json').is_file())
        self.assertIn('Prefer a short direct question.', (folder / 'prompt.md').read_text())
        self.assert_records_unchanged()

    def test_effective_settings_load_role_and_selected_skill_into_prompt(self):
        skill = self.root / '.agents/skills/ultra-sales/SKILL.md'
        skill.write_text(skill.read_text() + '\nSALES_SKILL_BOUND_TEST: Prefer one buyer question.\n')
        folder = station_agents.prepare(self.workspace, self.body, settings={'instructions': 'Keep it concise.'})
        info = json.loads((folder / 'run.json').read_text())
        self.assertEqual(info['reasoning_effort'], 'xhigh')
        self.assertEqual(info['skills'][0]['id'], 'ultra-sales')
        prompt = (folder / 'prompt.md').read_text()
        self.assertIn('SALES_SKILL_BOUND_TEST', prompt)
        self.assertIn('Return unsent drafts.', prompt)
        self.assertIn('Keep it concise.', prompt)
        second = station_agents.prepare(self.workspace, self.body, settings={'reasoning_effort': 'high', 'skills': []})
        self.assertNotIn('SALES_SKILL_BOUND_TEST', (second / 'prompt.md').read_text())
        self.assertEqual(json.loads((second / 'run.json').read_text())['reasoning_effort'], 'high')
        self.assert_records_unchanged()

    def test_invalid_disabled_or_missing_agent_configuration_refuses_before_model(self):
        for settings in [{'enabled': False}, {'reasoning_effort': 'unlimited'}, {'skills': ['../../data/leads.json']},
                         {'skills': ['ultra-prospect']}, {'shell': True}, {'instructions': 'x' * 4001}]:
            with self.assertRaises(ValueError): station_agents.prepare(self.workspace, self.body, settings=settings)
        (self.root / '.codex/agents/ultra_sales.toml').unlink()
        with self.assertRaisesRegex(ValueError, 'role'):
            station_agents.prepare(self.workspace, self.body)
        self.assertFalse((self.root / 'runs').exists(), 'Invalid configuration does not even run the preflight')
        self.assert_records_unchanged()

    def test_model_output_requires_real_subject_body_and_known_evidence_sources(self):
        folder = station_agents.prepare(self.workspace, self.body)
        result = self.result()
        result['pitch']['body'] = ''
        with self.assertRaises(ValueError): station_agents.validate_result(folder, result)
        result = self.result()
        result['evidence'][0]['source'] = 'https://invented.example'
        with self.assertRaises(ValueError): station_agents.validate_result(folder, result)

    def test_cli_stream_receipt_usage_and_owner_adoption_are_distinct(self):
        executable = self.root / 'codex'
        executable.write_text('#!/usr/bin/env python3\nimport json,sys\nfrom pathlib import Path\n'
            'if "login" in sys.argv: print("Logged in using ChatGPT"); sys.exit(0)\n'
            'prompt=sys.stdin.read()\n'
            'print(json.dumps({"type":"turn.started"}),flush=True)\n'
            f'answer={self.result()!r}\n'
            'Path(sys.argv[sys.argv.index("--output-last-message")+1]).write_text(json.dumps(answer))\n'
            'print(json.dumps({"type":"turn.completed","usage":{"input_tokens":123,"output_tokens":45}}),flush=True)\n')
        executable.chmod(0o700)
        events = []
        with patch.dict(os.environ, {'PATH': str(self.root) + os.pathsep + os.environ['PATH']}):
            receipt = station_agents.execute(self.workspace, self.body, events.append)
        self.assertEqual(receipt['run']['status'], 'needs_review')
        self.assertTrue(receipt['modelInvoked'])
        self.assertEqual(receipt['usage']['output_tokens'], 45)
        info = json.loads((self.root / 'runs' / receipt['run']['id'] / 'run.json').read_text())
        self.assertIn('model_reasoning_effort="xhigh"', info['command'])
        self.assertEqual(receipt['run']['reasoning_effort'], 'xhigh')
        self.assertTrue(any(e['stage'] == 'drafting' for e in events))
        self.assert_records_unchanged()
        adopted = station_agents.adopt(self.workspace, {'run_id': receipt['run']['id']}, self.workspace.record_version('leads'))
        draft = adopted['record']['draft']
        self.assertEqual(draft['body'], self.result()['pitch']['body'])
        self.assertFalse(draft['reviewed'])
        self.assertFalse(adopted['record'].get('contact_sent', False))
        with self.assertRaises(RequestError):
            station_agents.adopt(self.workspace, {'run_id': receipt['run']['id']}, self.workspace.record_version('leads'))

    def test_stale_source_and_closed_company_cannot_adopt_agent_pitch(self):
        folder = station_agents.prepare(self.workspace, self.body)
        (folder / 'result.json').write_text(json.dumps(self.result()))
        info = json.loads((folder / 'run.json').read_text()); info['status'] = 'needs_review'
        (folder / 'run.json').write_text(json.dumps(info))
        path = self.root / 'data/leads.json'; leads = json.loads(path.read_text())
        leads[0]['observed_fact'] += ' Changed since generation.'; path.write_text(json.dumps(leads))
        with self.assertRaises(RequestError): station_agents.adopt(self.workspace, {'run_id': folder.name}, self.workspace.record_version('leads'))
        leads[0] = {**self.lead, 'status': 'declined'}; path.write_text(json.dumps(leads))
        with self.assertRaises(RequestError): station_agents.adopt(self.workspace, {'run_id': folder.name}, self.workspace.record_version('leads'))

    def test_script_only_roles_and_unbounded_inputs_are_refused(self):
        for changes in [{'desk': 'finance'}, {'kind': 'pitch', 'desk': 'qa'}, {'execute': True}, {'reason': 'short'}]:
            with self.assertRaises(ValueError): station_agents.prepare(self.workspace, {**self.body, **changes})
        self.assert_records_unchanged()

    def test_missing_login_produces_a_failed_receipt_without_template_fallback(self):
        with patch.object(station_agents, 'readiness', return_value={'available': False, 'status': 'Sign in with ChatGPT.'}):
            receipt = station_agents.execute(self.workspace, self.body)
        self.assertEqual(receipt['run']['status'], 'failed')
        self.assertFalse(receipt['modelInvoked'])
        self.assertNotIn('output', receipt)
        self.assertIn('Sign in', receipt['error'])
        self.assert_records_unchanged()

    def test_qa_handoff_reads_the_exact_saved_sales_output(self):
        folder = station_agents.prepare(self.workspace, self.body)
        (folder / 'result.json').write_text(json.dumps(self.result()))
        (folder / 'report.md').write_text('Unsent fixture draft.')
        info = json.loads((folder / 'run.json').read_text()); info['status'] = 'needs_review'
        (folder / 'run.json').write_text(json.dumps(info))
        review = station_agents.prepare(self.workspace, {'desk': 'qa', 'kind': 'review', 'lead_id': self.lead['id'],
            'review_run': folder.name, 'reason': 'Check the supplied Sales draft for unsupported statements.'})
        context = json.loads((review / 'context.json').read_text())
        self.assertEqual(context['agent_output_to_review'], self.result())
        self.assertIn('runs/' + folder.name + '/report.md', context['sources'])
        with self.assertRaises(ValueError):
            station_agents.prepare(self.workspace, {'desk': 'delivery', 'kind': 'review', 'reason': 'Interpret an agreed scope without a saved check.'})
        self.assert_records_unchanged()

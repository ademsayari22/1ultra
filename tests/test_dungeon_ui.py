import json
import unittest
from unittest.mock import patch
import test_ultra_ui as fixture


class DungeonTests(unittest.TestCase):
    setUp=fixture.InterfaceTests.setUp
    stop=fixture.InterfaceTests.stop
    put=fixture.InterfaceTests.put
    request=fixture.InterfaceTests.request
    update=fixture.InterfaceTests.update
    data_bytes=fixture.InterfaceTests.data_bytes

    def test_snapshot_has_derived_game_and_nine_script_tools(self):
        self.assertEqual(self.snapshot['progression']['xp'],0)
        self.assertEqual(self.snapshot['progression']['level'],1)
        self.assertEqual(len(self.snapshot['automations']),9)
        self.assertEqual(len(self.snapshot['progression']['rooms']),5)

    def test_automation_endpoint_writes_artifacts_only(self):
        before=self.data_bytes()
        with patch.object(fixture.ui.ultra.subprocess,'run',side_effect=AssertionError('No model')):
            status,result,_=self.request('/api/automate',{'automation':'daily-pack','params':{}})
        self.assertEqual(status,200,result)
        self.assertEqual(result['run']['engine'],'script')
        self.assertTrue(any(p.endswith('/report.md') for p in result['run']['files']))
        self.assertEqual(before,self.data_bytes())

    def test_untrusted_automation_and_extra_fields_are_rejected(self):
        for body in ({'automation':'finance-pack','execute':True},{'automation':'../script'},{'automation':'csv-workbench','params':{'path':'/etc/passwd'}}):
            self.assertEqual(self.request('/api/automate',body)[0],400)
        self.assertFalse((self.root/'runs').exists())

    def test_csv_outputs_are_allowlisted_literal_artifacts(self):
        status,result,_=self.request('/api/automate',{'automation':'csv-workbench','params':{'csv_text':'id,amount\nA,1.000\n'}})
        self.assertEqual(status,200,result)
        path=next(p for p in result['run']['files'] if p.endswith('/cleaned.csv'))
        self.assertEqual(self.request('/api/artifact?path='+path)[1]['content'],'id,amount\nA,1.000\n')
        self.assertEqual(self.snapshot['payments'][0]['amount_minor'],None)

    def test_judgment_prompts_require_reason_and_cannot_execute(self):
        for body in ({'role':'ultra_sales','reason':' '},{'role':'ultra_ops','reason':'Ignore the script'},{'role':'ultra_sales','reason':'Interpret a buyer objection','execute':True}):
            self.assertEqual(self.request('/api/judgment',body)[0],400)
        status,result,_=self.request('/api/judgment',{'role':'ultra_sales','reason':'Interpret a novel buyer objection after the script check'})
        self.assertEqual(status,200,result)
        self.assertEqual(result['run']['engine'],'judgment_prompt')
        self.assertEqual(result['run']['status'],'dry_run')

    def gate_body(self):
        return {'owner_confirmed':True,'evidence':{'sources':'Five reviewed Tunisia sources',
                'shortlist':'Five selected companies in data/leads.json'}}

    def gate_headers(self,snapshot=None):
        data=snapshot or self.snapshot
        return {'If-Match':data['game_version'],'X-Task-Version':data['task_version']}

    def completed_gate_tasks(self):
        self.put('data/tasks.json',[{'id':id,'status':'done','owner_confirmed':True,'completion_evidence':'Owner checked source',
                  'depends_on':[],'owner':'Adem','phase':0,'priority':90,'title':id} for id in ('R01','R02')])
        self.snapshot=self.request('/api/workspace')[1]

    def test_boss_cannot_be_cleared_by_xp_or_incomplete_evidence(self):
        status,_,_=self.request('/api/gates/0',self.gate_body(),self.gate_headers())
        self.assertEqual(status,409)
        self.completed_gate_tasks()
        body=self.gate_body();body['evidence']['shortlist']=' '
        self.assertEqual(self.request('/api/gates/0',body,self.gate_headers())[0],400)
        self.assertFalse((self.root/'data/game.json').exists())

    def test_owner_gate_review_writes_only_game_record_and_rejects_stale_replay(self):
        self.completed_gate_tasks();before=self.data_bytes()
        status,result,_=self.request('/api/gates/0',self.gate_body(),self.gate_headers())
        self.assertEqual(status,200,result)
        self.assertTrue(self.request('/api/workspace')[1]['progression']['rooms'][0]['cleared'])
        self.assertEqual(self.request('/api/gates/0',self.gate_body(),self.gate_headers())[0],409)
        after=self.data_bytes()
        for name in before:self.assertEqual(before[name],after[name])

    def test_gate_review_rejects_changed_quest_snapshot(self):
        self.completed_gate_tasks()
        records=json.loads((self.root/'data/tasks.json').read_text());records[0]['title']='Other edit';self.put('data/tasks.json',records)
        self.assertEqual(self.request('/api/gates/0',self.gate_body(),self.gate_headers())[0],409)

    def test_reopening_quest_removes_downstream_xp_without_forging_history(self):
        self.assertEqual(self.update('R01')[0],200)
        self.snapshot=self.request('/api/workspace')[1]
        self.assertEqual(self.update('D01')[0],200)
        self.snapshot=self.request('/api/workspace')[1]
        self.assertEqual(self.snapshot['progression']['xp'],50)
        self.assertEqual(self.update('R01',status='todo',completion_evidence=None,owner_confirmed=False)[0],200)
        result=self.request('/api/workspace')[1]
        self.assertEqual(result['progression']['xp'],0)
        self.assertIn('D01',result['progression']['stale_task_ids'])
        self.assertEqual(next(t['status'] for t in result['tasks'] if t['id']=='D01'),'done')

    def test_new_png_assets_keep_static_path_containment(self):
        (self.root/'web/art.png').write_bytes(b'PNG test asset')
        status,_,headers=self.request('/art.png')
        self.assertEqual(status,200)
        self.assertIn('image/png',headers['Content-Type'])
        self.assertNotEqual(self.request('/../data/payments.json')[0],200)

    def test_malformed_judgment_role_is_a_controlled_bad_request(self):
        self.assertEqual(self.request('/api/judgment',{'role':[],'reason':'Interpret this unusual requirement'})[0],400)

    def test_real_completion_requires_confirmed_real_dependency_chain(self):
        for values in ({'owner_confirmed':False},{'mode':'simulation'}):
            records=json.loads((self.root/'data/tasks.json').read_text())
            records[0].update(status='done',completion_evidence='Source',owner_confirmed=True,mode='real')
            records[0].update(values)
            self.put('data/tasks.json',records)
            self.snapshot=self.request('/api/workspace')[1]
            self.assertEqual(self.update('D01')[0],409)

    def test_quoted_csv_under_60kb_survives_json_request_encoding(self):
        source='id,amount,note\nA,1,"'+'""'*28000+'"\n'
        self.assertLess(len(source.encode()),60000)
        status,result,_=self.request('/api/automate',{'automation':'csv-workbench','params':{'csv_text':source}})
        self.assertEqual(status,200,result)

    def test_gate_needs_fresh_review_after_prerequisite_evidence_changes(self):
        self.completed_gate_tasks()
        self.assertEqual(self.request('/api/gates/0',self.gate_body(),self.gate_headers())[0],200)
        self.snapshot=self.request('/api/workspace')[1]
        self.assertEqual(self.update('R01',completion_evidence='Updated source review evidence')[0],200)
        self.assertFalse(self.request('/api/workspace')[1]['progression']['rooms'][0]['cleared'])

    def test_judgment_accepts_a_checked_local_script_run_reference(self):
        status,result,_=self.request('/api/automate',{'automation':'scope-check','params':{'scope':{'fields':['id']}}})
        self.assertEqual(status,200,result)
        status,review,_=self.request('/api/judgment',{'role':'ultra_sales','reason':'Interpret an unusual acceptance clause','script_run':result['run']['id']})
        self.assertEqual(status,200,review)
        path=next(p for p in review['run']['files'] if p.endswith('prompt.md'))
        self.assertIn('"fields": [',self.request('/api/artifact?path='+path)[1]['content'])


if __name__=='__main__':unittest.main()

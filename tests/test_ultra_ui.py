import importlib.util
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ultra_ui', BASE / 'scripts/ultra_ui.py')
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)


class InterfaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('data','context','schemas','simulations','.codex/agents','web','docs'):
            (self.root/name).mkdir(parents=True)
        self.put('data/payments.json',[{'id':'owed','mode':'real','status':'owed','amount_minor':None,'currency':'TND'}])
        self.put('data/tasks.json',[
            {'id':'R01','phase':0,'title':'Check prospects','owner':'ultra_research','priority':80,'status':'todo','depends_on':[],'completion_evidence':None},
            {'id':'F01','phase':0,'title':'Record payment facts','owner':'Adem','priority':100,'status':'blocked_on_owner','depends_on':[],'completion_evidence':None},
            {'id':'D01','phase':2,'title':'Deliver output','owner':'ultra_delivery','priority':50,'status':'blocked','depends_on':['R01'],'completion_evidence':None}])
        self.put('data/leads.json',[])
        self.put('data/exclusions.json',{'companies':[]})
        self.put('data/budget.json',{'incremental_spend_limit_tnd':0,'status':'existing_tools_only','live_timeout_seconds':180})
        self.put('simulations/scenarios.json',[{'id':'messy-pilot','mode':'simulation','buyer':'FICTIONAL'}])
        self.put('schemas/agent_result.schema.json',{'type':'object'})
        for role in ('ultra_ops','ultra_research','ultra_sales','ultra_customer'):
            (self.root/f'.codex/agents/{role}.toml').write_text(f'name = "{role}"\ndescription = "Test role"\ndeveloper_instructions = "Draft only"\n')
        (self.root/'AGENTS.md').write_text('Test project instructions')
        (self.root/'STATE.md').write_text('Phase 0: readiness')
        (self.root/'context/FOUNDER.md').write_text('Synthetic founder facts')
        (self.root/'web/index.html').write_text('<title>1Ultra</title>')
        (self.root/'docs/sample.md').write_text('<script>window.pwned=1</script>')
        self.server=ui.create_server(self.root,self.root/'web',port=0)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        _,self.snapshot,_=self.request('/api/workspace')

    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join(2)

    def put(self,path,value):
        (self.root/path).write_text(json.dumps(value))

    def data_bytes(self):
        return {p.name:p.read_bytes() for p in (self.root/'data').glob('*')}

    def request(self,path,body=None,headers=None,method=None):
        h={}
        if body is not None:
            h={'Content-Type':'application/json','Origin':self.base,'X-Ultra-Token':self.snapshot['csrf_token']}
        h.update(headers or {})
        raw=json.dumps(body).encode() if body is not None else None
        req=Request(self.base+path,data=raw,headers=h,method=method)
        try: response=urlopen(req,timeout=3)
        except HTTPError as error:response=error
        with response:
            data=response.read();status=response.status;rh=dict(response.headers)
        try:value=json.loads(data)
        except ValueError:value=data.decode()
        return status,value,rh

    def update(self,task='R01',version=None,**overrides):
        body={'status':'done','completion_evidence':'Checked actual source','owner_confirmed':True}
        body.update(overrides)
        return self.request('/api/tasks/'+task,body,{'If-Match':version or self.snapshot['task_version']})

    def test_workspace_preserves_unknowns_and_does_not_invent_cash(self):
        self.assertIsNone(self.snapshot['payments'][0]['amount_minor'])
        self.assertEqual(self.snapshot['cash']['received_minor'],{})
        self.assertEqual(len(self.snapshot['tasks']),3)
        self.assertEqual(self.snapshot['active_phase'],0)

    def test_preparation_and_drafts_never_execute_models_or_change_data(self):
        before=self.data_bytes()
        with patch.object(ui.ultra.subprocess,'run',side_effect=AssertionError('model must not run')):
            for endpoint,body in [('/api/prepare',{}),('/api/draft',{'role':'ultra_sales'}),('/api/simulate',{'scenario':'messy-pilot'})]:
                status,result,_=self.request(endpoint,body)
                self.assertEqual(status,200,result)
                self.assertTrue(result['run']['files'])
        self.assertEqual(before,self.data_bytes())

    def test_untrusted_origin_host_or_token_cannot_write(self):
        before=self.data_bytes()
        for headers in [{'Origin':'https://evil.test'},{'Origin':'null'},{'X-Ultra-Token':'wrong'},{'Host':'evil.test'}]:
            with self.subTest(headers=headers):
                status,_,_=self.request('/api/prepare',{},headers)
                self.assertEqual(status,403)
        self.assertFalse((self.root/'runs').exists())
        self.assertEqual(before,self.data_bytes())

    def test_missing_origin_and_wrong_content_type_are_rejected(self):
        req=Request(self.base+'/api/prepare',data=b'{}',headers={'Content-Type':'application/json','X-Ultra-Token':self.snapshot['csrf_token']})
        with self.assertRaises(HTTPError) as raised:urlopen(req)
        self.assertEqual(raised.exception.code,403)
        raised.exception.close()
        self.assertEqual(self.request('/api/prepare',{}, {'Content-Type':'text/plain'})[0],415)

    def test_live_execution_extra_fields_bad_role_and_bad_scenario_are_rejected(self):
        for body in [{'role':'ultra_sales','execute':True},{'role':'../../data/payments'},{'role':'ultra_customer'},{'role':'ultra_sales','scenario':'missing'}]:
            self.assertEqual(self.request('/api/draft',body)[0],400,body)
        self.assertFalse((self.root/'runs').exists())

    def test_done_requires_evidence_owner_confirmation_and_dependencies(self):
        before=self.data_bytes()
        for task,body in [('R01',{'completion_evidence':' '}),('F01',{'owner_confirmed':False}),('D01',{}),('missing',{}),('R01',{'status':'magic'}),('R01',{'status':['done']})]:
            self.assertIn(self.update(task,**body)[0],(400,404,409))
        self.assertEqual(before,self.data_bytes())

    def test_completion_updates_only_task_and_stale_update_is_rejected(self):
        before=self.data_bytes()
        status,result,_=self.update()
        self.assertEqual(status,200,result)
        self.assertEqual(result['task']['status'],'done')
        self.assertEqual(self.update('F01')[0],409)
        after=self.data_bytes()
        self.assertNotEqual(before['tasks.json'],after['tasks.json'])
        for name in before:
            if name!='tasks.json':self.assertEqual(before[name],after[name])
        current=self.request('/api/workspace')[1]
        self.assertEqual(self.update('D01',version=current['task_version'])[0],200)

    def test_concurrent_updates_do_not_silently_overwrite_each_other(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda task:(task,self.update(task)[0]),['R01','F01']))
        self.assertEqual(sorted(code for _,code in results),[200,409])
        retry=next(task for task,code in results if code==409)
        version=self.request('/api/workspace')[1]['task_version']
        self.assertEqual(self.update(retry,version=version)[0],200)
        tasks=json.loads((self.root/'data/tasks.json').read_text())
        self.assertEqual({t['id'] for t in tasks if t['status']=='done'},{'R01','F01'})

    def test_in_progress_task_remains_a_daily_action(self):
        self.assertEqual(self.update('R01',status='in_progress')[0],200)
        status,result,_=self.request('/api/prepare',{})
        self.assertEqual(status,200)
        path=next(p for p in result['run']['files'] if p.endswith('/brief.md'))
        brief=(self.root/path).read_text()
        actions=brief.split('## Next actions (up to three)',1)[1].split('## Blocked / later',1)[0]
        self.assertIn('Check prospects',actions)

    def test_snapshot_version_hashes_the_exact_task_bytes_returned(self):
        import hashlib
        before=(self.root/'data/tasks.json').read_bytes()
        original=ui.ultra.read_json
        def external_edit(root,relative):
            if relative=='data/payments.json':
                tasks=json.loads((self.root/'data/tasks.json').read_text())
                tasks[0]['title']='External coordinator edit'
                self.put('data/tasks.json',tasks)
            return original(root,relative)
        with patch.object(ui.ultra,'read_json',side_effect=external_edit):
            snapshot=self.request('/api/workspace')[1]
        self.assertEqual(snapshot['tasks'][0]['title'],'Check prospects')
        self.assertEqual(snapshot['task_version'],hashlib.sha256(before).hexdigest())

    def test_atomic_replace_failure_leaves_original_valid(self):
        before=self.data_bytes()
        with patch.object(ui.os,'replace',side_effect=OSError('disk error')):
            self.assertEqual(self.update()[0],500)
        self.assertEqual(self.data_bytes(),before)
        json.loads((self.root/'data/tasks.json').read_text())

    def test_file_containment_and_allowlist(self):
        for path in ['../data/payments.json','/etc/passwd','.codex/agents/ultra_ops.toml','data/payments.json','docs','docs/../../etc/passwd']:
            from urllib.parse import quote
            self.assertIn(self.request('/api/artifact?path='+quote(path,safe=''))[0],(400,403,404))
        with tempfile.TemporaryDirectory() as outside:
            p=Path(outside)/'secret.md';p.write_text('private')
            (self.root/'docs/escape.md').symlink_to(p)
            self.assertIn(self.request('/api/artifact?path=docs/escape.md')[0],(400,403,404))
        (self.root/'docs/inside.md').symlink_to(self.root/'data/payments.json')
        self.assertIn(self.request('/api/artifact?path=docs/inside.md')[0],(400,403,404))

    def test_artifacts_are_json_text_and_responses_have_security_headers(self):
        status,result,headers=self.request('/api/artifact?path=docs/sample.md')
        self.assertEqual(status,200)
        self.assertEqual(result['content'],'<script>window.pwned=1</script>')
        self.assertIn('application/json',headers['Content-Type'])
        self.assertEqual(headers['X-Content-Type-Options'],'nosniff')
        self.assertIn("frame-ancestors 'none'",headers['Content-Security-Policy'])
        self.assertEqual(headers['Cache-Control'],'no-store')

    def test_business_record_routes_use_versions_and_keep_unknown_payment(self):
        headers={'If-Match':self.snapshot['record_versions']['payments']}
        status,result,_=self.request('/api/payments/owed',{'amount_minor':None,'status':'owed','currency':'TND'},headers)
        self.assertEqual(status,200)
        self.assertIsNone(result['record']['amount_minor'])
        self.assertTrue(result['record']['history'])
        self.assertEqual(self.request('/api/payments/owed',{'notes':'Stale note'},headers)[0],409)
        self.assertEqual(self.request('/api/workspace')[1]['cash']['received_minor'],{})

    def test_owner_can_add_lead_without_inventing_contact(self):
        headers={'If-Match':self.snapshot['record_versions']['leads']}
        status,result,_=self.request('/api/leads',{'company':'Synthetic office','contact_route':'Owner supplied route','status':'discovered'},headers)
        self.assertEqual(status,200)
        self.assertFalse(result['record']['contact_sent'])
        snapshot=self.request('/api/workspace')[1]
        self.assertEqual(len(snapshot['leads']),1)
        self.assertEqual(snapshot['progression']['xp'],0)
        self.assertEqual(self.request('/api/leads/'+result['record']['id'],{'status':'contacted'}, {'If-Match':snapshot['record_versions']['leads']})[0],400)

    def test_planning_route_changes_queue_without_completing_billing_tasks(self):
        headers={'If-Match':self.snapshot['record_versions']['budget']}
        status,result,_=self.request('/api/planning',{'defer_billing':True,'daily_minutes':60},headers)
        self.assertEqual(status,200)
        current=self.request('/api/workspace')[1]
        self.assertNotIn('F01',[t['id'] for t in current['daily_plan']['next']])
        self.assertEqual(next(t['status'] for t in current['tasks'] if t['id']=='F01'),'blocked_on_owner')
        self.assertEqual(result['record']['incremental_spend_limit_tnd'],0)
        self.assertEqual(self.request('/api/planning',{'new_purchase_authorized':True},{'If-Match':current['record_versions']['budget']})[0],400)

    def test_record_writes_keep_existing_origin_and_token_boundary(self):
        before=self.data_bytes()
        for route,collection,body in [('/api/leads','leads',{'company':'Fake'}),
                                      ('/api/payments','payments',{'status':'owed'}),
                                      ('/api/planning','budget',{'daily_minutes':30})]:
            self.assertEqual(self.request(route,body,{'X-Ultra-Token':'wrong','If-Match':self.snapshot['record_versions'][collection]})[0],403)
        self.assertEqual(before,self.data_bytes())

    def test_oversized_body_unknown_action_and_untrusted_get(self):
        self.assertEqual(self.request('/api/prepare',{'junk':'x'*70000})[0],413)
        self.assertEqual(self.request('/api/execute',{})[0],404)
        self.assertEqual(self.request('/api/workspace',headers={'Host':'evil.test'})[0],403)


if __name__=='__main__':unittest.main()

import csv
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import ultra
try:
    import automation
except ImportError:
    automation=None


class AutomationTests(unittest.TestCase):
    def test_practice_choice_has_fixed_feedback_and_no_business_mutation(self):
        before=(self.root/'data/leads.json').read_bytes()
        run=automation.run(self.root,'rehearsal',{'scenario':'messy-pilot','choice':'sample'})
        result=json.loads((run/'result.json').read_text())
        self.assertTrue(result['feedback']['bounded'])
        self.assertFalse(result['awards_business_xp'])
        self.assertEqual(before,(self.root/'data/leads.json').read_bytes())

    def setUp(self):
        self.assertIsNotNone(automation,'The script automation module is not implemented')
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for name in ('data','simulations','context','.codex/agents','schemas'):(self.root/name).mkdir(parents=True)
        self.put('data/tasks.json',[{'id':'F01','phase':0,'priority':100,'owner':'Adem','title':'Record facts','status':'todo','completion_evidence':None,'depends_on':[]}])
        self.put('data/payments.json',[{'id':'owed','mode':'real','status':'owed','currency':'TND','amount_minor':None}])
        self.put('data/leads.json',[{'id':'a','company':'Example Office','kind':'service_prospect','mode':'real','source_url':'https://example.com','contact_route':'Published route','checked_date':'2026-10-04','contact_sent':False,'buyer_need_confirmed':False}])
        self.put('data/exclusions.json',{'companies':[{'company':'Blocked Co','aliases':['BlockedCo']} ]})
        self.put('data/budget.json',{'incremental_spend_limit_tnd':0,'status':'existing_tools_only','live_timeout_seconds':180})
        self.put('simulations/scenarios.json',[{'id':'messy-pilot','mode':'simulation','buyer':'FICTIONAL','constraints':['Unreadable amount'],'exit_evidence':['Keep unclear fields for review']}])
        (self.root/'STATE.md').write_text('Phase 0: readiness')
        (self.root/'AGENTS.md').write_text('Script first')
        (self.root/'context/FOUNDER.md').write_text('Synthetic test facts')
        (self.root/'.codex/agents/ultra_sales.toml').write_text('name = "ultra_sales"\ndeveloper_instructions = "Judgment only"')
        self.put('schemas/agent_result.schema.json',{'type':'object'})

    def put(self,path,data):(self.root/path).write_text(json.dumps(data))
    def data_bytes(self):return {p.name:p.read_bytes() for p in (self.root/'data').iterdir() if p.is_file()}

    def test_all_services_run_without_models_or_real_record_changes(self):
        before=self.data_bytes()
        parameters={'scope-check':{'scope':{}},'csv-workbench':{'csv_text':'id,amount\nA,12.500\n'},'rehearsal':{'scenario':'messy-pilot'}}
        with patch.object(ultra.subprocess,'run',side_effect=AssertionError('No model may run')):
            for item in automation.catalog():
                folder=automation.run(self.root,item['id'],parameters.get(item['id'],{}))
                info=json.loads((folder/'run.json').read_text())
                self.assertEqual(info['engine'],'script')
                self.assertFalse(info['model_invoked'])
                self.assertTrue((folder/'report.md').read_text())
        self.assertEqual(before,self.data_bytes())

    def test_default_roles_use_scripts_even_if_execute_was_requested(self):
        with patch.object(ultra.subprocess,'run',side_effect=AssertionError('No model may run')):
            for role in ultra.ROLES:
                folder=ultra.agent(self.root,role,scenario_id='messy-pilot' if role=='ultra_customer' else None,execute=True)
                self.assertEqual(json.loads((folder/'run.json').read_text())['engine'],'script')

    def test_script_only_roles_cannot_become_live_agents(self):
        with self.assertRaises(ValueError):
            ultra.agent(self.root,'ultra_finance',execute=True,judgment_reason='Use a model anyway')

    def test_finance_retains_unknowns_and_currency_separation(self):
        records=[{'id':'p','mode':'real','status':'received','currency':'TND','amount_minor':1250,'receipt_evidence':'p'},
                 {'id':'u','mode':'real','status':'received','currency':'USD','amount_minor':100,'receipt_evidence':'u'},
                 {'id':'x','mode':'simulation','status':'received','currency':'TND','amount_minor':1000000,'receipt_evidence':'fiction'},
                 {'id':'o','mode':'real','status':'owed','currency':'TND','amount_minor':None}]
        self.put('data/payments.json',records)
        result=automation.finance_pack(self.root)
        self.assertEqual(result['cash']['received_minor'],{'TND':1250,'USD':100})
        self.assertIn('1.250 TND',result['follow_up'])
        self.assertTrue(result['missing_facts'])
        self.assertEqual(result['cash']['unknown_owed'],1)

    def test_lead_audit_matches_aliases_and_flags_unknown_expired_and_duplicates(self):
        leads=[{'id':'a','company':'Blocked.Co','source_url':'https://example.com','checked_date':'2026-10-04'},
               {'id':'b','company':None,'source_url':'https://example.net','checked_date':'2026-10-04'},
               {'id':'c','company':'Other','source_url':'https://elsewhere.example','checked_date':'2026-09-01','expires':'2026-10-01'},
               {'id':'d','company':'BlockedCo','source_url':'https://example.com','checked_date':'2026-10-04'}]
        result=automation.audit_leads(leads,{'companies':[{'company':'Blocked Co','aliases':['BlockedCo']}]},'2026-10-04')
        self.assertFalse(result[0]['eligible'])
        self.assertIn('excluded',result[0]['flags'])
        self.assertIn('unknown_company',result[1]['flags'])
        self.assertIn('expired',result[2]['flags'])
        self.assertIn('stale',result[2]['flags'])
        self.assertIn('duplicate_source',result[3]['flags'])

    def test_csv_preserves_rows_and_flags_conflicting_duplicates_and_bad_amounts(self):
        source='id,amount,name\n A ,12.500, Alice \nA,13.000,Bob\nB,"1,50",Carol\n,4.00,Dave\n'
        result=automation.clean_csv(source)
        output=list(csv.DictReader(io.StringIO(result['cleaned_csv'])))
        self.assertEqual(len(output),4)
        self.assertEqual(output[0],{'id':'A','amount':'12.500','name':'Alice'})
        self.assertEqual(output[2]['amount'],'1,50')
        kinds={issue['kind'] for issue in result['issues']}
        self.assertTrue({'duplicate_conflict','invalid_amount','missing_key'}<=kinds)
        self.assertEqual(result['source_sha256'],hashlib.sha256(source.encode()).hexdigest())

    def test_csv_spreadsheet_formulas_are_neutralized_and_source_is_retained(self):
        source='id,amount,note\nA,1.00,=HYPERLINK("evil")\n'
        result=automation.clean_csv(source)
        self.assertTrue(list(csv.DictReader(io.StringIO(result['cleaned_csv'])))[0]['note'].startswith("'="))
        folder=automation.run(self.root,'csv-workbench',{'csv_text':source})
        self.assertEqual((folder/'source.csv').read_text(),source)

    def test_scope_check_requires_actual_agreement_inputs(self):
        result=automation.check_scope({})
        self.assertFalse(result['ready'])
        self.assertIn('input_permission',result['missing'])
        self.assertIn('acceptance',result['missing'])
        full={'input_permission':True,'fields':['id','amount'],'quantity':20,'exceptions':'Human review',
              'price_minor':100000,'currency':'TND','deadline':'Owner agrees date','acceptance':'All specified fields checked',
              'sample_reference':'permitted/sample.csv','output_format':'CSV','payment_terms':'Agreed milestone',
              'start_condition':'Written acceptance and funded milestone'}
        self.assertTrue(automation.check_scope(full)['ready'])

    def test_bad_tool_parameters_are_rejected_before_run_creation(self):
        for name,params in [('unknown',{}),('csv-workbench',{'csv_text':'a,a\n1,2\n'}),('rehearsal',{'scenario':'missing'}),('finance-pack',{'execute':True})]:
            with self.subTest(name=name),self.assertRaises(ValueError):automation.run(self.root,name,params)
        self.assertFalse((self.root/'runs').exists())

    def test_next_quest_is_not_also_reported_as_blocked(self):
        result=automation.next_quests(self.root)
        self.assertEqual([task['id'] for task in result['next']],['F01'])
        self.assertEqual(result['blocked'],[])

    def test_lead_id_collision_cannot_bypass_an_exclusion(self):
        lead=json.loads((self.root/'data/leads.json').read_text())[0]
        blocked={**lead,'company':'Blocked Co','source_url':'https://blocked.example'}
        self.put('data/leads.json',[lead,blocked])
        folder=automation.run(self.root,'outreach-drafts',{'date':'2026-10-04'})
        result=json.loads((folder/'result.json').read_text())
        self.assertEqual(result['draft_count'],0)
        self.assertTrue(all('duplicate_id' in row['flags'] for row in result['audit']))

    def test_csv_formula_headers_are_neutralized(self):
        source='id,amount,=1+1,+SUM(A1),@foo,-formula\nA,1,note,note,note,note\n'
        result=automation.clean_csv(source)
        header=next(csv.reader(io.StringIO(result['cleaned_csv'])))
        self.assertEqual(header[2:],["'=1+1","'+SUM(A1)","'@foo","'-formula"])
        self.assertEqual(len([i for i in result['issues'] if i['row']==1]),4)

    def test_record_validation_reports_malformed_rows_without_crashing(self):
        for records in ([None],[{'id':[],'status':'done'}],{'bad':'root'}):
            self.put('data/tasks.json',records)
            self.put('data/leads.json',[None])
            result=automation.validate_records(self.root)
            self.assertFalse(result['valid'])
            self.assertTrue(result['errors'])

    def test_judgment_uses_explicit_script_input_and_output(self):
        source='id,amount\nA,1.000\n'
        preflight=automation.run(self.root,'csv-workbench',{'csv_text':source})
        folder=ultra.agent(self.root,'ultra_sales',judgment_reason='Interpret the unusual acceptance requirement',script_run=preflight.name)
        prompt=(folder/'prompt.md').read_text()
        self.assertIn(source,prompt)
        self.assertIn('source_sha256',prompt)
        self.assertEqual(json.loads((folder/'run.json').read_text())['script_preflight'],'runs/'+preflight.name)
        with self.assertRaises(ValueError):
            ultra.agent(self.root,'ultra_sales',judgment_reason='Interpret this requirement',script_run='../outside')

    def test_seeded_blocked_quest_becomes_ready_when_real_dependencies_finish(self):
        self.put('data/tasks.json',[
            {'id':'A','status':'done','owner_confirmed':True,'completion_evidence':'Checked','depends_on':[],'priority':80},
            {'id':'B','status':'blocked','depends_on':['A'],'priority':70},
            {'id':'C','status':'blocked','depends_on':['A'],'priority':60,'updated_at':'Owner blocked explicitly'}])
        self.assertEqual([t['id'] for t in automation.next_quests(self.root)['next']],['B'])


if __name__=='__main__':unittest.main()

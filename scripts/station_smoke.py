"""Bounded HTTP integration checks on copied records. No live model or outreach."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=8550)
    args = parser.parse_args(); project = Path(__file__).resolve().parents[1]
    baseline = {str(p.relative_to(project)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in (project / 'data').glob('*.json')}
    with tempfile.TemporaryDirectory(prefix='1ultra-station-smoke-') as temporary:
        root = Path(temporary)
        for relative in ['STATE.md', 'data/leads.json', 'data/tasks.json', 'data/budget.json', 'data/payments.json',
                         'data/exclusions.json', 'data/game.json', 'simulations/scenarios.json', 'sales/pitch-kit.json']:
            source = project / relative
            if source.exists():
                target = root / relative; target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target)
        original_leads = json.loads((root / 'data/leads.json').read_text())
        (root / 'runs').mkdir()
        runtime = root / 'runtime'; runtime.mkdir()
        # Start with the literal first-generation texts so boot must migrate an existing save.
        agent_texts = json.loads(subprocess.check_output(['node', '-e',
            "const fs=require('node:fs'),path=require('node:path'); const runtime=process.argv[1]; "
            "const {oldTexts,newTexts}=require('./tests/fixtures/station-agent-texts.cjs'); "
            "const durable=(file,value)=>fs.writeFileSync(file,JSON.stringify(value)); "
            "const read=name=>JSON.parse(fs.readFileSync(path.join(runtime,name),'utf8')); "
            "for(const [name,value] of Object.entries(require('./station/ultra-seed.js').files(1000))) "
            "durable(path.join(runtime,name),value); "
            "require('./station/ultra-crew-roster.js').makeRoster({fs,path,runtime,durable,now:()=>1000}).seed(); "
            "const save=read('agent.save.json'); for(const agent of [save.doc.agent,...save.doc.agents]) { "
            "agent.docs={...oldTexts[agent.id]}; agent.purpose=oldTexts[agent.id].purpose; } "
            "durable(path.join(runtime,'agent.save.json'),save); "
            "const roster=read('agent.roster.json'); for(const row of roster.agents) "
            "row.system=Object.values(oldTexts[row.agentId]).join('\\n\\n'); "
            "durable(path.join(runtime,'agent.roster.json'),roster); "
            "console.log(JSON.stringify(newTexts));", str(runtime)], cwd=project, text=True, timeout=20))
        import base64
        b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
        (runtime / 'codex').mkdir()
        (runtime / 'codex' / 'tokens.json').write_text(json.dumps({'access_token': b64({'alg': 'none'}) + '.' + b64({'exp': 4102444800}) + '.fixture', 'refresh_token': 'fixture-refresh', 'last_refresh': '2026-10-10T00:00:00Z', 'auth_mode': 'chatgpt'}))
        import http.server, socketserver, threading
        crew_seen, crew_key = [], 'freellmapi-' + 'ab' * 24
        class FakeFreeLLMAPI(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def send_json(self, status, body, extra=None):
                data = json.dumps(body).encode()
                self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data)))
                for name, value in (extra or {}).items(): self.send_header(name, value)
                self.end_headers(); self.wfile.write(data)
            def do_GET(self):
                if self.path.startswith('/v1/models'):
                    return self.send_json(200, {'object': 'list', 'data': [{'id': 'auto', 'available': True}, {'id': 'smart-model', 'execution_status': 'ready', 'supported_parameters': ['tools']}]})
                self.send_json(404, {'error': {'message': 'not found'}})
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
                crew_seen.append({'path': self.path, 'auth': self.headers.get('Authorization'), 'task': self.headers.get('X-FreeLLM-Task-Type'), 'model': body.get('model')})
                if self.path != '/v1/chat/completions': return self.send_json(404, {'error': {'message': 'not found'}})
                usage = {'prompt_tokens': 5, 'completion_tokens': 3, 'total_tokens': 8}
                if body.get('stream') is False:
                    return self.send_json(200, {'id': 'c1', 'object': 'chat.completion', 'model': 'smart-model', 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'fixture crew reply'}, 'finish_reason': 'stop'}], 'usage': usage}, {'X-Routed-Via': 'fixture/smart-model'})
                chunk = lambda delta, finish=None, extra=None: 'data: ' + json.dumps({'id': 'c1', 'object': 'chat.completion.chunk', 'created': 0, 'model': 'smart-model', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}], **(extra or {})}) + '\n\n'
                data = (chunk({'role': 'assistant', 'content': 'fixture crew reply'}) + chunk({}, 'stop', {'usage': usage}) + 'data: [DONE]\n\n').encode()
                self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('X-Routed-Via', 'fixture/smart-model')
                self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        fake = socketserver.ThreadingTCPServer(('127.0.0.1', 0), FakeFreeLLMAPI); fake.daemon_threads = True
        crew_port = fake.server_address[1]
        threading.Thread(target=fake.serve_forever, daemon=True).start()
        (runtime / '.secrets').mkdir(mode=0o700)
        (runtime / '.secrets' / 'freellmapi.json').write_text(json.dumps({'baseUrl': f'http://127.0.0.1:{crew_port}/v1', 'key': crew_key}))
        (runtime / 'model-tiers.json').write_text(json.dumps({'version': 1, 'models': {'fixture/smart-model': {'canonicalId': 'smart-model', 'tier': 'smart', 'tools': True, 'vision': False}}}))
        (runtime / 'ultra-control.json').write_text('{"halted": true}\n')
        (runtime / 'ultra-state.json').write_text(json.dumps({'version': 1, 'world': None, 'workstreams': None, 'companySessions': {}, 'crew': {}, 'memory': [], 'tasks': [], 'workflows': [], 'workflowRuns': {}, 'focus': None, 'settings': {'theme': 'dark', 'text': 16, 'reducedMotion': False}, 'history': [{'at': 'fixture', 'fields': ['settings']}]}) + '\n')
        log = open(root / 'station.log', 'w+')
        proc = subprocess.Popen(['node', str(project / 'station/sidecar/index.js')], cwd=project,
            env={'PATH': os.environ['PATH'], 'LANG': 'C.UTF-8', 'ULTRA_ROOT': str(root),
                 'ULTRA_RUNTIME': str(root / 'runtime'), 'ULTRA_PORT': str(args.port), 'ULTRA_FREELLMAPI_PORT': str(crew_port)}, stdout=log, stderr=log)
        base = f'http://127.0.0.1:{args.port}'; token = ''
        def request(route, body=None, version=None, expected=200, authenticated=True):
            headers = {'X-Starnet-Token': token} if authenticated else {}
            if body is not None: headers.update({'Origin': base, 'Content-Type': 'application/json'})
            if version: headers['If-Match'] = version
            req = urllib.request.Request(base + route, data=json.dumps(body).encode() if body is not None else None, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=10) as response: status, data = response.status, response.read()
            except urllib.error.HTTPError as error: status, data = error.code, error.read()
            assert status == expected, (route, status, data[:160])
            return json.loads(data) if data.startswith(b'{') else data.decode()
        def boot():
            nonlocal token, proc
            proc = subprocess.Popen(['node', str(project / 'station/sidecar/index.js')], cwd=project,
                env={'PATH':os.environ['PATH'],'LANG':'C.UTF-8','ULTRA_ROOT':str(root),'ULTRA_RUNTIME':str(root/'runtime'),'ULTRA_PORT':str(args.port), 'ULTRA_FREELLMAPI_PORT': str(crew_port)},stdout=log,stderr=log)
            for attempt in range(60):
                try:
                    page=request('/',authenticated=False)
                    token=json.loads(re.search(r'window.__STARNET_API_TOKEN__=([^;]+);',page).group(1)); return
                except (urllib.error.URLError,ConnectionError): time.sleep(.1)
            raise RuntimeError('Restart deadline exceeded')
        def wait_job(id):
            for attempt in range(60):
                rows=request('/api/ultra/runtime')['jobs']; row=next(j for j in rows if j['id']==id)
                if row['status']!='running':return row
                time.sleep(.1)
            raise AssertionError('Job completion deadline exceeded')
        def fixture_python(code, payload):
            assert root.resolve() != project, 'Campaign tools must only write to the copied fixture root'
            return json.loads(subprocess.check_output(['python3', '-c',
                'import json, sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); '
                'import campaign, campaign_tools; from ultra_ui import Workspace; '
                'root = Path(sys.argv[2]); store = campaign.Campaign(Workspace(root, root)); '
                'args = json.loads(sys.argv[3]); ' + code,
                str(project / 'scripts'), str(root), json.dumps(payload)], cwd=root,
                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, text=True, timeout=20))
        checks = []
        try:
            for attempt in range(60):
                if proc.poll() is not None:
                    log.seek(0); raise RuntimeError('Station stopped: ' + log.read()[-2000:])
                try: page = request('/', authenticated=False); break
                except (urllib.error.URLError, ConnectionError): time.sleep(.1)
            else: raise RuntimeError('Station boot deadline exceeded.')
            assert '1Ultra' in page
            token = json.loads(re.search(r'window.__STARNET_API_TOKEN__=([^;]+);', page).group(1))
            assert request('/api/ultra/runtime')['halted'] is True, 'existing emergency stop must survive'
            assert request('/api/ultra/runtime')['state']['history'][0]['at'] == 'fixture'
            assert (runtime / 'agent.save.json').is_file() and json.loads((runtime / 'agent.save.json').read_text())['doc']['agent']['name'] == 'ULTRA'
            request('/api/ultra/control', {'action': 'resume'})
            checks.append('existing runtime kept (stop, state); seed added only missing files')
            doc = json.loads((runtime / 'agent.save.json').read_text())['doc']
            agents = [doc['agent'], *doc['agents']]
            assert {agent['id'] for agent in agents} == set(agent_texts)
            for agent in agents:
                assert agent['docs'] == agent_texts[agent['id']], agent['id']
                assert agent['purpose'] == agent_texts[agent['id']]['purpose'], agent['id']
                assert 'nothing leaves the station without Adem' in agent['docs']['manual'], agent['id']
            assert json.loads((runtime / 'ultra-crew.json').read_text())['textsVersion'] == 2
            checks.append('Agent text migration: old ULTRA and crew texts become lenient defaults at boot; textsVersion 2')
            workspace = request('/api/ultra/workspace'); campaign = request('/api/ultra/campaign')
            page = request('/campaign/', authenticated=False)
            assert '1Ultra' in page and 'window.__STARNET_API_TOKEN__=' in page and '/campaign/ultra-app.js' in page
            assert 'function go(' in request('/campaign/ultra-app.js', authenticated=False)
            for escape in ['/campaign/../sidecar/index.js', '/campaign/%2e%2e/ultra-host.js', '/campaign/..%2fultra-host.js']:
                request(escape, authenticated=False, expected=404)
            checks.append('campaign page served at /campaign/ and path-jailed')
            sw = request('/api/ultra/switches')
            values = {row['id']: row['value'] for row in sw['switches']}
            assert values['lead.codex'] is False and values['concurrency'] == 2 and values['crew.escalate_to_lead'] is True
            request('/api/ultra/switches', {'id': 'tools.browser', 'value': True}, sw['version'], expected=409)
            request('/api/ultra/switches', {'id': 'concurrency', 'value': 3}, 'stale', expected=409)
            sw = request('/api/ultra/switches', {'id': 'concurrency', 'value': 3}, sw['version'])
            assert {r['id']: r['value'] for r in sw['switches']}['concurrency'] == 3
            request('/api/ultra/switches', {'id': 'concurrency', 'value': 2}, sw['version'])
            checks.append('owner switches: defaults, readiness refusal, stale refusal, change')
            classes = request('/api/ultra/route-classes')
            assert len(classes['routes']) > 300 and classes['unclassified'] == [], classes['unclassified']
            refused = request('/api/run', {'messages': []}, expected=403)
            assert refused['switch'] == 'models' and 'lead.codex' in refused['error'] and 'crew.freellmapi' in refused['error']
            request('/api/save?agent=agent')  # local family answers 200 (request() raises on any other status)
            request('/v1/chat/completions', {'model': 'x'}, expected=403)
            checks.append('route classes: none unclassified; model route refused with its switch; local routes answer')
            request('/api/ultra/control', {'action': 'stop'})
            assert request('/api/halt')['halted'] is True, '1Ultra stop must halt Starnet too'
            request('/api/halt/resume', {'confirm': True})
            assert request('/api/ultra/runtime')['halted'] is False, "Starnet RESUME clears the 1Ultra stop"
            request('/api/halt', {})
            assert request('/api/ultra/runtime')['halted'] is True, "Starnet E-STOP sets the 1Ultra stop"
            request('/api/halt/resume', {'confirm': True})
            assert request('/api/ultra/runtime')['halted'] is False
            checks.append('one emergency stop: 1Ultra stop halts Starnet; Starnet E-STOP and RESUME drive the 1Ultra stop')
            blessed = request('/api/projects/bless', {'path': str(root)}, expected=400)
            assert blessed.get('ok') is not True, blessed
            assert str(root) not in json.dumps(request('/api/projects')), 'the 1Ultra root must never become a project'
            checks.append('the 1Ultra project folder cannot be blessed as an agent project')
            sw = request('/api/ultra/switches'); request('/api/ultra/switches', {'id': 'lead.codex', 'value': True}, sw['version'])
            proc.terminate(); proc.wait(timeout=10); boot()
            status = request('/api/auth/codex/status')
            assert status.get('connected') is True, status
            request('/api/ultra/control', {'action': 'stop'})
            req = urllib.request.Request(base + '/api/run', data=json.dumps({'provider': 'codex', 'model': 'gpt-6.1-sol', 'reasoningEffort': 'xhigh', 'messages': [{'role': 'user', 'content': 'fixture'}], 'agentId': 'agent'}).encode(),
                                         headers={'X-Starnet-Token': token, 'Origin': base, 'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=20) as response: body = response.read().decode()
            except urllib.error.HTTPError as error: body = error.read().decode()
            assert 'Emergency stop' in body, body[:300]
            request('/api/halt/resume', {'confirm': True})
            sw = request('/api/ultra/switches'); request('/api/ultra/switches', {'id': 'lead.codex', 'value': False}, sw['version'])
            checks.append('Codex lead: tokens load while lead.codex is on; the emergency stop refuses the run before any model call')
            def run_body(payload):
                req = urllib.request.Request(base + '/api/run', data=json.dumps(payload).encode(),
                                             headers={'X-Starnet-Token': token, 'Origin': base, 'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=30) as response: return response.read().decode()
            def set_switch(sid, value):
                sw = request('/api/ultra/switches'); request('/api/ultra/switches', {'id': sid, 'value': value}, sw['version'])
            set_switch('crew.freellmapi', True)
            crew = request('/api/ultra/crew')
            assert crew['reachable'] and crew['keyAccepted'] and crew['readyModels'] == 1, crew
            assert [m['agentId'] for m in crew['members']] == ['research', 'delivery', 'sales', 'qa'] and all(m['ready'] for m in crew['members']), crew
            body = run_body({'agentId': 'sales', 'provider': 'custom', 'model': 'auto:smart', 'messages': [{'role': 'user', 'content': 'fixture'}]})
            assert 'fixture crew reply' in body, body[:300]
            chat = [s for s in crew_seen if s['path'] == '/v1/chat/completions']
            assert chat and chat[-1] == {'path': '/v1/chat/completions', 'auth': 'Bearer ' + crew_key, 'task': 'chat', 'model': 'auto:smart'}, crew_seen
            row = next(r for r in request('/api/runs?agent=sales')['runs'] if r.get('provider') == 'custom')
            assert row['usd'] == 0 and row['ultraRouting'][-1]['routedVia'] == 'fixture/smart-model', row
            checks.append('Crew on FreeLLMAPI: seeded crew ready, unified key and task type sent, routed model recorded, cost $0')
            (runtime / 'codex' / 'tokens.json').unlink()
            proc.terminate(); proc.wait(timeout=10); boot()
            set_switch('lead.codex', True)
            body = run_body({'agentId': 'agent', 'provider': 'codex', 'model': 'gpt-6.1-sol', 'messages': [{'role': 'user', 'content': 'fixture'}]})
            assert 'lead running on free tier' in body and 'fixture crew reply' in body, body[:400]
            assert crew_seen[-1]['model'] == 'auto:smart' and crew_seen[-1]['task'] is None, crew_seen[-1]
            set_switch('lead.codex', False); set_switch('crew.freellmapi', False)
            checks.append('Lead fallback: a signed-out Codex lead continues on the free tier with a visible notice')
            assert len(workspace['leads']) == len(json.loads((root / 'data/leads.json').read_text()))
            checks.append('Authenticated workspace and deterministic ranking')
            lead = workspace['hunt']['leads'][0]
            # /tools only lists toggleable families; station.inspect has no tool list.
            # Check the host registration and generated computer grants instead.
            subprocess.run(['node', '-e',
                "const assert=require('node:assert/strict'); const tools=[]; "
                "require('./station/ultra-host.js').registerCampaignTools({register:t=>tools.push(t)}); "
                "const {CAP_REGISTRY}=require('./station/sidecar/capability/registry.js'); "
                "const want={'campaign.leads':'read','campaign.lead':'read','campaign.check_draft':'read',"
                "'campaign.save_draft':'write','campaign.propose_lead':'write','campaign.pitch_kit':'read'}; "
                "assert.equal(tools.length,6); "
                "assert.deepEqual(Object.fromEntries(tools.map(t=>[t.name,t.scope])),want); "
                "const grants=CAP_REGISTRY.computer.filter(g=>g.capId==='campaign'); "
                "assert.equal(grants.length,6); "
                "assert.deepEqual(Object.fromEntries(grants.map(g=>[g.tool,g.scope])),want); "
                "assert.ok(grants.every(g=>!g.requiresConsent&&!g.network));"], cwd=project,
                env={**os.environ, 'ULTRA_ROOT': str(root), 'ULTRA_RUNTIME': str(root / 'runtime'),
                     'ULTRA_FREELLMAPI_PORT': str(crew_port)},
                check=True, timeout=20)
            campaign = request('/api/ultra/campaign')
            contact = {'lead_id': lead['id'], 'name': 'FICTIONAL smoke contact person', 'role': 'Fixture buyer',
                'route': 'smoke-private@example.invalid', 'source_url': 'https://example.invalid/team',
                'checked_on': workspace['local_date']}
            request('/api/ultra/campaign/contact', contact, campaign['version'])
            packet = fixture_python('print(json.dumps(campaign_tools.packet(store, args)))', {'id': lead['id']})
            copied_lead = next(row for row in original_leads if row['id'] == lead['id'])
            assert packet['lead']['has_contact_route'] is bool(copied_lead.get('contact_route'))
            assert 'contact_route' not in packet['lead']
            assert packet['contacts'] == [{'role': 'Fixture buyer', 'channel': 'email',
                'source_url': contact['source_url'], 'checked_on': contact['checked_on']}]
            for private in [contact['name'], contact['route']]: assert private not in json.dumps(packet)
            for route in ['leads', 'lead', 'check-draft', 'save-draft', 'propose-lead', '']:
                request('/api/ultra/tools/' + route, expected=404)
                request('/api/ultra/tools/' + route, {}, expected=404)
            assert json.loads((root / 'data/leads.json').read_text()) == original_leads
            checks.append('Campaign tools: ULTRA and the crew get campaign.* tools; a crew packet carries no contact route or names; /api/ultra/tools/ answers 404')
            kit = fixture_python('print(json.dumps(campaign_tools.pitch_kit(store, args)))', {})
            assert kit['sender']['fr'] == 'Adem Sayari, ingénieur IA et data science, basé à Sousse'
            request('/api/ultra/tools/pitch-kit', expected=404)
            checks.append("Pitch kit: copied-root campaign tool returns Adem's sender line; /api/ultra/tools/pitch-kit GET answers 404")
            campaign = request('/api/ultra/campaign')
            assert campaign['crew_drafts'] == [] and campaign['proposals'] == []
            proposal = fixture_python('print(json.dumps(campaign_tools.propose_lead(store, args, "research")))',
                {'company': 'FICTIONAL Smoke Proposal ' + root.name, 'country': 'TN', 'location': 'Tunis',
                 'website': 'https://station-smoke.example.invalid', 'source_url': 'https://station-smoke.example.invalid/services',
                 'observed_on': workspace['local_date'], 'quote': 'FICTIONAL HTTP TEST: this copied fixture company publishes services.'})
            campaign = request('/api/ultra/campaign')
            assert campaign['proposals'] == [proposal] and proposal['status'] == 'proposed'
            assert json.loads((root / 'data/leads.json').read_text()) == original_leads
            request('/api/ultra/campaign/accept-proposal', {'id': proposal['id']}, 'stale', expected=409)
            accepted = request('/api/ultra/campaign/accept-proposal', {'id': proposal['id']}, campaign['version'])['record']
            assert accepted['status'] == 'accepted'
            copied_leads = json.loads((root / 'data/leads.json').read_text())
            assert copied_leads[:-1] == original_leads and len(copied_leads) == len(original_leads) + 1
            accepted_lead = copied_leads[-1]
            assert accepted_lead['id'] == accepted['lead_id'] and accepted_lead['source_type'] == 'crew_proposal'
            assert accepted_lead['company'] == proposal['company'] and accepted_lead['observed_text'] == proposal['quote']
            assert accepted_lead['contact_sent'] is False and accepted_lead['buyer_need_confirmed'] is False
            draft = fixture_python('print(json.dumps(campaign_tools.save_draft(store, args, "sales")))',
                {'lead_id': accepted_lead['id'], 'subject': 'FICTIONAL HTTP TEST', 'language': 'fr',
                 'body': 'Bonjour, un petit échantillon à vérifier ensemble vous intéresserait-il ?'})
            campaign = request('/api/ultra/campaign')
            assert campaign['crew_drafts'] == [draft] and draft['reviewed'] is False and draft['status'] == 'proposed'
            assert campaign['proposals'] == [accepted]
            for relative, digest in baseline.items(): assert hashlib.sha256((project / relative).read_bytes()).hexdigest() == digest
            checks.append('LEADS: /api/ultra/campaign carries crew_drafts and proposals; accept-proposal adds a crew_proposal lead in the copied records only; the original business records are unchanged')
            proof = request('/api/ultra/campaign/proof', {'lead_id': lead['id'], 'offer': 'documents'}, campaign['version'])['proof']
            artifact = request('/api/ultra/artifact?path=' + proof['path'])
            assert 'SYNTHETIC' in artifact['content'] and 'UNSENT' in artifact['content']
            checks.append('Company proof pack opens an actual checked artifact')
            campaign = request('/api/ultra/campaign')
            reply = request('/api/ultra/campaign/event', {'lead_id': lead['id'], 'kind': 'reply', 'text': 'Please send an example',
                'on': workspace['local_date'], 'evidence': 'FICTIONAL HTTP TEST fixture reply', 'confirmed': True}, campaign['version'])['event']
            campaign = request('/api/ultra/campaign')
            request('/api/ultra/campaign/interpret', {'id': reply['id'], 'intent': 'example', 'confirmed': True}, campaign['version'])
            campaign = request('/api/ultra/campaign')
            assert campaign['events'][0]['text'] == 'Please send an example' and campaign['events'][0]['branch']['action'] == 'proof'
            checks.append('Original reply → confirmed example branch')
            request('/api/ultra/campaign/followup', {'lead_id': lead['id'], 'text': 'Test stale write'}, 'stale', expected=409)
            runtime = request('/api/ultra/runtime')
            request('/api/ultra/runtime', {'memory': [{'id': 'test-note', 'content': 'FICTIONAL TEST', 'status': 'hypothesis', 'source': 'Fixture evidence'}]}, runtime['version'])
            checks.append('Runtime save and stale business-write refusal')
            job = request('/api/ultra/jobs', {'desk': 'qa', 'tool': 'validate-records', 'params': {}})
            for attempt in range(60):
                runtime = request('/api/ultra/runtime'); row = next(j for j in runtime['jobs'] if j['id'] == job['id'])
                if row['status'] != 'running': break
                time.sleep(.1)
            assert row['status'] == 'prepared', row
            assert row['result']['run']['engine'] == 'script' and row['result']['run']['files']
            checks.append('Script job produces genuine run files')
            runtime=request('/api/ultra/runtime')
            workflow={'id':'fixture-flow','name':'Fixture audit and review','nodes':[
                {'id':'audit','kind':'script','tool':'validate-records','desk':'qa','params':{}},
                {'id':'review','kind':'owner','label':'Inspect source audit'}],'edges':[['audit','review']]}
            request('/api/ultra/runtime',{'workflows':[workflow]},runtime['version'])
            step=request('/api/ultra/workflows/step',{'id':'fixture-flow'})
            assert wait_job(step['id'])['status']=='prepared'
            checkpoint=request('/api/ultra/workflows/step',{'id':'fixture-flow'})
            assert checkpoint['checkpoint']['id']=='review'
            request('/api/ultra/workflows/step',{'id':'fixture-flow','confirmed':True})
            assert request('/api/ultra/workflows/step',{'id':'fixture-flow'})['complete']
            runtime=request('/api/ultra/runtime')
            request('/api/ultra/runtime',{'workflowRuns':{}},runtime['version'],expected=400)
            checks.append('Workflow script receipt → owner checkpoint → durable completion; forged progress refused')
            focus=request('/api/ultra/focus?minutes=20');assert focus['planned_minutes']<=20 and not focus['awards_xp']
            ready=request('/api/ultra/readiness');assert ready['providers'] and all(not p['connected'] for p in ready['providers'])
            checks.append('Bounded focus planner and honest unconnected provider catalog')
            stream={'workstreams':[{'id':'fixture-session','kind':'chat','title':'Fixture company','history':[{'role':'user','content':'Source-linked preparation note'}]}],'activeId':'fixture-session'}
            runtime=request('/api/ultra/runtime')
            request('/api/ultra/runtime',{'workstreams':stream,'companySessions':{lead['id']:'fixture-session'}},runtime['version'])
            request('/api/ultra/briefs',{'streamId':'fixture-session','directive':'Prepare a source check','question':'Which output?','answer':'One reviewed report'})
            runtime=request('/api/ultra/runtime');assert runtime['briefs'][0]['questions'][0]['answer']=='One reviewed report'
            request('/api/ultra/memory',{'action':'feedback','id':'test-note'},runtime['version'])
            runtime=request('/api/ultra/runtime')
            unresolved={'id':'scope-missing','nodes':[{'id':'scope','kind':'script','tool':'scope-check','desk':'delivery','params':{'scope':{}}},{'id':'next','kind':'owner'}],'edges':[['scope','next']]}
            request('/api/ultra/runtime',{'workflows':[workflow,unresolved]},runtime['version'])
            missing=request('/api/ultra/workflows/step',{'id':'scope-missing'})
            assert wait_job(missing['id'])['status']=='needs_review'
            progress=request('/api/ultra/runtime')['state']['workflowRuns']['scope-missing']
            assert 'scope' not in progress['completed']
            request('/api/ultra/jobs',{'desk':'qa','tool':'validate-records','workflowId':'scope-missing','nodeId':'scope'},expected=400)
            checks.append('Unresolved script checks and forged job metadata cannot advance workflows')
            request('/api/ultra/control',{'action':'stop'})
            request('/api/ultra/automate',{'automation':'lead-audit','params':{}},expected=400)
            campaign=request('/api/ultra/campaign')
            request('/api/ultra/campaign/proof',{'lead_id':lead['id'],'offer':'documents'},campaign['version'],expected=400)
            request('/api/ultra/jobs',{'desk':'qa','tool':'validate-records'},expected=400)
            proc.terminate();proc.wait(timeout=5);boot()
            runtime=request('/api/ultra/runtime')
            assert runtime['halted'] and runtime['state']['workflowRuns']['fixture-flow']['checkpoints']==['review']
            assert runtime['state']['workstreams']['workstreams'][0]['history'][0]['content']=='Source-linked preparation note'
            assert runtime['briefs'][0]['originalDirective']=='Prepare a source check'
            assert len(runtime['state']['memory'][0]['feedback'])==1
            request('/api/ultra/jobs',{'desk':'qa','tool':'validate-records'},expected=400)
            request('/api/ultra/briefs',{'streamId':'fixture-session','directive':'Corrected preparation instruction','question':'Which exceptions?','answer':'Keep unknown values'})
            current=request('/api/ultra/runtime')['briefs']
            assert len({b['id'] for b in current})==len(current)
            assert current[0]['originalDirective']=='Prepare a source check' and current[0]['questions'][0]['answer'].endswith('Keep unknown values')
            checks.append('Brief corrections preserve the original task without duplicate IDs')
            request('/api/ultra/control',{'action':'resume'})
            checks.append('Restart preserves sessions, briefs, memory feedback, workflows and emergency stop')
            for route in ['/api/run', '/api/cron/arm', '/v1/chat/completions', '/api/plugins/allow', '/api/plugins/call']:
                request(route, {}, expected=403)
            request('/api/ultra/workspace', expected=403, authenticated=False)
            checks.append('Live model, scheduler, plugin execution and unauthenticated API denied')
            classic = request('/classic/', authenticated=False)
            assert '/classic/game-app.js' in classic and 'ULTRA_API_BASE' in classic
            assert 'loadWorkspace' in request('/classic/game-app.js', authenticated=False)
            checks.append('Classic interface and namespaced assets served')
            assert json.loads((root / 'data/leads.json').read_text()) == [*original_leads, accepted_lead]
            for relative, digest in baseline.items(): assert hashlib.sha256((project / relative).read_bytes()).hexdigest() == digest
            checks.append('Project business records unchanged by fixture tests')
            print(json.dumps({'passed': len(checks), 'checks': checks, 'browser_rendered': False, 'live_provider_tested': False}, indent=2))
        finally:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
            log.close()
            fake.shutdown()


if __name__ == '__main__': main()

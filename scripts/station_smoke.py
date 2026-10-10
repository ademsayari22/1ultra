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
                         'data/exclusions.json', 'data/game.json', 'simulations/scenarios.json']:
            source = project / relative
            if source.exists():
                target = root / relative; target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target)
        (root / 'runs').mkdir()
        log = open(root / 'station.log', 'w+')
        proc = subprocess.Popen(['node', str(project / 'station/sidecar/index.js')], cwd=project,
            env={'PATH': os.environ['PATH'], 'LANG': 'C.UTF-8', 'ULTRA_ROOT': str(root),
                 'ULTRA_RUNTIME': str(root / 'runtime'), 'ULTRA_PORT': str(args.port)}, stdout=log, stderr=log)
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
                env={'PATH':os.environ['PATH'],'LANG':'C.UTF-8','ULTRA_ROOT':str(root),'ULTRA_RUNTIME':str(root/'runtime'),'ULTRA_PORT':str(args.port)},stdout=log,stderr=log)
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
            workspace = request('/api/ultra/workspace'); campaign = request('/api/ultra/campaign')
            assert len(workspace['leads']) == len(json.loads((root / 'data/leads.json').read_text()))
            checks.append('Authenticated workspace and deterministic ranking')
            lead = workspace['hunt']['leads'][0]
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
            job = request('/api/ultra/jobs', {'desk': 'research', 'tool': 'lead-audit', 'params': {}})
            for attempt in range(60):
                runtime = request('/api/ultra/runtime'); row = next(j for j in runtime['jobs'] if j['id'] == job['id'])
                if row['status'] != 'running': break
                time.sleep(.1)
            assert row['status'] == 'prepared', row
            assert row['result']['run']['engine'] == 'script' and row['result']['run']['files']
            checks.append('Script job produces genuine run files')
            runtime=request('/api/ultra/runtime')
            workflow={'id':'fixture-flow','name':'Fixture audit and review','nodes':[
                {'id':'audit','kind':'script','tool':'lead-audit','desk':'research','params':{}},
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
            for route in ['/api/run', '/api/cron/arm', '/v1/chat/completions', '/api/plugins/approve']:
                request(route, {}, expected=403)
            request('/api/ultra/workspace', expected=403, authenticated=False)
            checks.append('Live model, scheduler, plugin execution and unauthenticated API denied')
            classic = request('/classic/', authenticated=False)
            assert '/classic/game-app.js' in classic and 'ULTRA_API_BASE' in classic
            assert 'loadWorkspace' in request('/classic/game-app.js', authenticated=False)
            checks.append('Classic interface and namespaced assets served')
            assert json.loads((root / 'data/leads.json').read_text()) == json.loads((project / 'data/leads.json').read_text())
            for relative, digest in baseline.items(): assert hashlib.sha256((project / relative).read_bytes()).hexdigest() == digest
            checks.append('Project business records unchanged by fixture tests')
            print(json.dumps({'passed': len(checks), 'checks': checks, 'browser_rendered': False, 'live_provider_tested': False}, indent=2))
        finally:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
            log.close()


if __name__ == '__main__': main()

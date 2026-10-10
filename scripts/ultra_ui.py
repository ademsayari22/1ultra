"""1Ultra local interface. Run: python3 scripts/ultra_ui.py --port 8541."""

import argparse
import datetime
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ultra
import quests
import automation
import records
import prospecting

PHASES = [
    {'id':0,'name':'Find Tunisian leads','window':'Days 1–3','gate':'Review five sourced Tunisian B2B companies and select five relevant prospects.'},
    {'id':1,'name':'Prepare convincing pitches','window':'Days 2–7','gate':'Choose a small offer, check a permitted example and review three company-specific pitches.'},
    {'id':2,'name':'Win a conversation','window':'Days 3–14','gate':'Record actual contact and buyer replies; agree one bounded pilot and its start condition.'},
    {'id':3,'name':'Deliver the pilot','window':'After agreement','gate':'Scoped checks pass, buyer accepts and actual payment and effort are recorded.'},
    {'id':4,'name':'Repeat in Tunisia','window':'After delivery','gate':'A paying buyer identifies a recurring need or evidence supports refining the local target.'},
]
STATUS = {'todo','in_progress','blocked','blocked_on_owner','done'}
ARTIFACT_ROOTS = ('docs/','sales/templates/','delivery/templates/','finance/','simulations/worked-example/')
RUN_FILES = {'brief.md','prompt.md','result.json','scenario.json','role_prompts.md','run.json','report.md','follow_up.md','outreach.md','source.csv','cleaned.csv'}
EMPTY_GAME = b'{"version":1,"gates":{}}\n'


class RequestError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Workspace:
    def __init__(self, root, static_root):
        self.root, self.static_root = Path(root).resolve(), Path(static_root).resolve()
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()

    def task_version(self):
        return hashlib.sha256(ultra.inside(self.root,'data/tasks.json').read_bytes()).hexdigest()

    def record_version(self, collection):
        if collection not in ('leads', 'payments', 'budget'):
            raise RequestError(404, 'Unknown record collection.')
        return hashlib.sha256(ultra.inside(self.root, f'data/{collection}.json').read_bytes()).hexdigest()

    def update_record(self, collection, record_id, body, expected_version):
        with self.lock:
            if expected_version.strip('"') != self.record_version(collection):
                raise RequestError(409, 'Records changed. Refresh and review your unsaved edit.')
            path = ultra.inside(self.root, f'data/{collection}.json')
            current = json.loads(path.read_text())
            try:
                if collection == 'budget':
                    updated = records.journal(current, records.planning_edit(current, body))
                    self.atomic_json(path, updated, '.planning-')
                    return {'record': updated, 'record_version': self.record_version(collection)}
                before = next((row for row in current if row['id'] == record_id), None) if record_id else None
                if record_id and before is None:
                    raise RequestError(404, 'Record not found.')
                if before and before.get('mode', 'real') != 'real':
                    raise ValueError('Only real records can be edited here.')
                if collection == 'leads':
                    base = before or {'kind': 'service_prospect', 'status': 'discovered', 'contact_sent': False, 'buyer_need_confirmed': False}
                    updated = records.lead_edit(base, body, ultra.read_json(self.root, 'data/exclusions.json'))
                else:
                    base = before or {'status': 'owed', 'amount_minor': None, 'currency': 'TND'}
                    updated = records.payment_edit(base, body)
                updated['id'] = record_id or collection[:-1] + '-' + secrets.token_hex(6)
                updated = records.journal(before or {}, updated)
                candidate = [updated if row['id'] == record_id else row for row in current] if record_id else [*current, updated]
                if collection == 'payments':
                    ultra.cash_summary(candidate)
                self.atomic_json(path, candidate, '.record-')
                return {'record': updated, 'record_version': self.record_version(collection)}
            except ValueError as error:
                raise RequestError(400, str(error)) from None

    def run_info(self, folder):
        folder = ultra.inside(self.root, folder)
        relative = str(folder.relative_to(self.root) / 'run.json')
        info = json.loads(ultra.inside(self.root,relative).read_text())
        if not isinstance(info,dict):raise ValueError('Invalid run metadata')
        return {**{k:info.get(k) for k in ('mode','status','role','kind','scenario','engine','automation','judgment_reason',
                                         'reasoning_effort','model_requested','role_config','skills','agent_settings')},
                'id':folder.name,'created_at':datetime.datetime.fromtimestamp(folder.stat().st_mtime,datetime.timezone.utc).isoformat(),
                'files':[str(p.relative_to(self.root)) for p in sorted(folder.iterdir())
                         if p.is_file() and not p.is_symlink() and p.name in RUN_FILES]}

    def runs(self):
        path = ultra.inside(self.root,'runs')
        if not path.exists():return []
        result=[]
        for folder in sorted(path.iterdir(),key=lambda p:p.stat().st_mtime,reverse=True)[:60]:
            if folder.is_symlink() or not folder.is_dir() or not (folder/'run.json').is_file():continue
            try:result.append(self.run_info(folder))
            except (ValueError,OSError):continue
        return result

    def snapshot(self):
        with self.lock:
            task_bytes=ultra.inside(self.root,'data/tasks.json').read_bytes()
            task_version=hashlib.sha256(task_bytes).hexdigest()
            tasks=json.loads(task_bytes)
            game_bytes=self.game_bytes();game=json.loads(game_bytes)
            progression=quests.progress(tasks,game)
            completed=set(progression['effective_done_ids'])
            daily_plan=automation.next_quests(self.root)
            deferred_ids={t['id'] for t in daily_plan['deferred']}
            tasks=[{**t,'unmet_dependencies':[d for d in t.get('depends_on',[]) if d not in completed],
                    'ready':quests.ready(t,completed) and t['id'] not in deferred_ids and (not t.get('next_action_on') or t['next_action_on']<=daily_plan['date']),
                    'effective_done':t['id'] in completed,'training':quests.training(t),
                    'xp_eligible':t['id'] in progression['eligible_task_ids'],
                    'default_script':automation.DEFAULTS.get(t.get('owner'))} for t in tasks]
            roles=[]
            for role in ultra.ROLES:
                p=ultra.inside(self.root,f'.codex/agents/{role}.toml')
                match=re.search(r'^description\s*=\s*(".*")\s*$',p.read_text(),re.M) if p.is_file() else None
                tool=next(t for t in automation.catalog() if t['id']==automation.default_script(role))
                roles.append({'id':role,'description':json.loads(match.group(1)) if match else tool['description'],
                              'default_script':tool['id'],'engine':'script','judgment_available':role not in automation.SCRIPT_ONLY and p.is_file(),
                              'task_count':sum(t['owner']==role for t in tasks)})
            from campaign import Campaign, lead_view
            campaign_state = Campaign(self).read()
            business = {name: ultra.inside(self.root, f'data/{name}.json').read_bytes() for name in ('leads', 'payments', 'budget')}
            payments = json.loads(business['payments'])
            state=ultra.inside(self.root,'STATE.md').read_text()
            phase=re.search(r'Phase (\d)',state)
            return {'csrf_token':self.token,'task_version':task_version,
                    'tasks':tasks,'leads':json.loads(business['leads']),
                    'payments':payments,'cash':ultra.cash_summary(payments),
                    'budget':json.loads(business['budget']),'roles':roles,
                    'record_versions':{name: hashlib.sha256(raw).hexdigest() for name, raw in business.items()},
                    'daily_plan':daily_plan, 'local_date':records.local_today().isoformat(),
                    'scenarios':ultra.read_json(self.root,'simulations/scenarios.json'),
                    'runs':self.runs(),'phases':PHASES,'active_phase':int(phase.group(1)) if phase else 0,
                    'game':game,'game_version':hashlib.sha256(game_bytes).hexdigest(),'progression':progression,
                    'automations':automation.catalog(),
                    'hunt':prospecting.board([lead_view(r,campaign_state) for r in json.loads(business['leads'])], ultra.read_json(self.root,'data/exclusions.json'), records.local_today().isoformat()),
                    'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}

    def prospect_action(self, action, body, expected_version):
        allowed = {'preview': {'csv_text'}, 'import': {'csv_text'}, 'export': {'selected_only'},
                   'shortlist': {'id', 'selected'}, 'draft': {'id', 'offer'},
                   'draft-edit': {'id', 'subject', 'body'}, 'review-draft': {'id', 'confirmed'}}
        if action not in allowed or set(body) != allowed[action]:
            raise RequestError(400, 'Choose a supported preparation action and its required fields.')
        with self.lock:
            path = ultra.inside(self.root, 'data/leads.json')
            leads = json.loads(path.read_text())
            exclusions = ultra.read_json(self.root, 'data/exclusions.json')
            try:
                if action == 'preview':
                    return prospecting.preview_import(body['csv_text'], leads, exclusions)
                if action == 'export':
                    if type(body['selected_only']) is not bool: raise ValueError('Choose whether to export the shortlist.')
                    from campaign import Campaign
                    campaign = Campaign(self)
                    rows = [r for r in leads if (r.get('shortlisted') or not body['selected_only'])
                            and r.get('status') not in ('declined', 'rejected') and not campaign.route_suppressed(r)]
                    audits = automation.audit_leads(prospecting.in_scope(rows), exclusions)
                    if any('excluded' in row['flags'] or 'unknown_company' in row['flags'] for row in audits):
                        raise ValueError('Remove excluded or unidentified companies from the export.')
                    from campaign import lead_view
                    return {'csv_text': prospecting.export_csv([lead_view(r,campaign.read()) for r in rows])}
                if expected_version.strip('"') != self.record_version('leads'):
                    raise RequestError(409, 'Records changed. Refresh and review this action again.')
                if action == 'import':
                    result = prospecting.preview_import(body['csv_text'], leads, exclusions)
                    if not result['accepted']: raise ValueError('No new Tunisian companies are eligible for import.')
                    folder = ultra.new_run(self.root, 'script')
                    source_path = str((folder / 'source.csv').relative_to(self.root))
                    (folder / 'source.csv').write_text(body['csv_text'])
                    imported = []
                    for row in result['accepted']:
                        row['id'] = 'lead-' + secrets.token_hex(6)
                        row['source_reference'] = f"{source_path} · CSV row {row.pop('import_row')}"
                        imported.append(records.journal({}, row))
                    ultra.write_json(folder / 'result.json', {'imported_ids': [r['id'] for r in imported], 'rejected': result['rejected']})
                    ultra.write_json(folder / 'run.json', {'engine': 'script', 'automation': 'apollo-import', 'mode': 'draft',
                                     'status': 'imported_discoveries', 'model_invoked': False, 'real_records_changed': True})
                    self.atomic_json(path, [*leads, *imported], '.leads-import-')
                    return {'imported': len(imported), 'rejected': result['rejected'], 'source_path': source_path}
                record = next((row for row in leads if row['id'] == body['id']), None)
                if record is None: raise RequestError(404, 'Lead not found.')
                if not prospecting.in_scope([record]): raise ValueError('This workspace is limited to Tunisian B2B companies.')
                from campaign import Campaign
                if action in ('draft', 'draft-edit', 'review-draft') or action == 'shortlist' and body.get('selected'):
                    if Campaign(self).route_suppressed(record) or record.get('status') in ('declined', 'rejected'):
                        raise ValueError('Outreach preparation is suppressed for this company.')
                updated = dict(record)
                if action == 'shortlist':
                    if type(body['selected']) is not bool: raise ValueError('Shortlist selection must be explicit.')
                    if body['selected'] and record.get('status') in ('declined', 'rejected'): raise ValueError('Closed leads cannot be shortlisted.')
                    audit = automation.audit_leads([record], exclusions)[0]
                    if body['selected'] and any(flag in audit['flags'] for flag in ('excluded', 'unknown_company', 'simulation')):
                        raise ValueError('Check the company and its exclusions before shortlisting.')
                    updated['shortlisted'] = body['selected']
                elif action == 'draft':
                    updated['draft'] = prospecting.make_draft(record, body['offer'], exclusions)
                    updated['shortlisted'] = True
                else:
                    draft = dict(record.get('draft', {}))
                    if not draft.get('body'): raise ValueError('Prepare a pitch before reviewing or editing it.')
                    if action == 'draft-edit':
                        subject = records.text_value(body['subject']); message = records.text_value(body['body'])
                        if not subject or not message or len(subject) > 200: raise ValueError('Include a subject up to 200 characters and a nonempty message.')
                        draft.update(subject=subject, body=message, reviewed=False)
                    else:
                        if body['confirmed'] is not True: raise ValueError('Confirm you reviewed the claims, source and offer.')
                        audit = automation.audit_leads([record], exclusions, records.local_today().isoformat())[0]
                        if audit['flags']: raise ValueError('Resolve current lead checks before review: ' + ', '.join(audit['flags']))
                        from campaign import Campaign, reply_version, fingerprint
                        draft['campaign_reply_version']=reply_version(Campaign(self).read(),record['id'])
                        draft['reviewed_source_version']=fingerprint(record)
                        draft.update(reviewed=True, reviewed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
                    updated['draft'] = draft
                updated = records.journal(record, updated)
                self.atomic_json(path, [updated if row['id'] == updated['id'] else row for row in leads], '.lead-action-')
                return {'record': updated, 'record_version': self.record_version('leads')}
            except ValueError as error:
                raise RequestError(400, str(error)) from None

    def artifact(self, relative):
        if not relative or Path(relative).is_absolute() or '..' in Path(relative).parts:
            raise RequestError(403,'That artifact is outside the permitted paths.')
        try:path=ultra.inside(self.root,relative)
        except ValueError:raise RequestError(403,'That artifact is outside the project.')
        resolved=str(path.relative_to(self.root))
        allowed=(resolved in {'STATE.md','AGENTS.md'} or
                 (resolved.startswith(ARTIFACT_ROOTS) and path.suffix in {'.md','.json'}) or
                 (len(path.relative_to(self.root).parts)==3 and resolved.startswith('runs/') and path.name in RUN_FILES))
        if not allowed:raise RequestError(403,'That file is not a readable interface artifact.')
        if not path.is_file():raise RequestError(404,'Artifact not found.')
        if path.stat().st_size>300000:raise RequestError(413,'Artifact is too large to preview.')
        return {'path':resolved,'content':path.read_text()}

    def game_bytes(self):
        path=ultra.inside(self.root,'data/game.json')
        return path.read_bytes() if path.exists() else EMPTY_GAME

    def atomic_json(self,path,value,prefix):
        temp=None
        try:
            with tempfile.NamedTemporaryFile('w',dir=path.parent,prefix=prefix,suffix='.tmp',delete=False) as out:
                temp=Path(out.name);json.dump(value,out,indent=2,ensure_ascii=False);out.write('\n')
                out.flush();os.fsync(out.fileno())
            os.replace(temp,path)
        finally:
            if temp and temp.exists():temp.unlink()

    def update_gate(self,phase,body,game_version,task_version):
        required={r['id'] for r in quests.gate_requirements(phase)}
        evidence=body.get('evidence')
        if set(body)!={'evidence','owner_confirmed'} or body.get('owner_confirmed') is not True:
            raise RequestError(400,'Confirm the real evidence before reviewing this gate.')
        if not isinstance(evidence,dict) or set(evidence)!=required or any(not isinstance(v,str) or not v.strip() or len(v)>4000 for v in evidence.values()):
            raise RequestError(400,'Provide a nonblank reference for every gate requirement.')
        with self.lock:
            raw=self.game_bytes();task_raw=ultra.inside(self.root,'data/tasks.json').read_bytes()
            if hashlib.sha256(raw).hexdigest()!=game_version.strip('"') or hashlib.sha256(task_raw).hexdigest()!=task_version:
                raise RequestError(409,'Gate or quests changed. Refresh and review your evidence.')
            game=json.loads(raw);tasks=json.loads(task_raw);room=quests.progress(tasks,game)['rooms'][phase]
            if not room['unlocked'] or room['missing_tasks']:
                raise RequestError(409,'Complete the required real quests with owner-confirmed evidence first.')
            game.setdefault('gates',{})[str(phase)]={'evidence':{k:v.strip() for k,v in evidence.items()},'owner_confirmed':True,
                     'quest_fingerprint':quests.fingerprint(tasks,quests.ROOMS[phase]['tasks']),
                     'reviewed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
            if hashlib.sha256(ultra.inside(self.root,'data/tasks.json').read_bytes()).hexdigest()!=task_version:
                raise RequestError(409,'Quests changed during gate review. Try again.')
            self.atomic_json(ultra.inside(self.root,'data/game.json'),game,'.gate-')
            return {'gate':game['gates'][str(phase)]}

    def update_task(self, task_id, body, expected_version):
        if set(body)-{'status','completion_evidence','owner_confirmed','next_action_on','timebox_minutes'}:
            raise RequestError(400,'Unsupported task fields.')
        status=body.get('status')
        if not isinstance(status,str) or status not in STATUS:raise RequestError(400,'Choose a supported task status.')
        evidence=body.get('completion_evidence')
        if evidence is not None and (not isinstance(evidence,str) or len(evidence)>4000):
            raise RequestError(400,'Evidence must be text, up to 4000 characters.')
        try:
            if 'next_action_on' in body: next_date = records.date_value(body['next_action_on'])
        except ValueError as error: raise RequestError(400, str(error)) from None
        minutes = body.get('timebox_minutes')
        if 'timebox_minutes' in body and minutes is not None and (type(minutes) is not int or not 1 <= minutes <= 1440):
            raise RequestError(400, 'Time estimates must be 1–1440 minutes, or unknown.')
        with self.lock:
            if expected_version.strip('"')!=self.task_version():
                raise RequestError(409,'Tasks changed. Refresh before saving this edit.')
            path=ultra.inside(self.root,'data/tasks.json')
            tasks=json.loads(path.read_text())
            task=next((t for t in tasks if t['id']==task_id),None)
            if task is None:raise RequestError(404,'Task not found.')
            if status=='done':
                if not evidence or not evidence.strip():raise RequestError(400,'Completion requires actual evidence.')
                if body.get('owner_confirmed') is not True:raise RequestError(400,'Confirm that you completed this task and the evidence is accurate.')
                done=quests.effective_done(tasks,real=not quests.training(task))
                if any(d not in done for d in task.get('depends_on',[])):
                    raise RequestError(409,'Complete the required dependencies with evidence first.')
            revised = {**task, 'status':status, 'completion_evidence':evidence.strip() if isinstance(evidence,str) and evidence.strip() else None,
                       'owner_confirmed':body.get('owner_confirmed') is True if status=='done' else False}
            if 'next_action_on' in body: revised['next_action_on'] = next_date
            if 'timebox_minutes' in body: revised['timebox_minutes'] = minutes
            task.update(records.journal(task, revised))
            temp=None
            try:
                with tempfile.NamedTemporaryFile('w',dir=path.parent,prefix='.tasks-',suffix='.tmp',delete=False) as out:
                    temp=Path(out.name);json.dump(tasks,out,indent=2,ensure_ascii=False);out.write('\n')
                    out.flush();os.fsync(out.fileno())
                os.replace(temp,path)
            finally:
                if temp and temp.exists():temp.unlink()
            return {'task':task,'task_version':self.task_version()}

    def action(self, route, body):
        with self.lock:
            if route=='/api/automate':
                if set(body)-{'automation','params'}:raise RequestError(400,'Unsupported automation fields.')
                try:folder=automation.run(self.root,body.get('automation'),body.get('params',{}))
                except (TypeError,ValueError) as error:raise RequestError(400,str(error))
            elif route=='/api/judgment':
                if not {'role','reason'}<=set(body) or set(body)-{'role','reason','script_run'}:raise RequestError(400,'Judgment preparation needs a role, reason and optional script run; no execution fields.')
                if not isinstance(body.get('role'),str) or body['role'] not in set(ultra.ROLES)-automation.SCRIPT_ONLY:raise RequestError(400,'This role is handled by scripts.')
                try:folder=ultra.agent(self.root,body['role'],judgment_reason=body['reason'],script_run=body.get('script_run'),execute=False)
                except ValueError as error:raise RequestError(400,str(error))
            elif route=='/api/prepare':
                if body:raise RequestError(400,'Day preparation takes no parameters.')
                folder=ultra.prepare(self.root)
            elif route=='/api/draft':
                if set(body)-{'role','scenario'}:raise RequestError(400,'Draft preparation does not accept live execution or extra fields.')
                if body.get('role') not in ultra.ROLES:raise RequestError(400,'Choose a known agent role.')
                folder=ultra.agent(self.root,body['role'],scenario_id=body.get('scenario'),execute=False)
            elif route=='/api/simulate':
                if set(body)-{'scenario'}:raise RequestError(400,'Unsupported rehearsal fields.')
                folder=ultra.simulate(self.root,body.get('scenario','messy-pilot'))
            else:raise RequestError(404,'Unknown interface action.')
            return {'run':self.run_info(folder)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass

    def boundary(self):
        hosts=self.headers.get_all('Host') or []
        port=self.server.server_port
        if len(hosts)!=1 or hosts[0] not in {f'127.0.0.1:{port}',f'localhost:{port}'}:
            raise RequestError(403,'Use the local interface address.')

    def response(self,status,value,content_type='application/json; charset=utf-8'):
        data=json.dumps(value,ensure_ascii=False).encode() if content_type.startswith('application/json') else value
        self.send_response(status)
        for key,value in {'Content-Type':content_type,'Content-Length':str(len(data)),
                          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
                          'Referrer-Policy':'no-referrer',
                          'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}.items():
            self.send_header(key,value)
        self.end_headers();self.wfile.write(data)

    def do_GET(self):
        try:
            self.boundary();parsed=urlsplit(self.path)
            if parsed.path=='/api/workspace':self.response(200,self.server.workspace.snapshot());return
            if parsed.path=='/api/artifact':
                relative=parse_qs(parsed.query).get('path',[''])[0]
                self.response(200,self.server.workspace.artifact(relative));return
            if parsed.path.startswith('/api/'):raise RequestError(404,'Unknown interface route.')
            name=unquote(parsed.path).lstrip('/') or 'index.html'
            if '..' in Path(name).parts or Path(name).suffix not in {'.html','.css','.js','.svg','.woff2','.png','.webp'}:
                raise RequestError(404,'Page not found.')
            path=ultra.inside(self.server.workspace.static_root,name)
            if not path.is_file():raise RequestError(404,'Page not found.')
            kind=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
            self.response(200,path.read_bytes(),kind)
        except RequestError as error:self.response(error.status,{'error':error.message})
        except (OSError,ValueError,KeyError,TypeError,AttributeError):self.response(500,{'error':'The workspace could not be read. Check the local records.'})

    def do_POST(self):
        try:
            self.boundary()
            if self.headers.get('Origin')!=f'http://{self.headers.get("Host")}' or not secrets.compare_digest(self.headers.get('X-Ultra-Token',''),self.server.workspace.token):
                raise RequestError(403,'Reload the local interface before making changes.')
            if self.headers.get('Transfer-Encoding'):raise RequestError(400,'Transfer encoding is not supported.')
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':
                raise RequestError(415,'This action requires JSON.')
            try:length=int(self.headers.get('Content-Length','0'))
            except ValueError:raise RequestError(400,'Invalid request size.')
            route=urlsplit(self.path).path
            limit=400000 if route=='/api/automate' or route.startswith('/api/prospecting/') else 65536
            if not 0<length<=limit:raise RequestError(413,'Request is too large or empty.')
            body=json.loads(self.rfile.read(length))
            if not isinstance(body,dict):raise RequestError(400,'Send a JSON object.')
            route=urlsplit(self.path).path
            if route.startswith('/api/prospecting/'):
                result=self.server.workspace.prospect_action(route[len('/api/prospecting/'):],body,self.headers.get('If-Match',''))
            elif route.startswith('/api/tasks/'):
                task_id=unquote(route[len('/api/tasks/'):])
                result=self.server.workspace.update_task(task_id,body,self.headers.get('If-Match',''))
            elif route == '/api/planning':
                result = self.server.workspace.update_record('budget', None, body, self.headers.get('If-Match',''))
            elif route in ('/api/leads', '/api/payments') or route.startswith(('/api/leads/', '/api/payments/')):
                parts = route.strip('/').split('/')
                if len(parts) not in (2, 3): raise RequestError(404, 'Unknown record route.')
                result = self.server.workspace.update_record(parts[1], unquote(parts[2]) if len(parts) == 3 else None, body, self.headers.get('If-Match',''))
            elif route.startswith('/api/gates/'):
                try:phase=int(route[len('/api/gates/'):])
                except ValueError:raise RequestError(400,'Choose a valid dungeon room.')
                result=self.server.workspace.update_gate(phase,body,self.headers.get('If-Match',''),self.headers.get('X-Task-Version',''))
            else:result=self.server.workspace.action(route,body)
            self.response(200,result)
        except RequestError as error:self.response(error.status,{'error':error.message})
        except ValueError:self.response(400,{'error':'Invalid role, scenario or request data.'})
        except (OSError,RuntimeError,KeyError,TypeError,AttributeError):self.response(500,{'error':'The action could not be saved. Existing records were preserved; check local files.'})


def create_server(root,static_root,port=0):
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    server.workspace=Workspace(root,static_root)
    return server


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8541)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    server=create_server(root,root/'web',args.port)
    print(f'1Ultra interface: http://127.0.0.1:{server.server_port}',flush=True)
    print('Local records and draft preparation. Ctrl+C stops the server.',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()

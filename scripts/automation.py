"""Bounded local script services. Writes run artifacts; never business ledgers."""
import argparse
import csv
from collections import Counter
import datetime
import hashlib
import io
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

import ultra
import quests
import records

DEFAULTS={'ultra_ops':'daily-pack','ultra_finance':'finance-pack','ultra_customer':'rehearsal',
          'ultra_research':'lead-audit','ultra_sales':'outreach-drafts','ultra_delivery':'scope-check','ultra_qa':'validate-records'}
SCRIPT_ONLY={'ultra_ops','ultra_finance','ultra_customer'}
TOOLS=[
    ('daily-pack','Daily pack','Compose next quests, record checks, treasury facts and lead warnings.','operations'),
    ('next-quests','Quest planner','Sort the next three actions and their dependencies.','tasks'),
    ('validate-records','Record sentinel','Check task graphs, receipt records and missing facts.','quality'),
    ('finance-pack','Payment scribe','Reconcile currencies and prepare an unsent factual follow-up.','finance'),
    ('lead-audit','Lead scout','Check stored exclusions, duplicate sources, expiry and freshness.','research'),
    ('outreach-drafts','Message press','Render unsent French introductions for eligible service prospects.','sales'),
    ('scope-check','Scope inspector','Check whether a supplied job scope contains the required agreement inputs.','scope'),
    ('csv-workbench','Data forge','Trim CSV cells, preserve rows and flag conflicts, invalid amounts and formulas.','delivery'),
    ('rehearsal','Training encounter','Create a fixed fictional buyer challenge and review checklist.','customer'),
]
PARAMS={'daily-pack':set(),'next-quests':set(),'validate-records':set(),'finance-pack':set(),
        'lead-audit':{'date'},'outreach-drafts':{'date','lead_ids','require_reviewed_proofs'},'scope-check':{'scope'},
        'csv-workbench':{'csv_text','key_column','amount_column','delimiter'},'rehearsal':{'scenario','choice'}}


def catalog():
    return [{'id':id,'name':name,'description':description,'icon':icon,'engine':'script'} for id,name,description,icon in TOOLS]


def default_script(role):
    if role not in DEFAULTS:raise ValueError('Unknown project role')
    return DEFAULTS[role]


def normalize_company(value):
    plain=unicodedata.normalize('NFKD',str(value or '')).casefold()
    return ''.join(c for c in plain if c.isalnum() and not unicodedata.combining(c))


def audit_leads(leads,exclusions,today=None):
    if not isinstance(leads,list) or not all(isinstance(lead,dict) for lead in leads):raise ValueError('Leads must be a list of records')
    counts=Counter(str(lead.get('id')) for lead in leads)
    date=datetime.date.fromisoformat(today) if today else datetime.datetime.now(datetime.timezone.utc).date()
    excluded={normalize_company(name) for company in exclusions.get('companies',[])
              for name in [company.get('company'),*company.get('aliases',[])] if name}
    seen=set();results=[]
    for lead in leads:
        flags=[];company=normalize_company(lead.get('company'))
        if not isinstance(lead.get('id'),str) or not lead['id'].strip():flags.append('invalid_id')
        if counts[str(lead.get('id'))]>1:flags.append('duplicate_id')
        if not company:flags.append('unknown_company')
        elif company in excluded:flags.append('excluded')
        source=lead.get('source_url','')
        parsed=urlsplit(source) if isinstance(source,str) else None
        warm_source = lead.get('kind') == 'warm_contact' and isinstance(lead.get('source_reference'), str) and bool(lead['source_reference'].strip())
        if not warm_source and (not parsed or parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password):
            flags.append('invalid_source')
        key=source.rstrip('/') if isinstance(source,str) else ''
        if key and key in seen:flags.append('duplicate_source')
        seen.add(key)
        try:
            checked=datetime.date.fromisoformat(lead.get('checked_date',''))
            if (date-checked).days>14:flags.append('stale')
            if checked>date:flags.append('future_check_date')
        except (TypeError,ValueError):flags.append('missing_check_date')
        if lead.get('expires'):
            try:
                if datetime.date.fromisoformat(lead['expires'])<date:flags.append('expired')
            except (TypeError,ValueError):flags.append('invalid_expiry')
        if lead.get('mode','real')!='real':flags.append('simulation')
        if lead.get('contact_sent') is True:flags.append('already_contacted')
        if lead.get('status') in ('declined','rejected'):flags.append('closed')
        if not lead.get('contact_route'):flags.append('missing_contact_route')
        results.append({'id':lead.get('id'),'company':lead.get('company'),'flags':flags,
                        'eligible':not flags,'checked_on':date.isoformat(),
                        'note':'Stored-record audit only; live availability and buyer interest are not verified.'})
    return results


def finance_pack(root):
    payments=ultra.read_json(root,'data/payments.json');cash=ultra.cash_summary(payments)
    missing=[];drafts=[]
    for payment in payments:
        if payment.get('mode')!='real' or payment.get('status')!='owed':continue
        gaps=[field for field in ('amount_minor','invoice_reference','work_acceptance_evidence','agreed_due_date')
              if payment.get(field) is None or payment.get(field)=='']
        missing.append({'id':payment.get('id'),'fields':gaps})
        amount=ultra.money(payment.get('amount_minor'),payment['currency'])
        drafts.append(f"## {payment.get('description') or payment['id']}\n\nDRAFT — UNSENT\n\nBonjour,\n"
                      "Je souhaite confirmer la prochaine étape concernant le règlement du travail réalisé.\n"
                      f"Montant enregistré : {amount}.\n"
                      f"Référence de facture : {payment.get('invoice_reference') or 'à confirmer'}.\n"
                      f"Date convenue : {payment.get('agreed_due_date') or 'à confirmer'}.\n"
                      "Pouvez-vous confirmer les éléments manquants, la personne responsable et la prochaine étape ?\n\nMerci,\nAdem\n")
    receipts='\n'.join(f'- {ultra.money(value,currency)}' for currency,value in cash['received_minor'].items()) or '- No evidenced receipts'
    follow_up='\n\n'.join(drafts) or 'No owed payment recorded.'
    return {'cash':cash,'missing_facts':missing,'follow_up':follow_up+'\n\n## Recorded receipts by currency\n'+receipts,
            'note':'Receipt references are owner-supplied; the script does not verify bank transfers.'}


def check_scope(scope):
    if not isinstance(scope,dict):raise ValueError('Scope must be a JSON object')
    required=('input_permission','sample_reference','fields','output_format','quantity','exceptions',
              'price_minor','currency','payment_terms','start_condition','deadline','acceptance')
    missing=[]
    for name in required:
        value=scope.get(name)
        valid=value is True if name=='input_permission' else (
            isinstance(value,list) and bool(value) and all(isinstance(x,str) and x.strip() for x in value) if name=='fields' else
            type(value) is int and value>0 if name=='quantity' else
            type(value) is int and value>=0 if name=='price_minor' else
            value in ultra.DIGITS if name=='currency' and isinstance(value,str) else
            isinstance(value,str) and bool(value.strip()))
        if not valid:missing.append(name)
    return {'ready':not missing,'missing':missing,'scope':scope,
            'note':'A complete form is a preparation check; actual buyer acceptance still needs evidence.'}


def clean_csv(text,key_column='id',amount_column='amount',delimiter=','):
    if not isinstance(text,str) or not text.strip() or len(text.encode())>60000:raise ValueError('Supply nonempty CSV text up to 60 KB')
    if delimiter not in (',',';','\t'):raise ValueError('Choose comma, semicolon or tab delimiter')
    if not isinstance(key_column,str) or not isinstance(amount_column,str):raise ValueError('Column names must be text')
    try:raw=list(csv.reader(io.StringIO(text),delimiter=delimiter,strict=True))
    except csv.Error as error:raise ValueError('Malformed CSV') from error
    if not raw:raise ValueError('CSV needs headers')
    headers=[h.strip().lstrip('\ufeff') for h in raw[0]]
    if len(headers)>50 or any(not h for h in headers) or len(set(headers))!=len(headers):raise ValueError('CSV headers must be distinct and nonblank')
    if key_column not in headers:raise ValueError('Identifier column is missing')
    if amount_column and amount_column not in headers:raise ValueError('Amount column is missing; clear its name if not applicable')
    if len(raw)>5001:raise ValueError('CSV limit is 5000 data rows')
    rows=[];issues=[];changes=[];seen={}
    number=re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$')
    def export_cell(value,row,column):
        if value.startswith(('=','+','@')) or (value.startswith('-') and not number.fullmatch(value)):
            issues.append({'row':row,'kind':'spreadsheet_formula','column':column})
            changes.append({'row':row,'column':column,'kind':'escaped_formula'})
            return "'"+value
        return value
    export_headers=[export_cell(value,1,value) for value in headers]
    for index,cells in enumerate(raw[1:],2):
        if len(cells)!=len(headers):raise ValueError(f'Row {index} has the wrong number of cells')
        normalized=[cell.strip() for cell in cells];row=dict(zip(headers,normalized));key=row[key_column]
        if not key:issues.append({'row':index,'kind':'missing_key','column':key_column})
        elif key in seen:
            old,old_index=seen[key]
            issues.append({'row':index,'kind':'duplicate_identical' if row==old else 'duplicate_conflict','other_row':old_index,'key':key})
        else:seen[key]=(row.copy(),index)
        if amount_column and not number.fullmatch(row[amount_column]):
            issues.append({'row':index,'kind':'invalid_amount','column':amount_column,'value':row[amount_column]})
        export=[]
        for column,before,value in zip(headers,cells,normalized):
            if before!=value:changes.append({'row':index,'column':column,'kind':'trimmed'})
            export.append(export_cell(value,index,column))
        rows.append(export)
    out=io.StringIO(newline='');writer=csv.writer(out,delimiter=delimiter,lineterminator='\n')
    writer.writerow(export_headers);writer.writerows(rows)
    return {'cleaned_csv':out.getvalue(),'rows':len(rows),'headers':headers,'issues':issues,'changes':changes,
            'source_sha256':hashlib.sha256(text.encode()).hexdigest(),
            'note':'All rows retained. Amounts are never inferred. Review conflicts and flagged fields against the original.'}


def validate_records(root):
    errors=[];warnings=[]
    tasks=ultra.read_json(root,'data/tasks.json')
    try:done=quests.effective_done(tasks,real=True)
    except ValueError as error:errors.append(str(error));done=set()
    task_records=tasks if isinstance(tasks,list) else []
    for index,task in enumerate(task_records):
        if not isinstance(task,dict):continue
        id=str(task.get('id',f'row {index+1}'))
        if task.get('status') not in ('todo','in_progress','blocked','blocked_on_owner','done'):errors.append(id+': unsupported task status')
        if type(task.get('priority')) is not int or not 0<=task['priority']<=100:errors.append(id+': invalid priority')
        if type(task.get('phase')) is not int or not 0<=task['phase']<=4:errors.append(id+': invalid phase')
        if task.get('status')=='done' and isinstance(task.get('id'),str) and task['id'] not in done and not quests.training(task):errors.append(id+': completion is ineffective')
        if task.get('status')=='done' and task.get('owner_confirmed') is not True:warnings.append(id+': needs owner reconfirmation for XP')
    payments=ultra.read_json(root,'data/payments.json')
    if isinstance(payments,list):
        ids=[row.get('id') for row in payments if isinstance(row,dict)]
        if len(ids)!=len(set(str(id) for id in ids)):errors.append('Finance: duplicate payment ID')
        for row in payments:
            if isinstance(row,dict) and row.get('status') not in records.PAYMENT_STATUSES and row.get('mode')!='simulation':
                errors.append('Finance: unsupported payment status')
    try:ultra.cash_summary(payments)
    except (AttributeError,KeyError,TypeError,ValueError) as error:errors.append('Finance: '+str(error))
    leads=ultra.read_json(root,'data/leads.json')
    if not isinstance(leads,list) or not all(isinstance(lead,dict) and isinstance(lead.get('id'),str) for lead in leads):
        errors.append('Leads must be a list of records with text IDs');leads=[]
    ids=[lead.get('id') for lead in leads]
    if len(ids)!=len(set(ids)):errors.append('Duplicate lead ID')
    if not done:warnings.append('No confirmed real completed work recorded yet')
    return {'errors':errors,'warnings':warnings,'valid':not errors,'task_count':len(task_records),'lead_count':len(leads)}


def next_quests(root, today=None):
    date = datetime.date.fromisoformat(today) if today else records.local_today()
    budget = ultra.read_json(root, 'data/budget.json')
    limit = budget.get('daily_minutes')
    if budget.get('daily_minutes_on') and budget['daily_minutes_on'] != date.isoformat():
        limit = None
    if limit is not None and (type(limit) is not int or not 0 <= limit <= 1440):
        raise ValueError('Today\'s minutes must be 0–1440, or unknown.')
    tasks=ultra.read_json(root,'data/tasks.json');done=quests.effective_done(tasks,real=True)
    pending = [t for t in tasks if t.get('status') != 'done']
    def sort_key(task):
        due = records.date_value(task.get('next_action_on'))
        return (0 if due and due <= date.isoformat() else 1, due or '9999-12-31', -task.get('priority',0), task['id'])
    pending.sort(key=sort_key)
    ready=[]; blocked=[]; scheduled=[]; deferred=[]; selected=[]; over=[]; unknown=[]; used=0
    for task in pending:
        if budget.get('defer_billing') is True and task['id'] in ('F01','F02','F03'):
            deferred.append(task); continue
        if not quests.ready(task,done):
            blocked.append({'id':task['id'],'title':task.get('title'),'dependencies':[d for d in task.get('depends_on',[]) if d not in done]})
            continue
        if task.get('next_action_on') and task['next_action_on'] > date.isoformat():
            scheduled.append(task); continue
        item={**task,'unmet_dependencies':[]}; ready.append(item)
        minutes=task.get('timebox_minutes')
        if type(minutes) is not int or minutes <= 0:
            unknown.append(item)
            if limit is not None: continue
        if limit is not None and used + minutes > limit:
            over.append(item); continue
        if len(selected) < 3:
            selected.append(item)
            used += minutes if type(minutes) is int and minutes > 0 else 0
    follow_ups=[]
    for collection in ('leads','payments'):
        for row in ultra.read_json(root, f'data/{collection}.json'):
            due=records.date_value(row.get('next_action_on'))
            if row.get('mode','real') != 'real' or not due or due > date.isoformat(): continue
            if row.get('status') in ('declined','rejected','received'): continue
            follow_ups.append({'collection':collection,'id':row['id'],'title':row.get('company') or row.get('description') or row['id'],
                               'next_action_on':due,'next_action':row.get('next_action') or 'Review the record and choose the next action.'})
    follow_ups.sort(key=lambda item:(item['next_action_on'],item['collection'],item['id']))
    return {'next':selected,'ready_count':len(ready),'blocked':blocked,'scheduled':scheduled,'deferred':deferred,
            'over_capacity':over,'unestimated':unknown,'planned_minutes':used,'daily_minutes':limit,
            'date':date.isoformat(),'follow_ups':follow_ups,
            'note':'Preparing a brief does not complete a quest. Follow-up time is not included in quest estimates.'}


def daily_brief(result):
    plan=result['quests']; lines=[f"# Daily brief · {plan['date']}", '', '## Next actions', '']
    if plan['next']:
        for index, task in enumerate(plan['next'], 1):
            estimate=f"{task['timebox_minutes']} min" if task.get('timebox_minutes') else 'estimate needed'
            due=f" · due {task['next_action_on']}" if task.get('next_action_on') else ''
            lines.append(f"{index}. {task['id']}: {task['title']} ({estimate}{due}).")
    else: lines.append('No quests fit today. Review dates, estimates and prerequisites in the journal.')
    lines += ['', f"Planned quest time: {plan['planned_minutes']} min. " +
              (f"Today’s budget: {plan['daily_minutes']} min." if plan['daily_minutes'] is not None else 'Today’s time budget is unknown.'),
              'Leave additional time for the follow-ups below.', '', '## Due follow-ups', '']
    lines += [f"- {r['title']} · {r['next_action_on']}: {r['next_action']}" for r in plan['follow_ups']] or ['None recorded as due.']
    lines += ['', '## Inputs and checks', '']
    if plan['deferred']: lines.append('- Billing preparation is deferred by your planning preference. Its records remain open.')
    if plan['unestimated']: lines.append('- Estimate before scheduling: '+', '.join(t['id'] for t in plan['unestimated'])+'.')
    if plan['over_capacity']: lines.append('- Outside today’s time budget: '+', '.join(t['id'] for t in plan['over_capacity'])+'.')
    if plan['scheduled']: lines.append('- Scheduled later: '+', '.join(f"{t['id']} ({t['next_action_on']})" for t in plan['scheduled'])+'.')
    for text in result['records']['errors']: lines.append('- Record error: '+text)
    for text in result['records']['warnings']: lines.append('- '+text)
    flags=[r for r in result['leads'] if r['flags']]
    if flags: lines.append(f"- {len(flags)} stored prospects need review; inspect the detailed result before using them.")
    cash=result['finance']['cash']['received_minor']
    lines += ['', '## Recorded cash', '']
    lines += ['- '+ultra.money(value,currency) for currency,value in sorted(cash.items())] or ['No evidenced receipts recorded.']
    deposits=result['finance']['cash']['deposit_minor']
    if deposits:
        lines += ['', 'Deposits included in cash, with outstanding delivery/refund obligations:']
        lines += ['- '+ultra.money(value,currency) for currency,value in sorted(deposits.items())]
    lines += ['', 'Full validation, finance and lead details are saved in result.json. The follow-up draft is in follow_up.md.',
              'Local preparation only. No messages sent, real tasks completed or receipts created.', '']
    return '\n'.join(lines)


def run(root,name,params=None):
    params={} if params is None else params
    if name not in PARAMS or not isinstance(params,dict) or set(params)-PARAMS[name]:raise ValueError('Unsupported automation or parameters')
    extra={};mode='draft'
    if name=='next-quests':result=next_quests(root)
    elif name=='validate-records':result=validate_records(root)
    elif name=='finance-pack':
        result=finance_pack(root);extra['follow_up.md']=result['follow_up']
    elif name in ('lead-audit','outreach-drafts'):
        leads=ultra.read_json(root,'data/leads.json');audit=audit_leads(leads,ultra.read_json(root,'data/exclusions.json'),params.get('date'))
        result={'audit':audit,'note':'No contacts sent. Sources have not been rechecked online.'}
        if name=='outreach-drafts':
            drafts=[]
            from campaign import route_suppressed
            campaign_path=ultra.inside(root,'data/campaign-workbench.json')
            campaign_state=json.loads(campaign_path.read_text()) if campaign_path.exists() else {'events':[]}
            selected_ids=params.get('lead_ids')
            if selected_ids is not None and (not isinstance(selected_ids,list) or not 1<=len(selected_ids)<=100 or any(not isinstance(id,str) for id in selected_ids) or len(set(selected_ids))!=len(selected_ids) or set(selected_ids)-{r['id'] for r in leads}):raise ValueError('Select distinct existing lead IDs.')
            if params.get('require_reviewed_proofs'):
                from campaign import artifact_version
                if not selected_ids or any(not any(p['lead_id']==id and p.get('reviewed') and p['source_version']==artifact_version(next(l for l in leads if l['id']==id),campaign_state) for p in campaign_state.get('proofs',[])) for id in selected_ids):raise ValueError('Review a current checked proof for every selected company first.')
            for lead,checked in zip(leads,audit):
                if selected_ids is not None and lead['id'] not in selected_ids:continue
                if route_suppressed(campaign_state,lead) or lead.get('status') in ('declined','rejected'): continue
                if checked['eligible'] and lead.get('kind') in ('service_prospect','warm_contact'):
                    import prospecting
                    if not prospecting.in_scope([lead]) or not lead.get('observed_fact'): continue
                    draft=prospecting.make_draft(lead,lead.get('recommended_offer','cleanup'),ultra.read_json(root,'data/exclusions.json'),params.get('date'))
                    drafts.append(f"## {lead['company']}\nDRAFT — UNSENT\n\nSubject: {draft['subject']}\n\n{draft['body']}\n")
            result['draft_count']=len(drafts);extra['outreach.md']='\n\n'.join(drafts) or 'No eligible service prospects. Resolve the audit flags before drafting.'
    elif name=='scope-check':result=check_scope(params.get('scope',{}))
    elif name=='csv-workbench':
        result=clean_csv(params.get('csv_text',''),params.get('key_column','id'),params.get('amount_column','amount'),params.get('delimiter',','))
        extra={'source.csv':params['csv_text'],'cleaned.csv':result.pop('cleaned_csv')}
    elif name=='rehearsal':
        scenario=ultra.scenario(root,params.get('scenario','messy-pilot'));mode='simulation'
        result={'scenario':scenario['id'],'buyer':scenario['buyer'],'questions':scenario.get('constraints',[]),
                'checks':scenario.get('exit_evidence',[]),'awards_business_xp':False,
                'note':'FICTIONAL fixed encounter. No live model, buyer, payment or business XP.'}
        if 'choice' in params:
            choice=params['choice']
            rubric={'sample':(True,'Good scope boundary: inspect a permitted sample, preserve unclear values, agree checks and only then commit to price and timing.'),
                    'promise':(False,'An unseen input cannot justify promised accuracy or a deadline. Ask for a sample and check the critical fields first.'),
                    'broad':(False,'Unlimited revisions and integrations create unbounded work. Limit quantity, transforms, exceptions and acceptance; quote integrations separately.')}
            if choice not in rubric:raise ValueError('Choose one fixed practice response.')
            bounded,feedback=rubric[choice]
            result.update(choice=choice,feedback={'bounded':bounded,'text':feedback,'rubric':'Permission → sample → bounded scope → source checks → owner review'})
    else:
        result={'quests':next_quests(root),'records':validate_records(root),'finance':finance_pack(root),
                'leads':audit_leads(ultra.read_json(root,'data/leads.json'),ultra.read_json(root,'data/exclusions.json'))}
        extra['follow_up.md']=result['finance']['follow_up']
        extra['brief.md']=daily_brief(result)
    folder=ultra.new_run(root,'script')
    title=next(item['name'] for item in catalog() if item['id']==name)
    report=f'# {title}\n\nEngine: local Python script. No model invoked. No messages sent or real records changed.\n\n'
    if mode=='simulation':report+='FICTIONAL TRAINING — no business XP or cash.\n\n'
    if name=='daily-pack':report=extra['brief.md']
    else:report+='```json\n'+json.dumps(result,indent=2,ensure_ascii=False)+'\n```\n'
    (folder/'report.md').write_text(report)
    ultra.write_json(folder/'result.json',result)
    for filename,content in extra.items():(folder/filename).write_text(content)
    issues=result.get('issues',result.get('errors',[]))
    review=bool(issues or result.get('missing_facts') or result.get('missing') or any(r['flags'] for r in result.get('audit',[])))
    if name=='daily-pack':review=bool(result['records']['errors'] or result['finance']['missing_facts'] or any(r['flags'] for r in result['leads']))
    ultra.write_json(folder/'run.json',{'kind':'automation','automation':name,'engine':'script','mode':mode,
                                     'status':'needs_review' if review else 'script_completed','model_invoked':False,
                                     'real_records_changed':False})
    return folder


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tool',choices=[tool['id'] for tool in catalog()]);parser.add_argument('--params',default='{}',help='JSON object of declared tool inputs')
    args=parser.parse_args()
    try:print(run(Path(__file__).resolve().parents[1],args.tool,json.loads(args.params)))
    except (OSError,KeyError,TypeError,ValueError) as error:print('Error: '+str(error),file=sys.stderr);return 1
    return 0


if __name__=='__main__':sys.exit(main())

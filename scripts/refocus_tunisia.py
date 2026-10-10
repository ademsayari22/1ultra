"""One bounded, reversible migration for the owner's Tunisia lead-hunt request."""
import json
import shutil
from pathlib import Path

import automation
import prospecting
import quests
import records
import ultra
from ultra_ui import Workspace

DATE = '2026-10-05'
DEFINITIONS = [
    ('R01',0,'Review five sourced Tunisian B2B companies','ultra_research',100,[],30),
    ('R02',0,'Shortlist five relevant Tunisian companies','Adem',98,['R01'],20),
    ('R04',0,'Source another bounded Tunisia batch with Apollo or public pages','ultra_research',82,['R01'],30),
    ('S01',1,'Choose one small offer and confirm weekly capacity','Adem',94,[],20),
    ('S02',1,'Prepare one permitted or synthetic proof example','ultra_delivery',92,['S01'],60),
    ('Q00',1,'Check the proof against its source and explain the output','ultra_qa',90,['S02'],20),
    ('S03',1,'Prepare three company-specific French pitches','ultra_sales',88,['R02','S01','Q00'],30),
    ('Q01',1,'Review three pitches for truthful observations and bounded claims','ultra_qa',86,['S03','Q00'],20),
    ('C01',2,'Record actual buyer contacts, replies and follow-up dates','Adem',80,['Q01'],45),
    ('C02',2,'Inspect a permitted sample and agree one bounded paid pilot','Adem',78,['C01'],25),
    ('F04',2,'Record accepted terms and evidence the start condition is fulfilled','Adem',76,['C02'],15),
    ('D01',3,'Prepare the agreed pilot with source-linked output','ultra_delivery',72,['F04'],None),
    ('Q02',3,'Check agreed fields and exception handling against sources','ultra_qa',70,['D01'],None),
    ('D02',3,'Review and release the output; obtain actual buyer acceptance','Adem',68,['Q02'],30),
    ('F05',3,'Record actual payment and whole-job time and costs','Adem',66,['D02'],20),
    ('P01',4,'Ask a paying buyer about recurring work','Adem',60,['F05'],15),
    ('P02',4,'Prepare a capped repeat-service proposal from confirmed need','ultra_sales',58,['P01'],30),
    ('R03',4,'Review local buyer evidence and refine the next Tunisia niche','ultra_research',45,['Q01'],30),
    ('SIM01',1,'Practise one fictional buyer conversation','ultra_ops',20,[],20),
]


def apply(root, prospects):
    root = Path(root); marker = root / 'data/campaign.json'
    if marker.exists() and json.loads(marker.read_text()).get('migration') == 'tunisia-lead-focus-v1':
        return {'already_applied': True}
    tasks = ultra.read_json(root, 'data/tasks.json'); leads = ultra.read_json(root, 'data/leads.json')
    payments = ultra.read_json(root, 'data/payments.json'); exclusions = ultra.read_json(root, 'data/exclusions.json')
    old_tasks = {t['id']: t for t in tasks}; revised = []
    for id, phase, title, owner, priority, deps, minutes in DEFINITIONS:
        before = old_tasks.get(id)
        task = {**(before or {}), 'id': id, 'phase': phase, 'title': title, 'owner': owner, 'priority': priority, 'depends_on': deps}
        if before is None: task.update(status='todo', completion_evidence=None, owner_confirmed=False, next_action_on=None, timebox_minutes=minutes)
        else:
            task.setdefault('timebox_minutes', minutes)
            if before.get('status') == 'blocked' and before.get('depends_on') and not before.get('updated_at'):
                task['status'] = 'todo'
            if before.get('status') == 'done' and (before.get('title') != title or before.get('depends_on') != deps):
                task.update(status='in_progress', owner_confirmed=False, scope_changed_review_required=True)
            task = records.journal(before, task)
        if id == 'SIM01': task['mode'] = 'simulation'
        revised.append(task)
    # Retain any custom owner quests rather than silently deleting them.
    revised += [t for t in tasks if t['id'] not in {d[0] for d in DEFINITIONS} | {'F01','F02','F03','E01'}]
    quests.effective_done(revised, real=True)
    active = []
    for lead in leads:
        if lead.get('kind') in ('job_discovery', 'remote_contract_discovery'): continue
        if lead['id'] in ('zaatir','tca','sahel-comptabilite','mediasoft') and not lead.get('country'):
            enriched = {**lead, 'country': 'TN', 'country_basis': 'Existing 2026-10-04 Tunisia source review',
                        'industry': 'ERP & IT integration' if lead['id']=='mediasoft' else 'Accounting & audit',
                        'recommended_offer': 'catalogue' if lead['id']=='mediasoft' else 'documents',
                        'need_hypothesis': 'Petit lot de données ou de documents à préparer et contrôler ? Besoin à confirmer.',
                        'pitch_hook': 'Votre site ou votre fiche professionnelle présente des services aux entreprises à Sousse.'}
            lead = records.journal(lead, enriched)
        active.append(lead)
    known = {automation.normalize_company(row.get('company')) for row in active}
    for row in prospects:
        if automation.normalize_company(row.get('company')) in known: continue
        if not prospecting.in_scope([row]): raise ValueError('Research seed contains a lead outside Tunisia B2B.')
        audited = automation.audit_leads([row], exclusions, DATE)[0]
        if audited['flags']: raise ValueError('Research seed failed checks: '+row['company']+': '+', '.join(audited['flags']))
        active.append(records.journal({}, row)); known.add(automation.normalize_company(row.get('company')))
    ids = [r['id'] for r in active]
    if len(set(ids)) != len(ids): raise ValueError('Duplicate lead IDs in migration.')
    archive = root / 'data/archive/2026-10-05-lead-focus'; archive.mkdir(parents=True, exist_ok=False)
    for name in ('tasks','leads','payments','game','budget'):
        path = root / f'data/{name}.json'
        if path.exists(): shutil.copy2(path, archive / path.name)
    (archive / 'README.md').write_text('Archived at the owner’s request: refocus on finding and convincing Tunisian B2B leads. The consulting receivable was removed from active records; this does not establish payment, cancellation or forgiveness. Billing and employment/remote discoveries remain recoverable here. Budget and complete prior records are preserved.\n')
    workspace = Workspace(root, root / 'web')
    for name, value in [('tasks', revised), ('leads', active), ('payments', [p for p in payments if p['id'] != 'comptes-consulting-owed']),
                        ('game', {'version': 2, 'gates': {}}), ('campaign', {'migration':'tunisia-lead-focus-v1','country':'TN','focus':'find leads → convince them','changed_on':DATE,'archive':str(archive.relative_to(root))})]:
        workspace.atomic_json(root / f'data/{name}.json', value, '.refocus-')
    return {'leads': len(prospecting.in_scope(active)), 'tasks': len(revised), 'archive': str(archive.relative_to(root))}


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    prospects = ultra.read_json(root, 'research/TUNISIA_B2B_2026-10-05.json')['prospects']
    print(json.dumps(apply(root, prospects), ensure_ascii=False))

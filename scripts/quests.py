"""Derived dungeon progress. XP is work evidence, never money or model skill."""
import math
import hashlib
import json

ROOMS = [
    {'id':0,'name':'Scout Outpost','short':'SCOUT OUTPOST','tasks':['R01','R02'],
     'requirements':[('sources','Five Tunisian B2B sources reviewed'),('shortlist','Five relevant companies shortlisted')]},
    {'id':1,'name':'Pitch Workshop','short':'PITCH WORKSHOP','tasks':['S01','S02','Q00','S03','Q01'],
     'requirements':[('offer','Small offer and capacity chosen'),('example','Checked, explainable example'),('pitches','Three source-based pitches reviewed')]},
    {'id':2,'name':'Conversation Hall','short':'CONVERSATION HALL','tasks':['C01','C02','F04'],
     'requirements':[('contact','Actual contacts and replies recorded'),('scope','Buyer agrees a bounded pilot'),('start','Agreed start condition fulfilled')]},
    {'id':3,'name':'Delivery Forge','short':'DELIVERY FORGE','tasks':['D01','Q02','D02','F05'],
     'requirements':[('checks','Scoped delivery checks passed'),('acceptance','Actual buyer acceptance'),('payment','Balance received with evidence'),('effort','Whole-job time and costs recorded')]},
    {'id':4,'name':'Repeat Chamber','short':'REPEAT CHAMBER','tasks':['P01','P02'],
     'requirements':[('need','Paying client identifies recurring need'),('scope','Feasible follow-on scope and capacity')]},
]


def has_evidence(task):
    value=task.get('completion_evidence')
    return isinstance(value,str) and bool(value.strip())


def training(task):
    id=task.get('id')
    return task.get('mode')=='simulation' or isinstance(id,str) and id.startswith('SIM')


def ready(task, completed):
    pending=task.get('status') in ('todo','in_progress','blocked_on_owner')
    seeded_block=task.get('status')=='blocked' and bool(task.get('depends_on')) and not task.get('updated_at')
    return (pending or seeded_block) and not training(task) and all(d in completed for d in task.get('depends_on',[]))


def effective_done(tasks, real=False):
    """Re-evaluate the whole graph so stale descendants cannot unlock work."""
    if not isinstance(tasks,list):raise ValueError('Tasks must be a list')
    by_id={}
    for task in tasks:
        if not isinstance(task,dict) or not isinstance(task.get('id'),str) or not task['id']:
            raise ValueError('Every task needs an ID')
        if task['id'] in by_id:raise ValueError('Duplicate task ID: '+task['id'])
        deps=task.get('depends_on',[])
        if not isinstance(deps,list) or not all(isinstance(d,str) for d in deps):raise ValueError('Invalid dependencies')
        by_id[task['id']]=task
    visiting=set();checked={}
    def visit(id):
        if id in checked:return checked[id]
        if id not in by_id:raise ValueError('Unknown dependency: '+id)
        if id in visiting:raise ValueError('Dependency cycle: '+id)
        visiting.add(id)
        task=by_id[id]
        dependencies=[visit(d) for d in task.get('depends_on',[])]
        result=task.get('status')=='done' and has_evidence(task) and all(dependencies)
        if real:result=result and task.get('owner_confirmed') is True and not training(task)
        visiting.remove(id);checked[id]=result
        return result
    for id in by_id:visit(id)
    return {id for id,value in checked.items() if value}


def fingerprint(tasks, ids):
    """Bind a gate review to the evidence and revisions of its whole quest chain."""
    by_id={t['id']:t for t in tasks};selected={}
    def add(id):
        if id in selected:return
        task=by_id.get(id,{})
        selected[id]={key:task.get(key) for key in ('id','status','completion_evidence','owner_confirmed','mode','depends_on','updated_at')}
        for dependency in task.get('depends_on',[]):add(dependency)
    for id in ids:add(id)
    return hashlib.sha256(json.dumps(selected,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def gate_requirements(phase):
    if type(phase) is not int or not 0<=phase<len(ROOMS):raise ValueError('Unknown dungeon room')
    return [{'id':id,'label':label} for id,label in ROOMS[phase]['requirements']]


def progress(tasks,game):
    done=effective_done(tasks,real=True)
    eligible=done
    xp=len(eligible)*25
    stored=game.get('gates',{}) if isinstance(game,dict) else {}
    if not isinstance(stored,dict):raise ValueError('Invalid gate records')
    rooms=[]
    for definition in ROOMS:
        phase=definition['id'];gate=stored.get(str(phase),{})
        if not isinstance(gate,dict):raise ValueError('Invalid gate record')
        evidence=gate.get('evidence',{})
        if not isinstance(evidence,dict):raise ValueError('Invalid gate evidence')
        requirements=[{**req,'evidence':evidence.get(req['id'],''),
                       'met':isinstance(evidence.get(req['id']),str) and bool(evidence[req['id']].strip())}
                      for req in gate_requirements(phase)]
        missing=[id for id in definition['tasks'] if id not in eligible]
        previous=phase==0 or rooms[phase-1]['cleared']
        review_current=gate.get('quest_fingerprint')==fingerprint(tasks,definition['tasks'])
        cleared=previous and not missing and review_current and gate.get('owner_confirmed') is True and all(r['met'] for r in requirements)
        phase_tasks=[t for t in tasks if t['id'] in definition['tasks'] and not training(t)]
        rooms.append({**{k:v for k,v in definition.items() if k!='requirements'},'requirements':requirements,
                      'missing_tasks':missing,'unlocked':bool(previous),'cleared':bool(cleared),
                      'completed':sum(t['id'] in eligible for t in phase_tasks),'total':len(phase_tasks),
                      'reviewed_at':gate.get('reviewed_at'),'review_current':review_current})
    return {'xp':xp,'level':1+math.floor(xp/100),'level_xp':xp%100,'next_level_xp':100,
            'eligible_task_ids':sorted(eligible),'effective_done_ids':sorted(done),
            'stale_task_ids':sorted(t['id'] for t in tasks if t.get('status')=='done' and t['id'] not in done and not training(t)),
            'rooms':rooms,'training_task_ids':sorted(t['id'] for t in tasks if training(t))}

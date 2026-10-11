"""Deterministic campaign preparation and evidence records. No external I/O."""
import copy
import datetime
import hashlib
import json
import re
import secrets
from urllib.parse import urlsplit

import automation
import prospecting
import records
import ultra
from ultra_ui import RequestError

DEFAULT_WEIGHTS = {'fit': 40, 'evidence': 25, 'contact': 20, 'freshness': 15}
INTENTS = {'wrong_person': ('contacts', 'Find the right contact', 'Ask for a permitted introduction.'),
           'example': ('proof', 'Prepare a checked example', 'Review a synthetic proof pack before responding.'),
           'interested': ('scope', 'Qualify the pilot', 'Ask about sample permission, fields, quantity and acceptance.'),
           'later': ('followup', 'Propose a follow-up', 'Choose a date from the buyer’s actual reply; otherwise leave it unknown.'),
           'declined': ('closed', 'Close outreach', 'Suppress further suggestions for this company.'),
           'do_not_contact': ('closed', 'Do not contact', 'Suppress outreach at the recorded scope.'),
           'unclear': ('reply', 'Review the reply', 'Confirm or correct its interpretation before preparing the next step.')}
EMPTY = {'schema_version': 1, 'contacts': [], 'events': [], 'followups': [], 'signals': [],
         'proofs': [], 'variants': [], 'experiments': [], 'crew_drafts': [], 'proposals': [],
         'weights': DEFAULT_WEIGHTS, 'weights_version': 1, 'history': []}


def check_new_company(country, company, website, leads, exclusions, proposals=()):
    """Share CSV intake's name/website normalization and refusal order with crew intake."""
    if not prospecting.tunisian(country):
        raise ValueError('Company country is outside Tunisia or unknown')
    normalized = automation.normalize_company(company)
    excluded = {automation.normalize_company(value) for row in exclusions.get('companies', [])
                for value in [row.get('company'), *row.get('aliases', [])] if value}
    if normalized in excluded:
        raise ValueError('Company excluded')
    if normalized in {automation.normalize_company(row.get('company')) for row in leads if row.get('company')}:
        raise ValueError('Duplicate company')
    def website_key(value):
        return value.strip().rstrip('/') if isinstance(value, str) else ''
    key = website_key(website)
    known = {website_key(row.get('website', row.get('source_url', ''))) for row in leads}
    if key and key in known:
        raise ValueError('Duplicate company website')
    if any(row.get('status') == 'proposed' and (automation.normalize_company(row.get('company')) == normalized or
            key and website_key(row.get('website')) == key) for row in proposals):
        raise ValueError('Already proposed')


def fingerprint(lead, draft=False):
    keys = ('company', 'country', 'source_url', 'observed_fact', 'pitch_hook', 'checked_date')
    value = {key: lead.get(key) for key in keys}
    if draft: value['draft'] = {k: (lead.get('draft') or {}).get(k) for k in ('subject','body','offer','observation')}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def guess_intent(text):
    lowered = text.casefold()
    terms = [('do_not_contact', ['do not contact', 'stop contacting', 'unsubscribe', 'ne me contactez', 'désinscri']),
             ('declined', ['not interested', 'pas intéress', 'aucun besoin']),
             ('wrong_person', ['wrong person', 'not the right person', 'mauvaise personne', 'bon interlocuteur']),
             ('example', ['example', 'exemple', 'sample', 'échantillon']),
             ('later', ['later', 'next month', 'plus tard', 'mois prochain']),
             ('interested', ['interested', 'intéress', 'discuss', 'discuter'])]
    matches = [intent for intent, words in terms if any(word in lowered for word in words)]
    return matches[0] if len(matches) == 1 else 'unclear'


def branch(event):
    intent = event.get('interpretation', 'unclear') if event.get('interpretation_confirmed') else 'unclear'
    action, title, reason = INTENTS.get(intent, INTENTS['unclear'])
    return {'intent': intent, 'action': action, 'title': title, 'reason': reason, 'event_id': event['id'],
            'evidence': event.get('evidence')}



def reply_response(event):
    if not event.get('interpretation_confirmed'): return None
    return {'wrong_person': "Merci pour votre réponse. Quel serait le bon interlocuteur pour vérifier si ce petit test est utile ? Une introduction convient seulement si vous l’autorisez.",
            'example': "Merci. Je peux préparer un exemple synthétique avec le résultat et les exceptions à vérifier. Il ne représente pas vos données et ne garantit pas une précision sur vos documents.",
            'interested': "Merci. Quel travail répété vous prend du temps ? Pour cadrer un petit pilote, pouvons-nous examiner un échantillon que vous êtes autorisé à partager, puis convenir des champs, du volume, des exceptions et des critères d’acceptation ?",
            'later': "Merci. Quelle date vous conviendrait pour reprendre cette discussion ? Je laisse la date ouverte tant que nous ne l’avons pas convenue."}.get(event.get('interpretation'))


def suppressed(state, lead_id, contact_id=None):
    # A clear opt-out in an evidenced original reply is conservatively suppressed
    # even while the owner reviews interpretation. Ambiguous refusal stays review-only.
    return any(e.get('confirmed') and e.get('lead_id') == lead_id and
        (e.get('kind') == 'do_not_contact' or
         e.get('interpretation_confirmed') and e.get('interpretation') in {'declined', 'do_not_contact'} or
         e.get('kind') == 'reply' and any(term in e.get('text', '').casefold() for term in
             ('do not contact', 'stop contacting', 'unsubscribe', 'ne me contactez', 'désinscri'))) and
        (e.get('scope', 'company') == 'company' or contact_id is not None and e.get('contact_id') == contact_id)
        for e in state['events'])



def reply_version(state, lead_id):
    replies=[{k:e.get(k) for k in ('id','text','on','contact_id','scope','interpretation','interpretation_confirmed')}
             for e in state['events'] if e['lead_id']==lead_id and e['kind']=='reply' and e.get('confirmed')]
    return hashlib.sha256(json.dumps(replies,sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def artifact_version(lead, state):
    return hashlib.sha256((fingerprint(lead,True)+reply_version(state,lead['id'])).encode()).hexdigest()


def route_suppressed(state, lead):
    if suppressed(state,lead['id']): return True
    def tokens(route):
        text=(route or '').casefold()
        emails=set(re.findall(r'[a-z0-9_.+%-]+@[a-z0-9.-]+',text))
        phone=''.join(c for c in text if c.isdigit())
        return emails | ({phone} if len(phone)>=8 else set()) | {text.strip()}
    route=tokens(lead.get('contact_route'))
    return any(c['lead_id']==lead['id'] and suppressed(state,lead['id'],c['id']) and
               bool(route & tokens(c.get('route')) - {''}) for c in state.get('contacts',[]))


def lead_view(lead,state):
    out=copy.deepcopy(lead);draft=out.get('draft')
    if draft:
        epoch=draft.get('campaign_reply_version')
        empty=reply_version(EMPTY,lead['id'])
        draft['reviewed']=bool(draft.get('reviewed') and (epoch or empty)==reply_version(state,lead['id']) and
            (not draft.get('reviewed_source_version') or draft['reviewed_source_version']==fingerprint(lead)))
    return out


def rank(leads, exclusions, weights, offer, today):
    rows = []
    active = prospecting.in_scope(leads)
    audits = automation.audit_leads(active, exclusions, today)
    for lead, audit in zip(active, audits):
        if set(audit['flags']) & {'excluded', 'unknown_company', 'simulation'}: continue
        age = None
        try: age = (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(lead.get('checked_date') or '')).days
        except ValueError: pass
        factors = [
            ('fit', 1 if lead.get('recommended_offer') == offer else .5 if lead.get('industry') else 0,
             'Stored offer hypothesis matches' if lead.get('recommended_offer') == offer else 'Industry known; fit needs review'),
            ('evidence', 1 if lead.get('source_url') and lead.get('observed_fact') and lead.get('source_live_checked') else .5 if lead.get('source_url') and lead.get('observed_fact') else 0,
             'Observed source and live-check flag' if lead.get('source_live_checked') else 'Source record available; live check unknown'),
            ('contact', 1 if lead.get('contact_route') else 0, 'Published route; buying interest unknown'),
            ('freshness', 1 if age is not None and 0 <= age <= 30 else .5 if age is not None and 30 < age <= 90 else 0,
             'Source age: ' + (str(age) + ' days' if age is not None else 'unknown'))]
        scored = [{'factor': name, 'weight': weights[name], 'points': round(weights[name] * value, 2),
                   'reason': reason, 'source_url': lead.get('source_url'), 'checked_date': lead.get('checked_date')} for name, value, reason in factors]
        rows.append({'id': lead['id'], 'score': sum(f['points'] for f in scored), 'factors': scored,
                     'unknowns': [name for name, value, _ in factors if value == 0], 'audit_flags': audit['flags'],
                     'source_version': fingerprint(lead), 'meaning': 'Preparation priority; no purchase probability'})
    return sorted(rows, key=lambda row: (-row['score'], row['id']))


def funnel(leads, events, start=None, end=None):
    active = {r['id']: r for r in prospecting.in_scope(leads)}
    selected = [e for e in events if e.get('confirmed') and e.get('lead_id') in active and
                (not start or e.get('on', '') >= start) and (not end or e.get('on', '') <= end)]
    def event_ids(kind): return {e['lead_id'] for e in selected if e['kind'] == kind}
    counts = {'sourced': len(active), 'shortlisted': sum(r.get('shortlisted') is True for r in active.values())}
    statuses = {'contacted': {'contacted', 'no_reply', 'replied', 'qualified', 'sample_received', 'proposed', 'accepted'},
                'replied': {'replied', 'qualified', 'sample_received', 'proposed', 'accepted'},
                'qualified': {'qualified', 'sample_received', 'proposed', 'accepted'}, 'pilot': {'accepted'}}
    inferred_events = {'contacted': {'sent', 'reply', 'qualified', 'agreed_pilot'},
                       'replied': {'reply', 'qualified', 'agreed_pilot'},
                       'qualified': {'qualified', 'agreed_pilot'}, 'pilot': {'agreed_pilot'}}
    for stage, kind in [('contacted', 'sent'), ('replied', 'reply'), ('qualified', 'qualified'), ('pilot', 'agreed_pilot')]:
        legacy = {id for id, r in active.items() if r.get('owner_confirmed') and r.get('status_evidence') and
                  r.get('status') in statuses[stage] and (not start or r.get('contacted_on', '') >= start) and
                  (not end or r.get('contacted_on', '') <= end)}
        counts[stage] = len(set().union(*(event_ids(k) for k in inferred_events[stage])) | legacy)
    pairs = [('sourced', 'shortlisted'), ('shortlisted', 'contacted'), ('contacted', 'replied'), ('replied', 'qualified'), ('qualified', 'pilot')]
    return {'counts': counts, 'rates': {a + '_to_' + b: round(counts[b] / counts[a], 4) if counts[a] else None for a, b in pairs},
            'attempts': sum(e['kind'] == 'sent' for e in selected), 'unit': 'distinct companies',
            'cohort': 'Current active Tunisia companies; sourced/shortlisted are current inventory', 'start': start, 'end': end,
            'note': 'Event stages use evidenced owner-confirmed outcomes. Rates are descriptive; no causal claim.'}


def focus_plan(tasks, followups, minutes, today):
    if type(minutes) is not int or minutes not in {20, 45, 90}:
        raise ValueError('Choose a 20, 45 or 90 minute session.')
    steps, used, unknown = [], 0, []
    for followup in sorted(followups, key=lambda row: (row.get('on') or '9999-12-31', row['id'])):
        if not followup.get('on') or followup['on'] > today: continue
        estimate = 5  # Explicit planning estimate; never measured effort or completion.
        if used + estimate > minutes: continue
        steps.append({'id': followup['id'], 'lead_id': followup['lead_id'], 'title': followup['text'],
                      'kind': 'followup_review', 'minutes': estimate, 'estimate_basis': 'default planning estimate'})
        used += estimate
    for task in tasks:
        if not task.get('ready') or task.get('effective_done'): continue
        estimate = task.get('timebox_minutes')
        if type(estimate) is not int or estimate <= 0:
            unknown.append(task['id']); continue
        if used + estimate > minutes: continue
        steps.append({'id': task['id'], 'title': task['title'], 'kind': 'quest', 'minutes': estimate,
                      'estimate_basis': 'stored quest estimate'})
        used += estimate
    return {'minutes': minutes, 'steps': steps, 'planned_minutes': used, 'unknown_estimates': unknown,
            'awards_xp': False, 'note': 'Review due work first; estimates and elapsed time do not prove completion.'}


class Campaign:
    def __init__(self, workspace):
        self.workspace = workspace; self.root = workspace.root
        self.path = ultra.inside(self.root, 'data/campaign-workbench.json')

    def read(self):
        return json.loads(self.path.read_text()) if self.path.exists() else copy.deepcopy(EMPTY)

    def version(self):
        raw = self.path.read_bytes() if self.path.exists() else b''
        return hashlib.sha256(raw).hexdigest()

    def suppressed(self, id, contact_id=None):
        return suppressed(self.read(), id, contact_id)

    def route_suppressed(self, lead): return route_suppressed(self.read(), lead)

    def leads(self): return ultra.read_json(self.root, 'data/leads.json')

    def lead(self, id, outreach=False):
        row = next((r for r in self.leads() if r['id'] == id), None)
        if not row: raise ValueError('Select an existing company.')
        audit = automation.audit_leads([row], ultra.read_json(self.root, 'data/exclusions.json'))[0]
        if not prospecting.in_scope([row]) or set(audit['flags']) & {'excluded', 'unknown_company', 'simulation'}:
            raise ValueError('Only eligible Tunisian companies are available here.')
        if outreach and (self.route_suppressed(row) or row.get('status') in {'declined', 'rejected'}):
            raise ValueError('Outreach preparation is suppressed for this company.')
        return row

    def snapshot(self, offer='documents'):
        with self.workspace.lock:
            state = self.read(); leads = self.leads(); byid = {r['id']: r for r in leads}
            result = copy.deepcopy(state)
            result.update(version=self.version(), rankings=rank(leads, ultra.read_json(self.root, 'data/exclusions.json'),
                state['weights'], offer, records.local_today().isoformat()), analytics=funnel(leads, state['events']), offer=offer)
            for collection, draft in [('proofs', True), ('variants', True)]:
                for artifact in result[collection]:
                    artifact['review_current'] = bool(artifact.get('reviewed') and artifact['lead_id'] in byid and
                        artifact['source_version'] == artifact_version(byid[artifact['lead_id']], state))
            for e in result['events']:
                if e['kind'] == 'reply':
                    e['branch'] = branch(e)
                    e['response_draft'] = reply_response(e)
            for f in result['followups']:
                f['needs_review'] = f.get('reply_version',reply_version(EMPTY,f['lead_id'])) != reply_version(state,f['lead_id'])
                f['suppressed'] = suppressed(state,f['lead_id'],f.get('contact_id'))
            result['route_suppressed_ids'] = [r['id'] for r in leads if route_suppressed(state,r)]
            result['suppressed_ids'] = [r['id'] for r in leads if suppressed(state, r['id']) or r.get('status') in {'declined', 'rejected'}]
            result['experiment_results'] = [self.experiment_result(e, state['events']) for e in state['experiments']]
            result['stalled'] = [{'lead_id': r['id'], 'reason': 'No reviewed next action'} for r in prospecting.in_scope(leads)
                                 if (r.get('contact_sent') or any(e['lead_id'] == r['id'] and e['kind'] == 'sent' for e in state['events']))
                                 and not suppressed(state, r['id']) and not r.get('next_action') and
                                 not any(f['lead_id'] == r['id'] for f in state['followups'])]
            return result

    def preflight(self, requirement):
        if not isinstance(requirement,dict) or set(requirement)-{'kind','lead_ids','reply_id','intent'}: raise ValueError('Unsupported recipe requirements.')
        kind=requirement.get('kind');ids=requirement.get('lead_ids',[])
        if kind not in {'shortlist','pitches','conversation','pilot'} or not isinstance(ids,list) or len(set(ids))!=len(ids):raise ValueError('Choose a known campaign recipe and distinct companies.')
        leads=[self.lead(id,kind=='pitches') for id in ids];state=self.read();missing=[]
        if kind=='shortlist' and len(leads)<5:missing.append('Five eligible sourced companies')
        if kind=='pitches':
            if len(leads)!=3 or any(not l.get('shortlisted') for l in leads):missing.append('Three shortlisted companies')
            if any(not any(p['lead_id']==l['id'] and p.get('reviewed') and p['source_version']==artifact_version(l,state) for p in state['proofs']) for l in leads):missing.append('A current reviewed proof for each company')
        if kind in {'conversation','pilot'}:
            if len(leads)!=1:missing.append('One selected company')
            events=[e for e in state['events'] if e['lead_id'] in ids and e.get('confirmed')]
            if kind=='conversation':
                replies=[e for e in events if e['kind']=='reply'];latest=replies[-1] if replies else None
                if not latest or latest['id']!=requirement.get('reply_id') or not latest.get('interpretation_confirmed') or latest['interpretation']!=requirement.get('intent'):missing.append('Current owner-reviewed original reply')
            elif not any(e['kind']=='agreed_pilot' for e in events):missing.append('Evidenced owner-confirmed pilot agreement')
        return {'ready':not missing,'missing':missing,'lead_ids':ids,'authority':'Preparation eligibility only; no business completion'}

    def experiment_result(self, experiment, events):
        variants = []
        for name in ('A', 'B'):
            ids = {id for id, v in experiment['assignments'].items() if v == name}
            sends = [e for e in events if e.get('confirmed') and e['kind'] == 'sent' and e.get('experiment_id') == experiment['id']
                     and e.get('lead_id') in ids and experiment['start'] <= e['on'] <= experiment['end']]
            sent_ids = {e['lead_id'] for e in sends}
            replies = {e['lead_id'] for e in events if e.get('confirmed') and e['kind'] == 'reply' and e['lead_id'] in sent_ids
                       and experiment['start'] <= e['on'] <= experiment['end'] and any(s['lead_id'] == e['lead_id'] and s['on'] <= e['on'] for s in sends)}
            variants.append({'variant': name, 'assigned': len(ids), 'sent': len(sent_ids), 'attempts': len(sends),
                             'replied': len(replies), 'pending': len(sent_ids - replies), 'rate': len(replies) / len(sent_ids) if sent_ids else None})
        return {'id': experiment['id'], 'variants': variants, 'conclusion': 'Descriptive counts only; no reliable winner established.'}

    def action(self, name, body, expected):
        with self.workspace.lock:
            if expected.strip('"') != self.version(): raise RequestError(409, 'Campaign changed. Refresh before saving.')
            if not isinstance(body, dict): raise RequestError(400, 'Send a campaign object.')
            state = self.read(); before = copy.deepcopy(state)
            try:
                value = self.mutate(state, name, body)
                state['history'].append({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'action': name,
                    'id': value.get('id') if isinstance(value, dict) else None, 'before_version': self.version()})
                if state == before: raise ValueError('No campaign change.')
                self.workspace.atomic_json(self.path, state, '.campaign-')
                return {('event' if name == 'event' else 'proof' if name == 'proof' else 'variant' if name == 'variant' else
                         'experiment' if name == 'experiment' else 'record'): value, 'version': self.version()}
            except (ValueError, KeyError, TypeError) as e: raise RequestError(400, str(e)) from None

    def mutate(self, state, name, body):
        allowed = {
            'weights': {'weights'}, 'contact': {'lead_id', 'name', 'role', 'route', 'source_url', 'checked_on', 'relationship'},
            'signal': {'lead_id', 'text', 'source_url', 'checked_on', 'event_on', 'hypothesis'},
            'event': {'lead_id', 'contact_id', 'kind', 'text', 'on', 'evidence', 'confirmed', 'scope', 'experiment_id'},
            'interpret': {'id', 'intent', 'confirmed'}, 'followup': {'lead_id', 'contact_id', 'on', 'text'},
            'proof': {'lead_id', 'offer'}, 'review-proof': {'id', 'confirmed'},
            'variant': {'lead_id', 'language', 'channel'}, 'review-variant': {'id', 'confirmed'},
            'experiment': {'name', 'lead_ids', 'a', 'b', 'start', 'end'},
            'crew-draft-status': {'id', 'status'}, 'proposal-status': {'id', 'status', 'reason'},
            'accept-proposal': {'id'}}
        if name not in allowed or set(body) - allowed[name]: raise ValueError('Unsupported campaign fields.')
        if name in {'crew-draft-status', 'proposal-status', 'accept-proposal'}:
            collection = 'crew_drafts' if name == 'crew-draft-status' else 'proposals'
            row = next((r for r in state.get(collection, []) if r['id'] == body.get('id')), None)
            if not row or row.get('status') != 'proposed': raise ValueError('Select an open draft or proposal.')
            if name == 'crew-draft-status':
                if body.get('status') not in {'adopted', 'dismissed'}: raise ValueError('Adopt or dismiss the crew draft.')
                row.update(status=body['status'], reviewed=True)
            elif name == 'proposal-status':
                reason = required(body, 'reason')
                if body.get('status') != 'rejected' or not 3 <= len(reason) <= 300:
                    raise ValueError('Reject the proposal with a reason of 3–300 characters.')
                row.update(status='rejected', reason=reason)
            else:
                leads = self.leads()
                check_new_company(row.get('country'), row['company'], row.get('website'), leads,
                                  ultra.read_json(self.root, 'data/exclusions.json'))
                # Match the accepted CSV row shape and its journal, ID and atomic write path.
                lead = records.journal({}, {
                    'id': 'lead-' + secrets.token_hex(6), 'company': row['company'], 'kind': 'service_prospect',
                    'country': 'TN', 'location': row.get('location') or 'Tunisia', 'industry': row.get('industry'),
                    'website': row.get('website'), 'source_url': row['source_url'],
                    'source_reference': 'Crew proposal ' + row['id'] + ' by ' + row['agent_id'],
                    'observed_fact': row['quote'], 'observed_text': row['quote'], 'checked_date': row['observed_on'],
                    'source_type': 'crew_proposal', 'source_live_checked': False, 'contact_route': None,
                    'mode': 'real', 'status': 'discovered', 'contact_sent': False, 'buyer_need_confirmed': False,
                    'exclusion_check': 'not_excluded', 'need_hypothesis': 'À qualifier avec le décideur ; aucun besoin confirmé.'})
                self.workspace.atomic_json(ultra.inside(self.root, 'data/leads.json'), [*leads, lead], '.leads-import-')
                row.update(status='accepted', lead_id=lead['id'])
            return row
        if name == 'weights':
            weights = body['weights']
            if not isinstance(weights, dict) or set(weights) != set(DEFAULT_WEIGHTS) or any(type(v) is not int or not 0 <= v <= 100 for v in weights.values()) or not sum(weights.values()):
                raise ValueError('Set four integer weights 0–100 with a positive total.')
            state.update(weights=weights, weights_version=state['weights_version'] + 1); return weights
        if name in {'interpret', 'review-proof', 'review-variant'}:
            collection = 'events' if name == 'interpret' else 'proofs' if name == 'review-proof' else 'variants'
            row = next((r for r in state[collection] if r['id'] == body['id']), None)
            if not row or body.get('confirmed') is not True: raise ValueError('Select and explicitly review the record.')
            if name == 'interpret':
                if row['kind'] != 'reply' or body['intent'] not in INTENTS: raise ValueError('Select a supported reply intent.')
                row.setdefault('interpretation_history', []).append({'intent': row.get('interpretation'), 'confirmed': row.get('interpretation_confirmed')})
                row.update(interpretation=body['intent'], interpretation_confirmed=True)
            else:
                lead = self.lead(row['lead_id'], True)
                if row['source_version'] != artifact_version(lead,state): raise ValueError('Inputs changed. Prepare a fresh version before review.')
                row['reviewed'] = True
            return row
        if name == 'experiment':
            ids = body['lead_ids']
            if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or len(set(ids)) != len(ids): raise ValueError('Select 1–100 distinct companies.')
            for id in ids: self.lead(id, True)
            start, end = records.date_value(body['start']), records.date_value(body['end'])
            if not start or not end or start > end: raise ValueError('Choose a valid experiment window.')
            row = {'id': 'experiment-' + secrets.token_hex(6), 'name': required(body, 'name'), 'a': required(body, 'a'), 'b': required(body, 'b'),
                   'start': start, 'end': end, 'assignments': {id: 'AB'[int(hashlib.sha256(id.encode()).hexdigest(), 16) % 2] for id in ids}}
            state['experiments'].append(row); return row
        lead = self.lead(body['lead_id'], name in {'proof', 'variant', 'followup', 'contact'})
        id = name + '-' + secrets.token_hex(6)
        base = {'id': id, 'lead_id': lead['id'], 'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        contact_id = body.get('contact_id')
        if contact_id and not any(c['id'] == contact_id and c['lead_id'] == lead['id'] for c in state.get('contacts',[])):
            raise ValueError('Contact must belong to this company.')
        if name == 'followup' and suppressed(state, lead['id'], contact_id):
            raise ValueError('Outreach preparation is suppressed for this contact/company.')
        if name in {'contact', 'signal'}:
            source = required(body, 'source_url'); checked = records.date_value(body['checked_on'])
            parsed = urlsplit(source)
            if parsed.scheme not in {'https', 'http'} or not parsed.hostname or parsed.username or parsed.password or not checked or checked > records.local_today().isoformat():
                raise ValueError('Include a public source and an actual observation date.')
            row = {**base, **{k: records.text_value(v) for k, v in body.items() if k != 'lead_id'}}
            for key in ('name', 'route') if name == 'contact' else ('text',): required(row, key)
            if name == 'signal': row['event_on'] = records.date_value(body.get('event_on'))
            row['authority_confirmed'] = False
            state['contacts' if name == 'contact' else 'signals'].append(row); return row
        if name == 'event':
            kind = body['kind']; date = records.date_value(body.get('on'))
            if kind not in {'sent', 'reply', 'qualified', 'agreed_pilot', 'do_not_contact'} or body.get('confirmed') is not True or not date or date > records.local_today().isoformat():
                raise ValueError('Confirm an actual supported outcome and its date.')
            evidence = required(body, 'evidence')
            if body.get('scope', 'company') not in {'contact', 'company'} or body.get('scope') == 'contact' and not contact_id:
                raise ValueError('Choose company scope or an identified contact.')
            if kind == 'sent' and self.suppressed(lead['id'], contact_id): raise ValueError('Company/contact is suppressed.')
            row = {**base, 'kind': kind, 'on': date, 'evidence': evidence, 'confirmed': True, 'contact_id': contact_id,
                   'scope': body.get('scope', 'company'), 'text': records.text_value(body.get('text')) or ''}
            if kind == 'reply':
                required(row, 'text'); row.update(interpretation=guess_intent(row['text']), interpretation_confirmed=False)
            if body.get('experiment_id'):
                exp = next((e for e in state['experiments'] if e['id'] == body['experiment_id']), None)
                if kind != 'sent' or not exp or lead['id'] not in exp['assignments'] or not exp['start'] <= date <= exp['end']:
                    raise ValueError('Send must belong to the experiment assignment and date window.')
                row.update(experiment_id=exp['id'], variant=exp['assignments'][lead['id']])
            state['events'].append(row); return row
        if name == 'followup':
            row = {**base, 'contact_id': contact_id, 'on': records.date_value(body.get('on')), 'text': required(body, 'text'),
                   'status': 'proposed', 'sent': False, 'reply_version':reply_version(state,lead['id'])}
            state['followups'].append(row); return row
        if name == 'proof':
            row = self.proof(lead, body['offer'], base); state['proofs'].append(row); return row
        if name == 'variant':
            language, channel = body['language'], body['channel']
            if language not in {'fr', 'ar-TN'} or channel not in {'email', 'linkedin', 'phone', 'whatsapp'}:
                raise ValueError('Choose French/Tunisian Arabic and a supported channel.')
            draft = lead.get('draft')
            if not draft or not draft.get('body') or draft.get('offer') not in prospecting.OFFERS: raise ValueError('Prepare a supported source draft first.')
            scopes = {'cleanup': 'تنظيف جدول صغير من 20 سطر ومراجعة التكرار والخانات الناقصة',
                'catalogue': 'ترتيب 20 مرجع من الكاتالوغ في جدول ومراجعة المعرّفات',
                'documents': 'تحويل عيّنة من صفحتين لجدول مع ذكر المصادر والقيم اللي تستحق مراجعة',
                'website': 'مراجعة مشكل محدّد في صفحة ويب واحدة والاتفاق على إصلاح محدود'}
            text = draft['body'] if language == 'fr' else (
                f"عسلامة فريق {lead['company']}، أنا آدم. نقترح نتفاهموا على تجربة صغيرة: {scopes[draft['offer']]}. "
                "الخدمة هاذي تاخذ من وقتكم توّة؟ شكون الشخص المناسب باش نحكي معاه؟ "
                "قبل ما نبدأوا، نشوفوا عيّنة عندكم الإذن تشاركوها ونتفاهموا على نطاق الخدمة والسعر والوقت.")
            if channel == 'phone': text = ('Introduction à relire avant appel: ' if language == 'fr' else 'مقدّمة للمراجعة قبل المكالمة: ') + text
            row = {**base, 'language': language, 'channel': channel, 'body': text, 'source_observation': draft.get('observation'),
                   'source_version': artifact_version(lead, state), 'reviewed': False, 'status': 'unsent draft'}
            state['variants'].append(row); return row
        raise ValueError('Unknown campaign operation.')

    def proof(self, lead, offer, base):
        if offer not in prospecting.OFFERS: raise ValueError('Choose a bounded offer.')
        # An actual, inspectable fixed check; every row is fictional.
        website = offer == 'website'
        source = ("<a href='/missing'>Catalogue</a>" if website else
                  'page,id,label,quantity\n1, A-001 , Example one ,2\n2,A-002,Example two,\n2,A-001,Duplicate,2\n' if offer == 'documents' else
                  'id,label,quantity\n A-001 , Example one ,2\nA-002,Example two,\nA-001,Duplicate,2\n')
        checked = ({'before': source, 'after': "<a href='/catalogue'>Catalogue</a>",
                    'checks': {'one_link_changed': source.count('/missing') == 1,
                               'target_is_local': '/catalogue' in "<a href='/catalogue'>Catalogue</a>"}}
                   if website else automation.clean_csv(source, 'id', 'quantity', ','))
        draft = lead.get('draft')
        if not draft or draft.get('offer') != offer:
            draft = prospecting.make_draft(lead, offer, ultra.read_json(self.root, 'data/exclusions.json'))
        issue_kinds = {issue['kind'] for issue in checked.get('issues', [])}
        checks = [{'name': 'Synthetic input disclosed', 'passed': True},
                  {'name': 'Source retained with output', 'passed': True},
                  {'name': 'Relevant exception or website change checked',
                   'passed': all(checked['checks'].values()) if website else
                             {'duplicate_conflict', 'invalid_amount'} <= issue_kinds}]
        if not all(check['passed'] for check in checks):
            raise ValueError('Synthetic proof checks did not expose the expected exceptions.')
        folder = ultra.new_run(self.root, 'script'); path = folder / 'report.md'
        report = (f"# Draft proof pack · {lead['company']}\n\n**SYNTHETIC EXAMPLE — fictional rows; no client result. Owner review required.**\n\n"
                  f"Offer: {prospecting.OFFERS[offer]['name']}\n\nBounded pilot: {prospecting.OFFERS[offer]['scope']}. "
                  "Permission, quantity, fields, acceptance, price and date must be agreed before starting.\n\n"
                  f"Source: {lead.get('source_url')}\nObserved: {lead.get('observed_fact')}\nChecked on: {lead.get('checked_date')}\n\n"
                  f"## Company pitch draft · UNSENT\n\n{draft['body']}\n\n## Inspectable {'single-page website' if website else 'data'} example\n\n"
                  "This shows one check and exception workflow; a buyer's actual input still needs examination.\n\n"
                  f"```{'html' if website else 'csv'}\n{source}\n```\n\n```json\n{json.dumps(checked, indent=2, ensure_ascii=False)}\n```\n\n"
                  + ("The fictional broken link is changed once; the real site has not been assessed.\n\n" if website else
                     "IDs remain source-linked; duplicate A-001 and missing A-002 quantity require review. No ambiguous value was filled.\n\n") +
                  "Adem led AI-assisted delivery, contributed requirements and selected review. The court OCR evidence covers one held-out section only; it is not an accuracy promise for these or buyer documents.\n")
        path.write_text(report)
        if not website: (folder / 'source.csv').write_text(source)
        ultra.write_json(folder / 'result.json', checked)
        ultra.write_json(folder / 'run.json', {'engine': 'script', 'automation': 'proof-pack', 'mode': 'draft',
            'status': 'prepared', 'model_invoked': False, 'real_records_changed': False, 'lead_id': lead['id']})
        return {**base, 'offer': offer, 'path': str(path.relative_to(self.root)), 'run_id': folder.name,
                'source_version': artifact_version(lead, self.read()), 'checks': checks, 'reviewed': False, 'permission': 'synthetic'}


def required(body, key):
    value = records.text_value(body.get(key))
    if not value: raise ValueError('Required: ' + key)
    return value

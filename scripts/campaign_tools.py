"""Field-filtered campaign packets and unreviewed crew preparation. No external I/O."""
import datetime
import re
import secrets
from urllib.parse import urlsplit

import automation
import campaign
import prospecting
import records
import ultra


PACKET_FIELDS = ('id', 'company', 'country', 'location', 'industry', 'website', 'source_url', 'source_type',
                 'checked_date', 'observed_fact', 'observed_text', 'need_hypothesis', 'pitch_hook',
                 'recommended_offer', 'status', 'shortlisted', 'exclusion_check', 'buyer_need_confirmed', 'contact_sent')

# Structured identifiers, dates and enums are not free text. Preserve them so
# redaction cannot break lead references, review hashes or source dates.
MODEL_METADATA_FIELDS = {'id', 'lead_id', 'agent_id', 'source_version', 'created_at',
                         'checked_date', 'checked_on', 'country', 'recommended_offer',
                         'offer', 'status', 'stage', 'language', 'exclusion_check', 'channel', 'factor'}


def redact_model_text(value, contact_names):
    """Return a redacted model view; never mutate the stored record."""
    if isinstance(value, dict):
        return {key: item if key in MODEL_METADATA_FIELDS else redact_model_text(item, contact_names)
                for key, item in value.items()}
    if isinstance(value, list):
        return [redact_model_text(item, contact_names) for item in value]
    if not isinstance(value, str):
        return value
    value = re.sub(r'\b(?:https?://)?(?:www\.)?(?:linkedin\.com/in/|facebook\.com/|wa\.me/)[^\s<>"\';,)]+',
                   '[profile]', value, flags=re.I)
    value = re.sub(r'[\w.%+-]+@[\w.-]+\.[a-z]{2,}', '[email]', value, flags=re.I)
    value = re.sub(r'(?<!\w)\+?(?:\( *)?\d(?:[ .\-()]*\d){7,}\)?(?!\w)', '[phone]', value)
    names = sorted({name.strip() for name in contact_names if isinstance(name, str) and name.strip()},
                   key=len, reverse=True)
    if names:
        value = re.sub(r'(?<!\w)(?:' + '|'.join(re.escape(name) for name in names) + r')(?!\w)',
                       '[contact]', value, flags=re.I)
    return value

# A local preparation setting, not a sourced business rule.
STALE_SOURCE_DAYS = 180
CLAIM_RULES = [
    ('price', re.compile(r'\b\d+(?:[.,]\d+)?\s*(?:(?:DT|TND|dinars?|EUR|euros?|USD)\b|[€$])', re.I),
     'Remove the price: prices are agreed with Adem, never promised in a first message.'),
    ('percentage', re.compile(r'\b\d+(?:[.,]\d+)?\s*%', re.I),
     'Remove the percentage: source results do not establish accuracy for this company.'),
    ('time_promise', re.compile(r'\b(?:en|in|within|sous)\s+\d+(?:[.,]\d+)?\s*'
                               r'(?:h|heures?|hours?|hrs?|jours?|days?|semaines?|weeks?)\b|\b(?:24|48|72)\s*h\b', re.I),
     'Remove the time promise: delivery dates must be agreed with Adem.'),
    ('guarantee', re.compile(r'\b(?:garanti\w*|guarantee\w*)|\b100\s*%', re.I),
     'Remove the guarantee: a first message cannot promise results.'),
    ('invented_clients', re.compile(r'\b(?:nos\s+clients|our\s+clients|déjà\s+travaillé\s+avec|already\s+worked\s+with|références\s+clients)\b', re.I),
     'Remove client claims: do not invent clients, prior work or references.'),
]


def _text(args, key, minimum, maximum, default=None):
    value = args.get(key, default)
    if not isinstance(value, str) or not minimum <= len(value) <= maximum or (minimum and not value.strip()):
        raise ValueError(f'{key} must contain {minimum}–{maximum} characters.')
    return value


def check_draft(store, args):
    with store.workspace.lock:
        lead = next((row for row in prospecting.in_scope(store.leads()) if row['id'] == args.get('lead_id')), None)
        if lead is None:
            raise ValueError('Unknown or out-of-scope company.')
        body = _text(args, 'body', 1, 8000)
        subject = _text(args, 'subject', 0, 200, '')
        state = store.read()
        text = subject + '\n' + body
        problems = [{'rule': rule, 'text': message} for rule, regex, message in CLAIM_RULES if regex.search(text)]
        flags = automation.audit_leads([lead], ultra.read_json(store.root, 'data/exclusions.json'))[0]['flags']
        if lead.get('exclusion_check') != 'not_excluded' or 'excluded' in flags:
            problems.append({'rule': 'excluded', 'text': 'Check company exclusions before preparing outreach.'})
        if lead.get('status') in {'declined', 'rejected'}:
            problems.append({'rule': 'closed', 'text': 'Outreach is closed for this company.'})
        if campaign.suppressed(state, lead['id']) or campaign.route_suppressed(state, lead):
            problems.append({'rule': 'suppressed', 'text': 'Outreach is suppressed for this company.'})
        try:
            checked = records.date_value(lead.get('checked_date'))
            stale = not checked or (records.local_today() - datetime.date.fromisoformat(checked)).days > STALE_SOURCE_DAYS
        except ValueError:
            stale = True
        if stale:
            problems.append({'rule': 'stale_source', 'text': 'Refresh the source observation before preparing outreach.'})
        return {'ok': not problems, 'problems': problems, 'lead_id': lead['id'], 'source_version': campaign.fingerprint(lead)}


def _write_preparation(store, state, action, row):
    state['history'].append({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'action': action,
                             'id': row['id'], 'before_version': store.version()})
    store.workspace.atomic_json(store.path, state, '.campaign-')
    return row


def save_draft(store, args, agent_id):
    with store.workspace.lock:
        checked = check_draft(store, args)
        if not checked['ok']:
            raise ValueError('Fix these first: ' + '; '.join(p['text'] for p in checked['problems']))
        state = store.read()
        row = {'id': 'cd-' + secrets.token_hex(4), 'lead_id': checked['lead_id'], 'agent_id': agent_id,
               'subject': args.get('subject', ''), 'body': args['body'], 'language': 'en' if args.get('language') == 'en' else 'fr',
               'source_version': checked['source_version'], 'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'status': 'proposed', 'reviewed': False}
        drafts = state.setdefault('crew_drafts', [])
        drafts.append(row)
        for_lead = [draft for draft in drafts if draft['lead_id'] == row['lead_id']]
        kept = {draft['id'] for draft in for_lead[-5:]}
        state['crew_drafts'] = [draft for draft in drafts if draft['lead_id'] != row['lead_id'] or draft['id'] in kept]
        return _write_preparation(store, state, 'save-draft', row)


def propose_lead(store, args, agent_id):
    with store.workspace.lock:
        company = _text(args, 'company', 2, 200).strip()
        if len(company) < 2:
            raise ValueError('company must contain 2–200 characters.')
        state = store.read()
        # Eligibility precedes other field checks, with the same refusals as CSV intake.
        campaign.check_new_company(args.get('country'), company, args.get('website'), store.leads(),
                                   ultra.read_json(store.root, 'data/exclusions.json'), state.get('proposals', []))
        location = _text(args, 'location', 0, 100, '').strip()
        industry = records.text_value(args.get('industry'))
        source = _text(args, 'source_url', 1, 4000).strip()
        website = records.text_value(args.get('website'))
        for key, value in [('source_url', source), ('website', website)]:
            if value is None:
                continue
            parsed = urlsplit(value)
            if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError(key + ' must be an http(s) URL with a host.')
        observed = records.date_value(args.get('observed_on'))
        if not observed or observed > records.local_today().isoformat():
            raise ValueError('Include an actual observation date no later than today.')
        quote = _text(args, 'quote', 10, 1000)
        proposals = state.setdefault('proposals', [])
        if sum(p.get('status') == 'proposed' for p in proposals) >= 200:
            raise ValueError('Review open proposals first: at most 200 may remain open.')
        row = {'id': 'pl-' + secrets.token_hex(4), 'company': company, 'country': 'TN', 'location': location,
               'industry': industry, 'website': website, 'source_url': source, 'observed_on': observed, 'quote': quote,
               'agent_id': agent_id, 'status': 'proposed', 'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        proposals.append(row)
        return _write_preparation(store, state, 'propose-lead', row)


def _fields(row, keys):
    return {key: row[key] for key in keys if key in row}


def _suppressed(snapshot, lead_id):
    return lead_id in snapshot['suppressed_ids'] or lead_id in snapshot['route_suppressed_ids']


def _channel(route):
    route = str(route or '').strip().casefold()
    if '@' in route or route == 'email':
        return 'email'
    if route in {'phone', 'téléphone', 'tel'} or (
            sum(char.isdigit() for char in route) > len(route) / 2 and
            all(char.isdigit() or char in '+()- ' for char in route)):
        return 'phone'
    if 'linkedin' in route:
        return 'linkedin'
    if route in {'form', 'website'}:
        return 'website'
    try:
        url = urlsplit(route)
        if url.scheme in {'http', 'https'} and url.hostname:
            return 'website'
    except ValueError:
        pass
    return 'other'


def leads(store, args):
    offer = args.get('offer', 'documents')
    if not isinstance(offer, str) or offer not in prospecting.OFFERS:
        raise ValueError('Choose a supported small offer.')
    query = args.get('query', '')
    if not isinstance(query, str) or len(query) > 100:
        raise ValueError('Query must be at most 100 characters.')
    limit = args.get('limit', 20)
    if isinstance(limit, str):
        try:
            limit = int(limit)
        except ValueError:
            raise ValueError('Limit must be an integer from 1 to 50.') from None
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError('Limit must be an integer from 1 to 50.')

    snapshot = store.snapshot(offer)
    by_id = {lead['id']: lead for lead in prospecting.in_scope(store.leads())}
    query = query.casefold()
    rows = []
    for ranking in snapshot['rankings']:
        lead = by_id.get(ranking['id'])
        if lead is None or not any(query in (lead.get(key) or '').casefold()
                                   for key in ('company', 'location', 'industry')):
            continue
        names = [row.get('name') for row in snapshot['contacts'] if row['lead_id'] == lead['id']]
        rows.append(redact_model_text({'id': lead['id'], 'company': lead.get('company'), 'location': lead.get('location'),
                     'industry': lead.get('industry'), 'stage': prospecting.stage(lead), 'score': ranking['score'],
                     'shortlisted': bool(lead.get('shortlisted')), 'suppressed': _suppressed(snapshot, lead['id']),
                     'has_draft': bool((lead.get('draft') or {}).get('body')),
                     'crew_drafts': sum(draft['lead_id'] == lead['id'] for draft in snapshot.get('crew_drafts', []))}, names))
        if len(rows) == limit:
            break
    return {'offer': offer, 'count': len(rows), 'leads': rows}


def packet(store, args):
    lead = next((row for row in prospecting.in_scope(store.leads()) if row['id'] == args.get('id')), None)
    if lead is None:
        raise ValueError('Unknown or out-of-scope company.')
    flags = set(automation.audit_leads([lead], ultra.read_json(store.root, 'data/exclusions.json'))[0]['flags'])
    if 'excluded' in flags:
        raise ValueError('Company excluded.')
    if flags & {'unknown_company', 'simulation'}:
        raise ValueError('Unknown or out-of-scope company.')
    snapshot = store.snapshot()
    ranking = next((row for row in snapshot['rankings'] if row['id'] == lead['id']), None)
    draft = campaign.lead_view(lead, snapshot).get('draft')
    public_lead = _fields(lead, PACKET_FIELDS)
    public_lead['has_contact_route'] = bool(lead.get('contact_route'))
    names = [row.get('name') for row in snapshot['contacts'] if row['lead_id'] == lead['id']]
    return redact_model_text({
        'lead': public_lead,
        'ranking': _fields(ranking, ('score', 'factors', 'unknowns')) if ranking is not None else None,
        'contacts': [{**_fields(row, ('role', 'source_url', 'checked_on')), 'channel': _channel(row.get('route'))}
                     for row in snapshot['contacts'] if row['lead_id'] == lead['id']],
        'signals': [_fields(row, ('text', 'source_url', 'checked_on', 'hypothesis'))
                    for row in snapshot['signals'] if row['lead_id'] == lead['id']],
        'proofs': [_fields(row, ('id', 'offer', 'reviewed', 'review_current'))
                   for row in snapshot['proofs'] if row['lead_id'] == lead['id']],
        'draft': {key: draft.get(key) for key in ('subject', 'body', 'reviewed')} if draft else None,
        'crew_drafts': [row for row in snapshot.get('crew_drafts', []) if row['lead_id'] == lead['id']],
        'suppressed': _suppressed(snapshot, lead['id']),
        'source_version': campaign.fingerprint(lead),
    }, names)

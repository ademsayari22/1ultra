"""Read-only, field-filtered campaign packets for station agents."""
import campaign
import prospecting


PACKET_FIELDS = ('id', 'company', 'country', 'location', 'industry', 'website', 'source_url', 'source_type',
                 'checked_date', 'observed_fact', 'observed_text', 'need_hypothesis', 'pitch_hook',
                 'recommended_offer', 'status', 'shortlisted', 'exclusion_check', 'buyer_need_confirmed', 'contact_sent')


def _fields(row, keys):
    return {key: row[key] for key in keys if key in row}


def _suppressed(snapshot, lead_id):
    return lead_id in snapshot['suppressed_ids'] or lead_id in snapshot['route_suppressed_ids']


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
        rows.append({'id': lead['id'], 'company': lead.get('company'), 'location': lead.get('location'),
                     'industry': lead.get('industry'), 'stage': prospecting.stage(lead), 'score': ranking['score'],
                     'shortlisted': bool(lead.get('shortlisted')), 'suppressed': _suppressed(snapshot, lead['id']),
                     'has_draft': bool((lead.get('draft') or {}).get('body')), 'crew_drafts': 0})
        if len(rows) == limit:
            break
    return {'offer': offer, 'count': len(rows), 'leads': rows}


def packet(store, args):
    lead = next((row for row in prospecting.in_scope(store.leads()) if row['id'] == args.get('id')), None)
    if lead is None:
        raise ValueError('Unknown or out-of-scope company.')
    snapshot = store.snapshot()
    ranking = next((row for row in snapshot['rankings'] if row['id'] == lead['id']), None)
    draft = campaign.lead_view(lead, snapshot).get('draft')
    public_lead = _fields(lead, PACKET_FIELDS)
    public_lead['has_contact_route'] = bool(lead.get('contact_route'))
    return {
        'lead': public_lead,
        'ranking': _fields(ranking, ('score', 'factors', 'unknowns')) if ranking is not None else None,
        'contacts': [_fields(row, ('role', 'route', 'source_url', 'checked_on'))
                     for row in snapshot['contacts'] if row['lead_id'] == lead['id']],
        'signals': [_fields(row, ('text', 'source_url', 'checked_on', 'hypothesis'))
                    for row in snapshot['signals'] if row['lead_id'] == lead['id']],
        'proofs': [_fields(row, ('id', 'offer', 'reviewed', 'review_current'))
                   for row in snapshot['proofs'] if row['lead_id'] == lead['id']],
        'draft': {key: draft.get(key) for key in ('subject', 'body', 'reviewed')} if draft else None,
        'crew_drafts': [],
        'suppressed': _suppressed(snapshot, lead['id']),
        'source_version': campaign.fingerprint(lead),
    }

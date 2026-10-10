"""Validate owner-entered business records; no external actions or inferred receipts."""
import copy
import datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import ultra

LEAD_STATUSES = ('discovered', 'contacted', 'no_reply', 'replied', 'qualified', 'sample_received',
                 'proposed', 'accepted', 'declined', 'application_submitted', 'interview', 'rejected')
LEAD_KINDS = ('service_prospect', 'warm_contact', 'job_discovery', 'remote_contract_discovery')
PAYMENT_STATUSES = ('owed', 'deposit_received', 'received')
LEAD_FIELDS = {'company', 'kind', 'location', 'source_url', 'source_reference', 'observed_fact', 'contact_route',
               'checked_date', 'expires', 'status', 'contacted_on', 'status_evidence', 'next_action_on',
               'next_action', 'notes', 'owner_confirmed', 'country', 'industry', 'pitch_hook', 'need_hypothesis', 'website'}
PAYMENT_FIELDS = {'description', 'status', 'amount_minor', 'currency', 'invoice_reference',
                  'work_acceptance_evidence', 'agreed_due_date', 'receipt_evidence', 'received_on',
                  'obligation_reference', 'next_action_on', 'next_action', 'notes', 'owner_confirmed'}
PLANNING_FIELDS = {'available_hours_this_week', 'daily_minutes', 'receiving_method', 'defer_billing', 'opening_offer'}


def local_today():
    return datetime.datetime.now(ZoneInfo('Africa/Tunis')).date()


def date_value(value):
    if value is None or value == '':
        return None
    if not isinstance(value, str):
        raise ValueError('Dates must use YYYY-MM-DD.')
    try:
        parsed = datetime.date.fromisoformat(value)
    except ValueError:
        raise ValueError('Dates must be valid YYYY-MM-DD values.') from None
    if parsed.isoformat() != value:
        raise ValueError('Dates must use YYYY-MM-DD.')
    return value


def text_value(value):
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 4000:
        raise ValueError('Text fields must contain at most 4000 characters.')
    return value.strip() or None


def normalize(body, allowed, dates=()):
    if not isinstance(body, dict) or not body or set(body) - allowed:
        raise ValueError('Unsupported or empty record fields.')
    result = dict(body)
    for key, value in body.items():
        if key in dates:
            result[key] = date_value(value)
        elif key not in {'amount_minor', 'daily_minutes', 'available_hours_this_week', 'owner_confirmed', 'defer_billing'}:
            result[key] = text_value(value)
    if 'owner_confirmed' in body and type(body['owner_confirmed']) is not bool:
        raise ValueError('Owner confirmation must be explicit.')
    return result


def journal(before, after):
    history = copy.deepcopy(before.get('history', []))
    if not isinstance(history, list):
        raise ValueError('Record history must be a list.')
    event = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
             'before': copy.deepcopy({k: v for k, v in before.items() if k != 'history'}),
             'after': copy.deepcopy({k: v for k, v in after.items() if k != 'history'})}
    history.append(event)
    return {**after, 'history': history, 'updated_at': event['at']}


def lead_edit(before, body, exclusions):
    changes = normalize(body, LEAD_FIELDS, {'checked_date', 'expires', 'contacted_on', 'next_action_on'})
    after = {**before, **changes, 'mode': 'real'}
    if any(before.get(key) != after.get(key) for key in ('company', 'source_url', 'observed_fact', 'pitch_hook', 'country', 'checked_date')) and before.get('draft'):
        after['draft'] = {**before['draft'], 'reviewed': False}
    if after.get('kind') not in LEAD_KINDS or after.get('status') not in LEAD_STATUSES:
        raise ValueError('Choose a supported lead type and stage.')
    source = after.get('source_url')
    if source:
        parsed = urlsplit(source)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Source links must be public HTTP(S) URLs.')
    from automation import normalize_company
    company = normalize_company(after.get('company'))
    excluded = {normalize_company(name) for row in exclusions.get('companies', [])
                for name in [row.get('company'), *row.get('aliases', [])] if name}
    after['exclusion_check'] = 'unchecked' if not company else 'excluded' if company in excluded else 'not_excluded'
    progressed = after['status'] != 'discovered'
    changed_claim = any(after.get(k) != before.get(k) for k in ('status', 'status_evidence', 'contacted_on'))
    if progressed and (changed_claim or not before):
        if body.get('owner_confirmed') is not True or not after.get('status_evidence'):
            raise ValueError('Confirm the actual outcome and provide an evidence reference.')
        if after['status'] not in ('declined', 'rejected') and (not company or company in excluded):
            raise ValueError('Check the company and its exclusions before recording contact or progress.')
        if not after.get('contacted_on'):
            raise ValueError('Record the actual contact/application date.')
    elif progressed:
        after['owner_confirmed'] = before.get('owner_confirmed', False)
    if after.get('contacted_on') and after['contacted_on'] > local_today().isoformat():
        raise ValueError('Actual contact dates cannot be in the future.')
    if after.get('checked_date') and after['checked_date'] > local_today().isoformat():
        raise ValueError('Source check dates cannot be in the future.')
    after['contact_sent'] = bool(before.get('contact_sent') or progressed and after.get('contacted_on'))
    after['buyer_need_confirmed'] = bool(before.get('buyer_need_confirmed') or after['status'] in ('qualified', 'sample_received', 'proposed', 'accepted'))
    return after


def payment_edit(before, body):
    changes = normalize(body, PAYMENT_FIELDS, {'agreed_due_date', 'received_on', 'next_action_on'})
    after = {**before, **changes, 'mode': 'real'}
    if after.get('status') not in PAYMENT_STATUSES:
        raise ValueError('Choose owed, deposit received or received.')
    ultra.money(after.get('amount_minor'), after.get('currency'))
    amount = after.get('amount_minor')
    if amount is not None and amount > 9007199254740991:
        raise ValueError('Amount exceeds the exact range supported by this interface.')
    receipt = after['status'] in ('received', 'deposit_received')
    critical = ('status', 'amount_minor', 'currency', 'receipt_evidence', 'received_on', 'obligation_reference')
    changed_claim = any(after.get(k) != before.get(k) for k in critical) or not before
    if before.get('status') in ('received','deposit_received') and changed_claim and body.get('owner_confirmed') is not True:
        raise ValueError('Confirm corrections to an existing receipt before changing recorded cash.')
    if receipt and changed_claim:
        if amount is None or not after.get('receipt_evidence') or body.get('owner_confirmed') is not True:
            raise ValueError('Actual receipts need an amount, a receipt reference and owner confirmation.')
        if after['status'] == 'deposit_received' and not after.get('obligation_reference'):
            raise ValueError('Link a deposit to its delivery/refund obligation.')
    elif receipt:
        after['owner_confirmed'] = before.get('owner_confirmed', False)
    if after.get('received_on') and after['received_on'] > local_today().isoformat():
        raise ValueError('Receipt dates cannot be in the future.')
    if not receipt:
        after['owner_confirmed'] = False
    return after


def planning_edit(before, body):
    changes = normalize(body, PLANNING_FIELDS)
    if 'opening_offer' in changes and changes['opening_offer'] not in (None, 'cleanup', 'catalogue', 'documents', 'website'):
        raise ValueError('Choose one of the bounded service offers.')
    hours = changes.get('available_hours_this_week')
    if 'available_hours_this_week' in changes and hours is not None and (type(hours) not in (int, float) or not 0 <= hours <= 168):
        raise ValueError('Weekly hours must be between 0 and 168, or unknown.')
    minutes = changes.get('daily_minutes')
    if 'daily_minutes' in changes and minutes is not None and (type(minutes) is not int or not 0 <= minutes <= 1440):
        raise ValueError('Today\'s minutes must be an integer between 0 and 1440, or unknown.')
    if 'defer_billing' in changes and type(changes['defer_billing']) is not bool:
        raise ValueError('Billing deferral must be true or false.')
    if 'daily_minutes' in changes:
        changes['daily_minutes_on'] = local_today().isoformat()
    return {**before, **changes}

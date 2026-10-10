"""Tunisia B2B preparation: bounded CSV intake and truthful unsent templates."""
import csv
import datetime
import io
from urllib.parse import urlsplit

import automation
import records

OFFERS = {
    'cleanup': {'name': 'Checked spreadsheet cleanup', 'scope': 'un petit tableau de 20 lignes : doublons, formats et valeurs manquantes, avec une liste des exceptions'},
    'catalogue': {'name': 'Catalogue / ERP data preparation', 'scope': '20 références de votre catalogue : tableau structuré, contrôles des identifiants et liste des ambiguïtés'},
    'documents': {'name': 'Document to checked table', 'scope': 'un échantillon de 2 pages : extraction des champs convenus vers un tableau, avec renvoi aux sources et valeurs incertaines signalées'},
    'website': {'name': 'Website improvement pilot', 'scope': 'une seule page web : examiner un problème précis ensemble et convenir d’une correction limitée avec vérification avant/après'},
}
STAGES = [('scout', 'Find'), ('shortlist', 'Shortlist'), ('pitch', 'Prepare pitch'),
          ('contact', 'Await reply'), ('conversation', 'Convince'), ('pilot', 'Agree pilot'), ('closed', 'Closed')]


def tunisian(value):
    return automation.normalize_company(value) in {'tn', 'tunisia', 'tunisie', 'تونس'}


def in_scope(leads):
    return [row for row in leads if row.get('mode', 'real') == 'real' and tunisian(row.get('country'))
            and row.get('kind') in ('service_prospect', 'warm_contact') and not row.get('archived')]


def stage(lead):
    status = lead.get('status')
    if status in ('declined', 'rejected'): return 'closed'
    if status == 'accepted': return 'pilot'
    if status in ('replied', 'qualified', 'sample_received', 'proposed'): return 'conversation'
    if lead.get('contact_sent') or status in ('contacted', 'no_reply'): return 'contact'
    if lead.get('draft', {}).get('body'): return 'pitch'
    return 'shortlist' if lead.get('shortlisted') else 'scout'


def board(leads, exclusions, today=None):
    active = in_scope(leads)
    audits = automation.audit_leads(active, exclusions, today)
    rows = [{**row, 'pipeline_stage': stage(row), 'audit_flags': audit['flags'], 'draft_eligible': audit['eligible']}
            for row, audit in zip(active, audits)]
    return {'leads': rows, 'stages': [{'id': id, 'name': name, 'count': sum(stage(row) == id for row in active)} for id, name in STAGES],
            'offers': [{'id': id, **offer} for id, offer in OFFERS.items()], 'country': 'Tunisia',
            'shortlisted': sum(row.get('shortlisted') is True for row in active),
            'reviewed_drafts': sum(row.get('draft', {}).get('reviewed') is True for row in active)}


def preview_import(csv_text, existing, exclusions, today=None):
    if not isinstance(csv_text, str) or not csv_text.strip() or len(csv_text.encode('utf-8')) > 300000:
        raise ValueError('Choose a nonempty CSV up to 300 KB.')
    date = today or records.local_today().isoformat()
    records.date_value(date)
    try:
        dialect = csv.Sniffer().sniff(csv_text[:4096], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(csv_text.lstrip('\ufeff')), dialect=dialect)
    headers = reader.fieldnames or []
    names = {automation.normalize_company(header): header for header in headers}
    if len(names) != len(headers): raise ValueError('CSV headers must be distinct.')
    company_key = next((names[k] for k in ('companyname', 'company', 'accountname') if k in names), None)
    country_key = next((names[k] for k in ('companycountry', 'accounthqcountry', 'accountcountry') if k in names), None)
    if not company_key or not country_key:
        raise ValueError('Include Company Name and Company Country. Contact Country alone cannot establish Tunisia scope.')
    def value(row, *keys):
        return next((row.get(names[key], '').strip() for key in keys if names.get(key) and row.get(names[key], '').strip()), '')
    known = {automation.normalize_company(row.get('company')) for row in existing if row.get('company')}
    seen_urls = {row.get('website', row.get('source_url', '')).rstrip('/') for row in existing}
    excluded = {automation.normalize_company(name) for row in exclusions.get('companies', [])
                for name in [row.get('company'), *row.get('aliases', [])] if name}
    accepted, rejected = [], []
    try:
        for index, row in enumerate(reader, 2):
            if index > 501: raise ValueError('Import at most 500 leads per batch.')
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f'CSV row {index} has a different column count.')
            company = row[company_key].strip(); normalized = automation.normalize_company(company)
            reason = None
            if not company: reason = 'Company missing'
            elif not tunisian(row[country_key]): reason = 'Company country is outside Tunisia or unknown'
            elif normalized in excluded: reason = 'Company excluded'
            elif normalized in known: reason = 'Duplicate company'
            website = value(row, 'companywebsite', 'website', 'companyurl')
            if website and not website.startswith(('https://', 'http://')): website = 'https://' + website
            parsed = urlsplit(website)
            if website and (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password):
                reason = reason or 'Invalid company website'
            elif website and website.rstrip('/') in seen_urls: reason = reason or 'Duplicate company website'
            if any(len(cell) > 4000 or '\x00' in cell for cell in row.values()): reason = reason or 'Invalid or oversized cell'
            if reason:
                rejected.append({'row': index, 'company': company[:200], 'reason': reason}); continue
            industry = value(row, 'industry', 'companyindustry')
            email = value(row, 'email', 'workemail', 'emailaddress')
            phone = value(row, 'companyphone', 'workdirectphone', 'corporatephone')
            contact = '; '.join(part for part in (email, phone) if part)
            fact = f'Le fichier Apollo indique une entreprise située en Tunisie' + (f', secteur {industry}' if industry else '') + '.'
            accepted.append({'company': company, 'kind': 'service_prospect', 'country': 'TN',
                             'location': value(row, 'companycity', 'accounthqcity') or 'Tunisia', 'industry': industry or None,
                             'website': website or None, 'source_url': website or 'https://app.apollo.io/',
                             'source_reference': f'Apollo CSV row {index}', 'observed_fact': fact,
                             'contact_route': contact or None, 'checked_date': date, 'source_type': 'apollo_csv',
                             'source_live_checked': False, 'raw_import': row, 'mode': 'real', 'status': 'discovered',
                             'contact_sent': False, 'buyer_need_confirmed': False, 'exclusion_check': 'not_excluded',
                             'need_hypothesis': 'À qualifier avec le décideur ; aucun besoin confirmé.', 'import_row': index})
            known.add(normalized)
            if website: seen_urls.add(website.rstrip('/'))
    except csv.Error as error:
        raise ValueError('CSV cannot be parsed: ' + str(error)) from None
    return {'accepted': accepted, 'rejected': rejected, 'total': len(accepted) + len(rejected),
            'note': 'Company-country checked; imported details still need source/contact verification. No messages sent.'}


def make_draft(lead, offer, exclusions, today=None):
    if offer not in OFFERS: raise ValueError('Choose a supported small offer.')
    if not in_scope([lead]): raise ValueError('Pitch preparation is limited to Tunisian B2B leads.')
    audit = automation.audit_leads([lead], exclusions, today)[0]
    if not audit['eligible']: raise ValueError('Resolve lead checks first: ' + ', '.join(audit['flags']))
    observation = lead.get('pitch_hook') or lead.get('observed_fact')
    if not observation: raise ValueError('Record one specific source observation before drafting.')
    body = (f"Bonjour l’équipe {lead['company']},\n\n{observation}\n\n"
            f"Je propose de définir un petit test avec vous : {OFFERS[offer]['scope']}.\n"
            "Est-ce qu’une tâche de ce type vous prend du temps actuellement ? Qui serait la bonne personne pour en parler ?\n\n"
            "Si c’est pertinent, nous pourrions examiner un échantillon autorisé et convenir du périmètre, du prix et du délai avant de commencer.\n\nAdem")
    return {'subject': 'Petit test concret pour ' + lead['company'], 'body': body, 'offer': offer,
            'status': 'draft', 'reviewed': False, 'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'source_url': lead.get('source_url'), 'observation': observation}


def export_csv(leads):
    fields = ['company', 'country', 'city', 'website', 'email', 'contact_route', 'industry', 'observed_fact', 'source_url', 'checked_date', 'stage', 'review_status', 'subject', 'message']
    out = io.StringIO(); writer = csv.DictWriter(out, fields, lineterminator='\n'); writer.writeheader()
    for lead in in_scope(leads):
        draft = lead.get('draft', {})
        route = lead.get('contact_route') or ''
        email = next((part.strip() for part in route.split(';') if '@' in part and ' ' not in part.strip()), '')
        values = {**{key: lead.get(key) for key in fields}, 'country': 'Tunisia', 'city': lead.get('location'),
                  'website': lead.get('website') or lead.get('source_url'), 'email': email,
                  'stage': stage(lead), 'review_status':'reviewed current' if draft.get('reviewed') else 'needs review / unsent', 'subject': draft.get('subject') if draft.get('reviewed') else None, 'message': draft.get('body') if draft.get('reviewed') else None}
        writer.writerow({key: ("'" + str(value) if str(value or '').lstrip().startswith(('=', '+', '-', '@')) else value or '') for key, value in values.items() if key in fields})
    return out.getvalue()

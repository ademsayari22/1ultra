/* 1Ultra's native company board. Campaign records remain server-authoritative. */
'use strict';
(() => {
  function stageOf(lead, events) {
    const kinds = new Set((events || []).filter(e => e.lead_id === lead.id && e.confirmed === true).map(e => e.kind));
    return kinds.has('agreed_pilot') ? 'Pilot agreed' : kinds.has('qualified') ? 'Qualified'
      : kinds.has('reply') ? 'Replied' : kinds.has('sent') ? 'Contacted' : lead.pipeline_stage || 'discovered';
  }

  function outreachPrompt(lead) {
    return 'Prepare outreach for ' + lead.company + ' (lead ' + lead.id + '). Read its packet with campaign.lead. '
      + 'Have Sales write a short French pitch, check it with campaign.check_draft and save it with campaign.save_draft. '
      + 'Then have QA review it and end with VERDICT: approved or VERDICT: revise. '
      + 'Do not send anything: I review the draft in LEADS.';
  }

  function sessionTitle(lead) {
    const prefix = 'Outreach · ', suffix = ' · ' + lead.id;
    const companyLimit = 80 - prefix.length - suffix.length;
    if (companyLimit < 0) throw new Error('Lead id is too long for an outreach conversation title.');
    return prefix + String(lead.company).slice(0, companyLimit) + suffix;
  }

  function shouldPrefill(current, prompt) {
    return !String(current ?? '').includes(prompt);
  }

  function adoptionSteps(lead) {
    return lead.draft && lead.draft.body ? ['draft-edit', 'crew-draft-status'] : ['draft', 'draft-edit', 'crew-draft-status'];
  }

  function subjectOk(text) {
    const length = String(text ?? '').trim().length;
    return length >= 1 && length <= 200;
  }

  function evidenceOk(text) {
    return String(text ?? '').trim().length >= 10;
  }

  function openProposals(C) {
    return ((C && C.proposals) || []).filter(row => row.status === 'proposed');
  }

  function sourceLink(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? String(value) : '';
    } catch { return ''; }
  }

  function cardModel(lead, C) {
    C = C || {};
    const ranking = (C.rankings || []).find(r => r.id === lead.id);
    return { ...lead, stage: stageOf(lead, C.events), score: ranking ? ranking.score : null,
      factors: ranking ? ranking.factors || [] : [], unknowns: ranking ? ranking.unknowns || [] : [],
      suppressed: (C.suppressed_ids || []).includes(lead.id), source_url: sourceLink(lead.source_url),
      sourceVersion: ranking ? ranking.source_version : null,
      crewDrafts: (C.crew_drafts || []).filter(d => d.lead_id === lead.id && d.status === 'proposed')
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))) };
  }

  function ranked(W, C, query) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return ((W.hunt && W.hunt.leads) || [])
      .filter(lead => [lead.company, lead.location, lead.industry].some(value => String(value || '').toLocaleLowerCase().includes(needle)))
      .map(lead => cardModel(lead, C))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  window.UltraLeads = { view: { ranked, stageOf, outreachPrompt, cardModel, sessionTitle, shouldPrefill,
    openProposals, evidenceOk, adoptionSteps, subjectOk } };
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;
  const esc = value => StationUI.h.esc(String(value ?? ''));

  function button(action, label, id) {
    return '<button type="button" class="bb sm" data-ul-action="' + action + '"'
      + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + esc(label) + '</button>';
  }

  function sourceHTML(value, label = 'Source ↗') {
    const url = sourceLink(value);
    return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>'
      : '<span class="dim">No HTTP source link saved.</span>';
  }

  function draftsHTML(card, editing, inlineForm) {
    const draft = card.draft;
    const own = draft && draft.body ? '<p><span class="ul-chip ' + (draft.reviewed ? 'ul-ok' : 'ul-warn') + '">'
      + (draft.reviewed ? 'Reviewed draft' : 'Unreviewed draft') + '</span></p><b>' + esc(draft.subject || 'Subject needed')
      + '</b><div class="ul-message">' + esc(draft.body) + '</div>'
      + (!draft.reviewed ? '<div class="ul-actions">' + button('review', 'Mark reviewed') + '</div>' : '')
      : '<p class="dim">No owner draft yet.</p>';
    const crew = card.crewDrafts.map(d => {
      const compared = !!(d.source_version && card.sourceVersion);
      const changed = compared && d.source_version !== card.sourceVersion;
      return '<article class="ul-record"><b>' + esc(d.agent_id) + '</b> · <time>' + esc(d.created_at || 'Time unknown') + '</time>'
        + '<div class="ul-chips"><span class="ul-chip ul-ok">Check passed at save</span><span class="ul-chip'
        + (changed || !compared ? ' ul-warn' : '') + '">' + (compared ? changed ? 'Source changed since this draft' : 'Source unchanged since this draft' : 'Source comparison unavailable')
        + '</span></div><p><b>' + esc(d.subject || 'Subject needed') + '</b></p><div class="ul-message">' + esc(d.body)
        + '</div><div class="ul-actions">' + button('adopt', 'Use this draft', d.id) + button('dismiss', 'Dismiss', d.id) + '</div>'
        + (editing && editing.kind === 'adopt' && editing.id === d.id ? inlineForm : '') + '</article>';
    }).join('');
    return '<section class="ul-section"><h4>Your current draft</h4>' + own + '</section>'
      + '<section class="ul-section"><h4>Crew drafts</h4><p class="dim">Saved script checks do not replace your source and claim review.</p>'
      + (crew || '<p class="dim">No open crew drafts.</p>') + '</section>';
  }

  function conversationHTML(lead, C, editing, inlineForm) {
    const rows = key => (C[key] || []).filter(row => row.lead_id === lead.id);
    const events = rows('events').slice().sort((a, b) => String(b.on || '').localeCompare(String(a.on || '')))
      .map(e => '<article class="ul-record"><b>' + esc(e.kind) + ' · ' + esc(e.on) + '</b><p class="ul-message">'
        + esc(e.text || '') + '</p><p class="dim">Evidence: ' + esc(e.evidence) + ' · '
        + (e.confirmed ? 'Owner confirmed' : 'Unconfirmed record') + '</p></article>').join('');
    const contacts = rows('contacts').map(c => '<article class="ul-record"><b>Contact · ' + esc(c.name)
      + '</b><p>' + esc(c.role || 'Role unknown') + ' · ' + esc(c.route || 'Route unknown')
      + '</p><p class="dim">' + (c.authority_confirmed ? 'Authority owner-confirmed' : 'Authority unconfirmed')
      + ' · Checked ' + esc(c.checked_on || 'date unknown') + '</p>' + sourceHTML(c.source_url) + '</article>').join('');
    const signals = rows('signals').map(s => '<article class="ul-record"><b>Observed signal · ' + esc(s.checked_on || 'date unknown')
      + '</b><p class="ul-message">' + esc(s.text) + '</p><p class="dim">Possible opening: ' + esc(s.hypothesis || 'Needs review')
      + '</p>' + sourceHTML(s.source_url) + '</article>').join('');
    const followups = rows('followups').map(f => '<article class="ul-record"><b>Proposed follow-up · ' + esc(f.on || 'date unknown')
      + '</b><p class="ul-message">' + esc(f.text) + '</p><p class="dim">'
      + (f.suppressed ? 'Outreach suppressed' : f.needs_review ? 'New reply — review this proposal again' : 'No message sent') + '</p></article>').join('');
    return '<section class="ul-section"><h4>Conversation room</h4><div class="ul-actions">' + button('event', 'Record real outcome')
      + '</div>' + (editing && editing.kind === 'event' && editing.leadId === lead.id ? inlineForm : '')
      + '<h5>Recorded events</h5>' + (events || '<p class="dim">No real contact or reply recorded.</p>')
      + '<h5>Contacts</h5>' + (contacts || '<p class="dim">No contacts recorded.</p>')
      + '<h5>Signals</h5>' + (signals || '<p class="dim">No signals recorded.</p>')
      + '<h5>Follow-ups</h5>' + (followups || '<p class="dim">No follow-ups proposed.</p>') + '</section>';
  }

  async function api(path, body, version) {
    const headers = { 'X-Starnet-Token': window.__STARNET_API_TOKEN__ || '' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['If-Match'] = version || '';
    }
    const response = await fetch('/api/ultra/' + path, { method: body === undefined ? 'GET' : 'POST',
      headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || ('HTTP ' + response.status)), { status: response.status });
    return result;
  }

  function cardHTML(lead, C, editing, inlineForm) {
    const card = cardModel(lead, C);
    const factors = card.factors.map(f => '<li><b>' + esc(f.factor) + ' · ' + esc(f.points) + ' points</b><br><span class="dim">'
      + esc(f.reason) + '</span></li>').join('');
    return '<div class="ul-card-head"><h3>' + esc(card.company) + '</h3><span class="ul-score">' + esc(card.score ?? '—') + '</span></div>'
      + '<div class="ul-chips"><span class="ul-chip">' + esc(card.stage) + '</span>'
      + (card.shortlisted ? '<span class="ul-chip ul-ok">Shortlisted</span>' : '')
      + (card.suppressed ? '<span class="ul-chip ul-warn">Outreach suppressed</span>' : '') + '</div>'
      + '<p class="dim">' + esc(card.location || 'Location unknown') + ' · ' + esc(card.industry || 'Industry unknown') + '</p>'
      + '<blockquote>' + esc(card.observed_fact || 'No observed fact saved.') + '</blockquote>'
      + '<p>Need hypothesis: ' + esc(card.need_hypothesis || 'Unknown. Ask the buyer.') + '</p>'
      + (card.source_url ? '<a href="' + esc(card.source_url) + '" rel="noopener noreferrer" target="_blank">Inspect published source ↗</a>'
        : '<p class="dim">No HTTP source link saved.</p>')
      + '<p class="dim">Checked ' + esc(card.checked_date || 'date unknown') + ' · Route ' + esc(card.contact_route || 'unknown') + '</p>'
      + '<section class="ul-ranking"><h4>Why this ranks here</h4><p class="dim">Preparation priority, never a buying probability.</p>'
      + (factors ? '<ul>' + factors + '</ul>' : '<p class="dim">No ranking factors available.</p>')
      + '<p class="dim">Unknowns: ' + esc(card.unknowns.length ? card.unknowns.join(', ') : 'None listed; buying interest remains unknown.') + '</p></section>'
      + '<div class="ul-actions"><button class="bb sm" data-ul-action="shortlist">' + (card.shortlisted ? 'Remove shortlist' : 'Shortlist') + '</button>'
      + '<button class="bb sm" data-ul-action="outreach">Ask ULTRA to prepare outreach</button></div>'
      + draftsHTML(card, editing, inlineForm) + conversationHTML(lead, C, editing, inlineForm);
  }

  function prepareOutreach(lead) {
    if (typeof Workstreams === 'undefined' || !Workstreams.create || typeof App === 'undefined' || !App.openWorkstream
      || typeof Chat === 'undefined' || !Chat.prefill) throw new Error('The outreach conversation is unavailable. Reopen the station and try again.');
    const title = sessionTitle(lead);
    const existing = (Workstreams.list ? Workstreams.list() : []).find(s => s && !s.archived && s.title === title && s.agentId === 'agent');
    const stream = existing || Workstreams.create(title, { activate: false, agentId: 'agent' });
    if (!stream || !stream.id) throw new Error('Could not create the outreach conversation.');
    if (!existing && App.persist) App.persist();
    App.openWorkstream(stream.id);
    const prompt = outreachPrompt(lead);
    const composer = typeof document !== 'undefined' ? document.getElementById('chat-input') : null;
    if (shouldPrefill(composer ? composer.value : '', prompt)) Chat.prefill(prompt);
  }

  function build(body) {
    body.innerHTML = '<div class="ultra-leads"><div class="ul-header">'
      + '<label class="ul-field">Find company<input type="search" class="ul-search" placeholder="Company, place or industry"></label>'
      + '<label class="ul-field">Offer<select class="ul-offer" disabled></select></label>'
      + '<div class="ul-counts" aria-label="Campaign funnel"></div></div>'
      + '<nav class="ul-tabs" aria-label="Lead views"><button type="button" class="bb sm" data-tab="leads" aria-pressed="true">LEADS</button>'
      + '<button type="button" class="bb sm" data-tab="proposed" aria-pressed="false">PROPOSED</button></nav>'
      + '<p class="ul-error" role="alert" hidden></p><div class="ul-panes">'
      + '<div class="ul-list" aria-label="Companies"><p class="dim">Loading companies…</p></div>'
      + '<div class="ul-card" tabindex="-1"><p class="dim">Choose a company to inspect its facts.</p></div></div>'
      + '<div class="ul-proposed" hidden></div>'
      + '<footer><a href="#campaign" class="ul-classic">Classic campaign page</a></footer></div>';
    const root = body.querySelector('.ultra-leads');
    const search = root.querySelector('.ul-search'), offerSelect = root.querySelector('.ul-offer');
    const list = root.querySelector('.ul-list'), card = root.querySelector('.ul-card'), error = root.querySelector('.ul-error');
    const panes = root.querySelector('.ul-panes'), proposed = root.querySelector('.ul-proposed');
    let W = {}, C = {}, offer = 'documents', selected = null, busy = false, tab = 'leads', editing = null;
    const currentLead = () => ((W.hunt && W.hunt.leads) || []).find(lead => lead.id === selected);
    const crewDraft = id => (C.crew_drafts || []).find(d => d.id === id && d.lead_id === selected && d.status === 'proposed');
    const proposal = id => openProposals(C).find(row => row.id === id);

    function showError(e) {
      error.textContent = e.message; error.hidden = false;
      if (!W.hunt) list.innerHTML = '<p class="dim">Companies could not be loaded.</p>';
    }
    function setBusy(value) {
      busy = value;
      search.disabled = busy;
      offerSelect.disabled = busy || !offerSelect.options.length;
      root.querySelectorAll('[data-ul-action], [data-tab], .ul-row, form button, form input, form textarea, form select')
        .forEach(control => { control.disabled = busy; });
      root.setAttribute('aria-busy', String(busy));
    }
    function formHTML() {
      if (!editing) return '';
      const { kind, id, leadId, values } = editing;
      const options = rows => rows.map(([value, label]) => '<option value="' + esc(value) + '">' + esc(label) + '</option>').join('');
      let fields;
      if (kind === 'adopt') {
        fields = '<h4>Use crew draft</h4><label class="ul-field">Subject<input name="subject" value="' + esc(values.subject)
          + '" required maxlength="200"></label><label class="ul-field">Body<textarea name="body" required rows="8">'
          + esc(values.body) + '</textarea></label>';
      } else if (kind === 'reject') {
        fields = '<h4>Reject proposal</h4><label class="ul-field">Reason (3–300 characters)<textarea name="reason" required minlength="3" maxlength="300" rows="3"></textarea></label>';
      } else {
        const now = new Date();
        const date = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        fields = '<h4>Record actual buyer evidence</h4><p class="dim">Confirm only a real external outcome. The original reply is preserved.</p>'
          + '<label class="ul-field">Real event<select name="kind">' + options([['sent', 'Message actually sent'], ['reply', 'Buyer replied'],
            ['qualified', 'Need qualified'], ['agreed_pilot', 'Pilot agreed'], ['do_not_contact', 'Do not contact']]) + '</select></label>'
          + '<label class="ul-field">Contact (if known)<select name="contact_id">' + options([['', 'Company-level / unknown contact'],
            ...(C.contacts || []).filter(c => c.lead_id === leadId).map(c => [c.id, c.name])]) + '</select></label>'
          + '<label class="ul-field">Refusal scope<select name="scope">' + options([['company', 'Company'], ['contact', 'Identified contact only']]) + '</select></label>'
          + '<label class="ul-field">Experiment for an actual send (optional)<select name="experiment_id">' + options([['', 'Outside experiment'],
            ...(C.experiments || []).filter(e => e.assignments && e.assignments[leadId]).map(e => [e.id, e.name + ' · assigned ' + e.assignments[leadId]])]) + '</select></label>'
          + '<label class="ul-field">Actual date<input type="date" name="on" value="' + date + '" max="' + date + '" required></label>'
          + '<label class="ul-field">Evidence reference (at least 10 characters)<input name="evidence" required minlength="10"></label>'
          + '<label class="ul-field">Original reply wording, when applicable<textarea name="text" rows="5"></textarea></label>';
      }
      return '<form class="ul-inline-form" data-ul-form="' + kind + '" data-id="' + esc(id || '') + '" data-lead-id="' + esc(leadId || '')
        + '">' + fields + '<div class="ul-actions"><button type="submit" class="bb sm">'
        + (kind === 'adopt' ? 'Save as my unreviewed draft' : kind === 'reject' ? 'Reject proposal' : 'Save actual event')
        + '</button>' + button('cancel', 'Cancel') + '</div></form>';
    }
    function renderCard() {
      const lead = currentLead();
      card.innerHTML = lead ? cardHTML(lead, C, editing, formHTML())
        : '<p class="dim">Choose a company to inspect its facts.</p>';
      setBusy(busy);
    }
    function renderProposals() {
      const needle = search.value.trim().toLocaleLowerCase();
      const rows = openProposals(C).filter(p => [p.company, p.location, p.industry].some(value => String(value || '').toLocaleLowerCase().includes(needle)));
      proposed.innerHTML = '<h3>Proposed leads</h3><p class="dim">Crew research for your review; source checks and buying interest remain unconfirmed.</p>'
        + (rows.length ? rows.map(p => '<article class="ul-record"><h4>' + esc(p.company) + '</h4><p class="dim">'
          + esc(p.location || 'Location unknown') + ' · Proposed by ' + esc(p.agent_id) + ' · Observed ' + esc(p.observed_on)
          + '</p>' + sourceHTML(p.source_url) + '<blockquote>' + esc(p.quote) + '</blockquote><div class="ul-actions">'
          + button('accept', 'Accept', p.id) + button('reject', 'Reject', p.id) + '</div>'
          + (editing && editing.kind === 'reject' && editing.id === p.id ? formHTML() : '') + '</article>').join('')
          : '<p class="dim">No open proposals match this search.</p>');
      setBusy(busy);
    }
    function renderBoard() {
      panes.hidden = tab !== 'leads'; proposed.hidden = tab !== 'proposed';
      root.querySelectorAll('[data-tab]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.tab === tab)); });
      const rows = ranked(W, C, search.value);
      if (!rows.some(row => row.id === selected)) selected = rows.length ? rows[0].id : null;
      list.innerHTML = rows.length ? rows.map(row => '<button class="ul-row' + (row.id === selected ? ' selected' : '')
        + '" data-lead="' + esc(row.id) + '" aria-pressed="' + (row.id === selected) + '"><span class="ul-row-head"><b>'
        + esc(row.company) + '</b><span class="ul-score">' + esc(row.score ?? '—') + '</span></span><small class="dim">'
        + esc(row.location || 'Location unknown') + ' · ' + esc(row.industry || 'Industry unknown') + ' · ' + esc(row.stage) + '</small></button>').join('')
        : '<p class="dim">No companies match this search.</p>';
      renderCard(); renderProposals();
    }
    async function reload(requestedOffer = offer) {
      const wasBusy = busy;
      setBusy(true);
      try {
        const workspace = await api('workspace');
        const offers = (workspace.hunt && workspace.hunt.offers) || [];
        const nextOffer = offers.some(row => row.id === requestedOffer) ? requestedOffer : (offers[0] ? offers[0].id : 'documents');
        const campaign = await api('campaign?offer=' + encodeURIComponent(nextOffer));
        W = workspace; C = campaign; offer = nextOffer;
        offerSelect.innerHTML = offers.map(row => '<option value="' + esc(row.id) + '"' + (row.id === offer ? ' selected' : '') + '>' + esc(row.name) + '</option>').join('');
        const counts = (C.analytics && C.analytics.counts) || {};
        root.querySelector('.ul-counts').innerHTML = [['Sourced', 'sourced'], ['Shortlisted', 'shortlisted'], ['Contacted', 'contacted'], ['Replies', 'replied']]
          .map(([label, key]) => '<div><small class="dim">' + label + '</small><b>' + esc(counts[key] ?? '—') + '</b></div>').join('');
        error.hidden = true;
        renderBoard();
      } catch (e) { offerSelect.value = offer; throw e; }
      finally { setBusy(wasBusy); }
    }
    async function save(operation) {
      if (busy) return;
      setBusy(true);
      try {
        await operation();
        editing = null;
        await reload();
      } catch (e) {
        if (e.status === 409) {
          editing = null;
          const message = 'The campaign changed while you were looking. It is reloaded; check and save again.';
          try { await reload(); showError(new Error(message)); }
          catch (loadError) { showError(new Error('The campaign changed while you were looking. Reload failed: ' + loadError.message)); }
        } else { showError(e); }
      } finally { setBusy(false); }
    }
    search.addEventListener('input', renderBoard);
    offerSelect.addEventListener('change', () => { reload(offerSelect.value).catch(showError); });
    root.addEventListener('click', event => {
      if (busy) return;
      const tabButton = event.target.closest('[data-tab]');
      if (tabButton) { tab = tabButton.dataset.tab; editing = null; renderBoard(); return; }
      const row = event.target.closest('.ul-row');
      if (row && root.contains(row)) {
        selected = row.dataset.lead; editing = null;
        list.querySelectorAll('.ul-row').forEach(button => {
          button.classList.toggle('selected', button.dataset.lead === selected);
          button.setAttribute('aria-pressed', String(button.dataset.lead === selected));
        });
        renderCard();
        if (window.matchMedia('(max-width: 720px)').matches) { card.focus({ preventScroll: true }); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        return;
      }
      const action = event.target.closest('[data-ul-action]');
      if (!action) return;
      const name = action.dataset.ulAction, id = action.dataset.id, lead = currentLead();
      if (name === 'cancel') { editing = null; renderBoard(); return; }
      if (name === 'accept' || name === 'reject') {
        const p = proposal(id);
        if (!p) return;
        if (name === 'accept') {
          if (confirm('Add ' + p.company + ' to your leads? Its source still needs your own check.'))
            save(() => api('campaign/accept-proposal', { id }, C.version));
        } else { editing = { kind: 'reject', id, values: {} }; renderProposals(); }
        return;
      }
      if (!lead) return;
      if (name === 'shortlist') save(() => api('prospecting/shortlist', { id: lead.id, selected: !lead.shortlisted }, W.record_versions.leads));
      if (name === 'outreach') {
        try { prepareOutreach(lead); } catch (e) { showError(e); }
      }
      if (name === 'review' && lead.draft && lead.draft.body) {
        if (confirm('I checked this company’s source, claim and small offer. Mark this unsent draft reviewed?'))
          save(() => api('prospecting/review-draft', { id: lead.id, confirmed: true }, W.record_versions.leads));
      }
      if (name === 'adopt' || name === 'dismiss') {
        const d = crewDraft(id);
        if (!d) return;
        if (name === 'dismiss') save(() => api('campaign/crew-draft-status', { id, status: 'dismissed' }, C.version));
        else { editing = { kind: 'adopt', id, leadId: lead.id, values: { subject: d.subject || '', body: d.body || '' } }; renderCard(); }
      }
      if (name === 'event') { editing = { kind: 'event', leadId: lead.id, values: {} }; renderCard(); }
    });
    root.addEventListener('submit', event => {
      const form = event.target;
      if (!form.dataset.ulForm) return;
      event.preventDefault();
      if (busy || !editing || editing.kind !== form.dataset.ulForm) return;
      const value = key => form.elements[key] ? form.elements[key].value : '';
      const kind = editing.kind, id = form.dataset.id, lead = currentLead();
      if (kind === 'adopt') {
        if (!lead || lead.id !== form.dataset.leadId || !crewDraft(id)) return;
        const subject = value('subject').trim(), message = value('body');
        if (!subjectOk(subject) || !message.trim()) { showError(new Error('Include a subject of 1–200 characters and a nonempty body.')); return; }
        editing.values = { subject, body: message };
        save(async () => {
          for (const step of adoptionSteps(lead)) {
            if (step === 'draft') {
              await api('prospecting/draft', { id: lead.id, offer }, W.record_versions.leads);
              await reload();
            } else if (step === 'draft-edit') {
              const result = await api('prospecting/draft-edit', { id: lead.id, subject, body: message }, W.record_versions.leads);
              if (result.record && result.record_version) {
                W.hunt.leads = W.hunt.leads.map(row => row.id === lead.id ? result.record : row);
                W.record_versions.leads = result.record_version;
                renderCard();
              }
            } else {
              try { await api('campaign/crew-draft-status', { id, status: 'adopted' }, C.version); }
              catch (e) { e.message = 'Your owner draft was saved. Updating the crew draft status failed: ' + e.message; throw e; }
            }
          }
        });
      } else if (kind === 'reject') {
        if (!proposal(id)) return;
        const reason = value('reason').trim();
        if (reason.length < 3 || reason.length > 300) { showError(new Error('Give a rejection reason of 3–300 characters.')); return; }
        save(() => api('campaign/proposal-status', { id, status: 'rejected', reason }, C.version));
      } else if (kind === 'event') {
        if (!lead || lead.id !== form.dataset.leadId) return;
        const evidence = value('evidence').trim();
        if (!evidenceOk(evidence)) { showError(new Error('Evidence must contain at least 10 characters.')); return; }
        if (!confirm('I confirm this external event actually happened, with the date and evidence shown.')) return;
        const experimentId = value('experiment_id');
        save(() => api('campaign/event', { lead_id: lead.id, kind: value('kind'), on: value('on'), evidence,
          text: value('text'), confirmed: true, contact_id: value('contact_id') || null, scope: value('scope'),
          ...(experimentId ? { experiment_id: experimentId } : {}) }, C.version));
      }
    });
    root.querySelector('.ul-classic').addEventListener('click', event => { event.preventDefault(); StationUI.h.openTerm('campaign'); });
    reload().catch(showError);
  }

  StationUI.registerWindow('leads', 'LEADS', build, { console: true, className: 'ultra-leads-win' });
})();

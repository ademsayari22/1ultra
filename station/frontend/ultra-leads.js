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
      suppressed: (C.suppressed_ids || []).includes(lead.id), source_url: sourceLink(lead.source_url) };
  }

  function ranked(W, C, query) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return ((W.hunt && W.hunt.leads) || [])
      .filter(lead => [lead.company, lead.location, lead.industry].some(value => String(value || '').toLocaleLowerCase().includes(needle)))
      .map(lead => cardModel(lead, C))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  window.UltraLeads = { view: { ranked, stageOf, outreachPrompt, cardModel } };
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;
  const esc = value => StationUI.h.esc(String(value ?? ''));

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

  function cardHTML(lead, C) {
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
      + '<button class="bb sm" data-ul-action="outreach">Ask ULTRA to prepare outreach</button></div>';
  }

  function prepareOutreach(lead) {
    if (typeof Workstreams === 'undefined' || !Workstreams.create || typeof App === 'undefined' || !App.openWorkstream
      || typeof Chat === 'undefined' || !Chat.prefill) throw new Error('The outreach conversation is unavailable. Reopen the station and try again.');
    const title = ('Outreach · ' + lead.company).slice(0, 80);
    const existing = (Workstreams.list ? Workstreams.list() : []).find(s => s && !s.archived && s.title === title && s.agentId === 'agent');
    const stream = existing || Workstreams.create(title, { activate: false, agentId: 'agent' });
    if (!stream || !stream.id) throw new Error('Could not create the outreach conversation.');
    if (!existing && App.persist) App.persist();
    App.openWorkstream(stream.id);
    Chat.prefill(outreachPrompt(lead));
  }

  function build(body) {
    body.innerHTML = '<div class="ultra-leads"><div class="ul-header">'
      + '<label class="ul-field">Find company<input type="search" class="ul-search" placeholder="Company, place or industry"></label>'
      + '<label class="ul-field">Offer<select class="ul-offer" disabled></select></label>'
      + '<div class="ul-counts" aria-label="Campaign funnel"></div></div>'
      + '<p class="ul-error" role="alert" hidden></p><div class="ul-panes">'
      + '<div class="ul-list" aria-label="Companies"><p class="dim">Loading companies…</p></div>'
      + '<div class="ul-card" tabindex="-1"><p class="dim">Choose a company to inspect its facts.</p></div></div>'
      + '<footer><a href="#campaign" class="ul-classic">Classic campaign page</a></footer></div>';
    const root = body.querySelector('.ultra-leads');
    const search = root.querySelector('.ul-search'), offerSelect = root.querySelector('.ul-offer');
    const list = root.querySelector('.ul-list'), card = root.querySelector('.ul-card'), error = root.querySelector('.ul-error');
    let W = {}, C = {}, offer = 'documents', selected = null, busy = false;
    const currentLead = () => ((W.hunt && W.hunt.leads) || []).find(lead => lead.id === selected);

    function showError(e) {
      error.textContent = e.message; error.hidden = false;
      if (!W.hunt) list.innerHTML = '<p class="dim">Companies could not be loaded.</p>';
    }
    function setBusy(value) {
      busy = value;
      offerSelect.disabled = busy || !offerSelect.options.length;
      root.querySelectorAll('[data-ul-action="shortlist"]').forEach(button => { button.disabled = busy; });
      root.setAttribute('aria-busy', String(busy));
    }
    function renderCard() {
      const lead = currentLead();
      card.innerHTML = lead ? cardHTML(lead, C) : '<p class="dim">Choose a company to inspect its facts.</p>';
      setBusy(busy);
    }
    function renderBoard() {
      const rows = ranked(W, C, search.value);
      if (!rows.some(row => row.id === selected)) selected = rows.length ? rows[0].id : null;
      list.innerHTML = rows.length ? rows.map(row => '<button class="ul-row' + (row.id === selected ? ' selected' : '')
        + '" data-lead="' + esc(row.id) + '" aria-pressed="' + (row.id === selected) + '"><span class="ul-row-head"><b>'
        + esc(row.company) + '</b><span class="ul-score">' + esc(row.score ?? '—') + '</span></span><small class="dim">'
        + esc(row.location || 'Location unknown') + ' · ' + esc(row.industry || 'Industry unknown') + ' · ' + esc(row.stage) + '</small></button>').join('')
        : '<p class="dim">No companies match this search.</p>';
      renderCard();
    }
    async function reload(requestedOffer = offer) {
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
      finally { setBusy(false); }
    }
    async function saveShortlist(lead) {
      setBusy(true);
      try {
        await api('prospecting/shortlist', { id: lead.id, selected: !lead.shortlisted }, W.record_versions.leads);
        await reload();
      } catch (e) {
        if (e.status === 409) {
          const message = 'The campaign changed while you were looking. It is reloaded; check and save again.';
          try { await reload(); showError(new Error(message)); }
          catch (loadError) { showError(new Error('The campaign changed while you were looking. Reload failed: ' + loadError.message)); }
        } else { showError(e); }
      } finally { setBusy(false); }
    }
    search.addEventListener('input', renderBoard);
    offerSelect.addEventListener('change', () => { reload(offerSelect.value).catch(showError); });
    root.addEventListener('click', event => {
      const row = event.target.closest('.ul-row');
      if (row && root.contains(row)) {
        selected = row.dataset.lead;
        list.querySelectorAll('.ul-row').forEach(button => {
          button.classList.toggle('selected', button.dataset.lead === selected);
          button.setAttribute('aria-pressed', String(button.dataset.lead === selected));
        });
        renderCard();
        if (window.matchMedia('(max-width: 720px)').matches) { card.focus({ preventScroll: true }); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        return;
      }
      const action = event.target.closest('[data-ul-action]'), lead = currentLead();
      if (!action || !lead) return;
      if (action.dataset.ulAction === 'shortlist' && !busy) saveShortlist(lead);
      if (action.dataset.ulAction === 'outreach') {
        try { prepareOutreach(lead); } catch (e) { showError(e); }
      }
    });
    root.querySelector('.ul-classic').addEventListener('click', event => { event.preventDefault(); StationUI.h.openTerm('campaign'); });
    reload().catch(showError);
  }

  StationUI.registerWindow('leads', 'LEADS', build, { console: true, className: 'ultra-leads-win' });
})();

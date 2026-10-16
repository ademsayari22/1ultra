'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../station/frontend/ultra-leads.js');
const V = window.UltraLeads.view;

const W = { hunt: { leads: [
  { id: 'a', company: 'Alpha SARL', location: 'Sfax', industry: 'ERP', pipeline_stage: 'discovered', shortlisted: false },
  { id: 'b', company: 'Beta Data', location: 'Tunis', industry: 'Archives', pipeline_stage: 'pitch', shortlisted: true }] } };
const C = { rankings: [{ id: 'b', score: 80, factors: [], unknowns: [] }, { id: 'a', score: 40, factors: [], unknowns: [] }], events: [], suppressed_ids: [], crew_drafts: [] };

test('crew drafts show newest first with who wrote them, and adopted or dismissed ones leave the queue', () => {
  const C2 = { ...C, crew_drafts: [
    { id: 'd1', lead_id: 'a', agent_id: 'sales', body: 'v1', status: 'proposed', created_at: '2026-10-11T08:00:00Z' },
    { id: 'd2', lead_id: 'a', agent_id: 'sales', body: 'v2', status: 'proposed', created_at: '2026-10-11T09:00:00Z' },
    { id: 'd3', lead_id: 'a', agent_id: 'sales', body: 'v0', status: 'dismissed', created_at: '2026-10-11T07:00:00Z' }] };
  assert.deepEqual(V.cardModel(W.hunt.leads[0], C2).crewDrafts.map(d => d.id), ['d2', 'd1']);
});

test('crew draft cards carry saved notes and default older drafts to no notes', () => {
  const notes = [{ rule: 'price', text: 'Look at the price.' }, { rule: 'percentage', text: 'Look at the percentage.' }];
  const draft = { id: 'd1', lead_id: 'a', status: 'proposed', notes };
  const card = V.cardModel(W.hunt.leads[0], { ...C, crew_drafts: [draft] });
  assert.deepEqual(card.crewDrafts[0].notes, notes);
  const older = { id: 'd2', lead_id: 'a', status: 'proposed' };
  assert.deepEqual(V.cardModel(W.hunt.leads[0], { ...C, crew_drafts: [older] }).crewDrafts[0].notes, []);
  assert.equal(older.notes, undefined, 'the card does not rewrite saved records');
});

test('noteText joins draft notes into a readable line and handles no notes', () => {
  assert.equal(V.noteText([{ rule: 'price', text: 'Look at the price.' },
    { rule: 'percentage', text: 'Look at the percentage.' }]), 'Look at the price. · Look at the percentage.');
  assert.equal(V.noteText([]), '');
  assert.equal(V.noteText(), '');
});

test('proposed leads list only open proposals, with their source, date and quote', () => {
  const rows = V.openProposals({ proposals: [
    { id: 'p1', company: 'X', source_url: 'https://x.tn', observed_on: '2026-10-10', quote: 'Q', status: 'proposed', agent_id: 'research' },
    { id: 'p2', company: 'Y', status: 'accepted' }] });
  assert.deepEqual(rows.map(r => r.id), ['p1']);
});

test('the evidence form refuses evidence shorter than ten characters', () => {
  assert.equal(V.evidenceOk('short'), false);
  assert.equal(V.evidenceOk('2026-10-11 email to info@x.tn'), true);
});

test('adoption bootstraps only when the owner draft has no body', () => {
  for (const lead of [{}, { draft: {} }, { draft: { body: '' } }]) {
    assert.deepEqual(V.adoptionSteps(lead), ['draft', 'draft-edit', 'crew-draft-status']);
  }
  assert.deepEqual(V.adoptionSteps({ draft: { body: 'Owner pitch' } }), ['draft-edit', 'crew-draft-status']);
});

test('subjects require one to two hundred trimmed characters and evidence ignores padding', () => {
  for (const value of ['', '   ', 'x'.repeat(201), null]) assert.equal(V.subjectOk(value), false);
  for (const value of [' a ', 'x'.repeat(200)]) assert.equal(V.subjectOk(value), true);
  assert.equal(V.evidenceOk('   short   '), false);
  assert.equal(V.evidenceOk('  0123456789  '), true);
});

test('the board ranks by score and filters by company, place or industry', () => {
  assert.deepEqual(V.ranked(W, C, '').map(r => r.id), ['b', 'a']);
  assert.deepEqual(V.ranked(W, C, 'sfax').map(r => r.id), ['a']);
  assert.deepEqual(V.ranked(W, C, 'archives').map(r => r.id), ['b']);
});

test('the stage follows confirmed events, never drafts', () => {
  const lead = W.hunt.leads[0];
  assert.equal(V.stageOf(lead, []), 'discovered');
  assert.equal(V.stageOf(lead, [{ lead_id: 'a', kind: 'sent', confirmed: true }]), 'Contacted');
  assert.equal(V.stageOf(lead, [{ lead_id: 'a', kind: 'reply', confirmed: false }]), 'discovered');
});

test('asking ULTRA names the company, its id and the tools, and says nothing is sent', () => {
  const text = V.outreachPrompt(W.hunt.leads[1]);
  assert.match(text, /Beta Data/); assert.match(text, /\bb\b/);
  assert.match(text, /campaign\.lead/); assert.match(text, /campaign\.save_draft/); assert.match(text, /VERDICT/);
  assert.match(text, /Do not send/);
});

test('outreach titles preserve distinct lead ids when company names share a long prefix', () => {
  const prefix = 'A'.repeat(100);
  const first = V.sessionTitle({ company: prefix + ' Alpha', id: 'lead-alpha' });
  const second = V.sessionTitle({ company: prefix + ' Beta', id: 'lead-beta' });
  assert.notEqual(first, second);
  assert.ok(first.length <= 80);
  assert.ok(second.length <= 80);
  assert.ok(first.endsWith(' · lead-alpha'));
  assert.ok(second.endsWith(' · lead-beta'));
  assert.equal(V.sessionTitle({ company: 'Beta Data', id: 'b' }), 'Outreach · Beta Data · b');
});

test('outreach titles never truncate the id to fit the native store', () => {
  const id = 'lead-' + 'x'.repeat(59);
  const title = V.sessionTitle({ company: 'Beta Data', id });
  assert.equal(title.length, 80);
  assert.ok(title.endsWith(' · ' + id));
  assert.throws(() => V.sessionTitle({ company: 'Beta Data', id: 'x'.repeat(67) }), /too long/);
});

test('sessionFor uses the exact lead id suffix across renames and ignores archived or other-agent streams', () => {
  const streams = [
    { id: 'other-lead', title: 'Outreach · Beta Data · lead-ab', agentId: 'agent' },
    { id: 'archived', title: 'Outreach · Beta Data · b', agentId: 'agent', archived: true },
    { id: 'sales-only', title: 'Outreach · Beta Data · b', agentId: 'sales' },
    { id: 'original', title: 'Outreach · Beta Data · b', agentId: 'agent', archived: false }
  ];
  const lead = { id: 'b', company: 'Beta Data SARL' };
  assert.equal(V.sessionFor?.(streams, lead), streams[3]);
  assert.equal(V.sessionFor?.(streams.slice(0, 3), lead), undefined);
  assert.equal(V.sessionFor?.([null, { id: 'untitled', agentId: 'agent' }], lead), undefined);
});

test('shouldPrefill skips an exact existing prompt and accepts a missing prompt', () => {
  const prompt = 'Prepare outreach for Beta Data (lead b).';
  assert.equal(V.shouldPrefill('', prompt), true);
  assert.equal(V.shouldPrefill('Adem has a question.', prompt), true);
  assert.equal(V.shouldPrefill(prompt, prompt), false);
  assert.equal(V.shouldPrefill('Adem note; ' + prompt + '\nKeep this wording.  ', prompt), false);
  assert.equal(V.shouldPrefill('Prepare outreach for Alpha SARL (lead a).', prompt), true);
});

test('search ignores case and surrounding space without changing source order', () => {
  assert.deepEqual(V.ranked(W, C, '  ALPHA  ').map(r => r.id), ['a']);
  assert.deepEqual(W.hunt.leads.map(r => r.id), ['a', 'b']);
  assert.deepEqual(V.ranked(W, C, 'unknown'), []);
});

test('confirmed outcomes take precedence and belong to the selected company', () => {
  const events = [
    { lead_id: 'a', kind: 'agreed_pilot', confirmed: true },
    { lead_id: 'a', kind: 'sent', confirmed: true },
    { lead_id: 'b', kind: 'reply', confirmed: true }
  ];
  assert.equal(V.stageOf(W.hunt.leads[0], events), 'Pilot agreed');
  assert.equal(V.stageOf(W.hunt.leads[1], events), 'Replied');
  assert.equal(V.stageOf(W.hunt.leads[0], [{ lead_id: 'b', kind: 'qualified', confirmed: true }]), 'discovered');
});

test('the card preserves observed facts and explains its rank and suppression', () => {
  const lead = { ...W.hunt.leads[0], observed_fact: 'Published ERP integration service.',
    need_hypothesis: 'A sample migration may help.', source_url: 'https://example.com/services',
    checked_date: '2026-10-10', contact_route: 'company contact form' };
  const campaign = { ...C, suppressed_ids: ['a'], rankings: [{ id: 'a', score: 0,
    factors: [{ factor: 'evidence', points: 0, reason: 'Source needs checking.' }], unknowns: ['buyer need'] }] };
  const card = V.cardModel(lead, campaign);
  assert.equal(card.observed_fact, 'Published ERP integration service.');
  assert.equal(card.need_hypothesis, 'A sample migration may help.');
  assert.equal(card.source_url, 'https://example.com/services');
  assert.equal(card.checked_date, '2026-10-10');
  assert.equal(card.contact_route, 'company contact form');
  assert.equal(card.stage, 'discovered');
  assert.equal(card.score, 0);
  assert.equal(card.suppressed, true);
  assert.deepEqual(card.factors, [{ factor: 'evidence', points: 0, reason: 'Source needs checking.' }]);
  assert.deepEqual(card.unknowns, ['buyer need']);
  assert.equal(lead.suppressed, undefined);
});

test('the card permits only HTTP source links and keeps missing ranking unknown', () => {
  for (const source_url of ['javascript:alert(1)', 'data:text/html,test', '//example.com', '/relative', 'not a URL']) {
    assert.equal(V.cardModel({ ...W.hunt.leads[0], source_url }, {}).source_url, '');
  }
  assert.equal(V.cardModel({ ...W.hunt.leads[0], source_url: 'http://example.com' }, {}).source_url, 'http://example.com');
  assert.equal(V.cardModel(W.hunt.leads[0], {}).score, null);
  assert.deepEqual(V.ranked({}, {}, ''), []);
});

// A socket-free adapter for the browser-only DOM, fetch, App and Chat seams.
// Workstreams is the real native store; no models or business files are used.
const fs = require('node:fs');
const vm = require('node:vm');
const leadsSource = fs.readFileSync(require.resolve('../station/frontend/ultra-leads.js'), 'utf8');
const streamsSource = fs.readFileSync(require.resolve('../station/frontend/app/workstreams.js'), 'utf8');
const chatSource = fs.readFileSync(require.resolve('../station/frontend/app/chat.js'), 'utf8');
const nativePrefillSource = chatSource.slice(chatSource.indexOf('  function prefill(t) {'), chatSource.indexOf('  // a row of tappable suggestion pills'));
const stationUISource = fs.readFileSync(require.resolve('../station/frontend/app/stationui.js'), 'utf8');
const nativeWorkConversationSource = stationUISource.slice(stationUISource.indexOf('  function workConversation(from) {'),
  stationUISource.indexOf("  // the sidecar's bare-string 'notify' bus event"));
const workspace = { ...W, hunt: { ...W.hunt, offers: [
  { id: 'documents', name: 'Checked table' }, { id: 'cleanup', name: 'Spreadsheet cleanup' }
] }, record_versions: { leads: 'fixture-leads-v1' } };
const campaign = { ...C, version: 'fixture-campaign-v1', analytics: { counts: { sourced: 2, shortlisted: 1, contacted: 0, replied: 0 } } };
const settle = () => new Promise(resolve => setImmediate(resolve));

// Minimal DOM form adapter: replacing innerHTML creates fresh controls with
// their rendered defaults, just as the browser does. It does not retain edits.
function inlineForms(html) {
  const decode = text => String(text).replace(/&(amp|lt|gt|quot|#39);/g,
    (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[entity]));
  return Array.from(html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g), ([, attrs, fields]) => {
    const attr = name => decode(new RegExp('\\b' + name + '="([^"]*)"').exec(attrs)?.[1] || '');
    const elements = [];
    for (const match of fields.matchAll(/<input\b([^>]*)>|<(textarea|select)\b([^>]*)>([\s\S]*?)<\/\2>/g)) {
      const fieldAttrs = match[1] || match[3], name = /\bname="([^"]*)"/.exec(fieldAttrs)?.[1];
      if (!name) continue;
      const content = match[4] || '';
      const value = match[2] === 'textarea' ? content : match[2] === 'select'
        ? (/<option value="([^"]*)" selected/.exec(content) || /<option value="([^"]*)"/.exec(content))?.[1] || ''
        : /\bvalue="([^"]*)"/.exec(fieldAttrs)?.[1] || '';
      const control = { name, value: decode(value) };
      elements.push(control); elements[name] = control;
    }
    return { dataset: { ulForm: attr('data-ul-form'), id: attr('data-id'), leadId: attr('data-lead-id') }, elements };
  });
}

async function mounted(responses, confirmed = true, quests = []) {
  const requests = [], opened = [], persisted = [], prefills = [], doors = [], confirmations = [], mints = [];
  let sends = 0;
  const node = () => ({ innerHTML: '', value: '', hidden: false, textContent: '', handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; }, setAttribute() {}, querySelectorAll() { return []; } });
  const selectors = ['.ul-search', '.ul-offer', '.ul-list', '.ul-card', '.ul-error', '.ul-counts', '.ul-classic', '.ul-panes', '.ul-proposed'];
  const nodes = Object.fromEntries(selectors.map(selector => [selector, node()]));
  for (const selector of ['.ul-card', '.ul-proposed']) {
    let html = '', forms = [];
    Object.defineProperty(nodes[selector], 'innerHTML', { get: () => html, set(value) { html = value; forms = inlineForms(value); } });
    nodes[selector].querySelector = query => query === '.ul-inline-form' ? forms[0] || null : null;
  }
  const select = nodes['.ul-offer'];
  let optionsHTML = '';
  Object.defineProperties(select, {
    options: { get: () => Array.from(optionsHTML.matchAll(/<option /g)) },
    innerHTML: { get: () => optionsHTML, set(html) {
      optionsHTML = html;
      const selected = /<option value="([^"]*)" selected/.exec(html) || /<option value="([^"]*)"/.exec(html);
      this.value = selected ? selected[1] : '';
    } }
  });
  const root = node();
  root.querySelector = selector => selector === '.ul-inline-form'
    ? nodes['.ul-card'].querySelector(selector) || nodes['.ul-proposed'].querySelector(selector) : nodes[selector];
  root.contains = () => true;
  const composer = { value: '', focus() {}, setSelectionRange() {} };
  const nativePrefill = vm.runInNewContext(nativePrefillSource + '\nprefill', { input: composer, autoGrowInput() {} });
  const conversationPath = { hidden: true, children: [], replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); } };
  const open = { leads: true };
  const nativeWorkConversation = vm.runInNewContext(nativeWorkConversationSource + '\nworkConversation', {
    open, WORK_LABELS: {},
    minimizeTerm: key => { open[key] = false; root.hidden = true; },
    $: selector => selector === '#comms-workpath' ? conversationPath : selector === '#chat-input' ? composer : null,
    mkEl: (tag, className, textContent) => ({ tag, className, textContent, setAttribute() {} }),
    openTerm: key => doors.push(key)
  });
  let bodyHTML = '';
  const body = { querySelector: () => root };
  Object.defineProperty(body, 'innerHTML', { get: () => bodyHTML, set(html) {
    bodyHTML = html;
    for (const name of ['ul-list', 'ul-card']) {
      const content = new RegExp('class="' + name + '"[^>]*>(.*?)</div>', 's').exec(html);
      nodes['.' + name].innerHTML = content ? content[1] : '';
    }
    nodes['.ul-error'].hidden = /class="ul-error"[^>]* hidden/.test(html);
  } });
  let builder;
  const context = vm.createContext({ URL, window: { __STARNET_API_TOKEN__: 'fixture-token' },
    confirm: text => { confirmations.push(text); return confirmed; },
    document: { getElementById: id => id === 'chat-input' ? composer : null },
    StationUI: { registerWindow: (key, title, build) => { builder = build; }, h: {
      esc: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      openTerm: key => doors.push(key), workConversation: nativeWorkConversation
    } },
    App: { persist: () => persisted.push(JSON.parse(JSON.stringify(context.Workstreams.serialize()))),
      openWorkstream: id => { opened.push(id); context.Workstreams.switch(id); } },
    Chat: { prefill: text => { prefills.push(text); nativePrefill(text); }, send: () => { sends++; } },
    fetch: async (url, options) => {
      // Starnet's own quest routes answer outside the ultra-route queue, so existing request orders stay as they were.
      if (url === '/api/quests') return { ok: true, status: 200, json: async () => ({ ok: true, quests: JSON.parse(JSON.stringify(quests)) }) };
      if (url === '/api/quests/mint') {
        const q = JSON.parse(options.body); mints.push({ body: q, headers: options.headers });
        quests.push({ id: 'q:' + (quests.length + 1), status: 'open', ...q });
        return { ok: true, status: 200, json: async () => ({ ok: true, id: 'q:' + quests.length }) };
      }
      requests.push({ url, ...options });
      const response = responses.shift();
      assert.ok(response, 'Unexpected request: ' + url);
      const status = response.status || 200;
      return { ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(response.body)) };
    }
  });
  vm.runInContext(streamsSource, context);
  context.Workstreams.init();
  vm.runInContext(leadsSource, context);
  builder(body);
  await settle();
  const click = (action, id) => root.handlers.click({ target: { closest: selector => selector === '[data-ul-action]' ? { dataset: { ulAction: action, id } } : null } });
  const tab = name => root.handlers.click({ target: { closest: selector => selector === '[data-tab]' ? { dataset: { tab: name } } : null } });
  const submit = (kind, data, id) => root.handlers.submit({ preventDefault() {}, target: {
    dataset: { ulForm: kind, leadId: 'b', id },
    elements: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { value }]))
  } });
  return { nodes, body, root, form: () => root.querySelector('.ul-inline-form'), conversationPath, requests, opened, persisted, prefills, doors, composer, context, click, tab, submit, confirmations, mints, sends: () => sends };
}

test('the native board loads authenticated campaign data and the classic link opens its registered window', async () => {
  const ui = await mounted([{ body: workspace }, { body: campaign }]);
  assert.equal(ui.requests[0].url, '/api/ultra/workspace');
  assert.equal(ui.requests[1].url, '/api/ultra/campaign?offer=documents');
  assert.equal(ui.requests[1].headers['X-Starnet-Token'], 'fixture-token');
  assert.match(ui.nodes['.ul-list'].innerHTML, /Beta Data/);
  assert.match(ui.nodes['.ul-card'].innerHTML, /<h3>Beta Data<\/h3>/);
  assert.match(ui.nodes['.ul-counts'].innerHTML, /Sourced<\/small><b>2<\/b>/);
  ui.nodes['.ul-classic'].handlers.click({ preventDefault() {} });
  assert.deepEqual(ui.doors, ['campaign']);
});

test('Ask ULTRA persists and reuses a real lead-bound workstream and only prefills the composer', async () => {
  const ui = await mounted([{ body: workspace }, { body: campaign }]);
  ui.click('outreach'); ui.click('outreach');
  const streams = ui.context.Workstreams.list().filter(s => s.title === 'Outreach · Beta Data · b');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].agentId, 'agent');
  assert.equal(streams[0].history.length, 0);
  assert.equal(ui.persisted.length, 1);
  assert.ok(ui.persisted[0].workstreams.some(s => s.id === streams[0].id));
  assert.deepEqual(ui.opened, [streams[0].id, streams[0].id]);
  assert.deepEqual(ui.prefills, [V.outreachPrompt(W.hunt.leads[1])]);
  assert.equal(ui.composer.value, V.outreachPrompt(W.hunt.leads[1]));
  assert.equal(ui.sends(), 0);
  assert.equal(ui.requests.length, 2);
});

test('Ask ULTRA preserves composer text when the exact outreach prompt is already present', async () => {
  const ui = await mounted([{ body: workspace }, { body: campaign }]);
  const typed = 'Adem note; ' + V.outreachPrompt(W.hunt.leads[1]) + '\nKeep this wording.  ';
  ui.composer.value = typed;
  ui.click('outreach');
  assert.equal(ui.composer.value, typed);
  assert.deepEqual(ui.prefills, []);
  assert.equal(ui.sends(), 0);
});

test('Ask ULTRA steps LEADS aside through the native conversation seam and exposes its return shortcut', async () => {
  const ui = await mounted([{ body: workspace }, { body: campaign }]);
  ui.click('outreach');
  assert.equal(ui.root.hidden, true, 'LEADS steps aside');
  assert.equal(ui.conversationPath.hidden, false);
  assert.equal(ui.conversationPath.children[0].textContent, '‹ BACK TO LEADS');
  assert.match(ui.composer.value, /campaign\.lead/);
  ui.conversationPath.children[0].onclick();
  assert.deepEqual(ui.doors, ['leads']);
});

test('Ask ULTRA appends a missing prompt through native Chat.prefill while preserving the owner note', async () => {
  const ui = await mounted([{ body: workspace }, { body: campaign }]);
  ui.composer.value = 'Adem has a question.';
  ui.click('outreach');
  assert.equal(ui.composer.value, 'Adem has a question.; ' + V.outreachPrompt(W.hunt.leads[1]));
  assert.equal(ui.sends(), 0);
});

test('Ask ULTRA creates distinct conversations for long company names and reuses each by its id title', async () => {
  const prefix = 'A'.repeat(100);
  const leads = [{ ...W.hunt.leads[0], company: prefix + ' Alpha', id: 'lead-alpha' },
    { ...W.hunt.leads[1], company: prefix + ' Beta', id: 'lead-beta' }];
  const ui = await mounted([{ body: { ...workspace, hunt: { ...workspace.hunt, leads } } },
    { body: { ...campaign, rankings: [{ id: 'lead-alpha', score: 80 }, { id: 'lead-beta', score: 40 }] } }]);
  ui.click('outreach');
  ui.nodes['.ul-search'].value = leads[1].company;
  ui.nodes['.ul-search'].handlers.input();
  ui.click('outreach');
  ui.nodes['.ul-search'].value = leads[0].company;
  ui.nodes['.ul-search'].handlers.input();
  ui.click('outreach');
  const streams = ui.context.Workstreams.list().filter(s => s.title && s.title.startsWith('Outreach · '));
  assert.equal(streams.length, 2);
  assert.ok(streams.every(s => s.title.length <= 80));
  assert.ok(streams.some(s => s.title.endsWith(' · lead-alpha')));
  assert.ok(streams.some(s => s.title.endsWith(' · lead-beta')));
  assert.notEqual(ui.opened[0], ui.opened[1]);
  assert.equal(ui.opened[0], ui.opened[2]);
  assert.equal(ui.persisted.length, 2);
});

test('Ask ULTRA reopens the same conversation after the company is renamed', async () => {
  const renamed = { ...workspace, hunt: { ...workspace.hunt,
    leads: [W.hunt.leads[0], { ...W.hunt.leads[1], company: 'Beta Data SARL' }] } };
  const ui = await mounted([{ body: workspace }, { body: campaign }, { body: renamed }, { body: campaign }]);
  ui.click('outreach');
  ui.nodes['.ul-offer'].value = 'cleanup';
  ui.nodes['.ul-offer'].handlers.change(); await settle();
  ui.click('outreach');
  const streams = ui.context.Workstreams.list().filter(s => s.title?.endsWith(' · b'));
  assert.equal(streams.length, 1);
  assert.equal(streams[0].title, 'Outreach · Beta Data · b');
  assert.deepEqual(ui.opened, [streams[0].id, streams[0].id]);
  assert.equal(ui.persisted.length, 1);
  assert.match(ui.composer.value, /Beta Data SARL/);
});

test('shortlist conflicts reload fresh facts and require another owner save with the new version', async () => {
  const fresh = { ...workspace, hunt: { ...workspace.hunt, leads: [W.hunt.leads[0], { ...W.hunt.leads[1], observed_fact: 'New public fact.' }] },
    record_versions: { leads: 'fixture-leads-v2' } };
  const ui = await mounted([{ body: workspace }, { body: campaign }, { status: 409, body: { error: 'Changed' } },
    { body: fresh }, { body: campaign }, { body: {} }, { body: fresh }, { body: campaign }]);
  ui.click('shortlist'); await settle();
  const post = ui.requests[2];
  assert.equal(post.url, '/api/ultra/prospecting/shortlist');
  assert.equal(post.method, 'POST');
  assert.equal(post.headers['If-Match'], 'fixture-leads-v1');
  assert.equal(post.headers['X-Starnet-Token'], 'fixture-token');
  assert.deepEqual(JSON.parse(post.body), { id: 'b', selected: false });
  assert.match(ui.nodes['.ul-card'].innerHTML, /New public fact\./);
  assert.equal(ui.nodes['.ul-error'].hidden, false);
  assert.equal(ui.nodes['.ul-error'].textContent, 'The campaign changed while you were looking. It is reloaded; check and save again.');
  assert.equal(ui.requests.filter(r => r.method === 'POST').length, 1);
  ui.click('shortlist'); await settle();
  assert.equal(ui.requests[5].headers['If-Match'], 'fixture-leads-v2');
  assert.equal(ui.nodes['.ul-error'].hidden, true);
});

test('a failed offer load keeps the displayed offer consistent with the existing rankings', async () => {
  const ui = await mounted([{ body: workspace }, { body: campaign }, { body: workspace }, { status: 503, body: { error: 'Campaign unavailable' } }]);
  ui.nodes['.ul-offer'].value = 'cleanup';
  ui.nodes['.ul-offer'].handlers.change(); await settle();
  assert.equal(ui.requests[3].url, '/api/ultra/campaign?offer=cleanup');
  assert.equal(ui.nodes['.ul-error'].textContent, 'Campaign unavailable');
  assert.equal(ui.nodes['.ul-offer'].value, 'documents');
  assert.match(ui.nodes['.ul-card'].innerHTML, /Beta Data/);
});

test('an initial load failure shows an alert and clears the loading placeholder', async () => {
  const ui = await mounted([{ status: 500, body: { error: 'Workspace unavailable' } }]);
  assert.match(ui.body.innerHTML, /class="ul-error" role="alert"/);
  assert.equal(ui.nodes['.ul-error'].hidden, false);
  assert.equal(ui.nodes['.ul-error'].textContent, 'Workspace unavailable');
  assert.doesNotMatch(ui.nodes['.ul-list'].innerHTML, /Loading/);
});

const crewDraft = { id: 'cd-1', lead_id: 'b', agent_id: 'sales', subject: '', body: 'Crew pitch <checked>',
  status: 'proposed', source_version: 'source-old', created_at: '2026-10-11T09:00:00Z' };
const withCrew = { ...campaign, rankings: [{ id: 'b', score: 80, source_version: 'source-new' }], crew_drafts: [crewDraft] };
const withOwner = { ...workspace, hunt: { ...workspace.hunt, leads: [W.hunt.leads[0],
  { ...W.hunt.leads[1], draft: { subject: 'Owner subject', body: 'Owner pitch', reviewed: false } }] } };
const posts = ui => ui.requests.filter(r => r.method === 'POST');

test('crew cards show author, time, saved check and changed source without exposing other companies', async () => {
  const ui = await mounted([{ body: withOwner }, { body: { ...withCrew, crew_drafts: [crewDraft,
    { ...crewDraft, id: 'old', status: 'adopted', body: 'Adopted copy' },
    { ...crewDraft, id: 'other', lead_id: 'a', body: 'Other company copy' }] } }]);
  const html = ui.nodes['.ul-card'].innerHTML;
  assert.match(html, /Owner pitch/); assert.match(html, /Mark reviewed/);
  assert.ok(html.indexOf('Owner pitch') < html.indexOf('Crew pitch'));
  assert.match(html, /sales/); assert.match(html, /2026-10-11T09:00:00Z/);
  assert.match(html, /Saved for review/); assert.match(html, /Source changed/);
  assert.match(html, /Crew pitch &lt;checked&gt;/);
  assert.doesNotMatch(html, /Adopted copy|Other company copy/);
  ui.click('adopt', 'cd-1');
  assert.match(ui.nodes['.ul-card'].innerHTML, /data-ul-form="adopt"/);
  assert.match(ui.nodes['.ul-card'].innerHTML, /name="subject"[^>]*required/);
  assert.match(ui.nodes['.ul-card'].innerHTML, /Crew pitch &lt;checked&gt;/);
  assert.ok(ui.nodes['.ul-card'].innerHTML.indexOf('data-ul-form="adopt"') < ui.nodes['.ul-card'].innerHTML.indexOf('Conversation room'), 'adoption form stays beside its crew draft');
});

test('crew draft notes render as escaped dim text and allow owner adoption', async () => {
  const notes = [{ rule: 'price', text: 'Look at the price <sample>.' },
    { rule: 'guarantee', text: 'Look at the guarantee.' }];
  const ui = await mounted([{ body: workspace },
    { body: { ...withCrew, crew_drafts: [{ ...crewDraft, notes }] } }]);
  const html = ui.nodes['.ul-card'].innerHTML;
  assert.match(html, /<p class="dim">Look at the price &lt;sample&gt;\. · Look at the guarantee\.<\/p>/);
  assert.doesNotMatch(html, /Check passed at save|Look at the price <sample>/);
  assert.match(html, /Saved for review/);
  ui.click('adopt', 'cd-1');
  assert.match(ui.nodes['.ul-card'].innerHTML, /data-ul-form="adopt"/);
  assert.equal(posts(ui).length, 0, 'notes do not create a separate blocking action');
});

test('first crew adoption creates the owner template, reloads versions, edits, then marks adopted', async () => {
  const bootstrapped = { ...withOwner, record_versions: { leads: 'fixture-leads-v2' } };
  const freshCampaign = { ...withCrew, version: 'fixture-campaign-v2' };
  const ui = await mounted([{ body: workspace }, { body: withCrew }, { body: {} },
    { body: bootstrapped }, { body: freshCampaign }, { body: {} }, { body: {} },
    { body: bootstrapped }, { body: { ...freshCampaign, crew_drafts: [] } }]);
  ui.click('adopt', 'cd-1');
  ui.submit('adopt', { subject: '  Small pilot  ', body: 'Edited by Adem' }, 'cd-1'); await settle();
  const saved = posts(ui);
  assert.deepEqual(saved.map(r => r.url), ['/api/ultra/prospecting/draft', '/api/ultra/prospecting/draft-edit', '/api/ultra/campaign/crew-draft-status']);
  assert.deepEqual(saved.map(r => r.headers['If-Match']), ['fixture-leads-v1', 'fixture-leads-v2', 'fixture-campaign-v2']);
  assert.deepEqual(saved.map(r => JSON.parse(r.body)), [{ id: 'b', offer: 'documents' },
    { id: 'b', subject: 'Small pilot', body: 'Edited by Adem' }, { id: 'cd-1', status: 'adopted' }]);
  assert.doesNotMatch(ui.nodes['.ul-card'].innerHTML, /data-id="cd-1"/);
});

test('existing owner draft adoption skips the template and rejected subjects make no writes', async () => {
  const ui = await mounted([{ body: withOwner }, { body: withCrew }, { body: {} }, { body: {} },
    { body: withOwner }, { body: { ...withCrew, crew_drafts: [] } }]);
  ui.click('adopt', 'cd-1');
  for (const subject of ['', '   ', 'x'.repeat(201)]) {
    ui.submit('adopt', { subject, body: 'Edited' }, 'cd-1'); await settle();
    assert.equal(posts(ui).length, 0);
  }
  ui.submit('adopt', { subject: 'Chosen subject', body: 'Edited' }, 'cd-1'); await settle();
  assert.deepEqual(posts(ui).map(r => r.url), ['/api/ultra/prospecting/draft-edit', '/api/ultra/campaign/crew-draft-status']);
});

test('a failed crew status save still shows the successfully saved owner draft', async () => {
  const record = { ...withOwner.hunt.leads[1], draft: { subject: 'Updated subject', body: 'Saved by Adem', reviewed: false } };
  const ui = await mounted([{ body: withOwner }, { body: withCrew },
    { body: { record, record_version: 'fixture-leads-v2' } }, { status: 400, body: { error: 'Select an open draft.' } }]);
  ui.click('adopt', 'cd-1'); ui.submit('adopt', { subject: 'Updated subject', body: 'Saved by Adem' }, 'cd-1'); await settle();
  assert.match(ui.nodes['.ul-card'].innerHTML, /Saved by Adem/);
  assert.match(ui.nodes['.ul-error'].textContent, /owner draft was saved/);
  assert.match(ui.nodes['.ul-error'].textContent, /Select an open draft/);
  assert.equal(posts(ui).length, 2);
});

for (const step of ['draft', 'draft-edit', 'crew-draft-status']) {
  test('a 409 during adoption at ' + step + ' reloads and never retries a write', async () => {
    const initial = step === 'draft' ? workspace : withOwner;
    const responses = [{ body: initial }, { body: withCrew }];
    if (step === 'crew-draft-status') responses.push({ body: {} });
    responses.push({ status: 409, body: { error: 'Changed' } }, { body: withOwner }, { body: withCrew });
    const ui = await mounted(responses);
    ui.click('adopt', 'cd-1'); ui.submit('adopt', { subject: 'Subject', body: 'Edited' }, 'cd-1'); await settle();
    assert.equal(posts(ui).at(-1).url, '/api/ultra/' + (step === 'crew-draft-status' ? 'campaign/' : 'prospecting/') + step);
    assert.equal(posts(ui).length, step === 'crew-draft-status' ? 2 : 1);
    assert.match(ui.nodes['.ul-error'].textContent, /reloaded; check and save again/);
    assert.match(ui.nodes['.ul-card'].innerHTML, /data-id="cd-1"/);
  });
}

for (const step of ['draft', 'draft-edit']) {
  test('refusal of adoption ' + step + ' leaves the crew draft open', async () => {
    const ui = await mounted([{ body: step === 'draft' ? workspace : withOwner }, { body: withCrew },
      { status: 400, body: { error: 'Outreach preparation is suppressed.' } }]);
    ui.click('adopt', 'cd-1'); ui.submit('adopt', { subject: 'Subject', body: 'Edited' }, 'cd-1'); await settle();
    assert.equal(posts(ui).length, 1);
    assert.equal(posts(ui)[0].url, '/api/ultra/prospecting/' + step);
    assert.equal(ui.nodes['.ul-error'].textContent, 'Outreach preparation is suppressed.');
  });
}

test('dismiss and owner review use their own version domains and the classic review confirmation', async () => {
  const ui = await mounted([{ body: withOwner }, { body: withCrew }, { body: {} },
    { body: withOwner }, { body: { ...withCrew, crew_drafts: [] } }, { body: {} }, { body: withOwner }, { body: withCrew }]);
  ui.click('dismiss', 'cd-1'); await settle();
  ui.click('review'); await settle();
  assert.deepEqual(posts(ui).map(r => [r.url, r.headers['If-Match'], JSON.parse(r.body)]), [
    ['/api/ultra/campaign/crew-draft-status', 'fixture-campaign-v1', { id: 'cd-1', status: 'dismissed' }],
    ['/api/ultra/prospecting/review-draft', 'fixture-leads-v1', { id: 'b', confirmed: true }]
  ]);
  assert.deepEqual(ui.confirmations, ['I checked this company’s source, claim and small offer. Mark this unsent draft reviewed?']);
});

const proposal = { id: 'p1', company: 'New Company', location: 'Sfax', source_url: 'https://example.tn/source',
  observed_on: '2026-10-10', quote: 'Published <service>', agent_id: 'research', status: 'proposed' };

for (const kind of ['adopt', 'reject', 'event']) {
  test(kind + ' form keeps every typed value across search and offer renders', async () => {
    const state = { ...withCrew, proposals: [proposal],
      contacts: [{ id: 'c1', lead_id: 'b', name: 'Buyer' }],
      experiments: [{ id: 'x1', name: 'Fixture', assignments: { b: 'A' } }] };
    const ui = await mounted([{ body: withOwner }, { body: state }, { body: withOwner }, { body: state }]);
    if (kind === 'reject') ui.tab('proposed');
    ui.click(kind === 'event' ? 'event' : kind, kind === 'adopt' ? 'cd-1' : kind === 'reject' ? 'p1' : undefined);
    const values = kind === 'adopt' ? { subject: 'Owner subject <edited>', body: 'Edited pitch\nKeep this wording.' }
      : kind === 'reject' ? { reason: 'Owner reason <typed>\nNeeds a source check.' }
      : { kind: 'reply', contact_id: 'c1', scope: 'contact', experiment_id: 'x1', on: '2026-10-10',
        evidence: 'Mailbox thread 123', text: 'Original buyer wording\nPreserve it.' };
    const original = ui.form();
    for (const [key, value] of Object.entries(values)) original.elements[key].value = value;
    ui.nodes['.ul-search'].value = kind === 'reject' ? 'New' : 'Beta';
    ui.nodes['.ul-search'].handlers.input();
    assert.notEqual(ui.form(), original, 'the form really was replaced');
    for (const [key, value] of Object.entries(values)) assert.equal(ui.form().elements[key].value, value, 'search preserves ' + key);
    ui.nodes['.ul-offer'].value = 'cleanup';
    ui.nodes['.ul-offer'].handlers.change(); await settle();
    for (const [key, value] of Object.entries(values)) assert.equal(ui.form().elements[key].value, value, 'offer preserves ' + key);
    ui.nodes['.ul-search'].value = 'no match';
    ui.nodes['.ul-search'].handlers.input();
    assert.equal(ui.form(), null);
    ui.nodes['.ul-search'].value = '';
    ui.nodes['.ul-search'].handlers.input();
    for (const [key, value] of Object.entries(values)) assert.equal(ui.form().elements[key].value, value, 'returning preserves ' + key);
    assert.equal(posts(ui).length, 0, 'editing and filtering perform no business writes');
  });
}

test('PROPOSED lists sourced open proposals and accepts with the exact owner confirmation', async () => {
  const proposed = { ...campaign, proposals: [proposal, { ...proposal, id: 'closed', company: 'Accepted Company', status: 'accepted' }] };
  const ui = await mounted([{ body: workspace }, { body: proposed }, { body: {} }, { body: workspace }, { body: campaign }]);
  ui.tab('proposed');
  const html = ui.nodes['.ul-proposed'].innerHTML;
  for (const value of ['New Company', 'Sfax', 'https://example.tn/source', '2026-10-10', 'research', 'Published &lt;service&gt;']) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /Accepted Company/);
  ui.click('accept', 'p1'); await settle();
  assert.deepEqual(ui.confirmations, ['Add New Company to your leads? Its source still needs your own check.']);
  assert.deepEqual(JSON.parse(posts(ui)[0].body), { id: 'p1' });
  assert.equal(posts(ui)[0].url, '/api/ultra/campaign/accept-proposal');
  assert.equal(posts(ui)[0].headers['If-Match'], 'fixture-campaign-v1');
});

test('proposal rejection validates a trimmed reason before posting', async () => {
  const ui = await mounted([{ body: workspace }, { body: { ...campaign, proposals: [proposal] } },
    { body: {} }, { body: workspace }, { body: campaign }]);
  ui.tab('proposed'); ui.click('reject', 'p1');
  assert.match(ui.nodes['.ul-proposed'].innerHTML, /data-ul-form="reject"/);
  for (const reason of ['ab', '  a  ', 'x'.repeat(301)]) {
    ui.submit('reject', { reason }, 'p1'); await settle(); assert.equal(posts(ui).length, 0);
  }
  ui.submit('reject', { reason: '  Outside scope  ' }, 'p1'); await settle();
  assert.equal(posts(ui)[0].url, '/api/ultra/campaign/proposal-status');
  assert.deepEqual(JSON.parse(posts(ui)[0].body), { id: 'p1', status: 'rejected', reason: 'Outside scope' });
});

test('conversation room shows owner contact details, evidence, signals and follow-ups only for this company', async () => {
  const ui = await mounted([{ body: workspace }, { body: { ...campaign,
    events: [{ lead_id: 'b', kind: 'reply', on: '2026-10-10', text: 'Original reply', evidence: 'Mailbox reference', confirmed: true }],
    contacts: [{ id: 'c1', lead_id: 'b', name: 'Buyer Name', role: 'Director', route: 'buyer@example.tn', source_url: 'https://example.tn/contact' },
      { id: 'c2', lead_id: 'a', name: 'Other Buyer', route: 'other@example.tn' }],
    signals: [{ lead_id: 'b', checked_on: '2026-10-10', text: 'A sourced signal', hypothesis: 'Possible need', source_url: 'https://example.tn/signal' }],
    followups: [{ lead_id: 'b', on: '2026-10-12', text: 'Follow-up proposal', needs_review: true }] } }]);
  const html = ui.nodes['.ul-card'].innerHTML;
  for (const value of ['Buyer Name', 'Director', 'buyer@example.tn', 'https://example.tn/contact', 'Original reply', 'Mailbox reference', 'A sourced signal', 'Follow-up proposal']) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /Other Buyer|other@example.tn/);
});

test('the outcome form rejects short evidence, then posts the classic event payload after confirmation', async () => {
  const ui = await mounted([{ body: workspace }, { body: campaign }, { body: {} }, { body: workspace }, { body: campaign }]);
  ui.click('event');
  assert.match(ui.nodes['.ul-card'].innerHTML, /data-ul-form="event"/);
  assert.ok(ui.nodes['.ul-card'].innerHTML.indexOf('data-ul-form="event"') < ui.nodes['.ul-card'].innerHTML.indexOf('Recorded events'), 'the evidence form opens next to its action');
  const fields = { kind: 'reply', on: '2026-10-11', evidence: ' short ', text: 'Original reply', contact_id: '', scope: 'company', experiment_id: '' };
  ui.submit('event', fields); await settle(); assert.equal(posts(ui).length, 0);
  ui.submit('event', { ...fields, evidence: '2026-10-11 mailbox thread 123' }); await settle();
  assert.deepEqual(JSON.parse(posts(ui)[0].body), { lead_id: 'b', kind: 'reply', on: '2026-10-11', evidence: '2026-10-11 mailbox thread 123', text: 'Original reply', confirmed: true, contact_id: null, scope: 'company' });
  assert.equal(posts(ui)[0].url, '/api/ultra/campaign/event');
  assert.equal(posts(ui)[0].headers['If-Match'], 'fixture-campaign-v1');
  assert.deepEqual(ui.confirmations, ['I confirm this external event actually happened, with the date and evidence shown.']);
});

test('declining review, acceptance and outcome confirmation makes no writes', async () => {
  const ui = await mounted([{ body: withOwner }, { body: { ...campaign, proposals: [proposal] } }], false);
  ui.click('review'); ui.click('event');
  ui.submit('event', { kind: 'sent', on: '2026-10-11', evidence: 'Mailbox reference', text: '', contact_id: '', scope: 'company', experiment_id: '' });
  ui.tab('proposed'); ui.click('accept', 'p1'); await settle();
  assert.equal(posts(ui).length, 0);
  assert.equal(ui.confirmations.length, 3);
});

function mountedTemplates(presetsPresent = true) {
  const builders = {}, opened = [], prefills = [];
  const status = { textContent: '' }, root = { handlers: {}, addEventListener(kind, handler) { this.handlers[kind] = handler; } };
  const body = { innerHTML: '', querySelector: selector => selector === '.ultra-rt-status' ? status : root };
  let buildOpen = false, buildOpens = 0, presetClicks = 0;
  const context = vm.createContext({ window: {},
    document: { getElementById: id => id === 'refit-stations' && buildOpen && presetsPresent ? { click() { presetClicks++; } } : null },
    StationUI: { registerWindow: (key, title, build) => { builders[key] = { title, build }; }, h: {
      esc: text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      workConversation() {}
    } },
    Build: { isOpen: () => buildOpen, open: () => { buildOpen = true; buildOpens++; } },
    App: { openWorkstream: id => { opened.push(id); context.Workstreams.switch(id); } },
    Chat: { prefill: text => prefills.push(text) }
  });
  vm.runInContext(streamsSource, context); context.Workstreams.init();
  vm.runInContext(fs.readFileSync(require.resolve('../station/frontend/ultra-templates.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../station/frontend/ultra-window.js'), 'utf8'), context);
  assert.ok(builders['ultra-room-templates'], 'the native ROOM TEMPLATES window is registered');
  assert.equal(builders['ultra-room-templates'].title, 'ROOM TEMPLATES');
  builders['ultra-room-templates'].build(body);
  const click = (action, kit) => root.handlers.click({ target: { closest: () => ({ dataset: { ultraRtAction: action, kit } }) } });
  return { body, status, context, opened, prefills, click, buildOpens: () => buildOpens, presetClicks: () => presetClicks };
}

test('ROOM TEMPLATES lists the real catalog and every kit, and asks ULTRA in its General session', () => {
  const ui = mountedTemplates();
  assert.match(ui.body.innerHTML, /1ULTRA COMMAND/);
  assert.equal((ui.body.innerHTML.match(/class="ultra-rt-row"/g) || []).length, 7);
  for (const name of ['CAMPAIGN', 'LEAD RESEARCH', 'DRAFT &amp; CHECK', 'DELIVERY LAB', 'CLIENT PILOT', 'RECORDS']) assert.ok(ui.body.innerHTML.includes(name));
  ui.click('ask', 'ultraResearch');
  assert.deepEqual(ui.opened, [ui.context.Workstreams.generalId()]);
  assert.deepEqual(ui.prefills, ['Add the LEAD RESEARCH room template beside the station.']);
  assert.equal(ui.context.Workstreams.active().agentId, 'agent');
  assert.equal(ui.context.Workstreams.active().history.length, 0);
});

test('Open station presets opens BUILD MODE before clicking presets and never toggles it closed', () => {
  const ui = mountedTemplates();
  ui.click('presets'); ui.click('presets');
  assert.equal(ui.buildOpens(), 1);
  assert.equal(ui.presetClicks(), 2);
});

test('missing presets give a visible route to the station preset library', () => {
  const ui = mountedTemplates(false);
  ui.click('presets');
  assert.equal(ui.presetClicks(), 0);
  assert.match(ui.status.textContent, /BUILD MODE/); assert.match(ui.status.textContent, /Presets/);
});

test('a send quest key binds the company and the approved draft version', () => {
  const lead = { id: 'lead-1', company: 'Alpha SARL' };
  assert.equal(V.sendQuestKey(lead, '0123456789abcdef'), 'ultra:send:lead-1:0123456789abcdef');
  const quests = [
    { id: 'q:1', status: 'open', contract: { type: 'attest', key: 'ultra:send:lead-1:0123456789abcdef' } },
    { id: 'q:2', status: 'open', contract: { type: 'attest', key: 'ultra:send:lead-2:0123456789abcdef' } },
    { id: 'q:3', status: 'open', contract: { type: 'attest', key: 'ultra:send:lead-1:fedcba9876543210' } },
    { id: 'q:4', status: 'dismissed', contract: { type: 'attest', key: 'ultra:send:lead-1:aaaaaaaaaaaaaaaa' } }];
  assert.equal(V.sendQuestFor(quests, lead, '0123456789abcdef').id, 'q:1');
  assert.equal(V.sendQuestFor(quests, { id: 'lead-3' }, '0123456789abcdef'), null);
  assert.deepEqual(V.staleSendQuests(quests, lead, '0123456789abcdef').map(q => q.id), ['q:3']);
  assert.equal(V.sendQuestFor([{ ...quests[0], status: 'dismissed' }], lead, '0123456789abcdef'), null, 'a dismissed quest does not count');
});

test('the send quest Adem mints carries the draft, the instruction and the attest contract', () => {
  const lead = { id: 'lead-1', company: 'Alpha SARL', draft: { subject: 'Petit lot', body: 'Bonjour …' } };
  const q = V.sendQuestDraft(lead, '0123456789abcdef');
  assert.equal(q.title, 'Send pitch to Alpha SARL');
  assert.deepEqual(q.contract, { type: 'attest', key: 'ultra:send:lead-1:0123456789abcdef' });
  assert.equal(q.executionMode, 'commander');
  assert.match(q.desc, /Petit lot/);
  assert.match(q.desc, /date, channel and recipient/);
});

test('the card knows its draft version and its send quest, including an older approval', () => {
  const lead = { id: 'lead-1', company: 'Alpha SARL', draft: { subject: 'S', body: 'B', reviewed: true } };
  const C3 = { draft_versions: { 'lead-1': '0123456789abcdef' }, quests: [
    { id: 'q:1', status: 'done', contract: { type: 'attest', key: 'ultra:send:lead-1:0123456789abcdef' } },
    { id: 'q:2', status: 'open', contract: { type: 'attest', key: 'ultra:send:lead-1:fedcba9876543210' } }] };
  const card = V.cardModel(lead, C3);
  assert.equal(card.send.version, '0123456789abcdef');
  assert.equal(card.send.quest.id, 'q:1');
  assert.deepEqual(card.send.stale.map(q => q.id), ['q:2']);
  assert.deepEqual(V.cardModel(lead, {}).send, { version: null, quest: null, stale: [] });
});

test('Approve draft mints one Send pitch quest for the selected company and the card then shows it open', async () => {
  const reviewed = { ...workspace, hunt: { ...workspace.hunt, leads: workspace.hunt.leads.map(l => l.id === 'b'
    ? { ...l, draft: { subject: 'Petit lot', body: 'Bonjour, un petit lot ?', reviewed: true } } : l) } };
  const withVersion = { ...campaign, draft_versions: { b: '0123456789abcdef' } };
  const ui = await mounted([{ body: reviewed }, { body: withVersion }, { body: reviewed }, { body: withVersion }]);
  assert.match(ui.nodes['.ul-card'].innerHTML, /data-ul-action="approve"/);
  ui.click('approve');
  await settle(); await settle();
  assert.equal(ui.mints.length, 1);
  assert.equal(ui.mints[0].headers['X-Starnet-Token'], 'fixture-token');
  assert.deepEqual(ui.mints[0].body.contract, { type: 'attest', key: 'ultra:send:b:0123456789abcdef' });
  assert.equal(ui.mints[0].body.title, 'Send pitch to Beta Data');
  assert.match(ui.nodes['.ul-card'].innerHTML, /Send quest open/);
  assert.doesNotMatch(ui.nodes['.ul-card'].innerHTML, /data-ul-action="approve"/);
});

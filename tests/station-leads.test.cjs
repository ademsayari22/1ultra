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
const workspace = { ...W, hunt: { ...W.hunt, offers: [
  { id: 'documents', name: 'Checked table' }, { id: 'cleanup', name: 'Spreadsheet cleanup' }
] }, record_versions: { leads: 'fixture-leads-v1' } };
const campaign = { ...C, analytics: { counts: { sourced: 2, shortlisted: 1, contacted: 0, replied: 0 } } };
const settle = () => new Promise(resolve => setImmediate(resolve));

async function mounted(responses) {
  const requests = [], opened = [], persisted = [], prefills = [], doors = [];
  let sends = 0;
  const node = () => ({ innerHTML: '', value: '', hidden: false, textContent: '', handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; }, setAttribute() {}, querySelectorAll() { return []; } });
  const selectors = ['.ul-search', '.ul-offer', '.ul-list', '.ul-card', '.ul-error', '.ul-counts', '.ul-classic'];
  const nodes = Object.fromEntries(selectors.map(selector => [selector, node()]));
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
  root.querySelector = selector => nodes[selector];
  const composer = { value: '', focus() {}, setSelectionRange() {} };
  const nativePrefill = vm.runInNewContext(nativePrefillSource + '\nprefill', { input: composer, autoGrowInput() {} });
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
    document: { getElementById: id => id === 'chat-input' ? composer : null },
    StationUI: { registerWindow: (key, title, build) => { builder = build; }, h: {
      esc: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      openTerm: key => doors.push(key)
    } },
    App: { persist: () => persisted.push(JSON.parse(JSON.stringify(context.Workstreams.serialize()))),
      openWorkstream: id => { opened.push(id); context.Workstreams.switch(id); } },
    Chat: { prefill: text => { prefills.push(text); nativePrefill(text); }, send: () => { sends++; } },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      const response = responses.shift();
      assert.ok(response, 'Unexpected request: ' + url);
      const status = response.status || 200;
      return { ok: status < 400, status, json: async () => response.body };
    }
  });
  vm.runInContext(streamsSource, context);
  context.Workstreams.init();
  vm.runInContext(leadsSource, context);
  builder(body);
  await settle();
  const click = action => root.handlers.click({ target: { closest: selector => selector === '[data-ul-action]' ? { dataset: { ulAction: action } } : null } });
  return { nodes, body, requests, opened, persisted, prefills, doors, composer, context, click, sends: () => sends };
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

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = path.join(__dirname, '..', 'station');
const M = require(path.join(S, 'frontend/app/worldmodel.js'));
const T = require(path.join(S, 'frontend/app/stationtemplates.js'));
const Sprites = require(path.join(S, 'frontend/app/propsprites.js'));
const SB = require(path.join(S, 'frontend/app/stationbuilder.js'));
const U = require(path.join(S, 'frontend/ultra-templates.js'));
const { makeStationStore } = require(path.join(S, 'sidecar/station-store.js'));

const roomOf = (st, p) => st.roomById(st.roomAt(p.x, p.y)).name;

test('1ULTRA COMMAND puts ULTRA in a COMMAND room in the center and the crew in CAMPAIGN beside it', () => {
  const entry = T.catalog.find(c => c.id === 'ultra-command');
  assert.ok(entry, 'the preset is in the catalog');
  assert.equal(entry.group, 'ultra');
  assert.equal(entry.name, '1ULTRA COMMAND');
  const doc = T.build('ultra-command', M, Sprites);
  const v = makeStationStore().validateStationDoc(doc);
  assert.equal(v.ok, true, v.error);
  assert.equal(doc.meta.templateId, 'ultra-command');
  const st = M.create(doc);
  const names = st.rooms().filter(r => r.kind !== 'corridor').map(r => r.name).sort();
  assert.deepEqual(names, ['CAMPAIGN', 'COMMAND']);
  const cats = st.props().filter(p => p.t === 'ultra_cat');
  assert.equal(cats.length, 1, 'the preset has one station cat');
  assert.equal(roomOf(st, cats[0]), 'COMMAND', 'the cat lives in COMMAND');
  assert.equal(st.roomById(doc.meta.spawnRoomId).name, 'COMMAND', 'COMMAND is the spawn room, in the center');
  const seats = Object.fromEntries(st.props().filter(p => p.agentId).map(p => [p.agentId, roomOf(st, p)]));
  assert.deepEqual(seats, { agent: 'COMMAND', research: 'CAMPAIGN', delivery: 'CAMPAIGN', sales: 'CAMPAIGN', qa: 'CAMPAIGN' });
  const campaignGear = new Set(st.props().filter(p => roomOf(st, p) === 'CAMPAIGN').map(p => M.capForProp(p.t)).filter(Boolean));
  for (const cap of ['computer', 'cabinet', 'dish', 'notebook']) assert.ok(campaignGear.has(cap), 'CAMPAIGN brings ' + cap);
  const commandGear = new Set(st.props().filter(p => roomOf(st, p) === 'COMMAND').map(p => M.capForProp(p.t)).filter(Boolean));
  for (const cap of ['computer', 'cabinet', 'dish', 'notebook', 'workbench', 'studio']) assert.ok(commandGear.has(cap), 'COMMAND keeps the five essentials and the desk: ' + cap);
  for (const a of ['agent', 'research', 'sales']) assert.equal(st.agentRoomId(a), null, a + ' has no bay, so it keeps station-wide gear');
});

test('the preset builds over a populated station\'s ids and binds desks by id only', () => {
  const doc = T.build('ultra-command', M, Sprites, 900);
  assert.ok(doc._nid > 900);
  assert.ok(Object.keys(doc.rooms).every(id => Number(id.slice(1)) >= 900), 'room ids renumbered past the live station');
  const bound = doc.props.filter(p => p.agentId).map(p => p.agentId).sort();
  assert.deepEqual(bound, ['agent', 'delivery', 'qa', 'research', 'sales'], 'binding survives renumbering; ids need not exist yet');
});

test('the six 1Ultra room kits are offered to the station builder and each one builds cleanly', () => {
  const ids = T.kits().map(k => k.id);
  for (const id of ['ultraCampaign', 'ultraResearch', 'ultraDraftCheck', 'ultraDelivery', 'ultraPilot', 'ultraRecords']) assert.ok(ids.includes(id), id + ' is a kit');
  const env = { WorldModel: M, Pipeline: require(path.join(S, 'frontend/app/pipeline.js')), WorkflowLine: require(path.join(S, 'frontend/app/workflowline.js')),
    crew: [{ id: 'agent', name: 'ULTRA' }], heroId: 'agent', StationTemplates: T, PropSprites: Sprites, EquipmentHelp: require(path.join(S, 'frontend/app/equipmenthelp.js')) };
  for (const kit of T.kits().filter(k => k.id.startsWith('ultra'))) {
    assert.ok(kit.about.length > 10, kit.id + ' says what it is');
    const st = M.create(M.starterDoc());
    const r = SB.planRoom(st.serialize(), { kit: kit.name }, env);
    assert.equal(r.ok, true, kit.id + ': ' + (r.error || ''));
    const a = SB.apply(st, r.plan, env);
    assert.equal(a.ok, true, kit.id + ': ' + (a.error || ''));
    const nr = st.rooms().find(x => x.name === kit.name);
    assert.ok(nr, kit.id + ': a new room of that name');
    assert.ok(st.props().filter(p => st.roomAt(p.x, p.y) === nr.id).every(p => !p.agentId), kit.id + ': a kit never seats an agent');
    if (kit.line) {
      const briefs = st.props().filter(p => p.t === 'bay' && st.roomAt(p.x, p.y) === nr.id).map(p => p.brief).sort();
      assert.deepEqual(briefs, Object.values(kit.line.briefs).sort(), kit.id + ': each step gets its written instructions');
    }
    assert.equal(st.undo().ok, true);
  }
  const research = T.kits().find(k => k.id === 'ultraResearch');
  assert.equal(research.line.bp, 'research_line');
  assert.match(research.line.briefs.WRITER, /campaign\.propose_lead/);
  const draft = T.kits().find(k => k.id === 'ultraDraftCheck');
  assert.equal(draft.line.bp, 'revision_loop');
  assert.match(draft.line.briefs.REVIEWER, /VERDICT: approved or VERDICT: revise/);
});

test('Starnet\'s own presets are unchanged', () => {
  assert.deepEqual(T.catalog.filter(c => c.group !== 'ultra').map(c => c.id), ['software', 'research', 'creative', 'operations', 'cozy', 'default', 'retreat']);
  const doc = T.build('research', M, Sprites);
  assert.equal(M.create(doc).rooms().find(r => r.id === doc.meta.spawnRoomId).name, 'HOME', 'a preset without a center keeps HOME');
});

test('research and draft-check kits give the lenient brief and the owner-only rule to each step', () => {
  const rules = 'Nothing leaves the station: never send, publish, buy, sign or record outcomes — Adem does those.';
  assert.deepEqual(U.rooms.ultraResearch.line.briefs, {
    RESEARCHER: 'Find Tunisian companies that could use a small data or document job. Note where you found each one (link, date, what it said), and use campaign.leads to skip companies Adem already has. ' + rules,
    WRITER: 'Propose the best ones with campaign.propose_lead (one Tunisian company each, with its country, source link, the date you saw it and what it said), then list what you proposed. ' + rules
  });
  assert.deepEqual(U.rooms.ultraDraftCheck.line.briefs, {
    WRITER: 'Write a natural, persuasive French email for the company in the job, from its packet (campaign.lead) and Adem\'s pitch kit (campaign.pitch_kit), and save it with campaign.save_draft. If QA sent it back, improve what QA asked. ' + rules,
    REVIEWER: 'Read the email the way the recipient would: is it clear, specific and worth answering? Say what would make it stronger. End with exactly one line: VERDICT: approved or VERDICT: revise. ' + rules
  });
});

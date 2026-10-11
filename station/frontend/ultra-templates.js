/* 1Ultra station templates: the 1ULTRA COMMAND station (ULTRA in the center, the crew's CAMPAIGN room beside it) and the
   1Ultra room kits for future work. Starnet's stationtemplates.js merges these (ultra-templates patches), so BUILD MODE's
   station presets, the setup preview and ULTRA's station builder all read them. Rooms are Starnet's 18 x 11 size.
   A prop is [type, x, y, facing?, seat?]: x/y are room tiles; seat binds a desk to that agent when the preset is built
   (one desk per agent). Kits never bind seats: ULTRA's station builder places their furniture unassigned. */
'use strict';
const UltraTemplates = (() => {
  const RULES = 'Prepare only: never send, publish, buy or record outcomes. Stay inside Tunisia, respect exclusions, and mark anything unverified as unknown.';
  const rooms = {
    ultraCampaign: { name: 'CAMPAIGN', kind: 'bridge', floorStyle: 'cobalt', floorMat: 'resin', props: [
      ['war_intelcab', 1, 0], ['whiteboard', 4, 0], ['comms_dish', 15, 0], ['gigs_servercart', 1, 9], ['plant', 17, 9],
      ['desk', 2, 3, 0, 'research'], ['desk', 6, 3, 0, 'delivery'], ['desk', 10, 3, 0, 'sales'], ['desk', 14, 3, 0, 'qa']] },
    ultraResearch: { name: 'LEAD RESEARCH', kind: 'lab', floorStyle: 'teal', floorMat: 'resin', props: [
      ['war_intelcab', 0, 0], ['desk', 3, 1], ['research_samplecart', 11, 1], ['comms_dish', 15, 0], ['bookshelf', 2, 8], ['bookshelf', 12, 8]],
      line: { bp: 'research_line', x: 0, y: 4, label: 'TUNISIA · LEAD RESEARCH', briefs: {
        RESEARCHER: 'Find Tunisian companies that could use a small, bounded data pilot. For each one record the source URL, the date you saw it and the exact quoted text, and check it with campaign.leads so you never repeat a known or excluded company. ' + RULES,
        WRITER: 'Turn the research notes into proposed leads with campaign.propose_lead: one Tunisian company each, with its country, source URL, observed date and quoted text. Then write a short list of what you proposed and what stays unknown. ' + RULES
      } } },
    ultraDraftCheck: { name: 'DRAFT & CHECK', kind: 'hab', floorStyle: 'ash', floorMat: 'plank', props: [
      ['desk', 3, 1], ['industrial_roundtable', 10, 2], ['dinerchair', 9, 2, 3], ['dinerchair', 12, 2, 1], ['bookshelf', 15, 1], ['plant', 17, 3]],
      line: { bp: 'revision_loop', x: 0, y: 4, label: 'TUNISIA · DRAFT & CHECK', briefs: {
        WRITER: 'Write a short French pitch for the company named in the job, using only its packet from campaign.lead: no invented facts, prices, deadlines or results. Run campaign.check_draft, fix every problem it lists, then save it with campaign.save_draft. If QA sent it back, fix exactly what QA asked. ' + RULES,
        REVIEWER: 'Check the pitch against the company packet (campaign.lead) and campaign.check_draft. List every problem you find. End with exactly one line: VERDICT: approved or VERDICT: revise. ' + RULES
      } } },
    ultraDelivery: { name: 'DELIVERY LAB', kind: 'lab', floorStyle: 'sterile', floorMat: null, props: [
      ['war_intelcab', 0, 0], ['desk', 3, 1], ['rack', 12, 1], ['plant', 16, 1], ['workbench', 12, 8], ['industrial_drawerbank', 2, 8]] },
    ultraPilot: { name: 'CLIENT PILOT', kind: 'hab', floorStyle: 'ash', floorMat: 'resin', props: [
      ['war_intelcab', 0, 0], ['desk', 3, 1], ['whiteboard', 12, 0], ['industrial_roundtable', 12, 6], ['dinerchair', 11, 6, 3], ['dinerchair', 14, 6, 1], ['plant', 17, 9]] },
    ultraRecords: { name: 'RECORDS', kind: 'storage', floorStyle: 'rust', floorMat: null, props: [
      ['bookshelf', 1, 1], ['bookshelf', 4, 1], ['rack', 12, 1], ['gigs_servercart', 16, 1], ['desk', 3, 8], ['safe', 15, 8]] }
  };
  const kitAbout = {
    ultraCampaign: 'the crew\'s campaign room: four desks, files, web and memory',
    ultraResearch: 'a lead research lab with a Research + write line that proposes sourced Tunisian companies',
    ultraDraftCheck: 'a draft and check room with a Draft + QA loop for company pitches',
    ultraDelivery: 'a delivery lab for one bounded pilot: a desk, a terminal workbench, files and a rack',
    ultraPilot: 'a client pilot room: a desk, files, a whiteboard and a meeting table',
    ultraRecords: 'a records room: bookshelves, a rack, a server cart and a safe'
  };
  const catalog = [
    { id: 'ultra-command', group: 'ultra', name: '1ULTRA COMMAND', rooms: 2,
      pitch: 'ULTRA orchestrates from the center, and the crew works the campaign next door',
      description: 'A command room in the center for ULTRA, your orchestrator, with all five essentials, and the CAMPAIGN room beside it with a desk for Research, Delivery, Sales and QA. The free sides take room templates as your work grows.',
      center: { name: 'COMMAND', seat: 'agent', props: [['screens', 10, 0], ['industrial_roundtable', 7, 5], ['dinerchair', 6, 5, 3], ['dinerchair', 9, 5, 1], ['plant', 0, 9], ['plant', 17, 9]] },
      wings: [['ultraCampaign', 'east']] }
  ];
  return { rooms, kitAbout, catalog };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = UltraTemplates;

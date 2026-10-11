'use strict';

const {validate} = require('./shared/schema.js');

const BRIEF = "[CAMPAIGN] Campaign tools read Adem's Tunisia campaign: campaign.leads lists companies and campaign.lead gives one company's checked packet. Hand the crew the packet, never your own guesses. Nothing is ever sent: Adem reviews every draft and proposed lead in LEADS.";

function makeCampaignTools({call, isHalted}) {
  function campaignTool(name, path, keys, description, schema, method = 'GET', scope = 'read') {
    return {
      name, capability: 'campaign', scope, requiresConsent: false, description, schema,
      async run(args, ctx) {
        if (isHalted()) throw new Error('The emergency stop is on: campaign tools are paused.');
        try {
          const input = args && typeof args === 'object' && !Array.isArray(args)
            ? Object.fromEntries(keys.filter(key => args[key] !== undefined).map(key => [key, args[key]])) : args;
          const checked = validate(schema, input);
          if (!checked.ok) throw new Error('invalid arguments: ' + checked.errors.join('; '));
          if (input.query !== undefined && Array.from(input.query).length > 100)
            throw new Error('invalid arguments: query must be at most 100 characters.');
          if (input.limit !== undefined && (input.limit < 1 || input.limit > 50))
            throw new Error('invalid arguments: limit must be an integer from 1 to 50.');
          if (input.body !== undefined && (!input.body.trim() || Array.from(input.body).length > 8000))
            throw new Error('invalid arguments: body must contain 1–8000 characters.');
          if (input.subject !== undefined && Array.from(input.subject).length > 200)
            throw new Error('invalid arguments: subject must be at most 200 characters.');
          let route = path, body = null;
          if (method === 'GET') {
            const params = new URLSearchParams();
            for (const key of keys) if (input[key] !== undefined) params.set(key, input[key]);
            const query = params.toString();
            route += query ? '?' + query : '';
          } else {
            body = {...input};
            if (scope === 'write') body.agent_id = (ctx && ctx.agentId) || 'unknown';
          }
          const result = await call({route, method, body, version: ''});
          if (result && result.status >= 400)
            throw new Error((result.value && result.value.error) || 'Campaign worker refused the request (status ' + result.status + ').');
          return {content: JSON.stringify(result), summary: name};
        } catch (error) {
          throw new Error('Campaign tool error: ' + ((error && error.message) || String(error)));
        }
      },
    };
  }

  const draftProperties = {
    lead_id: {type: 'string'}, subject: {type: 'string', maxLength: 200},
    body: {type: 'string', minLength: 1, maxLength: 8000},
  };
  const tools = [
    campaignTool('campaign.leads', '/api/tools/leads', ['offer', 'query', 'limit'],
      "List the Tunisian companies on Adem's campaign board, ranked, with stage and score. Optional: offer, query, limit (1–50). Read-only.",
      {type: 'object', additionalProperties: false, properties: {
        offer: {type: 'string', enum: ['cleanup', 'catalogue', 'documents', 'website']},
        query: {type: 'string', maxLength: 100},
        limit: {type: 'integer', minimum: 1, maximum: 50},
      }}),
    campaignTool('campaign.lead', '/api/tools/lead', ['id'],
      "Read one company's checked packet by id: public source facts, ranking reasons, contact roles (no names), signals, proofs and drafts. Use it before any research, pitch or check about that company. Read-only.",
      {type: 'object', additionalProperties: false, properties: {id: {type: 'string'}}, required: ['id']}),
    campaignTool('campaign.check_draft', '/api/tools/check-draft', ['lead_id', 'subject', 'body'],
      "Check a pitch draft for one company against Adem's rules (no prices, percentages, time promises, guarantees or invented clients; scope, exclusions, suppression, source age). Read-only. Fix every problem before saving.",
      {type: 'object', additionalProperties: false, properties: draftProperties, required: ['lead_id', 'body']}, 'POST'),
    campaignTool('campaign.save_draft', '/api/tools/save-draft', ['lead_id', 'subject', 'body', 'language'],
      "Save a checked pitch draft for one company as unreviewed. Adem reviews it in LEADS. Refused while the draft has problems. Never sends anything.",
      {type: 'object', additionalProperties: false, properties: {...draftProperties, language: {type: 'string', enum: ['fr', 'en']}}, required: ['lead_id', 'body']}, 'POST', 'write'),
    campaignTool('campaign.propose_lead', '/api/tools/propose-lead', ['company', 'country', 'location', 'industry', 'website', 'source_url', 'observed_on', 'quote'],
      "Propose one new Tunisian company with its source URL, the date you saw it and the exact quoted text. Refused for known, excluded or non-Tunisian companies. Adem accepts or rejects it in LEADS.",
      {type: 'object', additionalProperties: false, properties: {
        company: {type: 'string', minLength: 2, maxLength: 200}, country: {type: 'string'},
        location: {type: 'string', maxLength: 100}, industry: {type: 'string'}, website: {type: 'string'},
        source_url: {type: 'string'}, observed_on: {type: 'string'}, quote: {type: 'string', minLength: 10, maxLength: 1000},
      }, required: ['company']}, 'POST', 'write'),
  ];

  return {register: registry => { for (const tool of tools) registry.register(tool); }, brief: () => BRIEF};
}

module.exports = {makeCampaignTools};

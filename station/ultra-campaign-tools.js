'use strict';

const BRIEF = "[CAMPAIGN] Campaign tools read Adem's Tunisia campaign: campaign.leads lists companies and campaign.lead gives one company's checked packet. Hand the crew the packet, never your own guesses. Nothing is ever sent: Adem reviews every draft and proposed lead in LEADS.";

function makeCampaignTools({call, isHalted}) {
  function readTool(name, path, keys, description, schema) {
    return {
      name, capability: 'campaign', scope: 'read', requiresConsent: false, description, schema,
      async run(args, ctx) {
        if (isHalted()) return {content: 'The emergency stop is on: campaign tools are paused.', summary: 'error'};
        try {
          const params = new URLSearchParams();
          for (const key of keys) if (args[key] !== undefined) params.set(key, args[key]);
          const query = params.toString();
          const route = path + (query ? '?' + query : '');
          const result = await call({route, method: 'GET', body: null, version: ''});
          return {content: JSON.stringify(result), summary: result && result.status >= 400 ? 'error' : name};
        } catch (error) {
          return {content: 'Campaign tool error: ' + ((error && error.message) || String(error)), summary: 'error'};
        }
      },
    };
  }

  const tools = [
    readTool('campaign.leads', '/api/tools/leads', ['offer', 'query', 'limit'],
      "List the Tunisian companies on Adem's campaign board, ranked, with stage and score. Optional: offer, query, limit (1–50). Read-only.",
      {type: 'object', additionalProperties: false, properties: {
        offer: {type: 'string', enum: ['cleanup', 'catalogue', 'documents', 'website']},
        query: {type: 'string', maxLength: 100},
        limit: {type: 'integer', minimum: 1, maximum: 50},
      }}),
    readTool('campaign.lead', '/api/tools/lead', ['id'],
      "Read one company's checked packet by id: public source facts, ranking reasons, contact roles (no names), signals, proofs and drafts. Use it before any research, pitch or check about that company. Read-only.",
      {type: 'object', additionalProperties: false, properties: {id: {type: 'string'}}, required: ['id']}),
  ];

  return {register: registry => { for (const tool of tools) registry.register(tool); }, brief: () => BRIEF};
}

module.exports = {makeCampaignTools};

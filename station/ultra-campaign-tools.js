'use strict';

const {validate} = require('./shared/schema.js');

const BRIEF = "[CAMPAIGN] Campaign tools read Adem's Tunisia campaign: campaign.leads lists companies and campaign.lead gives one company's checked packet. Hand the crew the packet, never your own guesses. Nothing is ever sent: Adem reviews every draft and proposed lead in LEADS.";

function makeCampaignTools({call, isHalted}) {
  function readTool(name, path, keys, description, schema) {
    return {
      name, capability: 'campaign', scope: 'read', requiresConsent: false, description, schema,
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
          const params = new URLSearchParams();
          for (const key of keys) if (input[key] !== undefined) params.set(key, input[key]);
          const query = params.toString();
          const route = path + (query ? '?' + query : '');
          const result = await call({route, method: 'GET', body: null, version: ''});
          if (result && result.status >= 400)
            throw new Error((result.value && result.value.error) || 'Campaign worker refused the request (status ' + result.status + ').');
          return {content: JSON.stringify(result), summary: name};
        } catch (error) {
          throw new Error('Campaign tool error: ' + ((error && error.message) || String(error)));
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

'use strict';
// 1Ultra owner quest gate: before Starnet completes a quest whose contract key starts with "ultra:", the real outcome
// the owner confirmed is recorded through the campaign worker. A refusal keeps the quest open and says why.
// Only Starnet's owner routes (/api/quests/report and /api/quests/confirm) call this; agent attestation never does.
const MIN_EVIDENCE = 10;

function makeQuestGate({ call, isHalted }) {
  // opts.attest: the owner is confirming an agent's attest, which Starnet accepts only while one is pending.
  return async function questGate(quest, evidence, opts) {
    const key = quest && quest.contract && typeof quest.contract.key === 'string' ? quest.contract.key : '';
    if (!key.startsWith('ultra:')) return { ok: true };
    // A quest the store will refuse anyway (not open, or no pending attest to confirm) records nothing.
    if (quest.status !== 'open') return { ok: true };
    if (opts && opts.attest && !(quest.attest && quest.attest.confirmed == null)) return { ok: true };
    if (isHalted()) return { ok: false, error: 'The emergency stop is on: resume before confirming campaign quests.' };
    const text = String(evidence == null ? '' : evidence).trim();
    if (text.length < MIN_EVIDENCE) return { ok: false, error: 'Add what you did (date, channel, recipient), at least 10 characters.' };
    try {
      const reply = await call({ route: '/api/hooks/quest-event', method: 'POST', body: { quest_id: String(quest.id), key, evidence: text }, version: '' });
      if (!reply || reply.status >= 400) return { ok: false, error: (reply && reply.value && reply.value.error) || 'The campaign worker refused this quest.' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };
}

module.exports = { makeQuestGate, MIN_EVIDENCE };

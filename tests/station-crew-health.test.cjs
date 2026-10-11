'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const H = require('../station/ultra-crew-health.js');
const { parseVerdict } = require('../station/sidecar/routing/verdict.js');
const TIERS = { models: {
  'p/smart': { canonicalId: 'smart', tier: 'smart', tools: true, vision: false },
  'p/smart-chat': { canonicalId: 'smart-chat', tier: 'smart', tools: false, vision: false },
  'p/mid': { canonicalId: 'mid', tier: 'standard', tools: true, vision: false },
  'p/fast': { canonicalId: 'fast', tier: 'fast', tools: true, vision: false } } };
const P = id => H.normalizeProfile(H.DEFAULT_PROFILES[id]);
const done = text => ({ reason: 'done', result: text, runId: 'r1' });
const served = via => [{ status: 200, routedVia: via }];

test('default profiles follow the spec', () => {
  assert.deepEqual(P('research'), { minTier: 'smart', tools: true, vision: false, taskType: 'chat', languages: ['en', 'fr'], requiresVerdict: false });
  assert.deepEqual([P('delivery').minTier, P('sales').tools, P('sales').languages, P('qa').requiresVerdict], ['standard', false, ['fr', 'en'], true]);
  assert.deepEqual(H.ROUTING, { smart: 'auto:smart', standard: 'auto:balanced', fast: 'auto:fast' });
  assert.throws(() => H.normalizeProfile({ minTier: 'mega', taskType: 'chat' }), /minTier/);
  assert.throws(() => H.normalizeProfile({ minTier: 'smart', taskType: 'poem' }), /taskType/);
});

test('size labels map to tiers, and a model missing from the tiers counts as fast', () => {
  assert.deepEqual(['Frontier', 'Large', 'Medium', 'Small', undefined].map(H.tierFromSize), ['smart', 'smart', 'standard', 'fast', 'fast']);
  assert.equal(H.tierOf('p/mid', TIERS), 'standard');
  assert.equal(H.tierOf('p/unknown', TIERS), 'fast');
});

test('a tier is ready only with a ready model at or above it that has the tools the member needs', () => {
  assert.equal(H.tierReady(P('research'), new Set(['smart']), TIERS), true);
  assert.equal(H.tierReady(P('research'), new Set(['smart-chat', 'mid']), TIERS), false, 'research needs tools at smart');
  assert.equal(H.tierReady(P('sales'), ['smart-chat'], TIERS), true);
  assert.equal(H.tierReady(P('delivery'), ['smart'], TIERS), true, 'a smart model serves a standard member');
  assert.equal(H.tierReady(P('delivery'), ['fast'], TIERS), false);
});

test('results are classified as the spec lists', () => {
  const c = (row, receipts, id = 'research') => H.classify({ row, receipts, profile: P(id), tiers: TIERS, parseVerdict }).kind;
  assert.equal(c(null, []), 'unavailable');
  for (const reason of ['timeout', 'error', 'refused']) assert.equal(c({ reason, result: 'x' }, []), 'unavailable', reason);
  assert.equal(c(done('x'), [{ status: 429, routedVia: '' }]), 'unavailable');
  assert.equal(c(done('x'), [{ status: 0, error: 'ECONNREFUSED' }]), 'unavailable');
  assert.equal(c(done('x'), [{ status: 429 }, { status: 200, routedVia: 'p/smart' }]), 'ok', 'a later success clears an earlier 429');
  assert.equal(c({ reason: 'invalid-result', result: 'x' }, []), 'failed_check');
  assert.equal(c({ reason: 'max_iters', result: 'x' }, []), 'failed_check');
  assert.equal(c(done('x'), served('p/fast')), 'downgraded');
  assert.equal(c(done('x'), served('p/unlisted')), 'downgraded');
  assert.equal(c(done('x'), served('p/mid'), 'delivery'), 'ok');
  assert.equal(c(done('x'), served('cache')), 'ok');
  assert.equal(c(done('Looks fine.'), served('p/smart'), 'qa'), 'failed_check', 'QA must end with a verdict');
  assert.equal(c(done('Two sources checked.\nVERDICT: revise'), served('p/smart'), 'qa'), 'ok');
  assert.equal(c(done('x'), served('p/smart')), 'ok');
});

test('the ladder retries once, then reassigns to a covering ready member, then hands back to the lead', () => {
  const cands = [
    { agentId: 'delivery', profile: P('delivery'), ready: true, benched: false },
    { agentId: 'sales', profile: P('sales'), ready: true, benched: false },
    { agentId: 'qa', profile: P('qa'), ready: true, benched: false }];
  const step = (kind, retried, tried, escalate = true, candidates = cands) =>
    H.nextStep({ outcome: { kind }, needs: P('research'), retried, tried: new Set(tried), candidates, escalate });
  assert.deepEqual(step('downgraded', false, ['research']), { action: 'retry', model: 'auto:smart' });
  assert.deepEqual(step('failed_check', false, ['research']), { action: 'retry', model: 'auto:smart' });
  assert.deepEqual(step('unavailable', false, ['research']), { action: 'reassign', agentId: 'qa' }, 'only QA covers smart + tools + en/fr');
  assert.deepEqual(step('downgraded', true, ['research', 'qa']), { action: 'lead' });
  assert.deepEqual(step('downgraded', true, ['research', 'qa'], false), { action: 'fail' });
  const qaDown = cands.map(c => c.agentId === 'qa' ? Object.assign({}, c, { ready: false }) : c);
  assert.deepEqual(step('unavailable', false, ['research'], true, qaDown), { action: 'lead' });
  const qaBenched = cands.map(c => c.agentId === 'qa' ? Object.assign({}, c, { benched: true }) : c);
  assert.deepEqual(step('unavailable', false, ['research'], false, qaBenched), { action: 'fail' });
});

test('three non-ok results within 30 minutes bench a member; an ok unbenches it', () => {
  const min = 60 * 1000;
  let s = H.emptyState();
  s = H.recordOutcome(s, 'research', 'downgraded', 0);
  s = H.recordOutcome(s, 'research', 'unavailable', 10 * min);
  assert.equal(s.members.research.benched, false);
  s = H.recordOutcome(s, 'research', 'failed_check', 20 * min);
  assert.equal(s.members.research.benched, true);
  s = H.recordOutcome(s, 'research', 'ok', 21 * min);
  assert.equal(s.members.research.benched, false);
  let slow = H.emptyState();
  for (const t of [0, 20, 40]) slow = H.recordOutcome(slow, 'sales', 'unavailable', t * min);
  assert.equal(slow.members.sales.benched, false, 'three failures spread over 40 minutes do not bench');
  assert.equal(H.unbench(s, 'research').members.research.benched, false);
  assert.equal(H.MAX_MOVES, 3);
});

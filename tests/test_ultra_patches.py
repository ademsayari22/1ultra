"""Every 1Ultra patch must match exactly once in rebranded upstream, in order, and be used (offline: reads the local clone)."""
import json, subprocess, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import update_starnet as U

CLONE = Path('/home/adem/1ultra/runs/upstream/starnet')
REVISION = json.loads((ROOT / 'station/UPSTREAM.json').read_text())['revision']


def patched_upstream():
    patches = json.loads((ROOT / 'station/ultra-patches.json').read_text())
    texts = {}
    for p in patches:
        if p['file'] not in texts:
            raw = subprocess.check_output(['git', '-C', str(CLONE), 'show', f"{REVISION}:{p['file']}"], text=True)
            texts[p['file']] = U.rebrand(raw) if U.brandable(p['file']) else raw
        count = texts[p['file']].count(p['find'])
        if count != 1:
            raise AssertionError(f"{p['id']} matches {count} times in {p['file']}")
        texts[p['file']] = texts[p['file']].replace(p['find'], p['replace'])
    return texts


@unittest.skipUnless((CLONE / '.git').exists(), 'upstream clone not present')
class PatchAnchorsTest(unittest.TestCase):
    def test_every_patch_applies_once_in_order(self):
        patched_upstream()

    def test_ids_are_unique(self):
        ids = [p['id'] for p in json.loads((ROOT / 'station/ultra-patches.json').read_text())]
        self.assertEqual(len(ids), len(set(ids)))

    def test_station_copy_matches_patched_upstream(self):
        for rel, expected in patched_upstream().items():
            self.assertEqual((ROOT / 'station' / rel).read_text(), expected, f'station/{rel} differs from upstream + patches; rerun update_starnet.py')

    def test_halt_status_and_resume_include_ultra(self):
        text = (ROOT / 'station/sidecar/index.js').read_text()
        for fragment in ["ultra: { halted: ultraHost.isHalted() }", "const ultraState = haltStatus();", "k !== 'ultra'"]:
            with self.subTest(fragment=fragment):
                self.assertTrue(fragment in text, f'missing halt/resume integration: {fragment}')

    def test_every_model_request_rechecks_stop_and_switch(self):
        text = (ROOT / 'station/sidecar/index.js').read_text()
        for fn in ("async function ensureCodexAccessToken() {\n", "async function forceRefreshCodexAccessToken(staleToken) {\n"):
            self.assertIn(fn + "  ultraHost.assertModelRequest({ provider: 'codex' });", text)
        self.assertIn("fetch: ultraHost.policy.gateFetch(opts && opts.fetch, ultraCheck, ultraHost.stopSignal)", text)
        self.assertIn("return ultraHost.policy.guardAdapter(ultraBuilt, ultraCheck);", text)
        fs_tools = (ROOT / 'station/sidecar/tools/builtin/fs.js').read_text()
        self.assertIn("require('../../../ultra-policy.js').protectionActive()) ? null : await rgBinary();", fs_tools)

    def test_codex_tokens_load_only_while_lead_switch_is_on(self):
        text = (ROOT / 'station/sidecar/index.js').read_text()
        self.assertIn("function loadCodexTokens() {\n  if (!ultraHost.switches.isOn('lead.codex')) return null;", text)
        self.assertIn("{ id: 'gpt-6.1-sol'", (ROOT / 'station/sidecar/providers/codex.js').read_text())
        self.assertIn("'gpt-6.1-sol'", (ROOT / 'station/frontend/app/modeldock.js').read_text())

    def test_free_tier_wire_and_zero_cost(self):
        text = (ROOT / 'station/sidecar/index.js').read_text()
        self.assertIn('ultraHost.registerProviderConfig(setProviderRuntimeConfig);', text)
        self.assertIn("require('../ultra-crew-wire.js').freeTierUsd(ultraHost.crew.isFreeTier(activeProviderId), mediaUsd, () => effectiveRunUsd(", text)

    def test_crew_receipts_reach_the_run_record_and_run_details(self):
        index = (ROOT / 'station/sidecar/index.js').read_text()
        self.assertIn('selectProviderRaw(ultraHost.crew.adapterOptions(Object.assign({}, opts, { fetch: ultraHost.policy.gateFetch(', index)
        self.assertIn('key: runKey, baseUrl, reasoningEffort, ultraRunId: runId, ultraAgentId: agentId });', index)
        self.assertIn('ultraRouting: ultraHost.crew.receiptsFor(runId), ', index)
        self.assertIn('entry.ultraRouting = ', (ROOT / 'station/sidecar/runstore.js').read_text())
        self.assertIn("'⤳ answered by '", (ROOT / 'station/frontend/app/chat.js').read_text())

    def test_crew_run_detail_preserves_the_upstream_telemetry_guard(self):
        text = (ROOT / 'station/frontend/app/chat.js').read_text()
        start = text.index('function telemetryRun')
        self.assertLess(text.index('t.ms', start) - start, 1300)
        self.assertLess(text.index('function telemetryCrewRouting'), start)
        self.assertIn('telemetryCrewRouting(entry, wrap);', text[start:start + 1300])

    def test_team_dispatch_runs_through_the_crew_supervisor(self):
        orchestration = (ROOT / 'station/sidecar/tools/builtin/orchestration.js').read_text()
        self.assertIn('const runWorkerOnce = async (job, o2) => {', orchestration)
        self.assertIn('if (deps.crewSupervisor && !deps.crewSupervisor.accept(job, row)) return Object.assign(row, { crewHeld: true });', orchestration)
        self.assertIn('deps.crewSupervisor.supervise(job, o2, { runWorkerOnce, crew, leadId, leadProvider: provider, parentRunId: ctx && ctx.runId })', orchestration)
        index = (ROOT / 'station/sidecar/index.js').read_text()
        for needle in ('crewSupervisor: ultraHost.crew,', 'ultraHost.crew.registerTools(registry);',
                       "teamNote += '\\n' + ultraHost.crew.leadBrief();", 'ultraMoves: ultraHost.crew.movesFor(runId), '):
            self.assertIn(needle, index)
        self.assertIn("tool: 'team.health', scope: 'read', requiresConsent: false, network: false", (ROOT / 'station/sidecar/capability/registry.js').read_text())
        self.assertIn('entry.ultraMoves = ', (ROOT / 'station/sidecar/runstore.js').read_text())

    def test_crew_credentials_never_fall_back_in_dispatch_or_resume(self):
        orchestration = (ROOT / 'station/sidecar/tools/builtin/orchestration.js').read_text()
        self.assertIn('const crewProvider = deps.crewSupervisor && deps.crewSupervisor.isCrewProvider(wanted);', orchestration)
        self.assertIn("if (crewProvider) return { refused: 'the crew provider has no FreeLLMAPI credential", orchestration)
        self.assertIn("if (wire.refused) return { agentId: job.agentId, reason: 'error', result: wire.refused, usd: 0 };", orchestration)
        self.assertIn("if (wire.refused) return { status: 'error', reason: 'error', result: wire.refused, usd: 0 };", orchestration)

    def test_background_crew_completion_keeps_moves_and_note_in_result(self):
        orchestration = (ROOT / 'station/sidecar/tools/builtin/orchestration.js').read_text()
        self.assertIn('crewMoves: r.crewMoves, note: r.note,', orchestration)
        self.assertIn("result: r.result + (Array.isArray(r.crewMoves) && r.crewMoves.length && r.note ? '\\n\\n[' + r.note + ']' : ''),", orchestration)

    def test_resumed_crew_workers_check_readiness_and_acceptance(self):
        text = (ROOT / 'station/sidecar/tools/builtin/orchestration.js').read_text()
        resume = text[text.index('function resumeRunnerFor(ctx)'):text.index('const interruptTool =')]
        self.assertIn('await deps.crewSupervisor.resumeCheck(rec.agentId)', resume)
        self.assertLess(resume.index('resumeCheck(rec.agentId)'), resume.index('workerWire(ident)'))
        self.assertIn("if (!check.ready) return { status: 'error', reason: 'error', result: check.reason, usd: 0 };", resume)
        self.assertIn('deps.crewSupervisor.accept({ agentId: rec.agentId, ident }, row)', resume)
        self.assertIn('FAILED — the resumed crew result did not pass its capability check (', resume)
        self.assertIn('Unchecked crew draft (never checked work):', resume)

    def test_codex_lead_falls_back_to_the_free_tier(self):
        index = (ROOT / 'station/sidecar/index.js').read_text()
        for needle in ('ultraHost.registerCodexState(() => !!(codexTokens && codexTokens.access_token) && !codexAuthDead);',
                       "!ultraHost.crew.leadStartFallback(agentId, runProvider)",
                       "if (o.ultraLeadFreeTier) emit('provider.fallback', ",
                       'ultraHost.crew.leadFallbacks(providerId, agentId));',
                       'key: fbKey, baseUrl: fbBaseUrl, reasoningEffort, ultraRunId: runId, ultraAgentId: agentId });'):
            self.assertIn(needle, index)
        self.assertIn("ultraHost.beforeRun(o, agentRoster.get(String(o.agentId || 'agent')) || null);", index)
        self.assertIn('crew.rewriteLeadRun(o,ident);', (ROOT / 'station/ultra-host.js').read_text())

    def test_relogin_required_errors_enter_the_auth_recovery_class(self):
        error_class = (ROOT / 'station/sidecar/providers/errorClass.js').read_text()
        self.assertIn("if (err && err.reloginRequired === true) return 'auth';", error_class)

    def test_startup_token_failure_retries_only_before_inference(self):
        text = (ROOT / 'station/sidecar/index.js').read_text()
        counted = text[text.index('async function runOnceCoreCounted(o)'):text.index('async function runOnceCore(o)')]
        self.assertIn("e.code !== 'ULTRA_CODEX_START_FALLBACK'", counted)
        self.assertIn('if (restarted || !e', counted)
        self.assertIn('next = e.ultraFallback; restarted = true;', counted)
        self.assertEqual(counted.count('runOnceCore('), 1, 'one counted call site (upstream update-drain-wiring guard)')
        token = text[text.index('try { codexToken = await ensureCodexAccessToken(); }'):]
        token = token[:token.index('provider = selectProvider(')]
        self.assertIn('ultraHost.crew.rewriteLeadAuthFailure(ultraFallback)', token)
        self.assertIn("code: 'ULTRA_CODEX_START_FALLBACK', ultraFallback", token)
        self.assertLess(token.index('rewriteLeadAuthFailure'), token.index("emit('agent.run.error'"))

    def test_codex_state_patch_is_appended_after_the_original_crew_patches(self):
        ids = [p['id'] for p in json.loads((ROOT / 'station/ultra-patches.json').read_text())]
        self.assertGreater(ids.index('crew-codex-state'), ids.index('crew-provider-config'))
        self.assertGreater(ids.index('crew-codex-state'), ids.index('crew-fallback-receipts'))

    def test_ultra_templates_are_merged_and_seat_preset_desks(self):
        templates = (ROOT / 'station/frontend/app/stationtemplates.js').read_text()
        self.assertIn("require('../ultra-templates.js')", templates)
        self.assertIn('if (entry.center) {', templates)
        self.assertIn('if (seat) requireOK(station.assignDesk(placed.id, seat));', templates)
        build = (ROOT / 'station/frontend/app/build.js').read_text()
        self.assertIn("['ultra', '1ULTRA',", build)
        self.assertIn("item.group === 'ultra' ? 'ultra' : 'look'", build)
        index = (ROOT / 'station/frontend/index.html').read_text()
        self.assertLess(index.index('<script src="ultra-templates.js"></script>'), index.index('<script src="app/stationtemplates.js"></script>'))

    def test_campaign_tools_register_after_crew_tools(self):
        index = (ROOT / 'station/sidecar/index.js').read_text()
        fragment = '  ultraHost.crew.registerTools(registry);\n  ultraHost.registerCampaignTools(registry);\n'
        self.assertTrue(fragment in index, 'campaign registration must follow crew registration')

    def test_campaign_tools_ride_computer_with_their_own_capability(self):
        registry = (ROOT / 'station/sidecar/capability/registry.js').read_text()
        fragment = ("      { capId: 'compute', tool: 'model.chat', scope: 'execute', requiresConsent: false, network: true },\n"
                    '      // 1Ultra: the campaign tools ride compute, like quest.update, so ULTRA and every crew member can read the campaign.\n'
                    "      { capId: 'campaign', tool: 'campaign.leads', scope: 'read', requiresConsent: false, network: false },\n"
                    "      { capId: 'campaign', tool: 'campaign.lead', scope: 'read', requiresConsent: false, network: false },\n"
                    "      { capId: 'campaign', tool: 'campaign.check_draft', scope: 'read', requiresConsent: false, network: false },\n"
                    "      { capId: 'campaign', tool: 'campaign.save_draft', scope: 'write', requiresConsent: false, network: false },\n"
                    "      { capId: 'campaign', tool: 'campaign.propose_lead', scope: 'write', requiresConsent: false, network: false },\n")
        self.assertTrue(fragment in registry, 'campaign read grants must ride computer with their own capId')

    def test_campaign_brief_follows_crew_brief_only_when_tool_is_available(self):
        index = (ROOT / 'station/sidecar/index.js').read_text()
        fragment = ("    if (resolved.tools.includes('team.health')) teamNote += '\\n' + ultraHost.crew.leadBrief();\n"
                    "    if (resolved.tools.includes('campaign.lead')) teamNote += '\\n' + ultraHost.campaignBrief();\n")
        self.assertTrue(fragment in index, 'campaign brief must follow crew brief and check tool availability')

    def test_campaign_tool_patches_are_appended_after_templates(self):
        ids = [p['id'] for p in json.loads((ROOT / 'station/ultra-patches.json').read_text())]
        self.assertEqual(ids[-3:], ['campaign-tools-register', 'campaign-tools-capability', 'campaign-tools-brief'])
        self.assertGreater(ids.index('campaign-tools-register'), ids.index('ultra-templates-script'))

    def test_campaign_tool_http_routes_are_refused_before_body_or_bridge(self):
        host = (ROOT / 'station/ultra-host.js').read_text()
        handler = host[host.index('async function handle(req,res){'):]
        refusal = "if(p.startsWith('/api/ultra/tools/'))return json(res,404,{error:'Not found.'});"
        self.assertTrue(refusal in handler, 'private tool routes must be refused by the HTTP handler')
        self.assertLess(handler.index(refusal), handler.index('const body='))
        self.assertLess(handler.index(refusal), handler.index('const response=await call(request);'))
        self.assertIn("const campaignTools=require('./ultra-campaign-tools.js').makeCampaignTools({call,isHalted});", host)
        self.assertIn('registerCampaignTools:registry=>campaignTools.register(registry)', host)
        self.assertIn('campaignBrief:()=>campaignTools.brief()', host)


if __name__ == '__main__':
    unittest.main()

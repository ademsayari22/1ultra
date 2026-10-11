# Upstream fast-test baseline

Run on 10 October 2026 against Starnet `54899e5` as adapted for 1Ultra (Phase 1), with the same per-step isolation as upstream `scripts/run-test-list.mjs` (temporary HOME and data folders). The real `runs/station-runtime` was snapshotted before and after: unchanged.

**1101 steps: 955 passed, 146 failed.** Every failure has one of the reasons below; none is unexplained.

Rerun on 10 October 2026 after Stage 1a (ULTRA on Codex and the safety rails): the same 1101 steps, 955 passed, and the same 146 steps failed for the same reasons; the real `runs/station-runtime` was again unchanged. The first Stage 1a run found one new failure, `test/failopen-ratchet.test.js`: the emergency-stop hook added one silent `catch`. It now reports through Starnet's `failNote` (`ultra.station-halt.killAll`), and the ratchet passes.

Rerun on 11 October 2026 after Stage 1b (the crew on FreeLLMAPI): the same 1101 steps, 955 passed, and the same 146 steps failed for the same reasons; the real `runs/station-runtime` was unchanged. Two Stage 1b runs found one new failure each, both source-pattern guards, and both were fixed rather than excused. `test/comms-presence.test.js` needs the per-tool duration within 1300 characters of `function telemetryRun`; the "answered by" line now comes from a helper defined before that function. `test/update-drain-wiring.test.js` allows only two bare `runOnceCore(` mentions; the free-tier restart after a failed Codex sign-in now goes through the same single counted call, at most once.

Rerun on 11 October 2026 after Stage 2 (the 1ULTRA COMMAND layout, room templates, campaign tools and LEADS): 1101 steps, 951 passed and 150 failed: the same 146, plus four `patch` failures listed below; the real `runs/station-runtime` was unchanged. The first Stage 2 run also failed `test/inputpolicy.test.js`, which requires every tool family on the computer to be a freebie or a toggleable toolset; the campaign tools are now the toggleable **1ULTRA CAMPAIGN** toolset, and that test passes.

| Reason | Failures | Meaning |
|---|---|---|
| `excluded-tooling` | 89 | reads website/, src-tauri/, .github/, qa/, dev/, relay/, bin/, release or eval files that are not imported |
| `brand` | 25 | asserts the exact upstream "StarNet" wording that the display rebrand changed |
| `excluded-art` | 18 | reads frontend/assets or review pages (Starnet art is not imported; Phase 2 adds CC0 art) |
| `dependency` | 6 | needs ogg-opus-decoder, sharp, @napi-rs/canvas or a Chrome binary, not installed in Phase 1 |
| `policy` | 6 | calls a route refused while its owner switch is off |
| `patch` | 6 | asserts upstream behavior a listed 1Ultra patch changes |

Two real defects were found by this run and fixed before recording it: test-started servers used the owner runtime and port (now only a deliberate `ULTRA_ROOT` launch does), and the Outbox file route and the station event bridge were wrongly switch-gated (now local).

## Failing steps

| Step | Reason | Note |
|---|---|---|
| `test/chat-file-drop.test.js` | `excluded-tooling` |  |
| `test/harness-stream-completion.test.js` | `excluded-tooling` |  |
| `test/diagnostics-build.test.js` | `excluded-tooling` |  |
| `test/mac-boot-compat.test.js` | `excluded-art` |  |
| `test/budget-stop-door.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/configexport.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/test-list-runner.test.js` | `excluded-tooling` |  |
| `test/agent-eval.test.js` | `excluded-tooling` |  |
| `test/eval-campaign-preflight.test.js` | `excluded-tooling` | eval fixtures (.jsonl) are not imported |
| `test/eval-fixture-host.test.mjs` | `excluded-tooling` |  |
| `test/eval-parity-offline.test.js` | `excluded-tooling` |  |
| `test/media-service.test.js` | `dependency` |  |
| `test/desktop-voice-bundle.test.js` | `excluded-tooling` |  |
| `test/provider.registry.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/friendlyerror.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/apps.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/updatecore.test.js` | `excluded-tooling` |  |
| `test/desktop-lifecycle-preferences.test.js` | `excluded-tooling` |  |
| `test/desktop-installed-cdp-forwarding.test.js` | `excluded-tooling` |  |
| `test/desktop-fresh-start-contract.test.js` | `excluded-tooling` |  |
| `test/datareset.test.js` | `excluded-tooling` |  |
| `test/hudmode.test.js` | `excluded-tooling` |  |
| `test/phase5.runner.test.js` | `excluded-tooling` | loop specs live in docs/, not imported |
| `test/t0-clean-install.test.js` | `excluded-tooling` |  |
| `test/packaged-lifecycle.test.js` | `excluded-tooling` |  |
| `test/soak.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/desktop-workspace-migration.test.js` | `excluded-tooling` |  |
| `test/t1-signing.test.js` | `excluded-tooling` |  |
| `test/upgrade-085-090.test.js` | `excluded-tooling` |  |
| `test/t3-release-smoke.test.js` | `excluded-tooling` |  |
| `test/t4-update-delivery.test.js` | `excluded-tooling` |  |
| `test/installer-upgrade-resilience.test.js` | `excluded-tooling` |  |
| `test/t5-public-distribution.test.js` | `excluded-tooling` |  |
| `test/minisign-verify.test.js` | `excluded-tooling` |  |
| `test/sidecar.security.test.js` | `policy` | /api/fs/dirstat (folder picker) follows tools.shell |
| `test/tauri.hardening.test.js` | `excluded-tooling` |  |
| `test/workshop-undo.e2e.test.js` | `policy` | away-workshop builds need a model (lead.codex / nightshift) |
| `test/workshop-implement.e2e.test.js` | `policy` | away-workshop builds need a model (lead.codex / nightshift) |
| `test/browser-held-profile.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/skill-market-catalog.test.js` | `excluded-tooling` |  |
| `test/skill-uploads-pull.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/skill-market-tools.test.js` | `excluded-tooling` |  |
| `test/saveversion.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/schema-stamp.test.js` | `patch` | ultra-seed writes agent.roster.json on first boot of an empty runtime |
| `test/update-state-parity.test.js` | `excluded-tooling` |  |
| `test/run-recovery-ui.test.js` | `excluded-tooling` |  |
| `test/deliverables-open.test.js` | `excluded-tooling` |  |
| `test/qa-bug-lifecycle.test.js` | `excluded-tooling` |  |
| `test/qa-bugs-register.test.js` | `excluded-tooling` |  |
| `test/qa-guardian.test.js` | `excluded-tooling` |  |
| `test/qa-product-perfect.test.js` | `excluded-tooling` |  |
| `test/qa-product-perfect-claims.test.js` | `excluded-tooling` |  |
| `test/website-pricing-hold.test.js` | `excluded-tooling` |  |
| `test/website-docs-navigation.test.js` | `excluded-tooling` |  |
| `test/website-skill-market.test.js` | `excluded-tooling` |  |
| `test/browser.login-seed.test.js` | `excluded-tooling` |  |
| `test/image-task.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/onboard-fresh-launcher.test.js` | `excluded-tooling` |  |
| `test/codex-configured.test.js` | `excluded-tooling` |  |
| `test/crt-context-loss.e2e.test.mjs` | `excluded-tooling` |  |
| `test/recipes.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/autonomy-confirmation.http.test.js` | `policy` | autonomy routes follow the nightshift switch |
| `test/autojobs.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/simulation-lighting.test.js` | `excluded-tooling` |  |
| `test/room-lighting-settings.test.js` | `excluded-tooling` |  |
| `test/world-agent-click.test.js` | `excluded-tooling` |  |
| `test/world-sharpen.test.mjs` | `dependency` |  |
| `test/world-immersion-characters.test.js` | `excluded-art` |  |
| `test/worldlight-receiver.test.mjs` | `dependency` |  |
| `test/state-truth-overlap.test.js` | `excluded-tooling` |  |
| `test/agent-model-select.test.js` | `excluded-tooling` |  |
| `test/provider-connections-ui.test.js` | `excluded-tooling` |  |
| `test/retry-user-transcript.http.test.js` | `policy` | /api/run follows lead.codex |
| `test/ctx-model-catalog.test.js` | `excluded-tooling` |  |
| `test/ctx-conversation-scope.test.js` | `excluded-tooling` |  |
| `test/acp-core.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/orchestration.test.js` | `excluded-tooling` |  |
| `test/idle-life-regressions.test.js` | `excluded-tooling` |  |
| `test/stationbake.connections.test.mjs` | `dependency` |  |
| `test/sprite-sit-facing.test.js` | `excluded-art` |  |
| `test/channels.telegram.pairing-ux.test.js` | `excluded-tooling` |  |
| `test/channels.telegram.groups.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/channels.secrets.test.js` | `excluded-tooling` |  |
| `test/channels.setup-guide.test.js` | `excluded-tooling` |  |
| `test/cross-surface-continuity.test.js` | `excluded-tooling` |  |
| `test/google-connector.test.js` | `excluded-tooling` |  |
| `test/mcp.catalog.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/connector-reliability-wiring.test.js` | `excluded-tooling` |  |
| `test/mcp-serve.test.js` | `policy` | channel routes follow the channel switches |
| `test/connectors-ui.test.js` | `excluded-tooling` |  |
| `test/brand-wordmark-mask.test.js` | `brand` | 1Ultra wordmark SVG uses text, the test expects path geometry |
| `test/sprite-loading.test.js` | `excluded-art` |  |
| `test/toast-live-region.test.js` | `excluded-tooling` |  |
| `test/toast-seat.test.js` | `excluded-tooling` |  |
| `test/poweruser-shell-repairs.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/release-bump.test.js` | `excluded-tooling` |  |
| `test/release-cut.test.js` | `excluded-tooling` |  |
| `test/release-preflight.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/release-ritual.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/opensource-readiness.test.js` | `excluded-tooling` |  |
| `test/source-release-mirror.test.js` | `excluded-tooling` | release mirror conventions |
| `test/release-train-chrome-warmup.test.js` | `excluded-tooling` |  |
| `test/release-train-provenance.test.js` | `excluded-tooling` |  |
| `test/frontend-dist-staging.test.js` | `excluded-art` |  |
| `test/desktop-build-macos-notarization.test.js` | `excluded-tooling` |  |
| `test/desktop-build-macos-python-host.test.js` | `excluded-tooling` |  |
| `test/desktop-artifact-open.test.js` | `excluded-tooling` |  |
| `test/release-train-macos-trust.test.js` | `excluded-tooling` |  |
| `test/release-train-windows-trust.test.js` | `excluded-tooling` |  |
| `test/release-contract-docs.test.js` | `excluded-tooling` |  |
| `test/website-deploy-staging.test.js` | `excluded-tooling` |  |
| `test/website-app-sync.test.js` | `excluded-tooling` |  |
| `test/website-live-preview.test.js` | `excluded-tooling` |  |
| `test/font.law.test.js` | `excluded-art` |  |
| `test/sprite-assets.test.js` | `excluded-art` |  |
| `test/sprite-walk-motion.test.js` | `excluded-art` |  |
| `test/sprite-detached-prop.test.js` | `excluded-art` |  |
| `test/station-builder.test.js` | `brand` | the refusal wording says 1Ultra; since Stage 2 its preset-menu assertion also sees the added 1ULTRA COMMAND preset. Every kit invariant, including the six 1Ultra room kits, passes |
| `test/free-path-ollama.test.js` | `brand` | expects "LINK STARNET"; also reads the unimported README.md |
| `test/keycta-recovery.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/process-fault.test.js` | `patch` | no-trigger-poll: the folder-trigger timer is off until the cron switch |
| `test/station-templates.test.js` | `patch` | asserts exactly seven station presets; 1Ultra adds 1ULTRA COMMAND |
| `test/capgate.test.js` | `patch` | asserts the computer's exact tool list; the campaign tools ride the computer |
| `test/harness.integration.test.js` | `patch` | asserts the computer's exact tool list; the campaign tools ride the computer |
| `test/routing.b5.test.js` | `patch` | asserts the computer's exact tool list; the campaign tools ride the computer |
| `test/value-loop-replay.test.mjs` | `excluded-tooling` |  |
| `test/session-typing-safety.test.js` | `excluded-tooling` |  |
| `test/session-continuity.test.js` | `excluded-tooling` |  |
| `test/session-reliability.e2e.test.js` | `excluded-tooling` |  |
| `test/sprite-direction-details.test.js` | `excluded-art` |  |
| `test/authored-prop-content.test.js` | `excluded-art` |  |
| `test/authored-machine-config.test.js` | `excluded-art` |  |
| `test/authored-service-content.test.js` | `excluded-art` |  |
| `test/coordinated-prop-recipes.test.js` | `excluded-tooling` |  |
| `test/prop-layout-polish.test.js` | `excluded-tooling` |  |
| `test/skin-study-preview.test.js` | `excluded-art` |  |
| `test/projection-prop-effects.test.js` | `excluded-art` |  |
| `test/projection-load-geometry.test.js` | `dependency` |  |
| `dev/industrial-textures/prop-catalog-review.test.cjs` | `excluded-tooling` |  |
| `test/projection-depth-rendering.test.js` | `dependency` |  |
| `test/remaster-physical-fit.test.js` | `excluded-art` |  |
| `test/industrial-shells.test.js` | `excluded-art` |  |
| `test/budget-authority-ui.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/settle-managed-copy.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/cli.test.js` | `excluded-tooling` |  |
| `test/cli.stop-child.test.js` | `excluded-tooling` |  |
| `test/manual.on-demand.test.js` | `brand` | passes on an unbranded copy of the same build |
| `test/remote.core.test.js` | `excluded-tooling` |  |
| `test/remote.relay.test.js` | `excluded-tooling` |  |
| `test/remote-view.test.js` | `excluded-art` |  |

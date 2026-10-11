# FreeLLMAPI for 1Ultra's crew

[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) (MIT) pools free model accounts behind one OpenAI-compatible address. 1Ultra runs it locally on `127.0.0.1` for the crew; ULTRA stays on Codex.

- `PIN` is the FreeLLMAPI commit 1Ultra installs.
- `app/` is that checkout and its build, and `state/` is its database, encryption key and dashboard login. Both are git-ignored, and agents cannot read either.
- Manage it with `python3 scripts/freellmapi.py install | start | stop | status | key | tiers | admin`. `docs/ops/STATION.md` has the full steps.
- It starts with OVH AI Endpoints' keyless access (2 requests per minute per model, slow). Free keys you add on its Keys page make it faster.
- Its own background traffic: key health checks (no prompts), a catalog fetch from `api.freellmapi.co` every 12 hours (no prompts), and no update checks. It keeps request metadata (not message bodies) for 90 days in its database.

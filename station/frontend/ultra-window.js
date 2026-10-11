/* 1Ultra's classic campaign, owner switches and future room templates. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;
  const esc = StationUI.h.esc;
  StationUI.registerWindow('campaign', 'CAMPAIGN', body => {
    body.innerHTML = '<iframe class="ultra-frame" src="/campaign/#campaign" title="1Ultra Tunisia campaign"></iframe>';
  }, { console: true, className: 'ultra-campaign-win' });

  StationUI.registerWindow('ultra-room-templates', 'ROOM TEMPLATES', body => {
    if (typeof UltraTemplates === 'undefined') {
      body.innerHTML = '<div class="ultra-rt"><p class="dim">Room templates are unavailable. Reopen the station.</p></div>';
      return;
    }
    body.innerHTML = '<div class="ultra-rt"><p class="dim">Station presets and rooms ULTRA can add for future work.</p>'
      + UltraTemplates.catalog.map(p => '<section class="ultra-rt-row"><h3>' + esc(p.name) + '</h3><p>' + esc(p.description)
        + '</p><button type="button" class="bb sm" data-ultra-rt-action="presets">Open station presets</button></section>').join('')
      + Object.entries(UltraTemplates.rooms).map(([key, kit]) => '<section class="ultra-rt-row"><h3>' + esc(kit.name)
        + '</h3><p class="dim">' + esc(UltraTemplates.kitAbout[key] || '') + '</p><button type="button" class="bb sm"'
        + ' data-ultra-rt-action="ask" data-kit="' + esc(key) + '">Ask ULTRA to add</button></section>').join('')
      + '<p class="dim ultra-rt-status" role="status" aria-live="polite"></p></div>';
    const root = body.querySelector('.ultra-rt'), status = body.querySelector('.ultra-rt-status');
    root.addEventListener('click', event => {
      const action = event.target.closest('[data-ultra-rt-action]');
      if (!action) return;
      try {
        if (action.dataset.ultraRtAction === 'presets') {
          if (typeof Build !== 'undefined' && Build.open && Build.isOpen && !Build.isOpen()) Build.open();
          const presets = document.getElementById('refit-stations');
          if (presets) { presets.click(); status.textContent = ''; }
          else status.textContent = 'Open BUILD → BUILD MODE → Presets, then choose 1ULTRA COMMAND.';
        } else if (action.dataset.ultraRtAction === 'ask') {
          const kit = UltraTemplates.rooms[action.dataset.kit];
          if (!kit) return;
          if (typeof Workstreams === 'undefined' || !Workstreams.generalId || !Workstreams.generalId()
            || typeof App === 'undefined' || !App.openWorkstream || typeof Chat === 'undefined' || !Chat.prefill)
            throw new Error('ULTRA’s General session is unavailable. Reopen the station.');
          App.openWorkstream(Workstreams.generalId());
          if (StationUI.h.workConversation) StationUI.h.workConversation('ultra-room-templates');
          Chat.prefill('Add the ' + kit.name + ' room template beside the station.');
        }
      } catch (e) { status.textContent = e.message; }
    });
  }, { console: true, className: 'ultra-room-templates-win' });

  async function api(method, payload, version) {
    const headers = { 'X-Starnet-Token': window.__STARNET_API_TOKEN__ || '' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['If-Match'] = version || ''; }
    const r = await fetch('/api/ultra/switches', { method, headers, body: payload ? JSON.stringify(payload) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  function control(s) {
    const dis = s.ready ? '' : ' disabled';
    if (s.type === 'bool') return '<input type="checkbox" data-switch="' + esc(s.id) + '"' + (s.value ? ' checked' : '') + dis + '>';
    return '<input type="number" data-switch="' + esc(s.id) + '" value="' + esc(String(s.value)) + '" min="' + esc(String(s.min)) + '" max="' + esc(String(s.max)) + '" step="' + (s.type === 'int' ? '1' : '0.01') + '"' + dis + '>';
  }
  function row(s) {
    const note = s.ready ? (s.needs ? (s.id === 'lead.codex' ? '' : 'Needs: ') + s.needs : '') : 'Not available yet' + (s.needs ? ' · needs: ' + s.needs : '');
    return '<label class="ultra-sw-row"><span class="ultra-sw-label"><b>' + esc(s.label) + '</b><small>' + esc(s.id) + (note ? ' · ' + esc(note) : '') + '</small></span>' + control(s) + '</label>';
  }
  function crewText(s) {
    if (!s.wire || !s.wire.configured) return 'not set up: run python3 scripts/freellmapi.py start, then key';
    if (!s.switch) return 'set up; turn on crew.freellmapi to use the crew';
    if (!s.reachable) return 'not running: python3 scripts/freellmapi.py start';
    if (!s.keyAccepted) return 'key rejected: python3 scripts/freellmapi.py key';
    const members = Array.isArray(s.members) ? s.members : [];
    return s.readyModels + ' ready model' + (s.readyModels === 1 ? '' : 's') + ' · ' + members.filter(m => m.ready).length + ' of ' + members.length + ' crew ready'
      + (s.tiersSeeded ? '' : ' · run python3 scripts/freellmapi.py tiers');
  }
  async function crewLine(body) {
    const input = body.querySelector('[data-switch="crew.freellmapi"]');
    if (!input) return;
    const line = document.createElement('p'); line.className = 'dim ultra-crew-status'; line.textContent = 'FreeLLMAPI: checking…';
    input.closest('label').after(line);
    try {
      const r = await fetch('/api/ultra/crew', { headers: { 'X-Starnet-Token': window.__STARNET_API_TOKEN__ || '' } });
      if (!r.ok) { line.textContent = 'FreeLLMAPI: status unavailable (HTTP ' + r.status + ')'; return; }
      line.textContent = 'FreeLLMAPI: ' + crewText(await r.json());
    } catch (e) { line.textContent = 'FreeLLMAPI: status unavailable (' + e.message + ')'; }
  }
  async function build(body) {
    body.innerHTML = '<div class="ultra-sw"><p class="dim">Loading switches…</p></div>';
    let data;
    try { data = await api('GET'); } catch (e) { body.innerHTML = '<div class="ultra-sw"><p class="bad">' + esc(e.message) + '</p></div>'; return; }
    body.innerHTML = '<div class="ultra-sw"><p>Only you can change these. Agents can read them. Emergency stop overrides every switch.</p><p class="bad ultra-sw-error"' + (data.problem ? '>' + esc(data.problem) : ' hidden>') + '</p>'
      + data.switches.map(row).join('')
      + '<p class="dim ultra-credit">1Ultra is built on the MIT-licensed StarNet code by Andrew Sims. It is not affiliated with or endorsed by StarNet.</p></div>';
    body.querySelectorAll('[data-switch]').forEach(input => input.addEventListener('change', async () => {
      const id = input.dataset.switch, value = input.type === 'checkbox' ? input.checked : Number(input.value);
      try { await api('POST', { id, value }, data.version); }
      catch (e) { const err = body.querySelector('.ultra-sw-error'); err.textContent = e.message; err.hidden = false; return; }
      build(body);
    }));
    crewLine(body);
  }
  StationUI.registerWindow('ultra-switches', 'SWITCHES', build, { console: true, className: 'ultra-switches-win' });
})();

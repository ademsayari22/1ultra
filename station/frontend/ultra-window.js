/* 1Ultra windows inside the station: the Tunisia campaign (its own page, framed) and the owner switches. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;
  const esc = StationUI.h.esc;
  StationUI.registerWindow('campaign', 'CAMPAIGN', body => {
    body.innerHTML = '<iframe class="ultra-frame" src="/campaign/#campaign" title="1Ultra Tunisia campaign"></iframe>';
  }, { console: true, className: 'ultra-campaign-win' });

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
    const note = s.ready ? (s.needs ? 'Needs: ' + s.needs : '') : 'Not available yet' + (s.needs ? ' · needs: ' + s.needs : '');
    return '<label class="ultra-sw-row"><span class="ultra-sw-label"><b>' + esc(s.label) + '</b><small>' + esc(s.id) + (note ? ' · ' + esc(note) : '') + '</small></span>' + control(s) + '</label>';
  }
  async function build(body) {
    body.innerHTML = '<div class="ultra-sw"><p class="dim">Loading switches…</p></div>';
    let data;
    try { data = await api('GET'); } catch (e) { body.innerHTML = '<div class="ultra-sw"><p class="bad">' + esc(e.message) + '</p></div>'; return; }
    body.innerHTML = '<div class="ultra-sw"><p>Only you can change these. Agents can read them. Emergency stop overrides every switch.</p><p class="bad ultra-sw-error" hidden></p>'
      + data.switches.map(row).join('')
      + '<p class="dim ultra-credit">1Ultra is built on the MIT-licensed StarNet code by Andrew Sims. It is not affiliated with or endorsed by StarNet.</p></div>';
    body.querySelectorAll('[data-switch]').forEach(input => input.addEventListener('change', async () => {
      const id = input.dataset.switch, value = input.type === 'checkbox' ? input.checked : Number(input.value);
      try { await api('POST', { id, value }, data.version); }
      catch (e) { const err = body.querySelector('.ultra-sw-error'); err.textContent = e.message; err.hidden = false; return; }
      build(body);
    }));
  }
  StationUI.registerWindow('ultra-switches', 'SWITCHES', build, { console: true, className: 'ultra-switches-win' });
})();

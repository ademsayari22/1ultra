const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const Policy = require('../station/ultra-policy.js');
const { makePathTrust } = require('../station/sidecar/pathtrust.js');
test('path trust refuses 1Ultra project files even in Full Power, symlinks included', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-pt-')));
  const runtime = path.join(root, 'runs', 'station-runtime');
  fs.mkdirSync(path.join(runtime, 'agent'), { recursive: true }); fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'leads.json'), '[]');
  fs.symlinkSync(path.join(root, 'data'), path.join(runtime, 'agent', 'link'));
  Policy.setProtectedRoots({ root, runtime });
  try {
    const pt = makePathTrust({ fsp, pathMod: path, workspaceRoot: runtime });
    const full = { scope: 'read', unrestrictedHost: true, agentId: 'agent' };
    for (const target of [path.join(root, 'data', 'leads.json'), path.join(runtime, 'agent', 'link', 'leads.json')])
      await assert.rejects(pt.guard(target, full), /off-limits/, target);
    // Full Power never reaches the owner's switches, the stop, the ChatGPT tokens or another agent's workspace.
    for (const target of ['ultra-switches.json', 'ultra-control.json', path.join('codex', 'tokens.json'), path.join('other', 'x.md')])
      for (const scope of ['read', 'write'])
        await assert.rejects(pt.guard(path.join(runtime, target), { ...full, scope }), /off-limits/, scope + ' ' + target);
    const own = await pt.guard(path.join(runtime, 'agent', 'note.md'), full);
    assert.equal(own.unrestrictedHost, true);
  } finally { Policy.setProtectedRoots(null); fs.rmSync(root, { recursive: true, force: true }); }
});

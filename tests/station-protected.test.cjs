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
    for (const target of [path.join(root, 'data', 'leads.json'), path.join(runtime, 'agent', 'link', 'leads.json')])
      await assert.rejects(pt.guard(target, { scope: 'read', unrestrictedHost: true }), /off-limits/, target);
    const own = await pt.guard(path.join(runtime, 'agent', 'note.md'), { scope: 'read', unrestrictedHost: true });
    assert.equal(own.unrestrictedHost, true);
  } finally { Policy.setProtectedRoots(null); }
});

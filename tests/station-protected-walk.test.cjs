// Recursive agent file tools (fs.search, fs.list recursive) skip 1Ultra project files entry by entry, even in Full Power.
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const Policy = require('../station/ultra-policy.js');
const { makePathTrust } = require('../station/sidecar/pathtrust.js');
const { makeFsTools } = require('../station/sidecar/tools/builtin/fs.js');

const MARKER = 'ULTRA-WALK-MARKER-7f3';
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-walk-')));
  const root = path.join(base, 'project'), runtime = path.join(root, 'runs', 'station-runtime');
  fs.mkdirSync(path.join(runtime, 'agent'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data')); fs.mkdirSync(path.join(base, 'other'));
  fs.writeFileSync(path.join(root, 'data', 'leads.json'), '["' + MARKER + ' lead"]\n');
  fs.writeFileSync(path.join(runtime, 'ultra-switches.json'), '{"note":"' + MARKER + ' switches"}\n');
  fs.writeFileSync(path.join(runtime, 'agent', 'own.txt'), MARKER + ' own\n');
  fs.writeFileSync(path.join(base, 'other', 'notes.txt'), MARKER + ' public\n');
  fs.symlinkSync(path.join(root, 'data'), path.join(runtime, 'agent', 'link'));
  return { base, root, runtime };
}
function tools(runtime) {
  const pt = makePathTrust({ fsp, pathMod: path, workspaceRoot: runtime });
  const pathTrust = (abs, o) => pt.guard(abs, { scope: (o && o.scope) || 'read', agentId: (o && o.agentId) || 'agent', fullAccess: true, unrestrictedHost: true });
  return makeFsTools({ fsp, pathMod: path, root: runtime, limits: { writeBytes: 1 << 20, readReturn: 24000 }, pathTrust });
}
const text = r => String(r && (r.content != null ? r.content : r));

test('fs.search from a folder containing the project skips project files and station files', async () => {
  const { base, root, runtime } = fixture();
  Policy.setProtectedRoots({ root, runtime });
  try {
    const t = tools(runtime), ctx = { agentId: 'agent' };
    const hits = text(await t.searchTool.run({ query: MARKER, path: base }, ctx));
    assert.match(hits, /public/, 'unprotected files are still searched');
    for (const word of ['lead', 'switches']) assert.doesNotMatch(hits, new RegExp(MARKER + ' ' + word), word);
    const files = text(await t.searchTool.run({ query: '*.json', target: 'files', path: base }, ctx));
    assert.doesNotMatch(files, /leads\.json|ultra-switches\.json/);
    const own = text(await t.searchTool.run({ query: MARKER }, ctx));
    assert.match(own, /own/, 'the agent still searches its own workspace');
    assert.doesNotMatch(own, new RegExp(MARKER + ' lead'), 'a link from the workspace into the project is skipped');
  } finally { Policy.setProtectedRoots(null); fs.rmSync(base, { recursive: true, force: true }); }
});

test('fs.list recursive from a folder containing the project lists no project or station files', async () => {
  const { base, root, runtime } = fixture();
  Policy.setProtectedRoots({ root, runtime });
  try {
    const t = tools(runtime), ctx = { agentId: 'agent' };
    const listed = text(await t.listTool.run({ path: base, recursive: true }, ctx));
    assert.match(listed, /other\/notes\.txt/, 'unprotected entries are still listed');
    assert.doesNotMatch(listed, /leads\.json|ultra-switches\.json|data\//);
    const own = text(await t.listTool.run({ recursive: true }, ctx));
    assert.match(own, /own\.txt/);
    assert.doesNotMatch(own, /link\/|leads\.json/, 'a link from the workspace into the project is not listed or descended');
  } finally { Policy.setProtectedRoots(null); fs.rmSync(base, { recursive: true, force: true }); }
});

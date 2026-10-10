import hashlib, json, subprocess, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import update_starnet as U


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


class UpdateStarnetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); base = Path(self.tmp.name)
        self.repo = base / 'upstream'; self.dest = base / 'station'
        files = {
            'sidecar/index.js': "'use strict';\nconst label = 'StarNet ready';\n",
            'frontend/index.html': '<title>STARNET</title><p>Starnet station</p>',
            'frontend/app/a.js': "show('StarNet'); key('starnet.save'); env('STARNET_PORT');\n",
            'frontend/prop-atlas.html': '<p>review page</p>',
            'frontend/dev/review.html': '<p>dev</p>',
            'frontend/assets/brand/logo.svg': '<svg/>',
            'test/a.test.js': "assert('StarNet');\n",
            'LICENSE': 'MIT StarNet\n', 'NOTICE.md': 'StarNet credits\n',
            'package.json': '{"name":"starnet-harness"}\n', 'website/index.html': 'site',
        }
        self.repo.mkdir()
        git(self.repo, 'init', '-q'); git(self.repo, 'config', 'user.email', 't@t'); git(self.repo, 'config', 'user.name', 't')
        for name, text in files.items():
            p = self.repo / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)
        git(self.repo, 'add', '-A'); git(self.repo, 'commit', '-qm', 'fixture')
        self.rev = git(self.repo, 'rev-parse', 'HEAD')
        self.patches = [{'id': 'host', 'file': 'sidecar/index.js', 'find': "'use strict';\n",
                         'replace': "'use strict';\nconst ultraHost = require('../ultra-host.js');\n"}]

    def tearDown(self): self.tmp.cleanup()

    def run_export(self, patches=None):
        return U.export(self.repo, self.rev, self.dest, self.patches if patches is None else patches)

    def test_copies_code_but_not_art_review_pages_dev_or_website(self):
        self.run_export()
        for rel in ['sidecar/index.js', 'frontend/index.html', 'frontend/app/a.js', 'test/a.test.js', 'LICENSE', 'NOTICE.md', 'package.upstream.json']:
            self.assertTrue((self.dest / rel).is_file(), rel)
        for rel in ['frontend/prop-atlas.html', 'frontend/dev/review.html', 'frontend/assets/brand/logo.svg', 'website/index.html', 'package.json']:
            self.assertFalse((self.dest / rel).exists(), rel)

    def test_rebrands_display_words_only(self):
        self.run_export()
        self.assertEqual((self.dest / 'frontend/app/a.js').read_text(), "show('1Ultra'); key('starnet.save'); env('STARNET_PORT');\n")
        self.assertEqual((self.dest / 'frontend/index.html').read_text(), '<title>1ULTRA</title><p>1Ultra station</p>')
        self.assertEqual((self.dest / 'LICENSE').read_text(), 'MIT StarNet\n')
        self.assertEqual((self.dest / 'NOTICE.md').read_text(), 'StarNet credits\n')

    def test_applies_patch_and_records_adaptations(self):
        manifest = self.run_export()
        self.assertIn("const ultraHost = require('../ultra-host.js');", (self.dest / 'sidecar/index.js').read_text())
        adapted = {a['path']: a for a in manifest['adaptations']}
        self.assertEqual(adapted['sidecar/index.js']['reasons'], ['brand', 'patch:host'])
        self.assertEqual(adapted['sidecar/index.js']['current_sha256'], hashlib.sha256((self.dest / 'sidecar/index.js').read_bytes()).hexdigest())
        self.assertNotIn('LICENSE', adapted)
        self.assertEqual(json.loads((self.dest / 'UPSTREAM.json').read_text())['revision'], self.rev)
        row = next(r for r in manifest['files'] if r['path'] == 'package.json')
        self.assertEqual(row['source_copy_path'], 'package.upstream.json')

    def test_patch_must_match_exactly_once(self):
        with self.assertRaisesRegex(RuntimeError, 'expects one match'):
            self.run_export([{'id': 'missing', 'file': 'sidecar/index.js', 'find': 'nope', 'replace': 'x'}])

    def test_unused_patch_is_an_error(self):
        with self.assertRaisesRegex(RuntimeError, 'never applied'):
            self.run_export(self.patches + [{'id': 'ghost', 'file': 'sidecar/gone.js', 'find': 'a', 'replace': 'b'}])

    def test_owned_files_are_preserved_and_stale_upstream_files_removed(self):
        (self.dest / 'frontend/campaign').mkdir(parents=True)
        (self.dest / 'ultra-host.js').write_text('owned')
        (self.dest / 'frontend/campaign/index.html').write_text('campaign')
        (self.dest / 'sidecar').mkdir()
        (self.dest / 'sidecar/removed-upstream.js').write_text('old')
        (self.dest / 'UPSTREAM.json').write_text(json.dumps({'files': [{'path': 'sidecar/removed-upstream.js'}]}))
        self.run_export()
        self.assertEqual((self.dest / 'ultra-host.js').read_text(), 'owned')
        self.assertEqual((self.dest / 'frontend/campaign/index.html').read_text(), 'campaign')
        self.assertFalse((self.dest / 'sidecar/removed-upstream.js').exists())

    def test_rerun_is_idempotent(self):
        self.run_export(); first = {p: p.read_bytes() for p in self.dest.rglob('*') if p.is_file()}
        self.run_export(); second = {p: p.read_bytes() for p in self.dest.rglob('*') if p.is_file()}
        self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()

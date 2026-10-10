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


if __name__ == '__main__':
    unittest.main()

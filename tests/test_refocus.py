import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
try:
    import refocus_tunisia
except ImportError:
    refocus_tunisia = None


class RefocusTests(unittest.TestCase):
    def test_archive_is_reversible_and_second_pass_preserves_new_owner_edits(self):
        self.assertIsNotNone(refocus_tunisia, 'The bounded refocus script is missing')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'data').mkdir()
            values = {'tasks': [{'id': 'F01', 'status': 'todo', 'depends_on': []},
                                {'id': 'S01', 'phase': 0, 'owner': 'Adem', 'priority': 90, 'status': 'in_progress', 'depends_on': [], 'notes': 'Owner note'},
                                {'id': 'S02', 'status': 'blocked', 'depends_on': ['S01']}],
                      'payments': [{'id': 'comptes-consulting-owed', 'status': 'owed', 'amount_minor': None, 'currency': 'TND'}],
                      'leads': [{'id': 'foreign', 'kind': 'remote_contract_discovery', 'location': 'Worldwide'},
                                {'id': 'zaatir', 'kind': 'service_prospect', 'location': 'Sousse', 'company': 'ZAATIR'}],
                      'budget': {'available_hours_this_week': 30}, 'game': {'gates': {}}, 'exclusions': {'companies': []}}
            for name, value in values.items(): (root / 'data' / (name + '.json')).write_text(json.dumps(value))
            before = (root / 'data/payments.json').read_bytes()
            refocus_tunisia.apply(root, [])
            self.assertEqual(json.loads((root / 'data/payments.json').read_text()), [])
            self.assertEqual((root / 'data/archive/2026-10-05-lead-focus/payments.json').read_bytes(), before)
            self.assertEqual(json.loads((root / 'data/budget.json').read_text())['available_hours_this_week'], 30)
            tasks = json.loads((root / 'data/tasks.json').read_text())
            selected = next(t for t in tasks if t['id'] == 'S01')
            self.assertEqual(selected['status'], 'in_progress'); self.assertEqual(selected['notes'], 'Owner note')
            self.assertEqual(next(t for t in tasks if t['id'] == 'S02')['status'], 'todo')
            selected['notes'] = 'Later owner edit'
            (root / 'data/tasks.json').write_text(json.dumps(tasks))
            latest = (root / 'data/tasks.json').read_bytes()
            refocus_tunisia.apply(root, [])
            self.assertEqual((root / 'data/tasks.json').read_bytes(), latest)


if __name__ == '__main__': unittest.main()

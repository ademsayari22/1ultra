import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
try:
    import quests
except ImportError:
    quests = None


def task(id, deps=(), **values):
    return {'id':id,'phase':0,'status':'done','completion_evidence':'Checked source',
            'owner_confirmed':True,'depends_on':list(deps),'priority':80,'owner':'Adem',**values}


class QuestTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(quests, 'The dungeon progression module is not implemented')

    def test_xp_is_derived_once_and_level_changes_at_100(self):
        records=[task(str(i)) for i in range(4)]
        first=quests.progress(records,{})
        self.assertEqual((first['xp'],first['level'],first['level_xp']),(100,2,0))
        self.assertEqual(first,quests.progress(records,{}))
        self.assertEqual(quests.progress(records[:1],{})['xp'],25)

    def test_training_unevidenced_and_unconfirmed_work_award_no_xp(self):
        records=[task('SIM01'),task('fiction',mode='simulation'),
                 task('blank',completion_evidence='  '),task('unconfirmed',owner_confirmed=False),
                 task('todo',status='todo')]
        self.assertEqual(quests.progress(records,{})['xp'],0)

    def test_reopened_prerequisite_revokes_downstream_eligibility(self):
        records=[task('A'),task('B',['A']),task('C',['B'])]
        self.assertEqual(quests.progress(records,{})['xp'],75)
        records[0]['status']='todo'
        result=quests.progress(records,{})
        self.assertEqual(result['xp'],0)
        self.assertEqual(set(result['stale_task_ids']),{'B','C'})
        self.assertEqual(quests.effective_done(records),set())
        self.assertEqual(records[1]['status'],'done')

    def test_cycles_unknown_dependencies_and_duplicate_ids_fail_visibly(self):
        for records in ([task('A',['B']),task('B',['A'])], [task('A',['missing'])], [task('A'),task('A')]):
            with self.subTest(records=records),self.assertRaises(ValueError):
                quests.progress(records,{})

    def test_blank_evidence_never_unlocks_a_dependency(self):
        self.assertEqual(quests.effective_done([task('A',completion_evidence='\t'),task('B',['A'])]),set())

    def test_levels_do_not_clear_boss_gates(self):
        result=quests.progress([task(str(i)) for i in range(12)],{})
        self.assertEqual(result['level'],4)
        self.assertFalse(any(room['cleared'] for room in result['rooms']))
        self.assertFalse(result['rooms'][1]['unlocked'])

    def test_owner_gate_needs_real_quests_and_all_references(self):
        records=[task('R01'),task('R02',['R01'])]
        game={'gates':{'0':{'owner_confirmed':True,'evidence':{'sources':'research/checked-sources.md',
              'shortlist':'data/leads.json: five reviewed companies'},
              'quest_fingerprint':quests.fingerprint(records,quests.ROOMS[0]['tasks'])}}}
        result=quests.progress(records,game)
        self.assertTrue(result['rooms'][0]['cleared'])
        self.assertTrue(result['rooms'][1]['unlocked'])
        game['gates']['0']['evidence']['shortlist']=' '
        self.assertFalse(quests.progress(records,game)['rooms'][0]['cleared'])

    def test_repeat_room_waits_for_the_delivery_room(self):
        result=quests.progress([task('Q00')],{})
        self.assertFalse(result['rooms'][4]['unlocked'])
        self.assertFalse(result['rooms'][4]['cleared'])

    def test_real_children_cannot_gain_xp_through_unconfirmed_or_training_ancestors(self):
        for values in ({'owner_confirmed':False},{'mode':'simulation'}):
            with self.subTest(values=values):
                result=quests.progress([task('A',**values),task('B',['A'])],{})
                self.assertEqual(result['xp'],0)
                self.assertIn('B',result['stale_task_ids'])

    def test_gate_review_is_bound_to_the_reviewed_quest_evidence(self):
        records=[task(id) for id in ('R01','R02')]
        gate={'owner_confirmed':True,'evidence':{'sources':'p','shortlist':'e'},
              'quest_fingerprint':quests.fingerprint(records,quests.ROOMS[0]['tasks'])}
        self.assertTrue(quests.progress(records,{'gates':{'0':gate}})['rooms'][0]['cleared'])
        records[0]['completion_evidence']='Different evidence'
        self.assertFalse(quests.progress(records,{'gates':{'0':gate}})['rooms'][0]['cleared'])


if __name__=='__main__':unittest.main()

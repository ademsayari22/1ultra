"""scripts/freellmapi.py: the local FreeLLMAPI service manager. No network: HTTP and processes are faked."""
import importlib.util
import json
import shutil
import stat
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('freellmapi', ROOT / 'scripts' / 'freellmapi.py')
fl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fl)
KEY = 'freellmapi-' + 'ab' * 24
ADMIN = {'email': 'e@x.io', 'password': 'p' * 10}


def mode(path):
    return stat.S_IMODE(path.stat().st_mode)


class FakeHttp:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def __call__(self, method, url, body=None, headers=None, timeout=10.0):
        self.calls.append((method, url, body, headers or {}))
        for (m, suffix), reply in self.routes.items():
            if m == method and url.endswith(suffix):
                return reply(headers or {}) if callable(reply) else reply
        return 404, None


class FreeLLMAPIScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='ultra-freellmapi-'))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_boot_config_has_ovh_keyless_access_and_no_license(self):
        cfg = fl.config({'email': 'owner@1ultra.local', 'password': 'p' * 12})
        self.assertEqual(cfg['keys'], [{'platform': 'ovh', 'key': 'no-key', 'label': 'ovh-anonymous', 'enabled': True}])
        self.assertNotIn('license', cfg)
        self.assertNotIn('routing', cfg)

    def test_state_files_are_private_and_reused(self):
        state = self.tmp / 'state'
        first = fl.ensure_state(state)
        second = fl.ensure_state(state)
        self.assertEqual(first, second)
        self.assertEqual(first['email'], fl.ADMIN_EMAIL)
        for name in ('admin.json', 'encryption.key', 'freellmapi.config.json', 'freellmapi.env'):
            self.assertEqual(mode(state / name), 0o600, name)
        self.assertEqual(mode(state), 0o700)
        self.assertRegex((state / 'encryption.key').read_text().strip(), r'^[0-9a-f]{64}$')

    def test_server_env_is_loopback_only_and_inherits_no_secrets(self):
        state = self.tmp / 'state'
        fl.ensure_state(state)
        env = fl.server_env(state, 3901, base={'PATH': '/usr/bin', 'HOME': '/home/x', 'OPENAI_API_KEY': 'sk-x', 'GROQ_API_KEY': 'g'})
        self.assertEqual(env['HOST'], '127.0.0.1')
        self.assertEqual(env['PORT'], '3901')
        self.assertEqual(env['NODE_ENV'], 'production')
        self.assertEqual(env['FREELLMAPI_UPDATE_CHECK'], 'off')
        self.assertEqual(env['RESPONSE_CACHE_PERSIST'], 'false')
        self.assertEqual(env['FREEAPI_DB_PATH'], str(state / 'freeapi.db'))
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('GROQ_API_KEY', env)

    def test_key_is_written_privately_for_the_station(self):
        http = FakeHttp({('POST', '/api/auth/login'): (200, {'token': 't1'}),
                         ('GET', '/api/settings/api-key'): lambda h: (200, {'apiKey': KEY}) if h.get('Authorization') == 'Bearer t1' else (401, None)})
        target = fl.fetch_key('http://127.0.0.1:3901', ADMIN, self.tmp / 'runtime', 3901, http=http)
        saved = json.loads(target.read_text())
        self.assertEqual((saved['baseUrl'], saved['key']), ('http://127.0.0.1:3901/v1', KEY))
        self.assertEqual(mode(target), 0o600)
        self.assertEqual(mode(target.parent), 0o700)

    def test_a_malformed_key_is_refused(self):
        http = FakeHttp({('POST', '/api/auth/login'): (200, {'token': 't1'}), ('GET', '/api/settings/api-key'): (200, {'apiKey': 'sk-other'})})
        with self.assertRaises(SystemExit):
            fl.fetch_key('http://127.0.0.1:3901', ADMIN, self.tmp / 'runtime', 3901, http=http)
        self.assertFalse((self.tmp / 'runtime' / '.secrets' / 'freellmapi.json').exists())

    def test_tiers_follow_size_labels_and_keep_edited_tiers(self):
        runtime = self.tmp / 'runtime'
        runtime.mkdir()
        (runtime / 'model-tiers.json').write_text(json.dumps({'version': 1, 'models': {'ovh/a': {'tier': 'smart', 'canonicalId': 'a'}}}))
        rows = [{'platform': 'ovh', 'modelId': 'a', 'canonicalId': 'a', 'sizeLabel': 'Small', 'supportsTools': False},
                {'platform': 'groq', 'modelId': 'b', 'canonicalId': 'b', 'sizeLabel': 'Frontier', 'supportsTools': True},
                {'platform': 'x', 'modelId': 'c', 'canonicalId': 'c', 'sizeLabel': 'Medium', 'supportsVision': True},
                {'platform': 'y', 'modelId': 'd', 'canonicalId': 'd', 'sizeLabel': None},
                {'modelId': 'no-platform'}]
        http = FakeHttp({('POST', '/api/auth/login'): (200, {'token': 't'}), ('GET', '/api/fallback'): (200, rows)})
        models = fl.seed_tiers('http://127.0.0.1:3901', ADMIN, runtime, http=http)['models']
        self.assertEqual({k: v['tier'] for k, v in models.items()}, {'ovh/a': 'smart', 'groq/b': 'smart', 'x/c': 'standard', 'y/d': 'fast'})
        self.assertEqual((models['groq/b']['tools'], models['x/c']['vision'], models['ovh/a']['canonicalId']), (True, True, 'a'))

    def test_ready_count_counts_only_ready_catalog_rows(self):
        http = FakeHttp({('GET', '/v1/models?execution_status=ready'): (200, {'data': [{'id': 'auto', 'available': True}, {'id': 'm1', 'execution_status': 'ready'}, {'id': 'm2', 'execution_status': 'exhausted'}]})})
        self.assertEqual(fl.ready_count('http://127.0.0.1:3901', KEY, http=http), 1)
        self.assertEqual(http.calls[0][3]['Authorization'], 'Bearer ' + KEY)

    def test_install_checks_out_the_pin_then_builds(self):
        service = self.tmp / 'service'
        service.mkdir()
        commit = 'a' * 40
        (service / 'PIN').write_text(commit + '\n')
        commands, heads = [], iter(['', commit])
        fl.install(service, run=lambda cmd, **kw: commands.append(cmd), head=lambda app: next(heads))
        app = str(service / 'app')
        self.assertEqual([c[:3] for c in commands], [['git', 'clone', '--quiet'], ['git', '-C', app], ['git', '-C', app], ['npm', 'ci', '--no-audit'], ['npm', 'run', 'build']])
        self.assertIn(commit, commands[2])

    def test_the_port_must_be_unprivileged(self):
        self.assertEqual(fl.listen_port({}), 3001)
        self.assertEqual(fl.listen_port({'ULTRA_FREELLMAPI_PORT': '3901'}), 3901)
        for bad in ('80', '70000', 'x'):
            with self.assertRaises(SystemExit):
                fl.listen_port({'ULTRA_FREELLMAPI_PORT': bad})


if __name__ == '__main__':
    unittest.main()

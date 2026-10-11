"""scripts/freellmapi.py: the local FreeLLMAPI service manager. No network: HTTP and processes are faked."""
import importlib.util
import json
import shutil
import signal
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

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

    def service(self, name='service'):
        service = self.tmp / name
        entry = service / 'app' / 'server' / 'dist' / 'index.js'
        entry.parent.mkdir(parents=True)
        entry.write_text('// synthetic entry; never executed\n')
        return service, entry

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

    def test_existing_state_permissions_are_hardened(self):
        state = self.tmp / 'state'
        state.mkdir()
        state.chmod(0o755)
        contents = {'admin.json': json.dumps(ADMIN), 'encryption.key': 'ab' * 32 + '\n',
                    'freellmapi.config.json': '{}\n', 'freellmapi.env': 'SYNTHETIC=value\n'}
        for name, text in contents.items():
            (state / name).write_text(text)
            (state / name).chmod(0o644)
        self.assertEqual(fl.ensure_state(state), ADMIN)
        with self.subTest(path='state'):
            self.assertEqual(mode(state), 0o700)
        for name in contents:
            with self.subTest(path=name):
                self.assertEqual(mode(state / name), 0o600)
        for name in ('admin.json', 'encryption.key', 'freellmapi.env'):
            self.assertEqual((state / name).read_text(), contents[name])

    def test_start_log_is_private_when_created_or_reused(self):
        for existing in (False, True):
            with self.subTest(existing=existing):
                service, _ = self.service('log-' + str(existing))
                log = service / 'state' / 'server.log'
                if existing:
                    log.parent.mkdir()
                    log.write_bytes(b'existing log\n')
                    log.chmod(0o644)
                proc = Mock(pid=12345)
                proc.poll.return_value = None
                http = FakeHttp({('GET', '/v1/models'): (200, {})})
                with patch.object(fl, 'alive', return_value=False):
                    result = fl.start(service, 3901, http=http, popen=Mock(return_value=proc), sleep=lambda _: None)
                self.assertTrue(result['running'])
                self.assertEqual(mode(log), 0o600)
                if existing:
                    self.assertEqual(log.read_bytes(), b'existing log\n')

    def test_owned_requires_an_exact_absolute_cmdline_argument(self):
        _, entry = self.service()
        source = self.tmp / 'cmdline'
        argument = str(entry.resolve()).encode()
        for raw, expected in [(b'node\0' + argument + b'\0', True),
                              (b'python3\0something\0', False),
                              (b'node\0' + argument + b'.backup\0', False),
                              (b'node\0--label=' + argument + b'\0', False),
                              (b'node\0app/server/dist/index.js\0', False)]:
            with self.subTest(raw=raw):
                source.write_bytes(raw)
                self.assertEqual(fl.owned(12345, entry, cmdline=lambda _: source.read_bytes()), expected)
        source.unlink()
        self.assertFalse(fl.owned(12345, entry, cmdline=lambda _: source.read_bytes()))

    def test_stop_signals_only_an_owned_pid(self):
        for identity in ('foreign', 'owned', 'unreadable'):
            with self.subTest(identity=identity):
                service, entry = self.service('stop-' + identity)
                state = service / 'state'
                state.mkdir()
                pid_file = state / 'server.pid'
                pid_file.write_text('12345\n')
                running, signals = [True], []

                def killpg(pid, sig):
                    signals.append((pid, sig))
                    running[0] = False

                raw = b'node\0' + str(entry.resolve()).encode() + b'\0' if identity == 'owned' else b'python3\0something\0'
                reader = Mock(side_effect=OSError('unreadable')) if identity == 'unreadable' else Mock(return_value=raw)
                with patch.object(fl, 'alive', side_effect=lambda _: running[0]), \
                        patch.object(fl.os, 'killpg', side_effect=killpg), \
                        patch.object(Path, 'read_bytes', reader):
                    result = fl.stop(service, sleep=lambda _: None)
                self.assertEqual(signals, [(12345, signal.SIGTERM)] if identity == 'owned' else [])
                self.assertFalse(pid_file.exists())
                expected = {'running': False} if identity == 'owned' else {'running': False, 'note': 'stale pid file removed'}
                self.assertEqual(result, expected)

    def test_start_reuses_only_an_owned_pid(self):
        for identity in ('foreign', 'owned'):
            with self.subTest(identity=identity):
                service, entry = self.service('start-' + identity)
                state = service / 'state'
                state.mkdir()
                pid_file = state / 'server.pid'
                pid_file.write_text('12345\n')
                raw = b'node\0' + str(entry.resolve()).encode() + b'\0' if identity == 'owned' else b'python3\0something\0'
                proc = Mock(pid=23456)
                proc.poll.return_value = None
                popen = Mock(return_value=proc)
                http = FakeHttp({('GET', '/v1/models'): (200, {})})
                with patch.object(fl, 'alive', return_value=True), patch.object(Path, 'read_bytes', return_value=raw):
                    result = fl.start(service, 3901, http=http, popen=popen, sleep=lambda _: None)
                self.assertTrue(result['running'])
                self.assertEqual(result['pid'], 12345 if identity == 'owned' else 23456)
                self.assertEqual(pid_file.read_text(), '12345\n' if identity == 'owned' else '23456\n')
                if identity == 'owned':
                    self.assertEqual(result['note'], 'already running')
                    popen.assert_not_called()
                else:
                    self.assertNotIn('note', result)
                    popen.assert_called_once()

    def test_start_refuses_an_exited_child_despite_a_ready_listener(self):
        for when in ('before', 'during'):
            for status in (200, 401):
                with self.subTest(when=when, status=status):
                    service, _ = self.service('exited-%s-%d' % (when, status))
                    proc = Mock(pid=12345)
                    polls = iter([1] if when == 'before' else [None, 1])
                    proc.poll.side_effect = lambda: next(polls, 1)
                    http = FakeHttp({('GET', '/v1/models'): (status, {})})
                    with self.assertRaisesRegex(SystemExit, 'stopped during startup'):
                        fl.start(service, 3901, http=http, popen=Mock(return_value=proc),
                                 sleep=lambda _: None, is_alive=lambda _: False)
                    self.assertEqual(len(http.calls), 0 if when == 'before' else 1)

    def test_start_timeout_terminates_child_and_removes_pid(self):
        service, _ = self.service()
        proc = Mock(pid=12345, returncode=None)
        proc.poll.side_effect = lambda: proc.returncode
        signals = []

        def killpg(pid, sig):
            signals.append((pid, sig))
            proc.returncode = -sig

        with patch.object(fl.os, 'killpg', side_effect=killpg):
            with self.assertRaisesRegex(SystemExit, 'did not answer within 30 seconds'):
                fl.start(service, 3901, http=Mock(side_effect=OSError('not ready')),
                         popen=Mock(return_value=proc), sleep=lambda _: None, is_alive=lambda _: False)
        self.assertEqual(signals, [(12345, signal.SIGTERM)])
        proc.wait.assert_called_once_with(timeout=2)
        self.assertIsNotNone(proc.returncode)
        self.assertFalse((service / 'state' / 'server.pid').exists())

    def test_start_exit_removes_pid_without_signalling(self):
        service, _ = self.service()
        proc = Mock(pid=12345)
        proc.poll.return_value = 1
        with patch.object(fl.os, 'killpg') as killpg:
            with self.assertRaisesRegex(SystemExit, 'stopped during startup'):
                fl.start(service, 3901, http=FakeHttp({('GET', '/v1/models'): (200, {})}),
                         popen=Mock(return_value=proc), sleep=lambda _: None, is_alive=lambda _: False)
        killpg.assert_not_called()
        proc.wait.assert_not_called()
        self.assertFalse((service / 'state' / 'server.pid').exists())

    def test_start_cleanup_escalates_if_sigterm_does_not_finish_child(self):
        service, _ = self.service()
        proc = Mock(pid=12345, returncode=None)
        proc.poll.side_effect = lambda: proc.returncode
        proc.wait.side_effect = [subprocess.TimeoutExpired(['node'], 2), 0]
        signals = []

        def killpg(pid, sig):
            signals.append((pid, sig))
            if sig == signal.SIGKILL:
                proc.returncode = -sig

        with patch.object(fl.os, 'killpg', side_effect=killpg):
            with self.assertRaisesRegex(SystemExit, 'did not answer within 30 seconds'):
                fl.start(service, 3901, http=Mock(side_effect=OSError('not ready')),
                         popen=Mock(return_value=proc), sleep=lambda _: None, is_alive=lambda _: False)
        self.assertEqual(signals, [(12345, signal.SIGTERM), (12345, signal.SIGKILL)])
        self.assertIsNotNone(proc.returncode)
        self.assertFalse((service / 'state' / 'server.pid').exists())

    def test_start_cleanup_handles_a_child_exiting_before_signal(self):
        service, _ = self.service()
        proc = Mock(pid=12345, returncode=None)
        proc.poll.side_effect = lambda: proc.returncode

        def killpg(pid, sig):
            proc.returncode = 0
            raise ProcessLookupError('child already exited')

        with patch.object(fl.os, 'killpg', side_effect=killpg) as send_signal:
            with self.assertRaisesRegex(SystemExit, 'did not answer within 30 seconds'):
                fl.start(service, 3901, http=Mock(side_effect=OSError('not ready')),
                         popen=Mock(return_value=proc), sleep=lambda _: None, is_alive=lambda _: False)
        send_signal.assert_called_once_with(12345, signal.SIGTERM)
        self.assertFalse((service / 'state' / 'server.pid').exists())

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

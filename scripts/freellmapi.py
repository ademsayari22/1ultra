#!/usr/bin/env python3
"""The local FreeLLMAPI service behind 1Ultra's crew.

  install  clone FreeLLMAPI at services/freellmapi/PIN and build it (needs network: GitHub and npm)
  start    run it on 127.0.0.1 (port ULTRA_FREELLMAPI_PORT, default 3001) with OVH AI Endpoints' keyless access
  stop     stop it
  status   installed / running / key loaded / ready models
  key      write the unified key for the station to <runtime>/.secrets/freellmapi.json
  tiers    write <runtime>/model-tiers.json from FreeLLMAPI's catalog (tiers you edited are kept)
  admin    print the dashboard address and login, so you can add free provider keys on its Keys page

FreeLLMAPI's database, encryption key and dashboard login stay in services/freellmapi/state/ (git-ignored;
agents cannot read the project folder). Provider keys go in through the dashboard only, never through
this script or a chat.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import signal
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / 'services' / 'freellmapi'
REPO = 'https://github.com/tashfeenahmed/freellmapi.git'
ADMIN_EMAIL = 'owner@1ultra.local'
KEY_RE = re.compile(r'^freellmapi-[0-9a-f]{48}$')
SIZE_TIER = {'Frontier': 'smart', 'Large': 'smart', 'Medium': 'standard', 'Small': 'fast'}


def pinned_commit(service: Path = SERVICE) -> str:
    value = (service / 'PIN').read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise SystemExit('services/freellmapi/PIN must hold one full 40-character commit hash.')
    return value


def runtime_dir(env=None) -> Path:
    env = os.environ if env is None else env
    return Path(env.get('ULTRA_RUNTIME') or ROOT / 'runs' / 'station-runtime')


def listen_port(env=None) -> int:
    env = os.environ if env is None else env
    raw = str(env.get('ULTRA_FREELLMAPI_PORT', '3001'))
    if not raw.isdigit() or not 1024 <= int(raw) <= 65535:
        raise SystemExit('ULTRA_FREELLMAPI_PORT must be a whole number from 1024 to 65535.')
    return int(raw)


def write_private(path: Path, text: str) -> None:
    """Atomic write, readable by this user only."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name('.%s.%s.tmp' % (path.name, secrets.token_hex(4)))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(text)
    os.replace(tmp, path)


def config(admin: dict) -> dict:
    """Applied by FreeLLMAPI on every boot: the dashboard login and OVH's keyless access. No license, no routing override."""
    return {'admin': {'email': admin['email'], 'password': admin['password']},
            'keys': [{'platform': 'ovh', 'key': 'no-key', 'label': 'ovh-anonymous', 'enabled': True}]}


def ensure_state(state: Path) -> dict:
    """Create the dashboard login and encryption key once, then (re)write the boot config. Returns the login."""
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state, 0o700)
    admin_file, key_file, env_file = state / 'admin.json', state / 'encryption.key', state / 'freellmapi.env'
    if not admin_file.exists():
        write_private(admin_file, json.dumps({'email': ADMIN_EMAIL, 'password': secrets.token_urlsafe(18)}) + '\n')
    if not key_file.exists():
        write_private(key_file, secrets.token_hex(32) + '\n')
    if not env_file.exists():
        write_private(env_file, '')
    for path in (admin_file, key_file, env_file):
        os.chmod(path, 0o600)
    admin = json.loads(admin_file.read_text())
    config_file = state / 'freellmapi.config.json'
    write_private(config_file, json.dumps(config(admin), indent=2) + '\n')
    os.chmod(config_file, 0o600)
    return admin


def server_env(state: Path, port: int, base=None) -> dict:
    """Loopback only, production mode, no update checks, no response cache on disk; nothing else is inherited."""
    base = os.environ if base is None else base
    env = {name: base[name] for name in ('PATH', 'LANG', 'HOME') if base.get(name)}
    env.update({
        'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(port),
        'ENCRYPTION_KEY': (state / 'encryption.key').read_text().strip(),
        'FREEAPI_DB_PATH': str(state / 'freeapi.db'),
        'FREEAPI_ENV_PATH': str(state / 'freellmapi.env'),
        'FREEAPI_CONFIG_PATH': str(state / 'freellmapi.config.json'),
        'FREELLMAPI_UPDATE_CHECK': 'off',
        'RESPONSE_CACHE_PERSIST': 'false',
    })
    return env


def http(method: str, url: str, body=None, headers=None, timeout: float = 10.0):
    """(status, parsed JSON or None) for any HTTP answer; a connection failure raises OSError."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method,
                                     headers={**({'Content-Type': 'application/json'} if data else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    try:
        return status, (json.loads(raw) if raw else None)
    except ValueError:
        return status, None


def login(base: str, admin: dict, http=http) -> str:
    status, body = http('POST', base + '/api/auth/login', {'email': admin['email'], 'password': admin['password']})
    if status != 200 or not isinstance(body, dict) or not body.get('token'):
        raise SystemExit('FreeLLMAPI dashboard login failed (HTTP %s). Is it running? python3 scripts/freellmapi.py start' % status)
    return body['token']


def fetch_key(base: str, admin: dict, runtime: Path, port: int, http=http) -> Path:
    token = login(base, admin, http)
    status, body = http('GET', base + '/api/settings/api-key', headers={'Authorization': 'Bearer ' + token})
    key = body.get('apiKey') if isinstance(body, dict) else None
    if status != 200 or not isinstance(key, str) or not KEY_RE.match(key):
        raise SystemExit('FreeLLMAPI did not return a valid unified key (HTTP %s).' % status)
    target = runtime / '.secrets' / 'freellmapi.json'
    write_private(target, json.dumps({'baseUrl': 'http://127.0.0.1:%d/v1' % port, 'key': key,
                                      'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}) + '\n')
    return target


def seed_tiers(base: str, admin: dict, runtime: Path, http=http) -> dict:
    """Tier every catalog model from FreeLLMAPI's cross-provider size label; a tier already in the file is kept."""
    token = login(base, admin, http)
    status, rows = http('GET', base + '/api/fallback', headers={'Authorization': 'Bearer ' + token})
    if status != 200 or not isinstance(rows, list):
        raise SystemExit('FreeLLMAPI did not return its model list (HTTP %s).' % status)
    target = runtime / 'model-tiers.json'
    current = json.loads(target.read_text()) if target.exists() else {}
    models = dict(current.get('models') or {})
    for row in rows:
        if not isinstance(row, dict) or not row.get('platform') or not row.get('modelId'):
            continue
        name = '%s/%s' % (row['platform'], row['modelId'])
        entry = dict(models.get(name) or {})
        entry.setdefault('tier', SIZE_TIER.get(row.get('sizeLabel'), 'fast'))
        entry.update({'canonicalId': str(row.get('canonicalId') or ''), 'tools': bool(row.get('supportsTools')),
                      'vision': bool(row.get('supportsVision')), 'sizeLabel': str(row.get('sizeLabel') or '')})
        models[name] = entry
    result = {'version': 1, 'seededAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'models': dict(sorted(models.items()))}
    write_private(target, json.dumps(result, indent=2) + '\n')
    return result


def ready_count(base: str, key: str, http=http) -> int:
    status, body = http('GET', base + '/v1/models?execution_status=ready', headers={'Authorization': 'Bearer ' + key})
    if status != 200 or not isinstance(body, dict):
        return 0
    return sum(1 for row in body.get('data') or [] if isinstance(row, dict) and row.get('execution_status') == 'ready')


def git_head(app: Path) -> str:
    result = subprocess.run(['git', '-C', str(app), 'rev-parse', 'HEAD'], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ''


def install(service: Path = SERVICE, run=subprocess.run, head=git_head) -> dict:
    app, commit = service / 'app', pinned_commit(service)
    if not (app / '.git').exists():
        run(['git', 'clone', '--quiet', '--filter=blob:none', REPO, str(app)], check=True)
    if head(app) != commit:
        run(['git', '-C', str(app), 'fetch', '--quiet', 'origin'], check=True)
        run(['git', '-C', str(app), 'checkout', '--quiet', '--detach', commit], check=True)
    if head(app) != commit:
        raise SystemExit('The FreeLLMAPI checkout is not at the pinned commit %s.' % commit)
    run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=str(app), check=True)
    run(['npm', 'run', 'build'], cwd=str(app), check=True)
    return {'installed': commit}


def read_pid(state: Path):
    try:
        return int((state / 'server.pid').read_text().strip())
    except (OSError, ValueError):
        return None


def alive(pid) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def read_cmdline(pid) -> bytes:
    return (Path('/proc') / str(pid) / 'cmdline').read_bytes()


def owned(pid, entry: Path, cmdline=read_cmdline) -> bool:
    """Own only a Node process whose second argument is the exact absolute service entry."""
    try:
        arguments = os.fsdecode(cmdline(pid)).split('\0')
    except OSError:
        return False
    if len(arguments) < 2 or not entry.is_absolute():
        return False
    executable = Path(arguments[0])
    is_node = arguments[0] == 'node' or (executable.is_absolute() and executable.name == 'node')
    return is_node and arguments[1] == str(entry)


def start(service: Path, port: int, http=http, popen=subprocess.Popen, sleep=time.sleep,
          *, cmdline=read_cmdline, is_alive=None, killpg=None) -> dict:
    app, state = service / 'app', service / 'state'
    entry = (app / 'server' / 'dist' / 'index.js').resolve()
    if not entry.exists():
        raise SystemExit('FreeLLMAPI is not installed. Run: python3 scripts/freellmapi.py install')
    base = 'http://127.0.0.1:%d' % port
    pid = read_pid(state)
    is_alive = alive if is_alive is None else is_alive
    if is_alive(pid) and owned(pid, entry, cmdline):
        return {'running': True, 'pid': pid, 'dashboard': base + '/keys', 'note': 'already running'}
    ensure_state(state)
    pid_file, proc = state / 'server.pid', None
    killpg = os.killpg if killpg is None else killpg
    try:
        log_file = state / 'server.log'
        fd = os.open(log_file, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, 'ab') as log:
            os.chmod(log_file, 0o600)
            proc = popen(['node', str(entry)], cwd=str(app), env=server_env(state, port), stdout=log, stderr=log, start_new_session=True)
        write_private(pid_file, '%d\n' % proc.pid)
        for _ in range(60):
            if proc.poll() is not None:
                raise SystemExit('FreeLLMAPI stopped during startup; see services/freellmapi/state/server.log')
            try:
                if http('GET', base + '/v1/models', timeout=2)[0] in (200, 401):
                    if proc.poll() is not None:
                        raise SystemExit('FreeLLMAPI stopped during startup; see services/freellmapi/state/server.log')
                    return {'running': True, 'pid': proc.pid, 'dashboard': base + '/keys'}
            except OSError:
                pass
            if proc.poll() is not None:
                raise SystemExit('FreeLLMAPI stopped during startup; see services/freellmapi/state/server.log')
            sleep(0.5)
        raise SystemExit('FreeLLMAPI did not answer within 30 seconds; see services/freellmapi/state/server.log')
    except BaseException:
        try:
            if proc is not None:
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    if proc.poll() is not None:
                        break
                    try:
                        killpg(proc.pid, sig)
                    except ProcessLookupError:
                        pass
                    try:
                        proc.wait(timeout=2)
                        break
                    except subprocess.TimeoutExpired:
                        pass
        finally:
            pid_file.unlink(missing_ok=True)
        raise


def stop(service: Path, sleep=time.sleep, *, cmdline=read_cmdline, is_alive=None, killpg=None) -> dict:
    state = service / 'state'
    pid = read_pid(state)
    entry = (service / 'app' / 'server' / 'dist' / 'index.js').resolve()
    is_alive = alive if is_alive is None else is_alive
    killpg = os.killpg if killpg is None else killpg
    if is_alive(pid):
        if not owned(pid, entry, cmdline):
            (state / 'server.pid').unlink(missing_ok=True)
            return {'running': False, 'note': 'stale pid file removed'}
        try:
            killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(40):
            if not is_alive(pid):
                break
            sleep(0.25)
    if not is_alive(pid):
        (state / 'server.pid').unlink(missing_ok=True)
    return {'running': is_alive(pid)}


def status(service: Path, runtime: Path, port: int, http=http) -> dict:
    base = 'http://127.0.0.1:%d' % port
    out = {'installed': (service / 'app' / 'server' / 'dist' / 'index.js').exists(), 'running': alive(read_pid(service / 'state')),
           'listening': False, 'keyLoaded': False, 'readyModels': None, 'dashboard': base + '/keys'}
    try:
        out['listening'] = http('GET', base + '/v1/models', timeout=2)[0] in (200, 401)
    except OSError:
        pass
    secret = runtime / '.secrets' / 'freellmapi.json'
    if secret.exists():
        key = str(json.loads(secret.read_text()).get('key', ''))
        out['keyLoaded'] = bool(KEY_RE.match(key))
        if out['listening'] and out['keyLoaded']:
            out['readyModels'] = ready_count(base, key, http)
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="The local FreeLLMAPI service behind 1Ultra's crew.")
    parser.add_argument('command', choices=['install', 'start', 'stop', 'status', 'key', 'tiers', 'admin'])
    args = parser.parse_args(argv)
    port, runtime = listen_port(), runtime_dir()
    base, state = 'http://127.0.0.1:%d' % port, SERVICE / 'state'
    if args.command == 'install':
        result = install()
    elif args.command == 'start':
        result = start(SERVICE, port)
    elif args.command == 'stop':
        result = stop(SERVICE)
    elif args.command == 'status':
        result = status(SERVICE, runtime, port)
    elif args.command == 'key':
        result = {'written': str(fetch_key(base, ensure_state(state), runtime, port))}
    elif args.command == 'tiers':
        counts = {}
        for entry in seed_tiers(base, ensure_state(state), runtime)['models'].values():
            counts[entry['tier']] = counts.get(entry['tier'], 0) + 1
        result = {'written': str(runtime / 'model-tiers.json'), 'tiers': counts}
    else:
        admin = ensure_state(state)
        result = {'dashboard': base + '/keys', 'email': admin['email'], 'password': admin['password'],
                  'next': 'Log in, add free keys (Groq, Cerebras, OpenRouter) on the Keys page, then run: python3 scripts/freellmapi.py tiers'}
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

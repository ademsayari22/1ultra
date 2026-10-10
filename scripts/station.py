"""Launch the merged local station; the classic Python app remains an option."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8541)
    parser.add_argument('--classic', action='store_true', help='Run the original Python interface')
    parser.add_argument('--check', action='store_true', help='Check local runtime prerequisites without starting a server')
    args = parser.parse_args(); root = Path(__file__).resolve().parents[1]
    if not 1 <= args.port <= 65535: parser.error('Choose a valid local port.')
    if args.classic:
        from ultra_ui import create_server
        server = create_server(root, root / 'web', args.port)
        print(f'1Ultra classic: http://127.0.0.1:{server.server_port}', flush=True)
        try: server.serve_forever()
        except KeyboardInterrupt: pass
        finally: server.server_close()
        return
    node = shutil.which('node')
    if not node: parser.error('Node.js 20+ is required for the station. Use --classic for the standard-library interface.')
    major = int(subprocess.check_output([node, '--version'], text=True).strip().lstrip('v').split('.')[0])
    if major < 20: parser.error('Node.js 20+ is required.')
    modules = root / 'station/node_modules'
    missing = [name for name in ('ajv', 'undici') if not (modules / name / 'package.json').is_file()]
    if missing: parser.error('Install runtime dependencies with: cd station && npm ci --ignore-scripts --no-audit --no-fund')
    if args.check:
        print(json.dumps({'node_major': major, 'python': sys.version.split()[0], 'dependencies': 'present',
                          'entrypoint': 'station/sidecar/index.js', 'models': 'manual Codex CLI judgment', 'outbound': 'disabled'})); return
    env = {'PATH': os.environ.get('PATH', ''), 'LANG': 'C.UTF-8', 'ULTRA_ROOT': str(root), 'ULTRA_PORT': str(args.port)}
    for key in ('HOME', 'CODEX_HOME'):
        if os.environ.get(key): env[key] = os.environ[key]
    proc = subprocess.Popen([node, str(root / 'station/sidecar/index.js')], cwd=root, env=env)
    try: return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill(); proc.wait()


if __name__ == '__main__': sys.exit(main() or 0)

"""Browser QA on copied records, with an explicitly supplied installed browser."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--playwright-module', required=True)
    parser.add_argument('--browser', required=True)
    parser.add_argument('--port', type=int, default=8552, choices=range(8550, 8560))
    parser.add_argument('--output', type=Path, default=Path('/tmp/1ultra-station-experience-qa'))
    parser.add_argument('--agents', action='store_true', help='Exercise agent UI using a local fake CLI; never a provider')
    parser.add_argument('--starnet', action='store_true', help="Exercise Starnet's interface at / with the campaign window")
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if not (output.is_relative_to(project / 'runs') or output.is_relative_to(Path('/tmp'))):
        parser.error('Keep screenshots in project runs/ or /tmp.')
    output.mkdir(parents=True, exist_ok=True)
    originals = list((project / 'data').glob('*.json')) + [project / 'STATE.md']
    baseline = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in originals}
    with tempfile.TemporaryDirectory(prefix='1ultra-browser-fixture-') as temporary:
        root = Path(temporary)
        for relative in ['STATE.md', 'context/FOUNDER.md', 'data/leads.json', 'data/tasks.json', 'data/budget.json',
                         'data/payments.json', 'data/exclusions.json', 'data/game.json',
                         'simulations/scenarios.json',
                         '.codex/agents/ultra_research.toml', '.codex/agents/ultra_sales.toml',
                         '.codex/agents/ultra_delivery.toml', '.codex/agents/ultra_qa.toml',
                         '.agents/skills/ultra-prospect/SKILL.md', '.agents/skills/ultra-sales/SKILL.md',
                         '.agents/skills/ultra-deliver/SKILL.md']:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(project / relative, target)
        (root / 'runs').mkdir()
        fixture_path = os.environ['PATH']
        if args.agents:
            (root / 'bin').mkdir()
            shutil.copy2(project / 'tests/fixtures/codex-agent.cjs', root / 'bin/codex')
            (root / 'bin/codex').chmod(0o700)
            fixture_path = str(root / 'bin') + os.pathsep + fixture_path
        with (root / 'server.log').open('w+') as log:
            proc = subprocess.Popen(['node', str(project / 'station/sidecar/index.js')], cwd=project,
                env={'PATH': fixture_path, 'LANG': 'C.UTF-8', 'ULTRA_ROOT': str(root),
                     'ULTRA_RUNTIME': str(root / 'runtime'), 'ULTRA_PORT': str(args.port)},
                stdout=log, stderr=log)
            base = f'http://127.0.0.1:{args.port}'
            try:
                for _ in range(100):
                    if proc.poll() is not None:
                        log.seek(0)
                        raise RuntimeError('Fixture stopped: ' + log.read()[-1500:])
                    try:
                        with urllib.request.urlopen(base, timeout=1) as response:
                            if response.status == 200:
                                break
                    except (urllib.error.URLError, ConnectionError):
                        time.sleep(.1)
                else:
                    raise RuntimeError('Fixture startup deadline exceeded')
                journey = 'tests/station-starnet-browser.cjs' if args.starnet else ('tests/station-agents-browser.cjs' if args.agents else 'tests/station-experience-browser.cjs')
                subprocess.run(['node', str(project / journey)],
                    cwd=project, check=True, timeout=180,
                    env={**os.environ, 'ULTRA_BROWSER_FIXTURE': 'copied-records',
                         'ULTRA_BROWSER_BASE': base, 'ULTRA_BROWSER_OUTPUT': str(output),
                         'ULTRA_PLAYWRIGHT_MODULE': args.playwright_module,
                         'ULTRA_BROWSER_EXECUTABLE': args.browser})
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
    for path, digest in baseline.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, path
    print(json.dumps({'original_business_records': 'unchanged', 'fixture': 'removed'}))


if __name__ == '__main__':
    main()

"""Export pinned MIT application source without excluded art or historical data.

Prepare with --inventory, fetch its OIDs into the partial clone, then --export.
No network operations are performed by this script.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

REVISION = 'e0a36dcd31787248b877aea01a6e53741012bc46'
TEXT = {'.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.yml', '.yaml', '.tpl', '.list'}


def eligible(name):
    p = Path(name)
    if name in {'LICENSE', 'NOTICE.md', 'package.json', 'package-lock.json'}:
        return True
    if p.suffix not in TEXT or '..' in p.parts:
        return False
    if p.parts[0] in {'sidecar', 'shared', 'test'}:
        return not any(x in p.parts for x in ('workspaces', 'output', 'credentials', 'fixtures-private'))
    if p.parts[0] == 'frontend':
        return len(p.parts) == 2 or p.parts[1] in {'app', 'css', 'js', 'lib'}
    return p.parts[0] in {'skills-catalog', 'scripts'} and p.suffix in TEXT


def inventory(repo):
    tree = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', REVISION], text=True)
    rows = []
    for line in tree.splitlines():
        meta, name = line.split('\t', 1)
        mode, kind, oid = meta.split()
        if mode == '100644' and kind == 'blob' and eligible(name):
            rows.append({'path': name, 'git_blob': oid})
    return rows


def export(repo, destination, rows):
    proc = subprocess.Popen(['git', '-C', str(repo), 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for row in rows:
        proc.stdin.write((row['git_blob'] + '\n').encode()); proc.stdin.flush()
        header = proc.stdout.readline().decode().strip().split()
        if len(header) != 3 or header[1] != 'blob':
            raise RuntimeError('Fetch missing source blob before export: ' + row['path'])
        data = proc.stdout.read(int(header[2])); proc.stdout.read(1)
        target = destination / row['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != data:
            raise RuntimeError('Refusing to replace adapted source: ' + row['path'])
        target.write_bytes(data)
        row['sha256'] = hashlib.sha256(data).hexdigest()
        row['bytes'] = len(data)
    proc.stdin.close(); proc.wait()
    (destination / 'UPSTREAM.json').write_text(json.dumps({'repository': 'https://github.com/androoAGI/starnet', 'revision': REVISION,
        'license': 'MIT code; upstream branding/art excluded and not imported', 'files': rows}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--inventory', type=Path); parser.add_argument('--export', type=Path)
    args = parser.parse_args(); rows = inventory(args.repo)
    if args.inventory:
        args.inventory.write_text('\n'.join(sorted({r['git_blob'] for r in rows})) + '\n')
        print(json.dumps({'files': len(rows), 'blob_list': str(args.inventory)}))
    if args.export:
        export(args.repo, args.export, rows); print(json.dumps({'exported': len(rows), 'destination': str(args.export)}))

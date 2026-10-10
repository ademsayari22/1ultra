"""Update station/ from a local Starnet clone: copy eligible MIT source, rebrand display text, apply 1Ultra patches.

Usage: python3 scripts/update_starnet.py --repo runs/upstream/starnet --revision <commit>
Fetch the clone separately (docs/ops/STATION.md). This script makes no network calls and runs nothing from the clone.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TEXT = {'.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.yml', '.yaml', '.tpl', '.list'}
FRONTEND_DIRS = {'app', 'css', 'js', 'lib', 'plugin-kit'}
SKIP_PARTS = {'workspaces', 'output', 'credentials', 'fixtures-private'}
# 1Ultra-owned paths inside station/: never written, replaced or deleted by an update.
OWNED = ('ultra-host.js', 'ultra-policy.js', 'ultra-state.js', 'ultra-switches.js', 'ultra-seed.js', 'ultra-patches.json',
         'UPSTREAM.json', 'package.json', 'package-lock.json', 'node_modules/', 'frontend/campaign/', 'frontend/assets/',
         'frontend/ultra-window.js', 'frontend/ultra-brand.css')
RENAMES = {'package.json': 'package.upstream.json', 'package-lock.json': 'package-lock.upstream.json'}
BRAND = [(re.compile(r'\bStarNet\b'), '1Ultra'), (re.compile(r'\bSTARNET\b'), '1ULTRA'), (re.compile(r'\bStarnet\b'), '1Ultra')]
BRAND_ROOTS = {'frontend', 'sidecar', 'shared', 'test', 'skills-catalog'}


def eligible(name):
    p = Path(name)
    if name in {'LICENSE', 'NOTICE.md', 'package.json', 'package-lock.json'}:
        return True
    if p.suffix not in TEXT or '..' in p.parts or len(p.parts) < 2:
        return False
    top = p.parts[0]
    if top in {'sidecar', 'shared', 'test'}:
        return not SKIP_PARTS.intersection(p.parts)
    if top == 'frontend':
        return p.parts[1:] == ('index.html',) or (len(p.parts) > 2 and p.parts[1] in FRONTEND_DIRS)
    return top in {'skills-catalog', 'scripts'}


def brandable(name):
    p = Path(name)
    return len(p.parts) > 1 and p.parts[0] in BRAND_ROOTS and not p.name.upper().startswith(('LICENSE', 'NOTICE', 'COPYING'))


def rebrand(text):
    for rx, new in BRAND:
        text = rx.sub(new, text)
    return text


def apply_patches(name, text, patches):
    applied = []
    for patch in patches:
        if patch['file'] != name:
            continue
        count = text.count(patch['find'])
        if count != 1:
            raise RuntimeError(f"Patch {patch['id']} expects one match in {name}, found {count}")
        text = text.replace(patch['find'], patch['replace'])
        applied.append(patch['id'])
    return text, applied


def owned(rel):
    return any(rel == o or (o.endswith('/') and rel.startswith(o)) for o in OWNED)


def inventory(repo, revision):
    tree = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', revision], text=True)
    rows = []
    for line in tree.splitlines():
        meta, name = line.split('\t', 1)
        mode, kind, oid = meta.split()
        if mode == '100644' and kind == 'blob' and eligible(name):
            rows.append({'path': name, 'git_blob': oid})
    return rows


def blobs(repo, rows):
    proc = subprocess.Popen(['git', '-C', str(repo), 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for row in rows:
            proc.stdin.write((row['git_blob'] + '\n').encode()); proc.stdin.flush()
            header = proc.stdout.readline().decode().split()
            if len(header) != 3 or header[1] != 'blob':
                raise RuntimeError('Missing source blob (fetch it into the clone first): ' + row['path'])
            data = proc.stdout.read(int(header[2])); proc.stdout.read(1)
            yield row, data
    finally:
        proc.stdin.close(); proc.stdout.close(); proc.wait()


def export(repo, revision, destination, patches):
    destination = Path(destination); destination.mkdir(parents=True, exist_ok=True)
    previous_file = destination / 'UPSTREAM.json'
    previous = json.loads(previous_file.read_text()) if previous_file.exists() else {'files': []}
    rows, adaptations, used, written = inventory(repo, revision), [], set(), set()
    for row, data in blobs(repo, rows):
        rel = RENAMES.get(row['path'], row['path'])
        if owned(rel):
            raise RuntimeError('Upstream path collides with a 1Ultra-owned file: ' + rel)
        row['sha256'] = hashlib.sha256(data).hexdigest(); row['bytes'] = len(data)
        if rel != row['path']:
            row['source_copy_path'] = rel
        reasons, out = [], data
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            text = None
        if text is not None:
            new = rebrand(text) if brandable(row['path']) else text
            if new != text:
                reasons.append('brand')
            new, applied = apply_patches(row['path'], new, patches)
            if applied:
                reasons.append('patch:' + ','.join(applied)); used.update(applied)
            out = new.encode('utf-8')
        target = destination / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(out); written.add(rel)
        if reasons:
            adaptations.append({'path': row['path'], 'current_sha256': hashlib.sha256(out).hexdigest(), 'reasons': reasons})
    unused = [p['id'] for p in patches if p['id'] not in used]
    if unused:
        raise RuntimeError('Patches never applied: ' + ', '.join(unused))
    for old in previous.get('files', []):
        rel = old.get('source_copy_path', old['path'])
        stale = destination / rel
        if rel not in written and not owned(rel) and stale.is_file():
            stale.unlink()
    manifest = {'repository': 'https://github.com/androoAGI/starnet', 'revision': revision,
                'license': 'MIT code; upstream branding/art excluded and not imported', 'files': rows, 'adaptations': adaptations}
    previous_file.write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--destination', type=Path, default=ROOT / 'station')
    args = parser.parse_args()
    patches = json.loads((ROOT / 'station' / 'ultra-patches.json').read_text())
    manifest = export(args.repo.resolve(), args.revision, args.destination.resolve(), patches)
    print(json.dumps({'revision': manifest['revision'], 'files': len(manifest['files']),
                      'adapted': len(manifest['adaptations']), 'patches': len(patches)}))


if __name__ == '__main__':
    main()

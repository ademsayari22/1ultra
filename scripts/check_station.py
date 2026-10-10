"""Verify pinned source provenance, notices and active frontend assets locally."""
import hashlib
import json
from pathlib import Path
import re
import subprocess


def main():
    root=Path(__file__).resolve().parents[1];station=root/'station'
    manifest=json.loads((station/'UPSTREAM.json').read_text())
    adapted={r['path']:r['current_sha256'] for r in manifest.get('adaptations',[])}
    paths=set();unchanged=0
    for row in manifest['files']:
        assert row['path'] not in paths, 'Duplicate source path';paths.add(row['path'])
        file=(station/row.get('source_copy_path',row['path'])).resolve()
        assert file.is_relative_to(station.resolve()) and file.is_file(),row['path']
        digest=hashlib.sha256(file.read_bytes()).hexdigest()
        assert digest==adapted.get(row['path'],row['sha256']), 'Unexpected source change: '+row['path']
        unchanged+=digest==row['sha256']
        assert '/assets/' not in row['path'] and not file.is_symlink(),row['path']
    for file in ('LICENSE','NOTICE.md'):
        row=next(r for r in manifest['files'] if r['path']==file)
        assert hashlib.sha256((station/file).read_bytes()).hexdigest()==row['sha256'],file
    html=(station/'frontend/campaign/index.html').read_text()
    assert '1Ultra' in html and 'frontend/assets' not in html
    for asset in re.findall(r'(?:src|href)="([^"#]+)"',html):
        assert not asset.startswith(('https:','http:')), 'Active external asset: '+asset
        if asset.startswith('/classic'): continue
        assert (station/'frontend'/asset.lstrip('/')).is_file(),asset
    for file in sorted({*station.glob('ultra-*.js'),*station.glob('frontend/ultra-*.js'),*station.glob('frontend/campaign/*.js'),station/'sidecar/index.js'}):
        subprocess.run(['node','--check',str(file)],check=True,capture_output=True)
    print(json.dumps({'pinned_revision':manifest['revision'],'imported_source_files':len(paths),
        'unchanged_upstream_files':unchanged,'adapted_upstream_files':len(adapted),
        'notices':'byte-preserved','active_assets':'local, present','excluded_art':'not imported'},indent=2))


if __name__=='__main__':main()

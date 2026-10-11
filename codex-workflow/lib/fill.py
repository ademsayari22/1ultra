"""Fill a prompt template: python3 fill.py TEMPLATE KEY=value KEY=@file ...  ->  stdout.

Every {{KEY}} in the template is replaced. A value starting with @ is read from that file (missing file -> "(none)").
"""
import sys
from pathlib import Path

template = Path(sys.argv[1]).read_text(encoding='utf-8')
for arg in sys.argv[2:]:
    key, _, value = arg.partition('=')
    if value.startswith('@'):
        path = Path(value[1:])
        value = path.read_text(encoding='utf-8').strip() if path.is_file() else '(none)'
    template = template.replace('{{' + key + '}}', value)
sys.stdout.write(template)

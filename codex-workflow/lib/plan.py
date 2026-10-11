"""Read a markdown plan: one task's section, the Global Constraints section, or the task list.

  python3 plan.py task PLAN N        -> the text from "### Task N:" up to the next "### Task" or "## " heading
  python3 plan.py constraints PLAN   -> the "## Global Constraints" section ("" when the plan has none)
  python3 plan.py tasks PLAN         -> one line per task: "N<TAB>title"
"""
import re
import sys


def task(text, n):
    m = re.search(r'^### Task %d\b[^\n]*$' % n, text, re.M)
    if not m:
        raise SystemExit('No "### Task %d" heading in the plan.' % n)
    rest = text[m.end():]
    nxt = re.search(r'^(### Task \d+\b|## )', rest, re.M)
    body = (text[m.start():m.end() + (nxt.start() if nxt else len(rest))]).strip()
    return re.sub(r'(\n\s*-{3,}\s*)+$', '', body) + '\n'   # drop a trailing --- separator


def constraints(text):
    m = re.search(r'^## Global Constraints[^\n]*$', text, re.M)
    if not m:
        return ''
    rest = text[m.end():]
    nxt = re.search(r'^## ', rest, re.M)
    return (text[m.start():m.end() + (nxt.start() if nxt else len(rest))]).strip() + '\n'


def tasks(text):
    return ['%s\t%s' % (n, title.strip()) for n, title in re.findall(r'^### Task (\d+)\b:?\s*([^\n]*)$', text, re.M)]


if __name__ == '__main__':
    kind, path = sys.argv[1], sys.argv[2]
    text = open(path, encoding='utf-8').read()
    if kind == 'task':
        sys.stdout.write(task(text, int(sys.argv[3])))
    elif kind == 'constraints':
        sys.stdout.write(constraints(text))
    elif kind == 'tasks':
        print('\n'.join(tasks(text)))
    else:
        raise SystemExit('Unknown command: ' + kind)

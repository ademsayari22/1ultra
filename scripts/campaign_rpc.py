"""Private pipe RPC for the station host. Never opens a socket."""
import argparse
import json
from pathlib import Path
import sys
from urllib.parse import parse_qs, unquote, urlsplit

from ultra_ui import Workspace, RequestError
from campaign import Campaign, focus_plan
import campaign_tools


def dispatch(workspace, request):
    route = urlsplit(request['route']); method = request.get('method', 'GET')
    body = request.get('body', {}); version = request.get('version', '')
    path = route.path; store = Campaign(workspace)
    if method == 'GET':
        if path == '/api/tools/leads': return campaign_tools.leads(store, {k: v[0] for k, v in parse_qs(route.query).items()})
        if path == '/api/tools/lead': return campaign_tools.packet(store, {k: v[0] for k, v in parse_qs(route.query).items()})
        if path == '/api/tools/pitch-kit': return campaign_tools.pitch_kit(store, {})
        if path == '/api/agents/readiness':
            from station_agents import readiness
            return readiness()
        if path == '/api/agents/catalog':
            from station_agents import catalog
            return catalog(workspace)
        if path == '/api/workspace': return workspace.snapshot()
        if path == '/api/campaign': return store.snapshot(parse_qs(route.query).get('offer', ['documents'])[0])
        if path == '/api/focus':
            snapshot = workspace.snapshot(); state = store.snapshot()
            return focus_plan(snapshot['tasks'], [f for f in state['followups'] if not f['suppressed'] and not f['needs_review']],
                              int(parse_qs(route.query).get('minutes', ['20'])[0]), snapshot['local_date'])
        if path == '/api/artifact': return workspace.artifact(parse_qs(route.query).get('path', [''])[0])
        raise RequestError(404, 'Unknown read route.')
    if method != 'POST': raise RequestError(405, 'Unsupported method.')
    if path == '/api/tools/check-draft':
        body.pop('agent_id', 'unknown')
        return campaign_tools.check_draft(store, body)
    if path == '/api/tools/save-draft': return campaign_tools.save_draft(store, body, body.pop('agent_id', 'unknown'))
    if path == '/api/tools/propose-lead': return campaign_tools.propose_lead(store, body, body.pop('agent_id', 'unknown'))
    if path == '/api/agents/adopt':
        from station_agents import adopt
        return adopt(workspace, body, version)
    if path=='/api/workflow-check': return store.preflight(body)
    if path.startswith('/api/campaign/'):
        return store.action(path.split('/')[-1], body, version)
    if path.startswith('/api/prospecting/'):
        return workspace.prospect_action(path.split('/')[-1], body, version)
    if path.startswith('/api/tasks/'):
        return workspace.update_task(unquote(path.split('/')[-1]), body, version)
    if path == '/api/planning': return workspace.update_record('budget', None, body, version)
    if path == '/api/leads' or path.startswith('/api/leads/'):
        return workspace.update_record('leads', unquote(path.split('/')[-1]) if path != '/api/leads' else None, body, version)
    if path.startswith('/api/gates/'):
        return workspace.update_gate(int(path.split('/')[-1]), body, version, request.get('task_version', ''))
    if path in {'/api/automate', '/api/draft', '/api/simulate', '/api/judgment'}:
        return workspace.action(path, body)
    raise RequestError(404, 'Unsupported campaign route.')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--root', type=Path, required=True); parser.add_argument('--once', action='store_true')
    args = parser.parse_args(); workspace = Workspace(args.root, Path(__file__).resolve().parents[1] / 'web')
    for line in sys.stdin:
        request = {}
        path = ''
        try:
            if len(line.encode()) > 450000: raise RequestError(413, 'RPC request too large.')
            request = json.loads(line)
            if not isinstance(request, dict): raise RequestError(400, 'RPC object required.')
            path = urlsplit(request.get('route', '')).path
            if request.get('route') == '/api/agents/run' and args.once and request.get('method') == 'POST':
                from station_agents import execute
                def emit(event):
                    print(json.dumps({'id': request.get('id'), 'kind': 'event', **event}), flush=True)
                value = execute(workspace, request.get('body', {}), emit, request.get('instructions', ''), request.get('settings'))
                result = {'id': request.get('id'), 'status': 400 if value.get('error') else 200, 'value': value}
            else:
                result = {'id': request.get('id'), 'status': 200, 'value': dispatch(workspace, request)}
        except RequestError as error:
            result = {'id': request.get('id') if isinstance(request, dict) else None, 'status': error.status, 'value': {'error': error.message}}
        except ValueError as error:
            message = str(error) if path.startswith('/api/tools/') or request.get('route') == '/api/agents/run' else 'Invalid campaign request.'
            result = {'id': request.get('id'), 'status': 400, 'value': {'error': message}}
        except (KeyError, TypeError):
            result = {'id': request.get('id') if isinstance(request, dict) else None, 'status': 400, 'value': {'error': 'Invalid campaign request.'}}
        except Exception:
            result = {'id': request.get('id'), 'status': 500, 'value': {'error': 'Campaign action failed. Inspect local files before retrying.'}}
        print(json.dumps(result, ensure_ascii=False), flush=True)
        if args.once: break


if __name__ == '__main__': main()

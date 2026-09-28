"""Real HTTP release gate. Uses existing sessions; never prints credentials/tokens.

QA_OPERATOR_PASSWORD and QA_CHIEF_PASSWORD must refer to existing accounts.
Run on the designated QA/demo branch: legacy suites settle its queue via API.
No database reset. Historical tickets and the registered QA client are retained.
"""
import argparse
import concurrent.futures
import datetime as dt
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get('BASE_URL', 'http://localhost:8080').rstrip('/')
BRANCH = '11111111-1111-1111-1111-111111111111'
SERVICE = '22222222-2222-2222-2222-222222222222'
WINDOWS = ['33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666']

def request(method, path, body=None, token=None, key=None):
    headers = {'Accept': 'application/json'}
    if token:
        headers['Cookie'] = 'session=' + token
    if key:
        headers['Idempotency-Key'] = key
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        return response.status, json.loads(raw) if raw else None, response.headers

def api(method, path, body=None, token=None, key=None, status=200):
    code, value, headers = request(method, '/api/v1' + path, body, token, key)
    assert code == status, f'{method} {path}: HTTP {code}, expected {status}'
    return value, headers

def login(kind):
    email = os.environ.get('QA_' + kind + '_EMAIL', 'operator@pochta.local' if kind == 'OPERATOR' else 'admin@pochta.local')
    password = os.environ['QA_' + kind + '_PASSWORD']
    _, headers = api('POST', '/auth/login', {'email': email, 'password': password})
    cookie = headers.get('Set-Cookie', '')
    assert 'HttpOnly' in cookie and 'SameSite=Lax' in cookie
    return cookie.split(';')[0].split('=', 1)[1]

def create(token=None, source='qr', key=None):
    path = ('/operator' if source == 'live' else '') + f'/branches/{BRANCH}/tickets/{source}'
    return api('POST', path, {'serviceId': SERVICE}, token, key or str(uuid.uuid4()), 201)[0]

def finish(ticket, token):
    if ticket['status'] == 'CALLED':
        ticket = api('POST', f'/operator/tickets/{ticket["id"]}/start', token=token)[0]
    if ticket['status'] == 'SERVING':
        api('POST', f'/operator/tickets/{ticket["id"]}/complete', token=token)

def drain(token):
    windows = api('GET', f'/operator/branches/{BRANCH}/windows', token=token)[0]['items']
    for window in windows:
        api('PUT', f'/admin/windows/{window["id"]}/status', {'status': 'OPEN'}, token)
        current = request('GET', f'/api/v1/operator/windows/{window["id"]}/current-ticket', token=token)
        if current[0] == 200:
            finish(current[1], token)
        else:
            assert current[0] == 204
        for _ in range(1000):
            code, ticket, _ = request('POST', f'/api/v1/operator/windows/{window["id"]}/call-next', token=token)
            if code == 409 and ticket['error']['code'] == 'NO_ELIGIBLE_TICKETS':
                break
            assert code == 200, f'drain HTTP {code}'
            finish(ticket, token)
        else:
            raise AssertionError('Queue did not drain within limit')

def check_eta(ticket):
    eta = api('GET', f'/tickets/{ticket["id"]}/eta')[0]
    position = api('GET', f'/tickets/{ticket["id"]}/position')[0]
    required_eta = {'ticketId','ticketStatus','reason','estimatedWaitSeconds','estimatedCallAt','position','referenceWindow','sampleSize','usedFallback','calculatedAt'}
    assert required_eta.issubset(set(eta))
    assert set(eta).issubset(required_eta | {'weightedWaitSeconds','medianSeconds','p90WaitSeconds','distribution'})
    for key in ['ticketId','ticketStatus','reason','position','referenceWindow']:
        assert eta[key] == position[key], key
    if eta['reason'] == 'AVAILABLE':
        assert 60 <= eta['estimatedWaitSeconds'] <= 1800
        assert 0 <= eta['sampleSize'] <= 20
        assert eta['usedFallback'] == (eta['sampleSize'] < 3)
        instant = lambda value: dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        assert (instant(eta['estimatedCallAt']) - instant(eta['calculatedAt'])).total_seconds() == eta['estimatedWaitSeconds']
    else:
        assert eta['estimatedWaitSeconds'] is None and eta['estimatedCallAt'] is None
        assert eta['sampleSize'] == 0 and not eta['usedFallback']
    return eta

def sprint4(run):
    operator, chief = login('OPERATOR'), login('CHIEF')
    assert api('GET', '/auth/me', token=operator)[0]['role'] == 'employee'
    assert api('GET', '/auth/me', token=chief)[0]['role'] == 'opc_chief'
    api('POST', '/auth/login', {'email': 'missing-' + str(uuid.uuid4()), 'password': 'invalid'}, status=401)
    api('GET', f'/operator/branches/{BRANCH}/windows', status=401)
    api('GET', f'/admin/branches/{BRANCH}/queue-policy', status=401)
    api('GET', '/admin/users', token=operator, status=403)
    api('GET', '/admin/users', token=chief)
    client_password = secrets.token_urlsafe(18)
    client_email = 'qa-' + str(uuid.uuid4()) + '@example.invalid'
    api('POST', '/auth/register', {'email': client_email, 'password': client_password}, status=201)
    _, headers = api('POST', '/auth/login', {'email': client_email, 'password': client_password})
    client = headers['Set-Cookie'].split(';')[0].split('=', 1)[1]
    api('GET', f'/operator/branches/{BRANCH}/windows', token=client, status=403)
    api('GET', f'/admin/branches/{BRANCH}/queue-policy', token=client, status=403)
    api('POST', '/auth/logout', token=client)
    api('GET', '/auth/me', token=client, status=401)
    drain(operator)
    key = str(uuid.uuid4())
    ticket = create(key=key)
    replay = api('POST', f'/branches/{BRANCH}/tickets/qr', {'serviceId': SERVICE}, key=key)[0]
    assert replay['id'] == ticket['id'] and ticket['publicNumber'].startswith('Q-') and ticket['source'] == 'QR'
    assert check_eta(ticket)['estimatedWaitSeconds'] == 60
    called = api('POST', f'/operator/windows/{WINDOWS[0]}/call-next', token=operator)[0]
    assert called['id'] == ticket['id']
    assert check_eta(called)['reason'] == 'NOT_QUEUED'
    finish(called, operator)
    assert check_eta(ticket)['reason'] == 'NOT_QUEUED'
    live = create(operator, 'live')
    called = api('POST', f'/operator/windows/{WINDOWS[0]}/call-next', token=operator)[0]
    assert called['id'] == live['id'] and live['source'] == 'LIVE'
    api('POST', f'/operator/tickets/{live["id"]}/no-show', token=operator)
    api('POST', f'/operator/tickets/{live["id"]}/no-show', token=operator)
    events = api('GET', f'/admin/tickets/{live["id"]}/events', token=chief)[0]['items']
    assert sum(event['type'] == 'NO_SHOW' for event in events) == 1
    api('GET', f'/operator/windows/{WINDOWS[0]}/current-ticket', token=operator, status=204)
    for _ in range(10):
        queued = create()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda window: request('POST', f'/api/v1/operator/windows/{window}/call-next', token=operator), WINDOWS))
        assert sorted(result[0] for result in results) == [200,409]
        winner = next(result[1] for result in results if result[0] == 200)
        assert winner['id'] == queued['id']
        finish(winner, operator)
    unknown = str(uuid.uuid4())
    api('GET', f'/tickets/{unknown}/eta', status=404)
    api('GET', '/tickets/invalid/eta', status=400)
    api('POST', f'/branches/{unknown}/tickets/qr', {'serviceId': SERVICE}, key=str(uuid.uuid4()), status=404)
    api('POST', '/auth/logout', token=operator)
    api('GET', '/auth/me', token=operator, status=401)
    api('POST', '/auth/logout', token=chief)
    print(f'Sprint 4 Run {run}: PASS; concurrent CallNext 10/10', flush=True)

def restart():
    token = login('OPERATOR')
    ticket = create()
    policy = api('GET', f'/admin/branches/{BRANCH}/queue-policy', token=token)[0]
    subprocess.run(['docker','compose','restart','postgres','backend'], cwd=ROOT, check=True)
    for _ in range(60):
        try:
            if request('GET','/ready')[0] == 200:
                break
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(1)
    else:
        raise AssertionError('Restart readiness timeout')
    assert api('GET','/auth/me',token=token)[0]['role'] == 'employee'
    assert api('GET',f'/tickets/{ticket["id"]}')[0]['status'] == 'WAITING'
    assert api('GET',f'/admin/branches/{BRANCH}/queue-policy',token=token)[0] == policy
    drain(token)
    api('POST','/auth/logout',token=token)
    print('Restart queue/policy/session: PASS', flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--legacy', action='store_true')
    parser.add_argument('--restart', action='store_true')
    parser.add_argument('--runs', type=int, default=3)
    args = parser.parse_args()
    assert request('GET','/health')[0] == 200
    assert request('GET','/ready')[0] == 200
    if args.legacy:
        token = login('CHIEF')
        try:
            env = dict(os.environ, QA_SESSION_TOKEN=token, BASE_URL=BASE)
            for sprint in ['sprint1','sprint2','sprint3']:
                subprocess.run(['go','test','-count=1','./...'], cwd=ROOT/'qa'/sprint, env=env, check=True)
                print(sprint + ': PASS', flush=True)
        finally:
            api('POST','/auth/logout',token=token)
    for run in range(1,args.runs+1):
        sprint4(run)
    if args.restart:
        restart()

if __name__ == '__main__':
    main()

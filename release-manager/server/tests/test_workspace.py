import json

import pytest
from fastapi.testclient import TestClient

from server import app as module

SHA = 'a' * 40
HEADERS = {'x-cardiolink-request': '1'}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(module, 'DB_PATH', tmp_path / 'workspace.db')
    monkeypatch.setenv('CARDIOLINK_DISABLE_SYNC', '1')
    monkeypatch.setattr(module, 'fetch_checks', lambda *_: 'passed')
    with TestClient(module.app, headers=HEADERS) as c:
        with module.db() as db:
            for meta in module.REPOS:
                data = {**meta, 'sha': SHA, 'ci': 'passed', 'commits': [{'sha': SHA}], 'pulls': []}
                db.execute('INSERT INTO repositories VALUES (?,?)', (meta['id'], json.dumps(data)))
        yield c


def plan(client):
    response = client.post('/api/releases', json={
        'title': 'Platform 1.0', 'version': '1.0.0', 'environment': 'Staging',
        'owner': 'Release team', 'notes': 'Evidence: https://github.com/example/tests. Rollback: prior revision.',
        'components': [{'repo': 'cardiolink-device-gateway', 'sha': SHA}],
    })
    assert response.status_code == 201, response.text
    return response.json()


def complete(client, release):
    for gate in module.GATES:
        response = client.patch(f"/api/releases/{release['id']}/gates/{gate['id']}", json={'revision': release['revision'], 'checked': True})
        assert response.status_code == 200
        release = response.json()
    return release


def move(client, release, status, **kwargs):
    return client.post(f"/api/releases/{release['id']}/transition", json={'revision': release['revision'], 'status': status, **kwargs})


def test_release_lifecycle_is_durable_and_preserves_pins(client):
    release = complete(client, plan(client))
    release = move(client, release, 'ready').json()
    response = move(client, release, 'released', rollout_note='Deployment completed through approved release pipeline.')
    assert response.status_code == 200
    workspace = client.get('/api/workspace').json()
    stored = workspace['releases'][0]
    assert stored['status'] == 'released'
    assert stored['components'][0]['sha'] == SHA
    assert stored['ci_evidence']['cardiolink-device-gateway']['sha'] == SHA
    assert len(workspace['activity']) == 7
    with module.db() as db:
        assert module.get_release(db, release['id'])['status'] == 'released'


def test_readiness_and_rollout_require_evidence(client):
    release = plan(client)
    assert move(client, release, 'ready').status_code == 422
    assert move(client, release, 'released', rollout_note='done').status_code == 409
    release = complete(client, release)
    release = move(client, release, 'ready').json()
    assert move(client, release, 'released').status_code == 422


@pytest.mark.parametrize('state', ['failed', 'pending', 'incomplete'])
def test_exact_pinned_checks_block_readiness(client, monkeypatch, state):
    release = complete(client, plan(client))
    observed = []

    def check(repo, sha):
        observed.append((repo, sha))
        return state

    monkeypatch.setattr(module, 'fetch_checks', check)
    assert move(client, release, 'ready').status_code == 422
    assert observed == [('cardiolink-device-gateway', SHA)]


def test_github_failure_blocks_transition_but_unknown_ci_can_be_reviewed(client, monkeypatch):
    release = complete(client, plan(client))
    monkeypatch.setattr(module, 'fetch_checks', lambda *_: (_ for _ in ()).throw(RuntimeError()))
    assert move(client, release, 'ready').status_code == 502
    monkeypatch.setattr(module, 'fetch_checks', lambda *_: 'unknown')
    response = move(client, release, 'ready')
    assert response.status_code == 200
    assert response.json()['ci_evidence']['cardiolink-device-gateway']['state'] == 'unknown'


def test_concurrent_updates_fail_and_edit_resets_review(client):
    original = plan(client)
    release = complete(client, original)
    assert move(client, original, 'ready').status_code == 409
    payload = {key: release[key] for key in module.ReleaseInput.model_fields}
    payload['revision'] = release['revision']
    payload['title'] = 'Changed scope'
    edited = client.put(f"/api/releases/{release['id']}", json=payload)
    assert edited.status_code == 200
    assert not any(edited.json()['gates'].values())
    assert move(client, edited.json(), 'ready').status_code == 422


def test_released_record_and_checklist_cannot_be_changed(client):
    release = complete(client, plan(client))
    release = move(client, release, 'ready').json()
    assert client.patch(f"/api/releases/{release['id']}/gates/ci", json={'revision': release['revision'], 'checked': False}).status_code == 409
    release = move(client, release, 'released', rollout_note='Completed').json()
    assert move(client, release, 'draft').status_code == 409


def test_unknown_and_duplicate_repositories_are_rejected(client):
    release = plan(client)
    payload = {key: release[key] for key in module.ReleaseInput.model_fields}
    payload['components'] *= 2
    assert client.post('/api/releases', json=payload).status_code == 422
    payload['components'] = [{'repo': 'other-repo', 'sha': SHA}]
    assert client.post('/api/releases', json=payload).status_code == 422
    payload['components'] = [{'repo': 'cardiolink-device-gateway', 'sha': 'b' * 40}]
    assert client.post('/api/releases', json=payload).status_code == 422


def test_api_write_requires_same_origin_custom_header(client):
    response = client.post('/api/sync', headers={'x-cardiolink-request': ''})
    assert response.status_code == 403
    assert client.put('/api/releases/unknown', json={}, headers={'x-cardiolink-request': ''}).status_code == 403


@pytest.mark.parametrize('checks,statuses,expected', [
    ([], [], 'unknown'),
    ([{'status': 'completed', 'conclusion': 'neutral'}], [], 'unknown'),
    ([{'status': 'in_progress'}], [], 'pending'),
    ([{'status': 'completed', 'conclusion': 'cancelled'}], [], 'failed'),
    ([{'status': 'completed', 'conclusion': 'success'}], [{'state': 'failure'}], 'failed'),
    ([{'status': 'completed', 'conclusion': 'success'}], [], 'passed'),
])
def test_ci_classification(checks, statuses, expected):
    assert module.checks_state(checks, statuses) == expected


def test_failed_sync_preserves_snapshot_and_marks_it_stale(client, monkeypatch):
    monkeypatch.setattr(module, 'github', lambda *_: (_ for _ in ()).throw(RuntimeError()))
    result = module.fetch_repository(module.REPOS[0])
    assert result['sha'] == SHA
    assert result['error']


@pytest.mark.parametrize('conclusion,expected', [('failure', 'failed'), ('success', 'incomplete'), (None, 'pending')])
def test_truncated_check_runs_never_become_reviewable_unknown(monkeypatch, conclusion, expected):
    def github(path):
        if '/check-runs?' in path:
            return {'total_count': 101, 'check_runs': [{'status': 'completed' if conclusion else 'in_progress', 'conclusion': conclusion}]}
        return {'total_count': 0, 'statuses': []}

    monkeypatch.setattr(module, 'github', github)
    assert module.fetch_checks('cardiolink-device-gateway', SHA) == expected


@pytest.mark.parametrize('state,expected', [('failure', 'failed'), ('success', 'incomplete'), ('pending', 'pending')])
def test_truncated_statuses_never_become_reviewable_unknown(monkeypatch, state, expected):
    def github(path):
        if '/check-runs?' in path:
            return {'total_count': 0, 'check_runs': []}
        return {'total_count': 101, 'statuses': [{'state': state}]}

    monkeypatch.setattr(module, 'github', github)
    assert module.fetch_checks('cardiolink-device-gateway', SHA) == expected


def test_newly_incomplete_ci_blocks_recording_a_ready_release(client, monkeypatch):
    release = complete(client, plan(client))
    release = move(client, release, 'ready').json()
    monkeypatch.setattr(module, 'fetch_checks', lambda *_: 'incomplete')
    response = move(client, release, 'released', rollout_note='Completed')
    assert response.status_code == 422
    assert client.get('/api/workspace').json()['releases'][0]['status'] == 'ready'

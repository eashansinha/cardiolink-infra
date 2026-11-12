"""CardioLink release workspace. GitHub access is strictly read-only."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
import json
import os
import re
import sqlite3
import subprocess
import threading
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

REPOS = [
    {"id": "cardiolink-clinician-portal", "name": "Clinician portal", "description": "Clinical readings and device reports", "language": "TypeScript", "kind": "Application", "depends_on": ["cardiolink-shared-auth"]},
    {"id": "cardiolink-device-gateway", "name": "Device gateway", "description": "Device ingestion and OTA firmware delivery", "language": "Python", "kind": "Service", "depends_on": ["cardiolink-shared-auth", "cardiolink-infra"]},
    {"id": "cardiolink-telemetry-gateway", "name": "Telemetry gateway", "description": "Telemetry validation, alerts and reporting", "language": "Java", "kind": "Service", "depends_on": []},
    {"id": "cardiolink-shared-auth", "name": "Shared auth", "description": "Shared token issuance and verification", "language": "Python", "kind": "Library", "depends_on": []},
    {"id": "cardiolink-infra", "name": "Infrastructure", "description": "AWS infrastructure and local orchestration", "language": "Terraform", "kind": "Infrastructure", "depends_on": []},
]
REPO_IDS = {r['id'] for r in REPOS}
GATES = [
    {"id": "scope", "title": "Scope and dependencies reviewed", "description": "Confirm included revisions and impact on connected services."},
    {"id": "verification", "title": "Verification evidence reviewed", "description": "Review test results and attach evidence links in the release notes."},
    {"id": "ci", "title": "CI coverage reviewed", "description": "Confirm available checks. If no checks exist, document the manual verification in release notes."},
    {"id": "rollback", "title": "Rollout and rollback plan documented", "description": "Include the rollout sequence and rollback revisions in the release notes."},
]
DB_PATH = Path(os.environ.get('CARDIOLINK_DATA_DIR', str(Path.home() / '.local/share/cardiolink-release-manager'))) / 'workspace.db'
SYNC_LOCK = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=20)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize():
    with db() as c:
        c.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, release_id TEXT, title TEXT NOT NULL, detail TEXT NOT NULL);
        ''')


def event(c, release_id, title, detail):
    c.execute('INSERT INTO activity (time, release_id, title, detail) VALUES (?,?,?,?)', (now(), release_id, title, detail))


def github(path):
    # No shell, user-controlled paths, or write-capable arguments.
    proc = subprocess.run(['gh', 'api', '-H', 'Accept: application/vnd.github+json', f'repos/eashansinha/{path}'], capture_output=True, text=True, timeout=25)
    if proc.returncode:
        raise RuntimeError('GitHub data unavailable. Check the server’s gh authentication and repository access.')
    return json.loads(proc.stdout)


def checks_state(checks, statuses):
    values = [x.get('conclusion') if x.get('status') == 'completed' else 'pending' for x in checks]
    values += [x.get('state') for x in statuses]
    if any(x in ('failure', 'error', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale') for x in values):
        return 'failed'
    if any(x in (None, 'pending', 'queued', 'in_progress', 'waiting', 'requested') for x in values):
        return 'pending'
    if not values or all(x in ('skipped', 'neutral') for x in values):
        return 'unknown'
    return 'passed'


def fetch_checks(repo_id, sha):
    checks = github(f'{repo_id}/commits/{sha}/check-runs?per_page=100')
    status = github(f'{repo_id}/commits/{sha}/status?per_page=100')
    # A truncated check set must not produce a green readiness gate.
    if checks.get('total_count', 0) > 100 or status.get('total_count', 0) > 100:
        return 'unknown'
    return checks_state(checks.get('check_runs', []), status.get('statuses', []))


def fetch_repository(meta):
    try:
        info = github(meta['id'])
        commits = github(f"{meta['id']}/commits?sha={info['default_branch']}&per_page=6")
        pulls = github(f"{meta['id']}/pulls?state=open&per_page=100")
        releases = github(f"{meta['id']}/releases?per_page=1")
        head = commits[0]
        return {**meta, 'url': info['html_url'], 'branch': info['default_branch'], 'sha': head['sha'],
                'ci': fetch_checks(meta['id'], head['sha']), 'synced_at': now(), 'error': None,
                'latest_release': releases[0]['tag_name'] if releases else None,
                'commits': [{'sha': x['sha'], 'title': x['commit']['message'].split('\n')[0], 'date': x['commit']['committer']['date'], 'url': x['html_url']} for x in commits],
                'pulls': [{'number': p['number'], 'title': p['title'], 'url': p['html_url'], 'author': p['user']['login'], 'draft': p['draft'], 'updated_at': p['updated_at']} for p in pulls],
                'pulls_truncated': len(pulls) == 100}
    except Exception:
        with db() as c:
            row = c.execute('SELECT data FROM repositories WHERE id=?', (meta['id'],)).fetchone()
        old = json.loads(row['data']) if row else {**meta, 'url': f"https://github.com/eashansinha/{meta['id']}", 'branch': 'main', 'sha': None, 'ci': 'unknown', 'synced_at': None, 'pulls': [], 'commits': [], 'latest_release': None}
        return {**old, 'error': 'GitHub sync failed. Showing the last available snapshot.'}


def sync_repositories():
    if not SYNC_LOCK.acquire(blocking=False):
        return False
    try:
        with ThreadPoolExecutor(max_workers=5) as executor:
            snapshots = list(executor.map(fetch_repository, REPOS))
        with db() as c:
            for snapshot in snapshots:
                c.execute('INSERT OR REPLACE INTO repositories VALUES (?,?)', (snapshot['id'], json.dumps(snapshot)))
        return True
    finally:
        SYNC_LOCK.release()


def background_sync(stop):
    sync_repositories()
    while not stop.wait(300):
        sync_repositories()


@asynccontextmanager
async def lifespan(app):
    initialize()
    stop = threading.Event()
    worker = None
    if os.environ.get('CARDIOLINK_DISABLE_SYNC') != '1':
        worker = threading.Thread(target=background_sync, args=(stop,), daemon=True)
        worker.start()
    yield
    stop.set()


app = FastAPI(title='CardioLink release workspace', lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware('http')
async def request_security(request: Request, call_next):
    if request.url.path.startswith('/api/') and request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
        if request.headers.get('x-cardiolink-request') != '1':
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail': 'Same-origin workspace request required.'}, status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


class Component(BaseModel):
    model_config = ConfigDict(extra='forbid')
    repo: str
    sha: str = Field(pattern=r'^[a-f0-9]{40}$')


class ReleaseInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=40, pattern=r'^[a-zA-Z0-9][a-zA-Z0-9._+\-]*$')
    owner: str = Field(max_length=100, default='')
    target_date: date | None = None
    environment: str = Field(pattern='^(Integration|Staging|Production)$')
    notes: str = Field(max_length=30000, default='')
    components: list[Component] = Field(min_length=1, max_length=5)


class ReleaseUpdate(ReleaseInput):
    revision: int


class GateInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int
    checked: bool


class TransitionInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int
    status: str = Field(pattern='^(draft|ready|released)$')
    rollout_note: str = Field(max_length=2000, default='')


def repositories(c):
    found = {r['id']: json.loads(r['data']) for r in c.execute('SELECT * FROM repositories')}
    return [found.get(m['id'], {**m, 'sha': None, 'ci': 'unknown', 'pulls': [], 'commits': [], 'synced_at': None, 'error': 'Waiting for first GitHub sync.', 'url': f"https://github.com/eashansinha/{m['id']}", 'branch': 'main', 'latest_release': None}) for m in REPOS]


def get_release(c, release_id):
    row = c.execute('SELECT data FROM releases WHERE id=?', (release_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Release not found.')
    return json.loads(row['data'])


def validate_components(c, components):
    if len({x.repo for x in components}) != len(components):
        raise HTTPException(422, 'Include each repository only once.')
    snapshots = {r['id']: r for r in repositories(c)}
    for item in components:
        if item.repo not in REPO_IDS:
            raise HTTPException(422, 'Unknown CardioLink repository.')
        # Only refs observed in trusted GitHub snapshots can be pinned.
        if item.sha not in {x['sha'] for x in snapshots[item.repo]['commits']}:
            raise HTTPException(422, 'Revision is not in the repository snapshot. Refresh GitHub and try again.')


def save(c, release):
    c.execute('UPDATE releases SET data=? WHERE id=?', (json.dumps(release), release['id']))


def check_revision(release, revision):
    if release['revision'] != revision:
        raise HTTPException(409, 'This release changed in another tab. Refresh and try again.')


def bump(release):
    release['revision'] += 1
    release['updated_at'] = now()


def readiness(release):
    blockers = []
    if not release['owner'].strip():
        blockers.append('Assign a release owner.')
    if not release['notes'].strip():
        blockers.append('Add verification evidence, rollout and rollback notes.')
    incomplete = [g['title'] for g in GATES if not release['gates'].get(g['id'])]
    blockers.extend(incomplete)
    return blockers


@app.get('/api/workspace')
def workspace():
    with db() as c:
        return {'repositories': repositories(c), 'releases': [json.loads(x['data']) for x in c.execute('SELECT data FROM releases ORDER BY rowid DESC')],
                'activity': [dict(x) for x in c.execute('SELECT * FROM activity ORDER BY id DESC LIMIT 200')], 'gates': GATES, 'syncing': SYNC_LOCK.locked()}


@app.post('/api/sync')
def sync():
    if not sync_repositories():
        raise HTTPException(409, 'A GitHub refresh is already running.')
    return {'ok': True}


@app.post('/api/releases', status_code=201)
def create_release(body: ReleaseInput):
    if not body.title.strip():
        raise HTTPException(422, 'Release name is required.')
    release = {**body.model_dump(mode='json'), 'id': str(uuid.uuid4()), 'status': 'draft', 'gates': {g['id']: False for g in GATES}, 'created_at': now(), 'updated_at': now(), 'revision': 1, 'rollout_note': '', 'ci_evidence': {}}
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        validate_components(c, body.components)
        c.execute('INSERT INTO releases VALUES (?,?)', (release['id'], json.dumps(release)))
        event(c, release['id'], 'Release planned', f"{release['title']} · {release['version']} · {release['environment']}")
    return release


@app.put('/api/releases/{release_id}')
def update_release(release_id: str, body: ReleaseUpdate):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        release = get_release(c, release_id)
        check_revision(release, body.revision)
        if release['status'] != 'draft':
            raise HTTPException(409, 'Move the release back to draft before editing.')
        if not body.title.strip():
            raise HTTPException(422, 'Release name is required.')
        # Existing immutable pins remain valid after falling out of the recent commit list.
        previous = {(x['repo'], x['sha']) for x in release['components']}
        validate_components(c, [x for x in body.components if (x.repo, x.sha) not in previous])
        if len({x.repo for x in body.components}) != len(body.components):
            raise HTTPException(422, 'Include each repository only once.')
        release.update(body.model_dump(mode='json', exclude={'revision'}))
        release['gates'] = {g['id']: False for g in GATES}
        release['ci_evidence'] = {}
        bump(release)
        save(c, release)
        event(c, release_id, 'Release updated', f"{release['title']} · Checklist reset for the changed plan")
    return release


@app.patch('/api/releases/{release_id}/gates/{gate_id}')
def update_gate(release_id: str, gate_id: str, body: GateInput):
    if gate_id not in {g['id'] for g in GATES}:
        raise HTTPException(404, 'Checklist item not found.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        release = get_release(c, release_id)
        check_revision(release, body.revision)
        if release['status'] != 'draft':
            raise HTTPException(409, 'Only draft checklists can be changed.')
        release['gates'][gate_id] = body.checked
        bump(release)
        save(c, release)
        label = next(g['title'] for g in GATES if g['id'] == gate_id)
        event(c, release_id, 'Checklist updated', f"{label} · {'Complete' if body.checked else 'Reopened'}")
    return release


@app.post('/api/releases/{release_id}/transition')
def transition(release_id: str, body: TransitionInput):
    # Optimistic check before slow GitHub calls; repeat under the write lock below.
    with db() as c:
        release = get_release(c, release_id)
        check_revision(release, body.revision)
    allowed = {('draft', 'ready'), ('ready', 'draft'), ('ready', 'released')}
    if (release['status'], body.status) not in allowed:
        raise HTTPException(409, 'That status transition is not available.')
    evidence = {}
    if body.status in ('ready', 'released'):
        blockers = readiness(release)
        if blockers:
            raise HTTPException(422, 'Complete release readiness: ' + '; '.join(blockers))
        # Always recheck the exact pinned revisions; default-branch green is not evidence.
        for item in release['components']:
            try:
                state = fetch_checks(item['repo'], item['sha'])
            except Exception:
                raise HTTPException(502, 'Could not verify pinned revisions with GitHub. Try again after refreshing.')
            evidence[item['repo']] = {'sha': item['sha'], 'state': state, 'checked_at': now()}
            if state in ('failed', 'pending'):
                raise HTTPException(422, f"{item['repo']} has {state} checks on the pinned revision.")
        if body.status == 'released' and not body.rollout_note.strip():
            raise HTTPException(422, 'Describe the completed rollout before recording a release.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        release = get_release(c, release_id)
        check_revision(release, body.revision)
        release['status'] = body.status
        release['ci_evidence'] = evidence
        if body.status == 'released':
            release['rollout_note'] = body.rollout_note.strip()
            release['released_at'] = now()
        bump(release)
        save(c, release)
        event(c, release_id, {'draft': 'Release returned to draft', 'ready': 'Release marked ready', 'released': 'Completed rollout recorded'}[body.status], f"{release['title']} · {release['version']}" + (f" · {release['rollout_note']}" if body.status == 'released' else ''))
    return release


@app.get('/api/health')
def health():
    with db() as c:
        c.execute('SELECT 1')
    return {'ok': True}


DIST = Path(__file__).resolve().parents[1] / 'dist'
if DIST.exists():
    app.mount('/assets', StaticFiles(directory=DIST / 'assets'), name='assets')


@app.get('/favicon.svg')
def favicon():
    return FileResponse(Path(__file__).resolve().parents[1] / 'public/favicon.svg')


@app.get('/')
def index():
    if not DIST.exists():
        raise HTTPException(503, 'Build the frontend with npm run build first.')
    return FileResponse(DIST / 'index.html', headers={'Cache-Control': 'no-cache'})

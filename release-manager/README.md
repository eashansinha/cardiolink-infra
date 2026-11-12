# CardioLink release workspace

Internal release planning for all five CardioLink repositories, hosted as a Devin App. GitHub access is **read-only**. This tool does not deploy services, merge PRs, publish tags, or issue regulated approvals.

## Run

Requirements: Node 22+, Python 3.10+, and the GitHub CLI authenticated with read access to the five `eashansinha/cardiolink-*` repos. Credentials stay on the server; no GitHub token is sent to the browser.

```sh
python -m pip install -r requirements.txt
npm ci
npm run build
PORT=8100 npm start
```

Serve the production server behind the Devin App authenticated proxy. Do not expose its port directly to the internet: workspace authorization is supplied by that proxy. All organization members who can access the app can edit the shared workspace. There is no separate application-level RBAC or individual electronic signature system.

For frontend development, run the API with `npm start` and Vite with `npm run dev` (API requests proxy to port 8100). Do not deploy the Vite development server.

## Workflow

1. Refresh GitHub snapshots. The server also refreshes them every five minutes. Failed refreshes retain the previous snapshot with a visible stale-data warning.
2. Plan a release: choose a version, environment, owner, optional date, and repository commits from the six most recent default-branch commits. Selected SHAs are immutable pins, not moving branch references.
3. Add release notes containing test/evidence links, rollout order and rollback instructions, then complete the shared readiness checklist. Editing the plan resets that checklist.
4. Mark ready. The server re-fetches checks for **each pinned commit**. Running, failed or cancelled checks block readiness; GitHub errors block the operation. Responses with more than 100 checks or status contexts are incomplete and also block readiness. Missing, skipped or neutral checks are inconclusive and require the explicit manual CI-coverage checklist review. The tool cannot establish that a person performed the documented tests.
5. Deploy using your existing release process. Then record the completed rollout with a note. This rechecks the pinned commits and retains the check snapshot. Released records cannot be edited; a ready record can return to draft for changes.

Readiness records and owner names are planning metadata, **not regulatory sign-offs**. Activity describes shared workspace actions and is not attributed to authenticated individuals. SQLite activity is a practical change history, not a tamper-evident compliance audit. Only the latest 200 events are displayed; older events remain in the database. Open PR lists are capped at 100 per repository and labeled if truncated. Repository relationships are documentation-derived references, not an automatically verified deployment graph.

## Data and operations

- Default database: `~/.local/share/cardiolink-release-manager/workspace.db`, outside the build/repo. Override the directory with `CARDIOLINK_DATA_DIR`. This directory is private to the host; do not commit or serve it.
- Back up with SQLite's online backup API (or `sqlite3 workspace.db '.backup backup.db'`). Copying only the live `.db` file can lose WAL changes. No automatic external backup is configured.
- `GET /api/health` verifies the database can be opened.
- `GET /api/workspace` supplies cached repository data and persistent release records.
- Use a single Uvicorn worker. Refresh coordination is in-process, and SQLite serializes record writes. Revision checks reject stale concurrent edits with HTTP 409.
- Mutation endpoints require a custom same-origin request header; no cross-origin access is enabled.
- `CARDIOLINK_DISABLE_SYNC=1` disables background GitHub calls for isolated tests.
- A Devin App visit can wake the managing session. Archiving or ending that session takes the app offline. If the server crashes, restart it and redeploy using the managing session.
- For a new version, build and commit, start on another port, deploy under the same app name, then stop the previous version after traffic switches. Use the same persistent data directory.

## Verify

```sh
npm test
npm run build
```

Tests use a temporary **real SQLite database**, with mocked GitHub responses. They cover readiness, exact-SHA CI gating, transitions, immutable released records, checklist invalidation, conflicts, stale snapshots and input validation. Browser verification should use a signed-in Devin preview, exercise desktop and mobile, and use an isolated `CARDIOLINK_DATA_DIR` so test rollouts are not confused with actual release records.

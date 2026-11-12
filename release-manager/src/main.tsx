import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Box,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Clock3,
  ExternalLink,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Layers3,
  LayoutDashboard,
  Loader2,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import "./style.css";

type CI = "passed" | "failed" | "pending" | "unknown" | "incomplete";
type Repo = {
  id: string;
  name: string;
  description: string;
  language: string;
  kind: string;
  depends_on: string[];
  sha: string | null;
  branch: string;
  ci: CI;
  url: string;
  synced_at: string | null;
  error: string | null;
  latest_release: string | null;
  pulls_truncated?: boolean;
  pulls: {
    number: number;
    title: string;
    url: string;
    author: string;
    draft: boolean;
    updated_at: string;
  }[];
  commits: { sha: string; title: string; date: string; url: string }[];
};
type Release = {
  id: string;
  title: string;
  version: string;
  owner: string;
  environment: string;
  target_date: string | null;
  notes: string;
  status: "draft" | "ready" | "released";
  components: { repo: string; sha: string }[];
  gates: Record<string, boolean>;
  revision: number;
  created_at: string;
  updated_at: string;
  released_at?: string;
  rollout_note: string;
  ci_evidence: Record<string, { sha: string; state: CI; checked_at: string }>;
};
type Gate = { id: string; title: string; description: string };
type Event = {
  id: number;
  time: string;
  release_id: string | null;
  title: string;
  detail: string;
};
type Workspace = {
  repositories: Repo[];
  releases: Release[];
  gates: Gate[];
  activity: Event[];
  syncing: boolean;
};
type ReleaseForm = Pick<
  Release,
  | "title"
  | "version"
  | "owner"
  | "environment"
  | "target_date"
  | "notes"
  | "components"
>;
const SESSION =
  "https://devin-gtm.devinenterprise.com/sessions/7a09fa5c61d347c4b7f3120b41590af8";
const names: Record<string, string> = {
  "cardiolink-clinician-portal": "Clinician portal",
  "cardiolink-device-gateway": "Device gateway",
  "cardiolink-telemetry-gateway": "Telemetry gateway",
  "cardiolink-shared-auth": "Shared auth",
  "cardiolink-infra": "Infrastructure",
};
const short = (sha: string) => sha.slice(0, 7);
const fmtDate = (value?: string | null) =>
  value
    ? new Date(
        value.length === 10 ? value + "T12:00:00" : value,
      ).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Unscheduled";
const timeAgo = (value?: string | null) => {
  if (!value) return "Not synced";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : fmtDate(value);
};
const go = (path: string) => {
  window.location.hash = path;
};

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CardioLink-Request": "1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.detail === "string"
        ? error.detail
        : `Request failed (${response.status}). Check the fields and try again.`,
    );
  }
  return response.json();
}

function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo-mark ${small ? "small" : ""}`}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M3 17h7l3-9 6 17 3-8h7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {status === "ready"
        ? "Ready"
        : status === "released"
          ? "Released"
          : "Draft"}
    </span>
  );
}
function CIStatus({ state }: { state: CI }) {
  const label = {
    passed: "Checks passed",
    failed: "Checks failed",
    pending: "Checks running",
    unknown: "No conclusive checks",
    incomplete: "Checks incomplete",
  }[state];
  return (
    <span className={`ci ${state}`}>
      {state === "passed" ? (
        <CircleCheck size={14} />
      ) : state === "pending" ? (
        <Clock3 size={14} />
      ) : (
        <CircleDot size={14} />
      )}{" "}
      {label}
    </span>
  );
}
function RepoIcon({ repo }: { repo: string }) {
  const Icon = repo.includes("infra")
    ? Layers3
    : repo.includes("auth")
      ? ShieldCheck
      : repo.includes("telemetry")
        ? Activity
        : repo.includes("portal")
          ? LayoutDashboard
          : Box;
  return (
    <span className={`repo-icon ${repo.split("-").pop()}`}>
      <Icon size={19} />
    </span>
  );
}
function Empty({
  icon: Icon = Layers3,
  title,
  children,
  action,
}: {
  icon?: typeof Layers3;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const saved = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      ref.current?.querySelector<HTMLElement>(
        "input:not(:disabled),textarea",
      ) || ref.current?.querySelector<HTMLElement>("button")
    )?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,a[href]",
        );
        if (!items?.length) return;
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === items[items.length - 1]
        ) {
          event.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = saved;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog ${wide ? "wide" : ""}`}
      >
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReleaseEditor({
  repositories,
  release,
  onClose,
  onSave,
}: {
  repositories: Repo[];
  release: Release | null;
  onClose: () => void;
  onSave: (data: ReleaseForm) => Promise<void>;
}) {
  const [form, setForm] = useState<ReleaseForm>(
    release
      ? { ...release }
      : {
          title: "",
          version: "",
          owner: "",
          environment: "Staging",
          target_date: null,
          notes: "",
          components: repositories
            .filter((r) => r.sha)
            .map((r) => ({ repo: r.id, sha: r.sha! })),
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: string, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({
        title: form.title.trim(),
        version: form.version.trim(),
        owner: form.owner.trim(),
        environment: form.environment,
        target_date: form.target_date || null,
        notes: form.notes,
        components: form.components,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={release ? "Edit release plan" : "Plan a release"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={submit}>
        <div className="dialog-body">
          <p className="form-intro">
            Bring the right revisions together. New plans start as drafts.
          </p>
          <div className="form-grid">
            <label className="full">
              Release name
              <input
                required
                maxLength={120}
                placeholder="e.g. November platform release"
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
              />
            </label>
            <label>
              Version
              <input
                required
                maxLength={40}
                pattern="[a-zA-Z0-9][a-zA-Z0-9._+\-]*"
                placeholder="e.g. 2026.11.0"
                value={form.version}
                onChange={(e) => update("version", e.target.value)}
              />
            </label>
            <label>
              Environment
              <select
                value={form.environment}
                onChange={(e) => update("environment", e.target.value)}
              >
                {["Integration", "Staging", "Production"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Release owner
              <input
                maxLength={100}
                placeholder="Name or team"
                value={form.owner}
                onChange={(e) => update("owner", e.target.value)}
              />
            </label>
            <label>
              Target date
              <input
                type="date"
                value={form.target_date || ""}
                onChange={(e) => update("target_date", e.target.value || null)}
              />
            </label>
          </div>
          <fieldset>
            <legend>
              Included repositories{" "}
              <span>{form.components.length} selected</span>
            </legend>
            <p className="field-help">
              Revisions are pinned to exact commits. Later commits won’t change
              this plan.
            </p>
            <div className="component-picker">
              {repositories.map((repo) => {
                const selected = form.components.find(
                  (c) => c.repo === repo.id,
                );
                return (
                  <div className="pick-row" key={repo.id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={!repo.sha && !selected}
                        checked={!!selected}
                        onChange={(e) =>
                          update(
                            "components",
                            e.target.checked
                              ? [
                                  ...form.components,
                                  { repo: repo.id, sha: repo.sha! },
                                ]
                              : form.components.filter(
                                  (c) => c.repo !== repo.id,
                                ),
                          )
                        }
                      />
                      <RepoIcon repo={repo.id} />
                      <span>
                        {repo.name}
                        <small>
                          {repo.branch}
                          {!repo.sha ? " · Awaiting sync" : ""}
                        </small>
                      </span>
                    </label>
                    {selected && (
                      <select
                        aria-label={`Revision for ${repo.name}`}
                        value={selected.sha}
                        onChange={(e) =>
                          update(
                            "components",
                            form.components.map((c) =>
                              c.repo === repo.id
                                ? { ...c, sha: e.target.value }
                                : c,
                            ),
                          )
                        }
                      >
                        {!repo.commits.some((c) => c.sha === selected.sha) && (
                          <option value={selected.sha}>
                            {short(selected.sha)} · Pinned
                          </option>
                        )}
                        {repo.commits.map((c, i) => (
                          <option key={c.sha} value={c.sha}>
                            {short(c.sha)}
                            {i === 0 ? " · Latest" : ""} ·{" "}
                            {c.title.slice(0, 40)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
          <label className="notes-label">
            Release notes
            <textarea
              rows={5}
              maxLength={30000}
              placeholder={
                "What’s changing?\nVerification evidence: …\nRollout sequence: …\nRollback plan: …"
              }
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          </label>
          {release && (
            <div className="notice">
              Saving changes resets the readiness checklist so the updated plan
              can be reviewed.
            </div>
          )}
          {error && (
            <div role="alert" className="error-box">
              {error}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !form.components.length}
          >
            {busy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}{" "}
            {release ? "Save changes" : "Create release plan"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ReleaseTable({ releases }: { releases: Release[] }) {
  return (
    <div className="table-scroll">
      <table className="release-table">
        <thead>
          <tr>
            <th>Release</th>
            <th>Status</th>
            <th>Environment</th>
            <th>Repositories</th>
            <th>Target date</th>
            <th>Owner</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {releases.map((r) => (
            <tr key={r.id}>
              <td>
                <button
                  className="table-link"
                  onClick={() => go(`release/${r.id}`)}
                >
                  {r.title}
                  <small className="mono">{r.version}</small>
                </button>
              </td>
              <td>
                <Badge status={r.status} />
              </td>
              <td>
                <span className="environment">
                  <span />
                  {r.environment}
                </span>
              </td>
              <td>
                <span className="repo-count">
                  <Layers3 size={14} />
                  {r.components.length} repositories
                </span>
              </td>
              <td className="muted nowrap">{fmtDate(r.target_date)}</td>
              <td>
                <span className="owner">
                  {r.owner && (
                    <span className="avatar">
                      {r.owner.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {r.owner || <span className="muted">Unassigned</span>}
                </span>
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Open ${r.title}`}
                  onClick={() => go(`release/${r.id}`)}
                >
                  <ChevronRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Overview({
  data,
  onCreate,
}: {
  data: Workspace;
  onCreate: () => void;
}) {
  const draft = data.releases.filter((r) => r.status === "draft");
  const ready = data.releases.filter((r) => r.status === "ready");
  const shipped = data.releases.filter((r) => r.status === "released");
  const upcoming = [...ready, ...draft][0];
  const pulls = data.repositories.flatMap((r) =>
    r.pulls.map((p) => ({ ...p, repo: r.id })),
  );
  return (
    <>
      <Heading
        title="Release overview"
        description="One workspace for everything shipping across CardioLink."
        action={
          <button className="button primary" onClick={onCreate}>
            <Plus size={16} />
            Plan a release
          </button>
        }
      />
      <div className="overview-metrics">
        <div>
          <span className="metric-icon blue">
            <Layers3 size={18} />
          </span>
          <div>
            <span className="metric-label">Connected repositories</span>
            <strong>
              {data.repositories.length.toString().padStart(2, "0")}
            </strong>
          </div>
          <span className="metric-detail">Platform-wide visibility</span>
        </div>
        <div>
          <span className="metric-icon">
            <FileText size={18} />
          </span>
          <div>
            <span className="metric-label">In planning</span>
            <strong>{draft.length.toString().padStart(2, "0")}</strong>
          </div>
          <span className="metric-detail">Draft release plans</span>
        </div>
        <div>
          <span className="metric-icon green">
            <CheckCheck size={18} />
          </span>
          <div>
            <span className="metric-label">Ready to release</span>
            <strong>{ready.length.toString().padStart(2, "0")}</strong>
          </div>
          <span className="metric-detail">Readiness reviewed</span>
        </div>
        <div>
          <span className="metric-icon">
            <GitPullRequest size={18} />
          </span>
          <div>
            <span className="metric-label">Open pull requests</span>
            <strong>{pulls.length.toString().padStart(2, "0")}</strong>
          </div>
          <span className="metric-detail">Across connected repos</span>
        </div>
      </div>
      <section className="panel platform-panel">
        <div className="section-heading">
          <div>
            <h2>Platform snapshot</h2>
            <p>The latest default-branch revision in each repository.</p>
          </div>
          <button className="text-button" onClick={() => go("repositories")}>
            View repositories
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="platform-grid">
          {data.repositories.map((repo) => (
            <button
              key={repo.id}
              className="platform-repo"
              onClick={() => go(`repository/${repo.id}`)}
            >
              <div className="platform-repo-top">
                <RepoIcon repo={repo.id} />
                <ArrowUpRight size={14} />
              </div>
              <strong>{repo.name}</strong>
              <span>{repo.kind}</span>
              <div className="platform-ref">
                <GitBranch size={12} />
                {repo.branch}
                <code>{repo.sha ? short(repo.sha) : "—"}</code>
              </div>
              <CIStatus state={repo.ci} />
              {repo.error && (
                <small className="warning-text">
                  Snapshot unavailable or stale
                </small>
              )}
            </button>
          ))}
        </div>
        <div className="platform-footer">
          <span>
            <span className="live-dot" />
            GitHub snapshots refresh every 5 minutes
          </span>
          <span>Exact revisions are pinned when you plan a release</span>
        </div>
      </section>
      <div className="overview-columns">
        <section className="panel next-release">
          <div className="section-heading">
            <h2>Next up</h2>
            <span className="subtle-label">Release planning</span>
          </div>
          {upcoming ? (
            <div className="next-content">
              <div className="next-top">
                <span className="version-pill mono">{upcoming.version}</span>
                <Badge status={upcoming.status} />
              </div>
              <button
                className="next-title"
                onClick={() => go(`release/${upcoming.id}`)}
              >
                {upcoming.title}
                <ArrowUpRight size={20} />
              </button>
              <div className="next-meta">
                <span>
                  <Layers3 size={15} />
                  {upcoming.components.length} repositories
                </span>
                <span>
                  <CalendarDays size={15} />
                  {fmtDate(upcoming.target_date)}
                </span>
              </div>
              <div className="progress-label">
                <span>Readiness checklist</span>
                <span>
                  {Object.values(upcoming.gates).filter(Boolean).length} /{" "}
                  {data.gates.length}
                </span>
              </div>
              <div className="segmented-progress">
                {data.gates.map((g) => (
                  <span
                    key={g.id}
                    className={upcoming.gates[g.id] ? "complete" : ""}
                  />
                ))}
              </div>
              <div className="next-footer">
                <span className="muted">
                  {upcoming.environment} environment
                </span>
                <button
                  className="text-button"
                  onClick={() => go(`release/${upcoming.id}`)}
                >
                  Open release
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ) : (
            <Empty
              title="Your next release starts here"
              icon={GitBranch}
              action={
                <button className="button" onClick={onCreate}>
                  <Plus size={15} />
                  Create the first plan
                </button>
              }
            >
              Pin revisions, collect evidence, and keep the whole team on the
              same page.
            </Empty>
          )}
        </section>
        <section className="panel pr-panel">
          <div className="section-heading">
            <h2>
              In the pipeline <span className="count">{pulls.length}</span>
            </h2>
            <span className="subtle-label">Open pull requests</span>
          </div>
          {pulls.length ? (
            <div className="pr-list">
              {pulls.slice(0, 4).map((p) => (
                <a
                  key={`${p.repo}-${p.number}`}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="pr-item"
                >
                  <GitPullRequest size={17} />
                  <div>
                    <strong>{p.title}</strong>
                    <small>
                      {names[p.repo]} <span className="mono">#{p.number}</span>
                      {p.draft ? " · Draft" : ""}
                    </small>
                  </div>
                  <ArrowUpRight size={14} />
                </a>
              ))}
            </div>
          ) : (
            <Empty title="The pipeline is clear" icon={GitPullRequest}>
              No open pull requests in the latest GitHub snapshot.
            </Empty>
          )}
          <div className="panel-bottom">
            <span>
              {shipped.length} release{shipped.length !== 1 ? "s" : ""} recorded
            </span>
            <button className="text-button" onClick={() => go("activity")}>
              View activity
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>
              Release plans{" "}
              <span className="count">{data.releases.length}</span>
            </h2>
          </div>
          <button className="text-button" onClick={() => go("releases")}>
            View all
            <ArrowRight size={14} />
          </button>
        </div>
        {data.releases.length ? (
          <ReleaseTable releases={data.releases.slice(0, 5)} />
        ) : (
          <div className="empty-row">
            <FileText size={16} />
            No release plans yet. Create a plan to coordinate your next rollout.
          </div>
        )}
      </section>
    </>
  );
}

function Releases({
  releases,
  onCreate,
}: {
  releases: Release[];
  onCreate: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const visible = releases.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      `${r.title} ${r.version} ${r.owner}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <Heading
        title="Release plans"
        description="Coordinate revisions, readiness, and rollout records in one place."
        action={
          <button className="button primary" onClick={onCreate}>
            <Plus size={16} />
            Plan a release
          </button>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <div className="tabs">
            {[
              ["all", "All releases"],
              ["draft", "Draft"],
              ["ready", "Ready"],
              ["released", "Released"],
            ].map(([value, label]) => (
              <button
                className={filter === value ? "active" : ""}
                key={value}
                onClick={() => setFilter(value)}
              >
                {label}
                <span>
                  {
                    releases.filter(
                      (r) => value === "all" || r.status === value,
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          <label className="filter-search">
            <Search size={15} />
            <input
              aria-label="Filter release plans"
              placeholder="Filter releases…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {visible.length ? (
          <ReleaseTable releases={visible} />
        ) : (
          <Empty
            title={
              releases.length
                ? "No matching releases"
                : "Plan your first release"
            }
            icon={FileText}
            action={
              !releases.length ? (
                <button className="button" onClick={onCreate}>
                  <Plus size={15} />
                  Plan a release
                </button>
              ) : (
                <button
                  className="text-button"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              )
            }
          >
            {releases.length
              ? "Try another search or status filter."
              : "Choose the services shipping together and pin their exact revisions."}
          </Empty>
        )}
      </section>
    </>
  );
}

function Repositories({ repositories }: { repositories: Repo[] }) {
  return (
    <>
      <Heading
        title="Repositories"
        description="Five connected codebases. A complete view of the CardioLink platform."
      />
      <div className="repo-grid">
        {repositories.map((repo) => (
          <section className="panel repository-card" key={repo.id}>
            <div className="repository-card-top">
              <RepoIcon repo={repo.id} />
              <span className="kind">{repo.kind}</span>
              <a
                href={repo.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${repo.name} on GitHub`}
              >
                <ExternalLink size={15} />
              </a>
            </div>
            <button
              className="repository-title"
              onClick={() => go(`repository/${repo.id}`)}
            >
              {repo.name}
              <ChevronRight size={17} />
            </button>
            <p>{repo.description}</p>
            <code className="repo-full-name">eashansinha/{repo.id}</code>
            <div className="repository-head">
              <span>
                <GitBranch size={14} />
                {repo.branch}
              </span>
              <a
                href={`${repo.url}/commit/${repo.sha}`}
                className="mono"
                target="_blank"
                rel="noreferrer"
              >
                {repo.sha ? short(repo.sha) : "Awaiting sync"}
              </a>
            </div>
            <div className="repository-bottom">
              <CIStatus state={repo.ci} />
              <span>
                <GitPullRequest size={13} />
                {repo.pulls.length}
                {repo.pulls_truncated ? "+" : ""}
              </span>
            </div>
            {repo.error && <div className="notice warning">{repo.error}</div>}
          </section>
        ))}
      </div>
      <div className="info-note">
        <ShieldCheck size={17} />
        <p>
          GitHub access is read-only. Release plans pin commits; they don’t
          merge pull requests, create GitHub releases, or trigger deployments.
        </p>
      </div>
    </>
  );
}

function RepositoryDetail({
  repo,
  releases,
}: {
  repo: Repo;
  releases: Release[];
}) {
  return (
    <>
      <button className="back-link" onClick={() => go("repositories")}>
        <ArrowLeft size={14} />
        Repositories
      </button>
      <Heading
        title={repo.name}
        description={repo.description}
        action={
          <a
            className="button"
            href={repo.url}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            Open in GitHub
          </a>
        }
      />
      <div className="detail-stats">
        <span>
          <GitBranch size={15} />
          {repo.branch}
        </span>
        <CIStatus state={repo.ci} />
        <span>{repo.language}</span>
        <span>Synced {timeAgo(repo.synced_at)}</span>
      </div>
      {repo.error && <div className="error-box">{repo.error}</div>}
      <div className="detail-columns">
        <div>
          <section className="panel">
            <div className="section-heading">
              <h2>Recent commits</h2>
              <span className="subtle-label">{repo.branch}</span>
            </div>
            {repo.commits.map((c) => (
              <a
                className="commit-item"
                key={c.sha}
                href={c.url}
                target="_blank"
                rel="noreferrer"
              >
                <GitCommitHorizontal size={18} />
                <div>
                  <strong>{c.title}</strong>
                  <small>{fmtDate(c.date)}</small>
                </div>
                <code>{short(c.sha)}</code>
                <ArrowUpRight size={14} />
              </a>
            ))}
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>
                Open pull requests{" "}
                <span className="count">
                  {repo.pulls.length}
                  {repo.pulls_truncated ? "+" : ""}
                </span>
              </h2>
            </div>
            {repo.pulls.length ? (
              repo.pulls.map((p) => (
                <a
                  className="pr-item"
                  key={p.number}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GitPullRequest size={17} />
                  <div>
                    <strong>{p.title}</strong>
                    <small>
                      #{p.number} by {p.author}
                      {p.draft ? " · Draft" : ""}
                    </small>
                  </div>
                  <ArrowUpRight size={14} />
                </a>
              ))
            ) : (
              <div className="empty-row">
                No open pull requests in this snapshot.
              </div>
            )}
          </section>
        </div>
        <aside>
          <section className="panel sidebar-panel">
            <h2>Connections</h2>
            <p>Repository relationships from the service documentation.</p>
            {repo.depends_on.length ? (
              repo.depends_on.map((id) => (
                <button
                  className="dependency"
                  key={id}
                  onClick={() => go(`repository/${id}`)}
                >
                  <RepoIcon repo={id} />
                  {names[id]}
                  <ChevronRight size={14} />
                </button>
              ))
            ) : (
              <div className="muted">No documented upstream dependencies.</div>
            )}
          </section>
          <section className="panel sidebar-panel">
            <h2>Included in releases</h2>
            {releases
              .filter((r) => r.components.some((c) => c.repo === repo.id))
              .map((r) => (
                <button
                  className="related-release"
                  onClick={() => go(`release/${r.id}`)}
                  key={r.id}
                >
                  <span>
                    {r.title}
                    <small className="mono">{r.version}</small>
                  </span>
                  <Badge status={r.status} />
                </button>
              ))}
            {!releases.some((r) =>
              r.components.some((c) => c.repo === repo.id),
            ) && <p>No release plans include this repository yet.</p>}
          </section>
        </aside>
      </div>
    </>
  );
}

function Timeline({
  events,
  onNavigate = true,
}: {
  events: Event[];
  onNavigate?: boolean;
}) {
  return events.length ? (
    <div className="timeline">
      {events.map((event) => (
        <div className="timeline-item" key={event.id}>
          <span className="timeline-dot">
            <Activity size={13} />
          </span>
          <div>
            <strong>{event.title}</strong>
            <p>{event.detail}</p>
            <span>
              {new Date(event.time).toLocaleString()}
              {onNavigate && event.release_id && (
                <button
                  className="text-button"
                  onClick={() => go(`release/${event.release_id}`)}
                >
                  Open release
                  <ArrowUpRight size={12} />
                </button>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="empty-row">
      Release activity will appear here as plans change.
    </div>
  );
}

function ReleaseDetail({
  release,
  data,
  onEdit,
  onChange,
}: {
  release: Release;
  data: Workspace;
  onEdit: () => void;
  onChange: () => Promise<void>;
}) {
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [record, setRecord] = useState(false);
  const [rollout, setRollout] = useState("");
  useEffect(() => {
    setError("");
    setTab("overview");
  }, [release.id]);
  const done = Object.values(release.gates).filter(Boolean).length;
  const update = async (path: string, method: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      await api(path, method, body);
      await onChange();
      setRecord(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const transition = (status: string, note = "") =>
    update(`/releases/${release.id}/transition`, "POST", {
      revision: release.revision,
      status,
      rollout_note: note,
    });
  const download = () => {
    const text = `# ${release.title}\n\nVersion: ${release.version}\nEnvironment: ${release.environment}\nStatus: ${release.status}\nOwner: ${release.owner || "Unassigned"}\nTarget: ${release.target_date || "Unscheduled"}\n\n## Revisions\n${release.components.map((c) => `- ${c.repo}: ${c.sha}`).join("\n")}\n\n## Readiness\n${data.gates.map((g) => `- [${release.gates[g.id] ? "x" : " "}] ${g.title}`).join("\n")}\n\n## Release notes\n${release.notes || "No notes yet."}\n\n## Rollout record\n${release.rollout_note || "No completed rollout recorded."}\n`;
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `cardiolink-${release.version}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <button className="back-link" onClick={() => go("releases")}>
        <ArrowLeft size={14} />
        Release plans
      </button>
      <div className="release-title-line">
        <span className="version-pill mono">{release.version}</span>
        <Badge status={release.status} />
      </div>
      <Heading
        title={release.title}
        description={`${release.environment} release plan · Created ${fmtDate(release.created_at)}`}
        action={
          <div className="actions">
            <button className="button" onClick={download}>
              <ArrowDownToLine size={15} />
              Export notes
            </button>
            {release.status === "draft" && (
              <button className="button" onClick={onEdit}>
                <SlidersHorizontal size={15} />
                Edit plan
              </button>
            )}
          </div>
        }
      />
      <div className="detail-stats">
        <span>
          <Layers3 size={15} />
          {release.components.length} repositories
        </span>
        <span>
          <CalendarDays size={15} />
          {fmtDate(release.target_date)}
        </span>
        <span className="owner">
          {release.owner ? (
            <>
              <span className="avatar">
                {release.owner.slice(0, 2).toUpperCase()}
              </span>
              {release.owner}
            </>
          ) : (
            "Owner unassigned"
          )}
        </span>
      </div>
      <div className="release-tabs tabs">
        <button
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          className={tab === "notes" ? "active" : ""}
          onClick={() => setTab("notes")}
        >
          Release notes
        </button>
        <button
          className={tab === "activity" ? "active" : ""}
          onClick={() => setTab("activity")}
        >
          Activity
          <span>
            {data.activity.filter((e) => e.release_id === release.id).length}
          </span>
        </button>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {tab === "activity" ? (
        <section className="panel">
          <div className="section-heading">
            <h2>Release activity</h2>
          </div>
          <Timeline
            events={data.activity.filter((e) => e.release_id === release.id)}
            onNavigate={false}
          />
        </section>
      ) : tab === "notes" ? (
        <section className="panel">
          <div className="section-heading">
            <h2>Release notes</h2>
            {release.status === "draft" && (
              <button className="text-button" onClick={onEdit}>
                Edit notes
                <ArrowRight size={14} />
              </button>
            )}
          </div>
          <pre className="release-notes">
            {release.notes ||
              "Add verification evidence, the rollout sequence and a rollback plan before marking this release ready."}
          </pre>
          {release.rollout_note && (
            <div className="rollout-record">
              <h3>Completed rollout</h3>
              <p>{release.rollout_note}</p>
              <small>{fmtDate(release.released_at)}</small>
            </div>
          )}
        </section>
      ) : (
        <div className="detail-columns">
          <div>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Pinned revisions</h2>
                  <p>These commits stay fixed as the default branches move.</p>
                </div>
                <span className="count">{release.components.length}</span>
              </div>
              {release.components.map((component) => {
                const repo = data.repositories.find(
                  (r) => r.id === component.repo,
                )!;
                const evidence = release.ci_evidence[repo.id];
                const headIsPin = repo.sha === component.sha;
                const ci = evidence?.state || (headIsPin ? repo.ci : "unknown");
                return (
                  <div className="pinned-repo" key={repo.id}>
                    <RepoIcon repo={repo.id} />
                    <div>
                      <button
                        className="text-button repo-name"
                        onClick={() => go(`repository/${repo.id}`)}
                      >
                        {repo.name}
                      </button>
                      <small>
                        {repo.kind}
                        {!headIsPin ? " · Default branch has moved" : ""}
                      </small>
                    </div>
                    <div className="pinned-meta">
                      <a
                        className="commit-chip mono"
                        href={`${repo.url}/commit/${component.sha}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <GitCommitHorizontal size={13} />
                        {short(component.sha)}
                        <ArrowUpRight size={12} />
                      </a>
                      <CIStatus state={ci} />
                    </div>
                  </div>
                );
              })}
              <div className="notice inline-notice">
                <GitBranch size={16} />
                <span>
                  Readiness checks the exact pinned commits against GitHub.
                  Missing or neutral checks require manual CI coverage review.
                </span>
              </div>
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>Release notes</h2>
                {release.status === "draft" && (
                  <button className="text-button" onClick={onEdit}>
                    Edit
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
              <pre className={`release-notes ${!release.notes ? "muted" : ""}`}>
                {release.notes ||
                  "Document the changes, verification evidence, rollout sequence, and rollback plan."}
              </pre>
              {release.rollout_note && (
                <div className="rollout-record">
                  <h3>Completed rollout</h3>
                  <p>{release.rollout_note}</p>
                  <small>{fmtDate(release.released_at)}</small>
                </div>
              )}
            </section>
          </div>
          <aside>
            <section className="panel checklist-panel">
              <div className="section-heading">
                <h2>Release readiness</h2>
                <span className="mono subtle-label">
                  {done}/{data.gates.length}
                </span>
              </div>
              <div className="readiness-summary">
                <div className="segmented-progress">
                  {data.gates.map((g) => (
                    <span
                      key={g.id}
                      className={release.gates[g.id] ? "complete" : ""}
                    />
                  ))}
                </div>
                <p>
                  {done === data.gates.length
                    ? "Checklist complete. Review the plan before continuing."
                    : "A shared checklist for a considered rollout."}
                </p>
              </div>
              <div className="checklist">
                {data.gates.map((g) => (
                  <label key={g.id}>
                    <input
                      type="checkbox"
                      checked={!!release.gates[g.id]}
                      disabled={busy || release.status !== "draft"}
                      onChange={(e) =>
                        update(
                          `/releases/${release.id}/gates/${g.id}`,
                          "PATCH",
                          {
                            revision: release.revision,
                            checked: e.target.checked,
                          },
                        )
                      }
                    />
                    <span>
                      <strong>{g.title}</strong>
                      <small>{g.description}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="readiness-action">
                {release.status === "draft" ? (
                  <>
                    <button
                      className="button primary full-width"
                      disabled={
                        busy ||
                        done !== data.gates.length ||
                        !release.owner.trim() ||
                        !release.notes.trim()
                      }
                      onClick={() => transition("ready")}
                    >
                      {busy ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      Mark ready
                    </button>
                    <p>
                      {!release.owner.trim()
                        ? "Assign an owner to continue."
                        : !release.notes.trim()
                          ? "Add release notes to continue."
                          : "Failed, running, or incomplete GitHub checks block readiness."}
                    </p>
                  </>
                ) : release.status === "ready" ? (
                  <>
                    <button
                      className="button primary full-width"
                      disabled={busy}
                      onClick={() => setRecord(true)}
                    >
                      <CheckCheck size={16} />
                      Record completed rollout
                    </button>
                    <button
                      className="text-button full-width centered"
                      disabled={busy}
                      onClick={() => transition("draft")}
                    >
                      Return to draft
                    </button>
                  </>
                ) : (
                  <div className="released-confirmation">
                    <CircleCheck size={21} />
                    <strong>Rollout recorded</strong>
                    <span>{fmtDate(release.released_at)}</span>
                  </div>
                )}
              </div>
            </section>
            <div className="info-note compact">
              <ShieldCheck size={17} />
              <p>
                Checklist completion is a workspace record, not a regulated
                approval. Deploy through your existing release process.
              </p>
            </div>
          </aside>
        </div>
      )}
      {record && (
        <Dialog
          title="Record completed rollout"
          onClose={() => {
            if (!busy) setRecord(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              transition("released", rollout);
            }}
          >
            <div className="dialog-body">
              <p className="form-intro">
                Record a rollout already completed through your deployment
                process. This action does not deploy code or publish a GitHub
                release.
              </p>
              <label>
                Rollout record
                <textarea
                  required
                  rows={5}
                  maxLength={2000}
                  value={rollout}
                  onChange={(e) => setRollout(e.target.value)}
                  placeholder="What was deployed, where, and how was the rollout verified?"
                />
              </label>
              {error && (
                <div className="error-box" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setRecord(false)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || !rollout.trim()}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}
                Record rollout
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

function Settings({ data }: { data: Workspace }) {
  return (
    <>
      <Heading
        title="Workspace settings"
        description="How this CardioLink workspace connects, stores data, and controls access."
      />
      <section className="panel settings-panel">
        <div>
          <ShieldCheck size={21} />
          <section>
            <h2>Internal access</h2>
            <p>
              Hosted behind Devin’s authenticated app proxy. Organization
              members with access to this app share the workspace and can edit
              release records.
            </p>
            <p>
              Release owners are planning contacts. Checklist records do not
              provide individual sign-offs or regulated electronic signatures.
            </p>
          </section>
          <span className="kind">Organization</span>
        </div>
        <div>
          <GitBranch size={21} />
          <section>
            <h2>GitHub connection</h2>
            <p>
              Read-only snapshots from five allowlisted eashansinha repositories
              refresh every five minutes. GitHub credentials stay on the server.
            </p>
            <p>
              Drafts pin immutable commit SHAs. Readiness and rollout recording
              fetch fresh CI results for those exact commits.
            </p>
          </section>
          <span className="kind">Read-only</span>
        </div>
        <div>
          <Layers3 size={21} />
          <section>
            <h2>Persistent workspace</h2>
            <p>
              Release plans, checklist progress, and activity are stored in
              SQLite outside the production build. Refreshes and app
              redeployments preserve workspace data.
            </p>
            <p>
              The app’s lifetime follows its managing Devin session. Archiving
              or ending the session takes the app offline.
            </p>
          </section>
          <span className="kind">SQLite</span>
        </div>
        <div>
          <Activity size={21} />
          <section>
            <h2>Activity history</h2>
            <p>
              The workspace retains release changes and shows the latest 200
              events. Events describe shared workspace actions and are not
              attributed to authenticated individuals.
            </p>
          </section>
        </div>
      </section>
      <div className="settings-foot">
        <span>{data.repositories.length} connected repositories</span>
        <a href={SESSION} target="_blank" rel="noreferrer">
          Request workspace changes
          <ArrowUpRight size={14} />
        </a>
      </div>
    </>
  );
}

function App() {
  const [data, setData] = useState<Workspace | null>(null);
  const [route, setRoute] = useState(
    window.location.hash.slice(1) || "overview",
  );
  const [fatal, setFatal] = useState("");
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState<Release | null | undefined>(undefined);
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const load = async () => {
    try {
      setData(await api<Workspace>("/workspace"));
      setFatal("");
    } catch (e) {
      setFatal((e as Error).message);
    }
  };
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    const hash = () => {
      setRoute(window.location.hash.slice(1) || "overview");
      setMobile(false);
      setSearch("");
      window.scrollTo(0, 0);
    };
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setSearch("");
    };
    window.addEventListener("hashchange", hash);
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const sync = async () => {
    setRefreshing(true);
    try {
      await api("/sync", "POST");
      await load();
      setToast("GitHub snapshots refreshed");
    } catch (e) {
      setFatal((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const nav = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "releases", label: "Release plans", icon: Layers3 },
    { id: "repositories", label: "Repositories", icon: GitBranch },
    { id: "activity", label: "Activity", icon: Activity },
  ];
  const active = route.startsWith("release/")
    ? "releases"
    : route.startsWith("repository/")
      ? "repositories"
      : route;
  const results =
    data && search.trim()
      ? [
          ...data.releases
            .filter((r) =>
              `${r.title} ${r.version}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((r) => ({
              key: r.id,
              label: r.title,
              detail: `Release · ${r.version}`,
              route: `release/${r.id}`,
            })),
          ...data.repositories
            .filter((r) =>
              `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()),
            )
            .map((r) => ({
              key: r.id,
              label: r.name,
              detail: "Repository",
              route: `repository/${r.id}`,
            })),
        ].slice(0, 8)
      : [];
  const latest = data?.repositories
    .map((r) => r.synced_at)
    .filter(Boolean)
    .sort()[0];
  let content: React.ReactNode = null;
  if (data) {
    if (route === "overview")
      content = <Overview data={data} onCreate={() => setEditor(null)} />;
    else if (route === "releases")
      content = (
        <Releases releases={data.releases} onCreate={() => setEditor(null)} />
      );
    else if (route === "repositories")
      content = <Repositories repositories={data.repositories} />;
    else if (route === "activity")
      content = (
        <>
          <Heading
            title="Workspace activity"
            description="A shared history of release plans, checklist updates, and rollout records."
          />
          <section className="panel">
            <div className="section-heading">
              <h2>Recent activity</h2>
              <span className="subtle-label">Latest 200 events</span>
            </div>
            <Timeline events={data.activity} />
          </section>
        </>
      );
    else if (route === "settings") content = <Settings data={data} />;
    else if (route.startsWith("release/")) {
      const release = data.releases.find((r) => r.id === route.split("/")[1]);
      content = release ? (
        <ReleaseDetail
          release={release}
          data={data}
          onEdit={() => setEditor(release)}
          onChange={load}
        />
      ) : (
        <Empty
          title="Release not found"
          action={
            <button className="button" onClick={() => go("releases")}>
              Back to release plans
            </button>
          }
        >
          This release is not part of this workspace.
        </Empty>
      );
    } else if (route.startsWith("repository/")) {
      const repo = data.repositories.find((r) => r.id === route.split("/")[1]);
      content = repo ? (
        <RepositoryDetail repo={repo} releases={data.releases} />
      ) : (
        <Empty title="Repository not found">
          Choose a connected CardioLink repository.
        </Empty>
      );
    } else
      content = (
        <Empty
          title="Page not found"
          action={
            <button className="button" onClick={() => go("overview")}>
              Back to overview
            </button>
          }
        >
          Choose a page from the workspace navigation.
        </Empty>
      );
  }
  return (
    <div className="app-shell">
      {mobile && <div className="nav-scrim" onClick={() => setMobile(false)} />}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href="#overview" aria-label="CardioLink home">
          <Logo />
          <div>
            CardioLink<span>Release workspace</span>
          </div>
        </a>
        <div className="workspace-switch">
          <span className="workspace-icon">
            <Layers3 size={16} />
          </span>
          <span>
            Platform engineering<small>Internal workspace</small>
          </span>
          <ShieldCheck size={14} />
        </div>
        <div className="nav-label">Workspace</div>
        <nav aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <a
              href={`#${id}`}
              className={active === id ? "active" : ""}
              key={id}
              aria-current={active === id ? "page" : undefined}
            >
              <Icon size={17} />
              {label}
              {id === "repositories" && <span className="nav-count">5</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon">
            <GitBranch size={16} />
          </span>
          <strong>Connected by design</strong>
          <p>
            Coordinate every service.
            <br />
            Keep every revision in view.
          </p>
          <a href="#repositories">
            Explore the platform
            <ArrowRight size={13} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <a href="#settings" className={active === "settings" ? "active" : ""}>
            <Settings2 size={17} />
            Workspace settings
          </a>
          <a href={SESSION} target="_blank" rel="noreferrer">
            <span className="devin-glyph">d</span>Request changes
            <ArrowUpRight size={13} />
          </a>
          <div className="workspace-user">
            <span className="avatar">CL</span>
            <div>
              CardioLink team<small>Organization workspace</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile((v) => !v)}
            >
              <Menu size={20} />
            </button>
            <span>CardioLink</span>
            <ChevronRight size={13} />
            <strong>
              {active === "settings"
                ? "Settings"
                : nav.find((n) => n.id === active)?.label || "Workspace"}
            </strong>
            <span className="internal-badge">Internal</span>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={15} />
              <input
                ref={searchRef}
                aria-label="Search workspace"
                placeholder="Search workspace…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>/</kbd>
              {search && (
                <div className="search-results">
                  <div className="search-results-heading">
                    Workspace results
                    <button
                      className="icon-button"
                      aria-label="Close search"
                      onClick={() => setSearch("")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {results.length ? (
                    results.map((result) => (
                      <button key={result.key} onClick={() => go(result.route)}>
                        <Search size={14} />
                        <span>
                          {result.label}
                          <small>{result.detail}</small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))
                  ) : (
                    <p>No results for “{search}”.</p>
                  )}
                </div>
              )}
            </div>
            <a
              className="github-header"
              href="https://github.com/eashansinha?tab=repositories&q=cardiolink"
              target="_blank"
              rel="noreferrer"
              aria-label="CardioLink repositories on GitHub"
            >
              <GitBranch size={17} />
            </a>
          </div>
        </header>
        <main>
          <div className="workspace-status">
            <span>
              <span className="live-dot" />
              CardioLink platform
              <span className="status-divider" />5 repositories connected
            </span>
            <button
              className="sync-button"
              onClick={sync}
              disabled={refreshing || !!data?.syncing}
            >
              <RefreshCw
                size={12}
                className={refreshing || data?.syncing ? "spin" : ""}
              />
              <span>
                {refreshing || data?.syncing
                  ? "Syncing GitHub…"
                  : `Synced ${timeAgo(latest)}`}
              </span>
            </button>
          </div>
          {fatal && (
            <div className="error-box" role="alert">
              {fatal}
              <button className="text-button" onClick={load}>
                Retry
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading">
              <Loader2 size={25} className="spin" />
              <span>Loading your release workspace…</span>
            </div>
          ) : (
            content
          )}
          <footer className="main-footer">
            <span>
              <Logo small />
              CardioLink release workspace
            </span>
            <span>Plan with context. Release with confidence.</span>
            <a href={SESSION} target="_blank" rel="noreferrer">
              Managed with Devin
              <ArrowUpRight size={12} />
            </a>
          </footer>
        </main>
      </div>
      {editor !== undefined && data && (
        <ReleaseEditor
          key={editor?.id || "new"}
          release={editor}
          repositories={data.repositories}
          onClose={() => setEditor(undefined)}
          onSave={async (form) => {
            await api(
              editor ? `/releases/${editor.id}` : "/releases",
              editor ? "PUT" : "POST",
              editor ? { ...form, revision: editor.revision } : form,
            ).then(async (result) => {
              await load();
              setToast(
                editor ? "Release plan updated" : "Release plan created",
              );
              if (!editor) go(`release/${(result as Release).id}`);
            });
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

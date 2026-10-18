import { upstreamMessage, timedFetch } from "@/lib/integrations/http";
import { githubOwnerProblem } from "./config";
import type {
  GithubCommit,
  GithubIntegrationSnapshot,
  GithubPullRequest,
  GithubWorkflowFailure,
} from "./types";

const API = "https://api.github.com";
const SCAN_REPOS = 12;
const TIMEOUT_MS = 8_000;

interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
  pushedAt: string;
}

function empty(
  partial: Pick<GithubIntegrationSnapshot, "configured" | "owner" | "status" | "detail"> &
    Partial<GithubIntegrationSnapshot>,
): GithubIntegrationSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    configured: partial.configured,
    owner: partial.owner,
    status: partial.status,
    detail: partial.detail,
    repoCount: partial.repoCount ?? 0,
    reposScanned: partial.reposScanned ?? 0,
    openPrs: partial.openPrs ?? [],
    commits: partial.commits ?? [],
    failingRuns: partial.failingRuns ?? [],
    cached: false,
  };
}

function httpsUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function githubGet(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
) {
  return timedFetch(
    `${API}${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VanOS-Mission-Control",
      },
      timeoutMs: TIMEOUT_MS,
      secrets: [token],
      allowHosts: ["api.github.com"],
    },
    fetchImpl,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRepos(json: unknown, owner: string): RepoRef[] {
  if (!Array.isArray(json)) return [];
  const want = owner.toLowerCase();
  const repos: RepoRef[] = [];
  for (const row of json) {
    const rec = asRecord(row);
    if (!rec) continue;
    const ownerRec = asRecord(rec.owner);
    const login = typeof ownerRec?.login === "string" ? ownerRec.login : "";
    const name = typeof rec.name === "string" ? rec.name : "";
    if (!name || login.toLowerCase() !== want) continue;
    repos.push({
      owner: login,
      name,
      fullName: typeof rec.full_name === "string" ? rec.full_name : `${login}/${name}`,
      pushedAt: typeof rec.pushed_at === "string" ? rec.pushed_at : "",
    });
  }
  repos.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
  return repos;
}

function parsePulls(json: unknown, repo: string): GithubPullRequest[] {
  if (!Array.isArray(json)) return [];
  const pulls: GithubPullRequest[] = [];
  for (const row of json) {
    const rec = asRecord(row);
    if (!rec) continue;
    const number = typeof rec.number === "number" ? rec.number : 0;
    const title = typeof rec.title === "string" ? rec.title : "";
    if (!number || !title) continue;
    const user = asRecord(rec.user);
    pulls.push({
      repo,
      number,
      title: title.slice(0, 200),
      author: typeof user?.login === "string" ? user.login : "unknown",
      url: httpsUrl(rec.html_url),
      updatedAt: typeof rec.updated_at === "string" ? rec.updated_at : "",
    });
  }
  return pulls;
}

function parseCommits(json: unknown, repo: string): GithubCommit[] {
  if (!Array.isArray(json)) return [];
  const commits: GithubCommit[] = [];
  for (const row of json) {
    const rec = asRecord(row);
    if (!rec) continue;
    const sha = typeof rec.sha === "string" ? rec.sha : "";
    const commit = asRecord(rec.commit);
    const messageRaw = typeof commit?.message === "string" ? commit.message : "";
    const message = messageRaw.split("\n")[0]?.trim().slice(0, 180) || "(no message)";
    const gitAuthor = asRecord(commit?.author);
    const user = asRecord(rec.author);
    const author =
      (typeof user?.login === "string" && user.login) ||
      (typeof gitAuthor?.name === "string" && gitAuthor.name) ||
      "unknown";
    if (!sha) continue;
    commits.push({
      repo,
      sha,
      message,
      author,
      url: httpsUrl(rec.html_url),
      committedAt: typeof gitAuthor?.date === "string" ? gitAuthor.date : "",
    });
  }
  return commits;
}

function parseFailures(json: unknown, repo: string): GithubWorkflowFailure[] {
  const rec = asRecord(json);
  const runs = rec && Array.isArray(rec.workflow_runs) ? rec.workflow_runs : [];
  const sorted = runs
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  const seen = new Set<string>();
  const failures: GithubWorkflowFailure[] = [];
  for (const run of sorted) {
    const key = String(run.path || run.name || run.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const conclusion = typeof run.conclusion === "string" ? run.conclusion : "";
    if (conclusion !== "failure" && conclusion !== "timed_out") continue;
    failures.push({
      repo,
      name: typeof run.name === "string" ? run.name : "Workflow",
      branch: typeof run.head_branch === "string" ? run.head_branch : "",
      url: httpsUrl(run.html_url),
      conclusion,
      updatedAt: typeof run.updated_at === "string" ? run.updated_at : "",
    });
  }
  return failures;
}

function permissionNote(status: number, json: unknown, text: string, token: string, what: string): string | null {
  if (status === 401) return null;
  if (status === 403 || status === 404) {
    const message = upstreamMessage(json, text, [token]).toLowerCase();
    if (message.includes("rate limit")) return "GitHub rate limit reached. Cached data will refresh later.";
    return `${what} is not readable. The fine-grained token needs read access for that.`;
  }
  if (status === 0) return text || `${what} request failed.`;
  if (status >= 400) return `${what} returned HTTP ${status}.`;
  return null;
}

export async function loadGithubBoard(
  token: string,
  owner: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubIntegrationSnapshot> {
  const ownerProblem = githubOwnerProblem(owner);
  if (ownerProblem) {
    return empty({ configured: true, owner, status: "error", detail: ownerProblem });
  }

  let listed = await githubGet(
    "/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,organization_member,collaborator",
    token,
    fetchImpl,
  );
  if (!listed.ok && listed.status === 422) {
    listed = await githubGet(
      "/user/repos?per_page=100&sort=pushed&direction=desc",
      token,
      fetchImpl,
    );
  }
  if (!listed.ok) {
    const reason =
      listed.status === 401
        ? "GitHub rejected GITHUB_TOKEN (401). Use a fine-grained personal access token with read-only repository access."
        : `GitHub repository list failed (${listed.status || "network"}). ${upstreamMessage(listed.json, listed.text, [token])}`;
    return empty({
      configured: true,
      owner,
      status: "error",
      detail: reason.slice(0, 280),
    });
  }

  let repos = parseRepos(listed.json, owner);
  if (!repos.length) {
    const org = await githubGet(
      `/orgs/${encodeURIComponent(owner)}/repos?per_page=100&sort=pushed&direction=desc&type=all`,
      token,
      fetchImpl,
    );
    if (org.ok) repos = parseRepos(org.json, owner);
    if (!repos.length) {
      const user = await githubGet(
        `/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=pushed&direction=desc`,
        token,
        fetchImpl,
      );
      if (user.ok) repos = parseRepos(user.json, owner);
    }
  }

  if (!repos.length) {
    return empty({
      configured: true,
      owner,
      status: "warn",
      detail: `No repositories for ${owner} were visible to this token. Grant the fine-grained token access to those repos (Metadata: Read).`,
    });
  }

  const scanned = repos.slice(0, SCAN_REPOS);
  const warnings: string[] = [];
  let pullsBlocked = false;
  let commitsBlocked = false;
  let actionsBlocked = false;

  const chunks = await mapPool(scanned, 4, async (repo) => {
    const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
    const [pulls, commits, runs] = await Promise.all([
      githubGet(`${base}/pulls?state=open&per_page=10&sort=updated&direction=desc`, token, fetchImpl),
      githubGet(`${base}/commits?per_page=3`, token, fetchImpl),
      githubGet(`${base}/actions/runs?per_page=8`, token, fetchImpl),
    ]);
    return { repo, pulls, commits, runs };
  });

  const openPrs: GithubPullRequest[] = [];
  const commits: GithubCommit[] = [];
  const failingRuns: GithubWorkflowFailure[] = [];

  for (const chunk of chunks) {
    if (chunk.pulls.ok) {
      openPrs.push(...parsePulls(chunk.pulls.json, chunk.repo.fullName));
    } else if (!pullsBlocked) {
      const note = permissionNote(chunk.pulls.status, chunk.pulls.json, chunk.pulls.text, token, "Pull requests");
      if (note) warnings.push(note);
      pullsBlocked = chunk.pulls.status === 403 || chunk.pulls.status === 401;
    }
    if (chunk.commits.ok) {
      commits.push(...parseCommits(chunk.commits.json, chunk.repo.fullName));
    } else if (!commitsBlocked) {
      const note = permissionNote(chunk.commits.status, chunk.commits.json, chunk.commits.text, token, "Commits");
      if (note) warnings.push(note);
      commitsBlocked = chunk.commits.status === 403 || chunk.commits.status === 401;
    }
    if (chunk.runs.ok) {
      failingRuns.push(...parseFailures(chunk.runs.json, chunk.repo.fullName));
    } else if (!actionsBlocked) {
      const note = permissionNote(chunk.runs.status, chunk.runs.json, chunk.runs.text, token, "Actions");
      if (note) warnings.push(note);
      actionsBlocked = chunk.runs.status === 403 || chunk.runs.status === 401;
    }
  }

  openPrs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  commits.sort((a, b) => b.committedAt.localeCompare(a.committedAt));
  failingRuns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const limitedPrs = openPrs.slice(0, 20);
  const limitedCommits = commits.slice(0, 15);
  const limitedRuns = failingRuns.slice(0, 20);
  const summary = `${scanned.length} of ${repos.length} repos · ${limitedPrs.length} open PRs · ${limitedRuns.length} failing workflows`;
  const extra = warnings.slice(0, 2).join(" ");
  const status = warnings.length || limitedRuns.length ? "warn" : "ok";

  return empty({
    configured: true,
    owner,
    status,
    detail: [summary, extra].filter(Boolean).join(" "),
    repoCount: repos.length,
    reposScanned: scanned.length,
    openPrs: limitedPrs,
    commits: limitedCommits,
    failingRuns: limitedRuns,
  });
}

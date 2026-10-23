import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { clearIntegrationCache } from "@/lib/integrations/cache";
import { getGithubSnapshot } from "./snapshot";

const TOKEN = "github_pat_test_value_do_not_log";

const env = process.env as Record<string, string | undefined>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function githubFetch(onCall?: (url: string) => void): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    onCall?.(url);
    const auth = new Headers(init?.headers).get("authorization");
    assert.equal(auth, `Bearer ${TOKEN}`);
    assert.equal(url.includes(TOKEN), false);
    if (url.includes("/user/repos")) {
      return json([
        {
          name: "VanOS",
          full_name: "jojo-swe/VanOS",
          private: true,
          pushed_at: "2026-10-16T12:00:00Z",
          owner: { login: "jojo-swe" },
        },
        {
          name: "Other",
          full_name: "someone/Other",
          private: false,
          pushed_at: "2026-10-16T13:00:00Z",
          owner: { login: "someone" },
        },
      ]);
    }
    if (url.includes("/pulls")) {
      return json([
        {
          number: 9,
          title: "Wire Notion",
          html_url: "https://github.com/jojo-swe/VanOS/pull/9",
          updated_at: "2026-10-16T12:30:00Z",
          user: { login: "jojo-swe" },
        },
      ]);
    }
    if (url.includes("/commits")) {
      return json([
        {
          sha: "abcdef1234567890",
          html_url: "https://github.com/jojo-swe/VanOS/commit/abcdef1234567890",
          commit: {
            message: "Add integrations\n\nbody",
            author: { name: "Jojo", date: "2026-10-16T12:00:00Z" },
          },
          author: { login: "jojo-swe" },
        },
      ]);
    }
    if (url.includes("/actions/runs")) {
      return json({
        workflow_runs: [
          {
            name: "CI",
            path: ".github/workflows/ci.yml",
            conclusion: "success",
            status: "completed",
            updated_at: "2026-10-16T12:00:00Z",
            html_url: "https://github.com/jojo-swe/VanOS/actions/runs/2",
            head_branch: "main",
          },
          {
            name: "CI",
            path: ".github/workflows/ci.yml",
            conclusion: "failure",
            status: "completed",
            updated_at: "2026-10-16T10:00:00Z",
            html_url: "https://github.com/jojo-swe/VanOS/actions/runs/1",
            head_branch: "main",
          },
          {
            name: "Lint",
            path: ".github/workflows/lint.yml",
            conclusion: "failure",
            status: "completed",
            updated_at: "2026-10-16T11:00:00Z",
            html_url: "https://github.com/jojo-swe/VanOS/actions/runs/3",
            head_branch: "main",
          },
        ],
      });
    }
    return json({ message: "missing" }, 404);
  };
}

afterEach(() => {
  delete env.GITHUB_TOKEN;
  delete env.GITHUB_OWNER;
  clearIntegrationCache();
});

describe("github integration", () => {
  test("stays off and does not call GitHub when the token is missing", async () => {
    let called = false;
    const snapshot = await getGithubSnapshot(async () => {
      called = true;
      return json({});
    });
    assert.equal(called, false);
    assert.equal(snapshot.configured, false);
    assert.equal(snapshot.status, "idle");
    assert.match(snapshot.detail, /GITHUB_TOKEN/);
  });

  test("loads open PRs, commits, and only the latest failing workflow", async () => {
    env.GITHUB_TOKEN = TOKEN;
    env.GITHUB_OWNER = "jojo-swe";
    const urls: string[] = [];
    const snapshot = await getGithubSnapshot(githubFetch((url) => urls.push(url)));
    assert.equal(snapshot.configured, true);
    assert.equal(snapshot.owner, "jojo-swe");
    assert.equal(snapshot.reposScanned, 1);
    assert.equal(snapshot.repoCount, 1);
    assert.equal(snapshot.openPrs.length, 1);
    assert.equal(snapshot.openPrs[0]?.title, "Wire Notion");
    assert.equal(snapshot.openPrs[0]?.repo, "jojo-swe/VanOS");
    assert.equal(snapshot.commits[0]?.message, "Add integrations");
    assert.equal(snapshot.failingRuns.length, 1);
    assert.equal(snapshot.failingRuns[0]?.name, "Lint");
    assert.equal(urls.some((url) => url.includes("someone")), false);
    assert.equal(JSON.stringify(snapshot).includes(TOKEN), false);
    assert.equal(snapshot.status, "warn");
  });

  test("caches a successful read", async () => {
    env.GITHUB_TOKEN = TOKEN;
    let calls = 0;
    const fetchImpl = githubFetch(() => {
      calls += 1;
    });
    await getGithubSnapshot(fetchImpl);
    const first = calls;
    const again = await getGithubSnapshot(fetchImpl);
    assert.equal(calls, first);
    assert.equal(again.cached, true);
    assert.ok(first > 0);
  });

  test("an upstream error does not echo the secret", async () => {
    env.GITHUB_TOKEN = TOKEN;
    const snapshot = await getGithubSnapshot(async () =>
      json({ message: `bad ${TOKEN}` }, 502),
    );
    assert.equal(snapshot.status, "error");
    assert.equal(JSON.stringify(snapshot).includes(TOKEN), false);
    assert.match(snapshot.detail, /502/);
  });

  test("an invalid owner does not call GitHub", async () => {
    env.GITHUB_TOKEN = TOKEN;
    env.GITHUB_OWNER = "not a login";
    let called = false;
    const snapshot = await getGithubSnapshot(async () => {
      called = true;
      return json({});
    });
    assert.equal(called, false);
    assert.equal(snapshot.status, "error");
    assert.match(snapshot.detail, /GITHUB_OWNER/);
  });
});

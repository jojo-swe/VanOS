import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { scrubSecrets, timedFetch } from "./http";

describe("integration http", () => {
  test("scrubs secrets and bearer values", () => {
    const text = scrubSecrets(
      "Bearer github_pat_test_value failed https://user:github_pat_test_value@example.com/a?token=1",
      ["github_pat_test_value"],
    );
    assert.equal(text.includes("github_pat_test_value"), false);
    assert.equal(text.includes("token="), false);
    assert.match(text, /Bearer \[redacted\]/);
  });

  test("refuses a cross-origin redirect", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/steal" },
      });
    };
    const res = await timedFetch(
      "https://api.github.com/user/repos",
      {
        headers: { Authorization: "Bearer github_pat_test_value" },
        secrets: ["github_pat_test_value"],
      },
      fetchImpl,
    );
    assert.deepEqual(seen, ["https://api.github.com/user/repos"]);
    assert.match(res.text, /cross-origin/);
    assert.equal(res.text.includes("github_pat_test_value"), false);
  });

  test("follows one same-origin redirect", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/repos")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://api.github.com/user/repos?page=1" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const res = await timedFetch("https://api.github.com/user/repos", {}, fetchImpl);
    assert.equal(res.ok, true);
    assert.equal(seen.length, 2);
    assert.equal((res.json as { ok: boolean }).ok, true);
  });

  test("timeouts become a friendly message without the secret", async () => {
    const fetchImpl: typeof fetch = async () => {
      const err = new Error("The operation was aborted due to timeout github_pat_test_value");
      err.name = "TimeoutError";
      throw err;
    };
    const res = await timedFetch(
      "https://api.github.com/user/repos",
      { secrets: ["github_pat_test_value"] },
      fetchImpl,
    );
    assert.equal(res.ok, false);
    assert.equal(res.text, "Timed out waiting for the upstream API");
  });
});

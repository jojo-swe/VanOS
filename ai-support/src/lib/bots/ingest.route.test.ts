import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { POST } from "@/app/api/bots/ingest/route";
import { BOT_INGEST_RATE_LIMIT } from "@/lib/bots/parse-ingest";

const SECRET = "test-ingest-secret";

let dataDir = "";

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-bots-"));
  process.env.BOTS_INGEST_SECRET = SECRET;
  process.env.BOTS_DATA_DIR = dataDir;
  process.env.VANOS_STORE_PREFIX = `vanos-test-${process.pid}`;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

after(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

function post(
  body: unknown,
  headers: Record<string, string> = {},
) {
  return POST(
    new Request("http://127.0.0.1:3000/api/bots/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

const auth = { authorization: `Bearer ${SECRET}` };

describe("POST /api/bots/ingest", { concurrency: false }, () => {
  test("auth failure", async () => {
    const body = {
      botId: "muddy",
      type: "status",
      title: "Hi",
      body: "There",
    };
    const missing = await post(body);
    assert.equal(missing.status, 401);

    const wrong = await post(body, { authorization: "Bearer not-the-secret" });
    assert.equal(wrong.status, 401);
    const json = (await wrong.json()) as { error?: string };
    assert.equal(json.error, "Unauthorized");
  });

  test("schema failure", async () => {
    const unknown = await post(
      {
        botId: "schema-bot",
        type: "status",
        title: "Hi",
        body: "There",
        surprise: true,
      },
      auth,
    );
    assert.equal(unknown.status, 400);
    const unknownJson = (await unknown.json()) as {
      error: string;
      fields?: string[];
    };
    assert.match(unknownJson.error, /Unknown field/);
    assert.deepEqual(unknownJson.fields, ["surprise"]);

    const badType = await post(
      { botId: "schema-bot", type: "nope", title: "Hi", body: "There" },
      auth,
    );
    assert.equal(badType.status, 400);
    const badTypeJson = (await badType.json()) as { error: string };
    assert.match(badTypeJson.error, /type is required/);
  });

  test("success", async () => {
    const headers = { ...auth, "idempotency-key": "muddy-status-1" };
    const body = {
      botId: "muddy",
      botName: "Muddy",
      type: "result",
      title: "Morning triage",
      body: "Reviewed overnight alerts. No blockers.",
      timestamp: "2026-10-16T10:00:00Z",
      links: [{ label: "Dashboard", url: "https://example.com/dashboard" }],
      metadata: { source: "routine" },
    };

    const first = await post(body, headers);
    assert.equal(first.status, 200);
    const firstJson = (await first.json()) as {
      ok: boolean;
      idempotent: boolean;
      event: {
        id: string;
        botId: string;
        type: string;
        title: string;
        body: string;
      };
    };
    assert.equal(firstJson.ok, true);
    assert.equal(firstJson.idempotent, false);
    assert.equal(firstJson.event.botId, "muddy");
    assert.equal(firstJson.event.type, "result");
    assert.equal(firstJson.event.title, "Morning triage");
    assert.equal(
      firstJson.event.body,
      "Reviewed overnight alerts. No blockers.",
    );

    const second = await post(body, headers);
    assert.equal(second.status, 200);
    const secondJson = (await second.json()) as {
      idempotent: boolean;
      event: { id: string };
    };
    assert.equal(secondJson.idempotent, true);
    assert.equal(secondJson.event.id, firstJson.event.id);

    const legacy = await post(
      {
        botId: "legacy-bot",
        botName: "Legacy",
        status: "warn",
        summary: "Heartbeat still accepted",
      },
      auth,
    );
    assert.equal(legacy.status, 200);
    const legacyJson = (await legacy.json()) as {
      event: { summary?: string; type?: string };
    };
    assert.equal(legacyJson.event.summary, "Heartbeat still accepted");
    assert.equal(legacyJson.event.type, undefined);
  });

  test("rate limit", async () => {
    for (let i = 0; i < BOT_INGEST_RATE_LIMIT; i++) {
      const res = await post(
        {
          botId: "flood-bot",
          botName: "Flood",
          type: "status",
          title: `Ping ${i}`,
          body: "Still here",
        },
        auth,
      );
      assert.equal(res.status, 200, `request ${i} should succeed`);
    }

    const blocked = await post(
      {
        botId: "flood-bot",
        botName: "Flood",
        type: "status",
        title: "Too many",
        body: "Slow down",
      },
      auth,
    );
    assert.equal(blocked.status, 429);
    const json = (await blocked.json()) as { error: string; botId?: string };
    assert.match(json.error, /Rate limit/);
    assert.equal(json.botId, "flood-bot");
    assert.ok(blocked.headers.get("retry-after"));
  });
});

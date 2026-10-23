import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { clearIntegrationCache } from "@/lib/integrations/cache";
import { normalizeNotionId } from "./config";
import { getNotionSnapshot } from "./snapshot";

const TOKEN = "ntn_test_value_do_not_log_1234";
const DB = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const env = process.env as Record<string, string | undefined>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  delete env.NOTION_TOKEN;
  delete env.NOTION_DATABASE_IDS;
  delete env.NOTION_STATUS_PROPERTY;
  delete env.NOTION_DONE_VALUE;
  clearIntegrationCache();
});

describe("notion ids", () => {
  test("reads the database id from a URL, not the view id", () => {
    const id = normalizeNotionId(
      "https://www.notion.so/Att-gora-for-John-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?v=cccccccccccccccccccccccccccccccc",
    );
    assert.equal(id, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });
});

describe("notion integration", () => {
  test("stays off without a token", async () => {
    let called = false;
    const snapshot = await getNotionSnapshot(async () => {
      called = true;
      return json({});
    });
    assert.equal(called, false);
    assert.equal(snapshot.configured, false);
    assert.equal(snapshot.status, "idle");
  });

  test("asks for database ids and does not call Notion when they are missing", async () => {
    env.NOTION_TOKEN = TOKEN;
    let called = false;
    const snapshot = await getNotionSnapshot(async () => {
      called = true;
      return json({});
    });
    assert.equal(called, false);
    assert.equal(snapshot.status, "warn");
    assert.match(snapshot.detail, /NOTION_DATABASE_IDS/);
  });

  test("lists open rows and filters Status != Klart", async () => {
    env.NOTION_TOKEN = TOKEN;
    env.NOTION_DATABASE_IDS = DB;
    let filter: unknown;
    const snapshot = await getNotionSnapshot(async (input, init) => {
      const url = String(input);
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
      assert.equal(url.includes(TOKEN), false);
      if (url.endsWith(`/databases/${DB}`)) {
        return json({
          title: [{ plain_text: "Att göra för John (botarna)" }],
          properties: {
            Name: { type: "title" },
            Status: { type: "status" },
          },
        });
      }
      filter = JSON.parse(String(init?.body));
      return json({
        results: [
          {
            id: "page-open",
            url: "https://www.notion.so/page-open",
            last_edited_time: "2026-10-16T12:00:00Z",
            properties: {
              Name: { type: "title", title: [{ plain_text: "Fix the bots" }] },
              Status: { type: "status", status: { name: "Pågår" } },
            },
          },
          {
            id: "page-done",
            url: "https://www.notion.so/page-done",
            last_edited_time: "2026-10-16T11:00:00Z",
            properties: {
              Name: { type: "title", title: [{ plain_text: "Already done" }] },
              Status: { type: "status", status: { name: "Klart" } },
            },
          },
        ],
      });
    });

    assert.deepEqual(filter, {
      filter: { property: "Status", status: { does_not_equal: "Klart" } },
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      page_size: 25,
    });
    assert.equal(snapshot.status, "ok");
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0]?.title, "Fix the bots");
    assert.equal(snapshot.rows[0]?.status, "Pågår");
    assert.equal(snapshot.rows[0]?.databaseTitle, "Att göra för John (botarna)");
    assert.equal(JSON.stringify(snapshot).includes(TOKEN), false);
  });

  test("uses a select filter when Status is a select", async () => {
    env.NOTION_TOKEN = TOKEN;
    env.NOTION_DATABASE_IDS = DB;
    let filter: { filter?: { select?: { does_not_equal?: string } } } | undefined;
    await getNotionSnapshot(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/databases/${DB}`)) {
        return json({
          title: [{ plain_text: "Tasks" }],
          properties: { Status: { type: "select" }, Name: { type: "title" } },
        });
      }
      filter = JSON.parse(String(init?.body));
      return json({ results: [] });
    });
    assert.equal(filter?.filter?.select?.does_not_equal, "Klart");
  });

  test("an upstream error does not echo the secret", async () => {
    env.NOTION_TOKEN = TOKEN;
    env.NOTION_DATABASE_IDS = DB;
    const snapshot = await getNotionSnapshot(async () =>
      json({ message: `unauthorized ${TOKEN}` }, 502),
    );
    assert.equal(snapshot.status, "error");
    assert.equal(JSON.stringify(snapshot).includes(TOKEN), false);
    assert.match(snapshot.detail, /502/);
  });
});

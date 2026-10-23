import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { clearIntegrationCache } from "@/lib/integrations/cache";
import { getObsidianSnapshot } from "./snapshot";
import { resolveVault } from "./vault";

const KEY = "obsidian_test_key_do_not_log";
const env = process.env as Record<string, string | undefined>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  delete env.OBSIDIAN_VAULT_PATH;
  delete env.OBSIDIAN_API_URL;
  delete env.OBSIDIAN_API_KEY;
  delete env.OBSIDIAN_API_INSECURE;
  clearIntegrationCache();
});

describe("obsidian integration", () => {
  test("stays off when no vault or API is configured", async () => {
    let called = false;
    const snapshot = await getObsidianSnapshot(null, async () => {
      called = true;
      return json({});
    });
    assert.equal(called, false);
    assert.equal(snapshot.configured, false);
    assert.equal(snapshot.status, "idle");
  });

  test("refuses a system root as the vault", async () => {
    const resolved = await resolveVault("/tmp");
    assert.equal("error" in resolved, true);
    if ("error" in resolved) assert.match(resolved.error, /vault folder/);
  });

  test("reads recent notes and search from a local vault", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vanos-vault-"));
    await mkdir(path.join(root, "Projects"));
    await mkdir(path.join(root, ".obsidian"));
    const older = path.join(root, "Inbox.md");
    const newer = path.join(root, "Projects", "Bots.md");
    await writeFile(older, "# Inbox\n\nNothing here.\n");
    await writeFile(
      newer,
      "---\ntitle: Bots for John\n---\n\nStatus is not Klart yet.\n",
    );
    await writeFile(path.join(root, ".obsidian", "secret.md"), "SECRET_PHRASE should stay hidden\n");
    await writeFile(path.join(root, "notes.txt"), "not markdown\n");
    const outside = path.join(tmpdir(), `vanos-outside-${Date.now()}.md`);
    await writeFile(outside, "OUTSIDE_SECRET\n");
    await symlink(outside, path.join(root, "leak.md"));
    const oldTime = new Date("2026-01-01T00:00:00Z");
    const newTime = new Date("2026-10-16T12:00:00Z");
    await utimes(older, oldTime, oldTime);
    await utimes(newer, newTime, newTime);

    env.OBSIDIAN_VAULT_PATH = root;
    const recent = await getObsidianSnapshot();
    assert.equal(recent.status, "ok");
    assert.equal(recent.notes[0]?.title, "Bots for John");
    assert.equal(recent.notes[0]?.path, "Projects/Bots.md");
    assert.equal(recent.notes.some((note) => note.path.includes(".obsidian")), false);
    assert.equal(recent.notes.some((note) => note.path === "leak.md"), false);

    clearIntegrationCache();
    const found = await getObsidianSnapshot("Klart");
    assert.equal(found.mode, "search");
    assert.equal(found.notes.length, 1);
    assert.equal(found.notes[0]?.path, "Projects/Bots.md");
    assert.equal(found.notes[0]?.excerpt.includes("---"), false);
    assert.match(found.notes[0]?.excerpt ?? "", /Klart/);

    clearIntegrationCache();
    const hidden = await getObsidianSnapshot("SECRET_PHRASE");
    assert.equal(hidden.notes.length, 0);
    const leaked = await getObsidianSnapshot("OUTSIDE_SECRET");
    assert.equal(leaked.notes.length, 0);
    assert.equal(JSON.stringify(found).includes(root), false);
  });

  test("searches through the Local REST API without putting the key in the URL", async () => {
    env.OBSIDIAN_API_URL = "http://127.0.0.1:27123";
    env.OBSIDIAN_API_KEY = KEY;
    const snapshot = await getObsidianSnapshot("sample", async (input, init) => {
      const url = String(input);
      assert.equal(url.includes(KEY), false);
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${KEY}`);
      assert.match(url, /\/search\/simple\/\?/);
      assert.equal(init?.method, "POST");
      return json([
        {
          filename: "Projects/Bots.md",
          score: 1,
          matches: [{ context: "open work for sample" }],
        },
      ]);
    });
    assert.equal(snapshot.mode, "search");
    assert.equal(snapshot.notes[0]?.title, "Bots");
    assert.match(snapshot.notes[0]?.excerpt ?? "", /sample/);
    assert.equal(JSON.stringify(snapshot).includes(KEY), false);
  });

  test("an incomplete API config does not call the network", async () => {
    env.OBSIDIAN_API_URL = "http://127.0.0.1:27123";
    let called = false;
    const snapshot = await getObsidianSnapshot(null, async () => {
      called = true;
      return json({});
    });
    assert.equal(called, false);
    assert.match(snapshot.detail, /OBSIDIAN_API_KEY/);
  });

  test("insecure mode does not leak the key when the API is down", async () => {
    env.OBSIDIAN_API_URL = "http://127.0.0.1:9";
    env.OBSIDIAN_API_KEY = KEY;
    env.OBSIDIAN_API_INSECURE = "true";
    let called = false;
    const snapshot = await getObsidianSnapshot(null, async () => {
      called = true;
      return json({});
    });
    assert.equal(called, false);
    assert.equal(snapshot.status, "error");
    assert.equal(JSON.stringify(snapshot).includes(KEY), false);
  });
});

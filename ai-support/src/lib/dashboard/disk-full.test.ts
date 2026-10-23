import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import { GET } from "@/app/api/dashboard/route";
import { resetDashboardMemory, serveDashboard } from "@/lib/dashboard/serve";
import { fsOps, resetFsWriteState } from "@/lib/durable/fs";
import { clearDurableCache, DurableWriteError, durableGetJson, durableSetJson } from "@/lib/durable/store";

const SENTINEL = "DISK_FULL_SECRET_PAYLOAD";

const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_ACCESS_MODE",
  "VANOS_DEMO_MODE",
  "VANOS_EDGE_DASHBOARD",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "DASHBOARD_BASIC_USER",
  "DASHBOARD_BASIC_PASSWORD",
  "MONEY_FX_AUTO",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];

let dataDir = "";
let n = 0;
const uniqueKey = (name: string) => `disk-${name}-${n++}`;

function errno(code: string, syscall: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: filesystem write failed`) as NodeJS.ErrnoException;
  err.code = code;
  err.syscall = syscall;
  return err;
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
}

function localEnv(): void {
  env.NODE_ENV = "development";
  env.VANOS_ACCESS_MODE = "public";
  env.MONEY_FX_AUTO = "off";
  env.VANOS_DATA_DIR = dataDir;
  env.BOTS_DATA_DIR = dataDir;
  delete env.VANOS_DEMO_MODE;
  delete env.VANOS_EDGE_DASHBOARD;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  delete env.DASHBOARD_BASIC_USER;
  delete env.DASHBOARD_BASIC_PASSWORD;
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "vanos-disk-full-"));
});

after(async () => {
  restoreEnv();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  localEnv();
  resetFsWriteState();
  resetDashboardMemory();
  clearDurableCache();
});

afterEach(() => {
  restoreEnv();
  mock.restoreAll();
});

function fsLogs(errors: { mock: { calls: { arguments: unknown[] }[] } }): { code: string; raw: string }[] {
  return errors.mock.calls
    .map((call) => String(call.arguments[0]))
    .filter((line) => line.includes("fs_write_failed"))
    .map((raw) => ({ raw, code: (JSON.parse(raw) as { code: string }).code }));
}

describe("dashboard filesystem write failures", { concurrency: false }, () => {
  test("logs each write errno once, with the code only", async () => {
    for (const code of ["EDQUOT", "EROFS", "EACCES", "EIO"] as const) {
      resetFsWriteState();
      const errors = mock.method(console, "error", () => undefined);
      const write = mock.method(fsOps, "writeFile", async () => {
        throw errno(code, "write");
      });
      try {
        const key = uniqueKey(code);
        await assert.rejects(durableSetJson(key, { secret: SENTINEL }), DurableWriteError);
        await assert.rejects(durableSetJson(key, { secret: SENTINEL }), DurableWriteError);
        const logs = fsLogs(errors);
        assert.equal(logs.length, 1, code);
        const parsed = JSON.parse(logs[0].raw) as Record<string, unknown>;
        assert.deepEqual(Object.keys(parsed).sort(), ["code", "event", "level", "ts"]);
        assert.equal(parsed.event, "fs_write_failed");
        assert.equal(parsed.code, code);
        assert.equal(logs[0].raw.includes(SENTINEL), false);
        assert.equal(logs[0].raw.includes(dataDir), false);
      } finally {
        write.mock.restore();
        errors.mock.restore();
      }
    }
  });

  test("GET /api/dashboard serves last good data when writeFile throws ENOSPC", async () => {
    const key = uniqueKey("enospc");
    const good = { keep: "last-good" };
    await durableSetJson(key, good);

    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandled);
    const errors = mock.method(console, "error", () => undefined);
    const write = mock.method(fsOps, "writeFile", async () => {
      throw errno("ENOSPC", "write");
    });
    try {
      await assert.rejects(durableSetJson(key, { secret: SENTINEL }), DurableWriteError);
      await assert.rejects(durableSetJson(key, { secret: SENTINEL }), DurableWriteError);

      clearDurableCache();
      assert.deepEqual(await durableGetJson(key), good);

      const res = await GET(new Request("http://127.0.0.1:3000/api/dashboard"));
      const body = (await res.json()) as {
        status?: string;
        degraded?: boolean;
        reason?: string;
        agents?: unknown[];
      };
      assert.ok(res.status === 503 || body.degraded === true);
      if (res.status === 503) {
        assert.deepEqual(body, { status: "degraded", reason: "ENOSPC" });
      } else {
        assert.equal(res.status, 200);
        assert.equal(body.degraded, true);
        assert.equal(body.reason, "ENOSPC");
        assert.ok(Array.isArray(body.agents) && body.agents.length > 0);
      }
      assert.equal(JSON.stringify(body).includes(SENTINEL), false);

      const logs = fsLogs(errors);
      assert.equal(logs.length, 1);
      assert.equal(logs[0].code, "ENOSPC");
      assert.equal(logs[0].raw.includes(SENTINEL), false);

      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(unhandled.length, 0);
    } finally {
      write.mock.restore();
      errors.mock.restore();
      process.off("unhandledRejection", onUnhandled);
    }

    await durableSetJson(key, { keep: "recovered" });
    const healthy = await GET(new Request("http://127.0.0.1:3000/api/dashboard"));
    const healthyBody = (await healthy.json()) as { degraded?: boolean };
    assert.equal(healthy.status, 200);
    assert.equal(healthyBody.degraded, undefined);
    clearDurableCache();
    assert.deepEqual(await durableGetJson(key), { keep: "recovered" });
  });

  test("answers 503 when the disk is full and nothing has been served yet", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandled);
    const mkdir = mock.method(fsOps, "mkdir", async () => {
      throw errno("ENOSPC", "mkdir");
    });
    try {
      const res = await serveDashboard(async () => {
        await durableSetJson(uniqueKey("empty"), { secret: SENTINEL });
        throw new Error("load should not run after a failed write");
      });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("retry-after"), "5");
      assert.deepEqual(await res.json(), { status: "degraded", reason: "ENOSPC" });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(unhandled.length, 0);
    } finally {
      mkdir.mock.restore();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a failed rename leaves the previous file readable", async () => {
    const key = uniqueKey("rename");
    await durableSetJson(key, { keep: "on-disk" });
    const rename = mock.method(fsOps, "rename", async () => {
      throw errno("EROFS", "rename");
    });
    try {
      await assert.rejects(durableSetJson(key, { secret: SENTINEL }), DurableWriteError);
    } finally {
      rename.mock.restore();
    }
    clearDurableCache();
    assert.deepEqual(await durableGetJson(key), { keep: "on-disk" });
  });
});

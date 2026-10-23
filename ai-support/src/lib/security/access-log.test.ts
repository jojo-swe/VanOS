import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { authorizeAgent } from "@/lib/agent-api/auth";
import { authorizeIngest } from "@/lib/bots/auth";
import {
  accessClientIp,
  frameworkStatus,
  logAuthFail,
  logPageView,
  logServerError,
  redact,
  withRequestLog,
} from "@/lib/security/access-log";
import { clearRateLimits } from "@/lib/security/rate-limit";
import { proxy } from "@/proxy";
import { appVersion, reportStartup } from "@/lib/security/startup-log";

const SECRET = "super-secret-token-value-0123456789";
const QUERY = "query-secret-value-abcdef";
const COOKIE = "cookie-secret-value-ghijkl";
const PASSWORD = "dashboard-password-value";

const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_ACCESS_MODE",
  "VANOS_EDGE_DASHBOARD",
  "VANOS_DEMO_MODE",
  "VANOS_TRUST_PROXY",
  "VANOS_REQUIRE_NETWORK_GATE",
  "VANOS_REQUIRE_BASIC_AUTH",
  "VANOS_PUBLIC_INGEST",
  "VANOS_ALLOWED_TAILSCALE_USERS",
  "VANOS_EDGE_SECRET",
  "VANOS_TRUST_TAILSCALE_CGNAT",
  "DASHBOARD_BASIC_USER",
  "DASHBOARD_BASIC_PASSWORD",
  "AGENT_API_TOKEN",
  "AGENT_API_TOKEN_PREVIOUS",
  "BOTS_INGEST_SECRET",
  "BOTS_INGEST_SECRET_PREVIOUS",
  "VANOS_ALLOW_INGEST_AS_AGENT",
  "VANOS_RATE_LIMIT_PER_MIN",
  "VANOS_TOTP_SECRET",
  "VANOS_SESSION_SECRET",
  "VANOS_SESSION_TTL_SECONDS",
  "VANOS_SESSION_TTL_DAYS",
  "VANOS_TOTP_RECOVERY_CODES",
  "VANOS_TOTP_RECOVERY_FILE",
  "VANOS_TOTP_RECOVERY_USED_FILE",
  "GITHUB_TOKEN",
  "NOTION_TOKEN",
  "OBSIDIAN_API_KEY",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  clearRateLimits();
});

async function capture(fn: () => void | Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = write;
  }
  return lines.flatMap((chunk) => chunk.split("\n")).filter((line) => line.length > 0);
}

async function records(fn: () => void | Promise<void>): Promise<Array<Record<string, unknown>>> {
  return (await capture(fn)).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function recordsAsync(fn: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
  const lines: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = write;
  }
  return lines
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function gate(path: string, headers?: Record<string, string>) {
  return proxy(new NextRequest(new URL(path, "http://127.0.0.1:3000"), { headers }));
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("access log shape", () => {
  test("request line uses only the safe fields", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "private";
    delete env.VANOS_TRUST_PROXY;
    const handler = withRequestLog(async () => new Response("ok", { status: 201 }));
    const req = new Request("http://127.0.0.1/api/v1/health?token=hidden", {
      method: "GET",
    });
    const logged = await recordsAsync(async () => {
      await handler(req);
    });
    const row = logged[0];
    assert.deepEqual(Object.keys(row).sort(), [
      "dur_ms",
      "ip",
      "level",
      "method",
      "path",
      "route_group",
      "status",
      "ts",
    ]);
    assert.equal(row.level, "info");
    assert.equal(row.method, "GET");
    assert.equal(row.path, "/api/v1/health");
    assert.equal(row.status, 201);
    assert.equal(row.route_group, "v1");
    assert.equal(typeof row.dur_ms, "number");
    assert.match(String(row.ts), ISO);
    assert.equal(JSON.stringify(row).includes("hidden"), false);
    assert.equal(JSON.stringify(row).includes("?"), false);
  });

  test("client IP uses the rightmost untrusted hop only behind a trusted proxy", async () => {
    delete env.VANOS_TRUST_PROXY;
    const headers = { get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.9, 10.0.0.8" : null) };
    assert.equal(accessClientIp({ ip: "127.0.0.1", headers }), "127.0.0.1");
    assert.equal(accessClientIp({ headers }), "unknown");

    env.VANOS_TRUST_PROXY = "true";
    assert.equal(accessClientIp({ ip: "127.0.0.1", headers }), "10.0.0.8");
    assert.equal(accessClientIp({ ip: "10.9.9.9", headers: { get: () => "" } }), "10.9.9.9");
    assert.equal(
      accessClientIp({
        ip: "10.0.0.8",
        headers: { get: () => "203.0.113.9, 10.0.0.8" },
      }),
      "203.0.113.9",
    );
  });
});

describe("proxy access log", () => {
  test("edge 404s log dashboard, v1, and other closed paths", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "edge";
    delete env.VANOS_EDGE_DASHBOARD;
    delete env.VANOS_TRUST_PROXY;

    const logged = (await records(async () => {
      assert.equal(
        (await gate("/dashboard?token=" + QUERY, {
          authorization: `Bearer ${SECRET}`,
          cookie: `session=${COOKIE}`,
          "x-forwarded-for": "203.0.113.9, 198.51.100.8",
        })).status,
        404,
      );
      assert.equal((await gate("/api/v1/snapshot")).status, 404);
      assert.equal((await gate("/support")).status, 404);
      assert.equal((await gate("/api/bots/ingest")).status, 200);
    }));

    const blob = JSON.stringify(logged);
    assert.equal(blob.includes(SECRET), false);
    assert.equal(blob.includes(QUERY), false);
    assert.equal(blob.includes(COOKIE), false);
    assert.equal(blob.includes("?"), false);
    assert.equal(blob.includes("198.51.100.8"), false);
    assert.equal(blob.includes("authorization"), false);
    assert.equal(blob.includes("cookie"), false);

    const dashboard = logged.find((row) => row.path === "/dashboard");
    assert.ok(dashboard);
    assert.equal(dashboard.status, 404);
    assert.equal(dashboard.level, "warn");
    assert.equal(dashboard.route_group, "dashboard");
    assert.equal(dashboard.method, "GET");
    assert.notEqual(dashboard.ip, "203.0.113.9");

    const snapshot = logged.find((row) => row.path === "/api/v1/snapshot");
    assert.equal(snapshot?.route_group, "v1");
    assert.equal(snapshot?.status, 404);

    const support = logged.find((row) => row.path === "/support");
    assert.equal(support?.route_group, "edge");
    assert.equal(support?.status, 404);

    assert.equal(
      logged.some((row) => row.path === "/api/bots/ingest" && row.status === 200),
      false,
    );
  });

  test("trusted proxy logs the rightmost untrusted hop on an edge 404", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "edge";
    env.VANOS_TRUST_PROXY = "true";
    const logged = (await records(async () => {
      assert.equal(
        (await gate("/favicon.ico", { "x-forwarded-for": "203.0.113.9, 10.1.1.1" })).status,
        404,
      );
    }));
    assert.equal(logged[0]?.ip, "10.1.1.1");
    assert.equal(logged[0]?.route_group, "edge");
    assert.equal(JSON.stringify(logged).includes("203.0.113.9"), false);
  });

  test("basic auth failure and success", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "private";
    env.VANOS_REQUIRE_NETWORK_GATE = "false";
    env.DASHBOARD_BASIC_USER = "jojo";
    env.DASHBOARD_BASIC_PASSWORD = PASSWORD;
    const basic = "Basic " + Buffer.from(`jojo:${PASSWORD}`).toString("base64");

    const denied = (await records(async () => {
      assert.equal((await gate("/dashboard?password=" + PASSWORD)).status, 401);
    }));
    const fail = denied.find((row) => row.event === "auth_fail");
    const request = denied.find((row) => row.status === 401);
    assert.equal(fail?.reason, "basic_auth_fail");
    assert.equal(fail?.level, "warn");
    assert.equal(fail?.path, "/dashboard");
    assert.equal(request?.route_group, "dashboard");
    assert.equal(request?.level, "warn");
    const deniedBlob = JSON.stringify(denied);
    assert.equal(deniedBlob.includes(PASSWORD), false);
    assert.equal(deniedBlob.includes("?"), false);

    const allowed = (await records(async () => {
      assert.equal((await gate("/dashboard", { authorization: basic })).status, 200);
    }));
    assert.equal(allowed.some((row) => row.event === "auth_ok"), true);
    assert.equal(allowed.some((row) => row.status === 200), false);
    assert.equal(JSON.stringify(allowed).includes(PASSWORD), false);
  });

  test("rate limit is an auth failure and a 429 request", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "edge";
    env.VANOS_RATE_LIMIT_PER_MIN = "1";
    const headers = { "x-forwarded-for": "203.0.113.77" };
    const logged = (await records(async () => {
      assert.equal((await gate("/api/bots/ingest", headers)).status, 200);
      assert.equal((await gate("/api/bots/ingest", headers)).status, 429);
    }));
    const limited = logged.find((row) => row.status === 429);
    const auth = logged.find((row) => row.event === "auth_fail");
    assert.equal(limited?.route_group, "ingest");
    assert.equal(limited?.level, "warn");
    assert.equal(auth?.reason, "rate_limited");
    assert.equal(auth?.path, "/api/bots/ingest");
  });
});

describe("auth events", () => {
  test("bad token, missing token, and auth_ok never include the token", async () => {
    env.NODE_ENV = "production";
    delete env.VANOS_ALLOW_INGEST_AS_AGENT;
    env.AGENT_API_TOKEN = "a".repeat(32);
    env.BOTS_INGEST_SECRET = "c".repeat(32);

    const good = new Request("http://127.0.0.1/api/mcp?access_token=" + SECRET, {
      headers: { authorization: `Bearer ${"a".repeat(32)}`, cookie: `session=${COOKIE}` },
    });
    const bad = new Request("http://127.0.0.1/api/bots/ingest", {
      headers: { authorization: `Bearer ${SECRET}`, "x-vanos-ingest-secret": SECRET },
    });
    const missing = new Request("http://127.0.0.1/api/v1/snapshot");

    const logged = (await records(async () => {
      assert.equal(authorizeAgent(good), true);
      assert.equal(authorizeIngest(bad), false);
      logAuthFail(missing, "missing_token");
    }));

    const blob = JSON.stringify(logged);
    assert.equal(blob.includes(SECRET), false);
    assert.equal(blob.includes(COOKIE), false);
    assert.equal(blob.includes("access_token"), false);
    assert.equal(blob.includes("?"), false);
    assert.equal(logged.find((row) => row.event === "auth_ok")?.path, "/api/mcp");
    assert.equal(logged.find((row) => row.reason === "bad_token")?.path, "/api/bots/ingest");
    assert.equal(logged.find((row) => row.reason === "missing_token")?.level, "warn");
    assert.equal(logged.some((row) => row.event === "auth_ok" && "reason" in row), false);
  });
});

describe("startup log", () => {
  test("config_ok true has no reason and names the version and mode", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "edge";
    delete env.AGENT_API_TOKEN;
    delete env.AGENT_API_TOKEN_PREVIOUS;
    delete env.BOTS_INGEST_SECRET;
    delete env.BOTS_INGEST_SECRET_PREVIOUS;
    delete env.VANOS_TOTP_SECRET;
    delete env.VANOS_SESSION_SECRET;
    delete env.DASHBOARD_BASIC_PASSWORD;
    const logged = (await records(async () => {
      reportStartup(() => {
        throw new Error("should not exit");
      });
    }));
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.event, "startup");
    assert.equal(logged[0]?.level, "info");
    assert.equal(logged[0]?.config_ok, true);
    assert.equal(logged[0]?.mode, "edge");
    assert.equal(logged[0]?.version, appVersion());
    assert.equal("reason" in (logged[0] ?? {}), false);
    const version = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;
    assert.equal(logged[0]?.version, version);
  });

  test("short and shared keys are logged before exit and the secret is omitted", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "private";
    env.AGENT_API_TOKEN = "short-token";
    env.BOTS_INGEST_SECRET = "c".repeat(32);
    let wroteBeforeExit = false;
    const lines: string[] = [];
    const write = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      assert.throws(
        () =>
          reportStartup(() => {
            wroteBeforeExit = lines.length > 0;
            throw new Error("exit-now");
          }),
        /exit-now/,
      );
    } finally {
      process.stdout.write = write;
    }
    assert.equal(wroteBeforeExit, true);
    const row = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(row.event, "startup");
    assert.equal(row.level, "error");
    assert.equal(row.config_ok, false);
    assert.equal(row.reason, "short_key");
    assert.equal(row.mode, "private");
    assert.equal(lines[0]?.includes("short-token"), false);

    env.AGENT_API_TOKEN = SECRET;
    env.BOTS_INGEST_SECRET = SECRET;
    const shared = (await records(async () => {
      assert.throws(
        () => reportStartup(() => {
          throw new Error("exit-now");
        }),
        /exit-now/,
      );
    }));
    assert.equal(shared[0]?.reason, "shared_key");
    assert.equal(JSON.stringify(shared).includes(SECRET), false);
  });
});

describe("error log", () => {
  test("records the class, redacts secrets, and keeps at most 20 stack lines", async () => {
    env.AGENT_API_TOKEN = SECRET;
    const err = new TypeError(`boom Bearer ${SECRET} ?token=${QUERY} cookie=${COOKIE}`);
    err.stack = Array.from({ length: 25 }, (_, i) => `frame ${i} ${SECRET}?x=${QUERY}`).join("\n");
    const logged = (await records(async () => {
      logServerError(`/api/v1/ingest?token=${QUERY}`, err);
      assert.equal(frameworkStatus({ digest: "NEXT_NOT_FOUND" }), 404);
      logServerError("/dashboard", { digest: "NEXT_NOT_FOUND" });
    }));
    assert.equal(logged.length, 1);
    const row = logged[0];
    assert.equal(row?.event, "error");
    assert.equal(row?.level, "error");
    assert.equal(row?.route, "/api/v1/ingest");
    assert.equal(row?.error, "TypeError");
    assert.equal(String(row?.message).includes(SECRET), false);
    assert.equal(String(row?.message).includes(QUERY), false);
    assert.equal(String(row?.stack).includes(SECRET), false);
    assert.equal(String(row?.stack).includes(QUERY), false);
    assert.ok(String(row?.stack).split("\n").length <= 20);
    assert.equal(JSON.stringify(row).includes("?"), false);
  });

  test("a thrown handler logs status 500 and the query stays out of the line", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "edge";
    const handler = withRequestLog(async () => {
      throw new Error("explode " + SECRET);
    });
    const req = new Request(`http://127.0.0.1/api/mcp?token=${QUERY}`, { method: "POST" });
    const combined = await recordsAsync(async () => {
      await assert.rejects(() => handler(req));
    });
    assert.equal(combined[0]?.status, 500);
    assert.equal(combined[0]?.level, "error");
    assert.equal(combined[0]?.route_group, "mcp");
    assert.equal(combined[0]?.path, "/api/mcp");
    assert.equal(JSON.stringify(combined).includes(QUERY), false);
    assert.equal(JSON.stringify(combined).includes(SECRET), false);
  });
});

describe("dashboard exposure guard", () => {
  test("status 200 in edge mode without the flag emits dashboard_exposed", async () => {
    env.NODE_ENV = "production";
    env.VANOS_ACCESS_MODE = "edge";
    delete env.VANOS_EDGE_DASHBOARD;
    const logged = (await records(async () => {
      logPageView({
        method: "GET",
        path: "/dashboard?next=" + SECRET,
        status: 200,
        durMs: 3,
        socketIp: "127.0.0.1",
        forwardedFor: null,
      });
    }));
    assert.equal(logged[0]?.level, "error");
    assert.equal(logged[0]?.status, 200);
    assert.equal(logged[0]?.path, "/dashboard");
    assert.equal(logged[1]?.event, "dashboard_exposed");
    assert.equal(logged[1]?.level, "error");
    assert.equal(logged[1]?.mode, "edge");
    assert.equal(JSON.stringify(logged).includes(SECRET), false);

    env.VANOS_EDGE_DASHBOARD = "true";
    const open = (await records(async () => {
      logPageView({
        method: "GET",
        path: "/dashboard",
        status: 200,
        durMs: 1,
        socketIp: "127.0.0.1",
        forwardedFor: null,
      });
    }));
    assert.equal(open.some((row) => row.event === "dashboard_exposed"), false);
    assert.equal(open[0]?.level, "info");

    delete env.VANOS_EDGE_DASHBOARD;
    env.VANOS_ACCESS_MODE = "private";
    const closed = (await records(async () => {
      logPageView({
        method: "GET",
        path: "/dashboard",
        status: 404,
        durMs: 1,
        socketIp: "10.0.0.5",
        forwardedFor: "203.0.113.1",
      });
    }));
    assert.equal(closed.length, 1);
    assert.equal(closed[0]?.status, 404);
    assert.equal(closed[0]?.ip, "10.0.0.5");
    assert.equal(closed.some((row) => row.event === "dashboard_exposed"), false);
  });
});

describe("redaction", () => {
  test("query strings and bearer values do not survive", async () => {
    env.BOTS_INGEST_SECRET = SECRET;
    env.GITHUB_TOKEN = "github_pat_test_value_do_not_log";
    env.NOTION_TOKEN = "ntn_test_value_do_not_log_1234";
    env.OBSIDIAN_API_KEY = "obsidian_test_key_do_not_log";
    const text = redact(
      `failed Bearer ${SECRET} cookie=${COOKIE} https://user:${SECRET}@example.com/api?token=${QUERY}&x=1 github_pat_test_value_do_not_log ntn_test_value_do_not_log_1234 obsidian_test_key_do_not_log`,
    );
    assert.equal(text.includes(SECRET), false);
    assert.equal(text.includes("github_pat_test_value_do_not_log"), false);
    assert.equal(text.includes("ntn_test_value_do_not_log_1234"), false);
    assert.equal(text.includes("obsidian_test_key_do_not_log"), false);
    assert.equal(text.includes(QUERY), false);
    assert.equal(text.includes("token="), false);
  });
});

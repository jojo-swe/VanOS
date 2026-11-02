import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as moneyGet } from "@/app/api/money/route";
import { proxy } from "@/proxy";
import { clearDurableCache } from "@/lib/durable/store";
import { basicCredentialsMatch, credentialsMatch } from "@/lib/security/dashboard-auth";
import { clearRateLimits } from "@/lib/security/rate-limit";
import {
  clearSessionGenerationCache,
  SESSION_GENERATION_FRESH_MS,
  SESSION_GENERATION_STALE_LIMIT_MS,
} from "@/lib/security/session-generation";
import {
  checkMfaCode,
  clearTotpState,
  decodeBase32,
  submitTotp,
  totpAt,
} from "@/lib/security/totp";

/** RFC 6238 appendix B secret, base32. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SESSION = "s".repeat(32);
const PASSWORD = "p".repeat(32);

const ENV_KEYS = [
  "NODE_ENV",
  "VANOS_ACCESS_MODE",
  "VANOS_EDGE_DASHBOARD",
  "VANOS_DEMO_MODE",
  "VANOS_TRUST_PROXY",
  "VANOS_REQUIRE_NETWORK_GATE",
  "VANOS_PUBLIC_INGEST",
  "VANOS_RATE_LIMIT_PER_MIN",
  "DASHBOARD_BASIC_USER",
  "DASHBOARD_BASIC_PASSWORD",
  "AGENT_API_TOKEN",
  "BOTS_INGEST_SECRET",
  "VANOS_TOTP_SECRET",
  "VANOS_SESSION_SECRET",
  "VANOS_SESSION_TTL_DAYS",
  "VANOS_TOTP_MAX_ATTEMPTS",
  "VANOS_TOTP_ATTEMPT_WINDOW_SEC",
  "VANOS_TOTP_RECOVERY_CODES",
  "VANOS_TOTP_RECOVERY_FILE",
  "VANOS_TOTP_RECOVERY_USED_FILE",
  "VANOS_DATA_DIR",
  "BOTS_DATA_DIR",
  "VANOS_STORE_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = env[key];
const realFetch = globalThis.fetch;

const basic = "Basic " + Buffer.from(`jojo:${PASSWORD}`).toString("base64");
const GEN_FILE = "auth-session-generation.json";

let dataDir = "";

function gate(pathname: string, headers?: Record<string, string>, method = "GET") {
  return proxy(
    new NextRequest(new URL(pathname, "http://127.0.0.1:3000"), { method, headers }),
  );
}

/** Basic login with TOTP off. Returns the `name=value` cookie pair. */
async function login(): Promise<string> {
  const res = await gate("/dashboard", { authorization: basic });
  assert.equal(res.status, 200);
  const pair = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  assert.match(pair, /^vanos_session=v3\./);
  return pair;
}

function logout(headers: Record<string, string>) {
  return logoutPost(
    new Request("http://127.0.0.1:3000/api/auth/logout", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin", ...headers },
    }),
  );
}

/** What a process restart forgets: every in-memory cache and counter. */
function restart(): void {
  clearDurableCache();
  clearSessionGenerationCache();
  clearTotpState();
  clearRateLimits();
}

async function capture(fn: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
  const lines: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    if (typeof chunk !== "string") {
      return (write as (...args: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
    }
    lines.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = write;
  }
  return lines
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Upstash stand-in for the commands the store and rate limiter send: GET,
 * SET, MGET, the version-checked write script (2 keys) and the counter
 * script (1 key). `down` makes every call fail like an outage.
 */
function fakeUpstash() {
  const db = new Map<string, string>();
  const ctl = { down: false, db };
  env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.test";
  env.UPSTASH_REDIS_REST_TOKEN = "t".repeat(32);
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (ctl.down) return new Response("down", { status: 503 });
    const cmd = JSON.parse(String(init?.body)) as (string | number)[];
    const op = String(cmd[0]).toUpperCase();
    let result: unknown = null;
    if (op === "GET") result = db.get(String(cmd[1])) ?? null;
    else if (op === "SET") {
      db.set(String(cmd[1]), String(cmd[2]));
      result = "OK";
    } else if (op === "MGET") result = cmd.slice(1).map((k) => db.get(String(k)) ?? null);
    else if (op === "EVAL" && Number(cmd[2]) === 2) {
      const [, , , docKey, verKey, expected, value] = cmd.map(String);
      const ver = db.get(verKey) ?? "0";
      if (ver !== expected) result = 0;
      else {
        db.set(docKey, value);
        db.set(verKey, String(Number(ver) + 1));
        result = 1;
      }
    } else if (op === "EVAL" && Number(cmd[2]) === 1) {
      const key = String(cmd[3]);
      const n = Number(db.get(key) ?? "0") + 1;
      db.set(key, String(n));
      result = n;
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
  return ctl;
}

function unwritableDataDir(): void {
  const blocker = path.join(dataDir, "not-a-dir");
  writeFileSync(blocker, "x");
  env.VANOS_DATA_DIR = path.join(blocker, "store");
  env.BOTS_DATA_DIR = path.join(blocker, "store");
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "vanos-auth-"));
  env.VANOS_DATA_DIR = dataDir;
  env.BOTS_DATA_DIR = dataDir;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  delete env.VANOS_STORE_PREFIX;
  restart();
  env.NODE_ENV = "production";
  env.VANOS_ACCESS_MODE = "private";
  env.VANOS_REQUIRE_NETWORK_GATE = "false";
  env.VANOS_TRUST_PROXY = "true";
  env.DASHBOARD_BASIC_USER = "jojo";
  env.DASHBOARD_BASIC_PASSWORD = PASSWORD;
  env.VANOS_SESSION_SECRET = SESSION;
  env.VANOS_TOTP_MAX_ATTEMPTS = "20";
  delete env.VANOS_TOTP_SECRET;
  delete env.VANOS_SESSION_TTL_DAYS;
  delete env.VANOS_TOTP_ATTEMPT_WINDOW_SEC;
  delete env.VANOS_TOTP_RECOVERY_CODES;
  delete env.VANOS_TOTP_RECOVERY_FILE;
  delete env.VANOS_TOTP_RECOVERY_USED_FILE;
  delete env.VANOS_EDGE_DASHBOARD;
  delete env.VANOS_DEMO_MODE;
  delete env.VANOS_PUBLIC_INGEST;
  delete env.AGENT_API_TOKEN;
  delete env.BOTS_INGEST_SECRET;
});

afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
  restart();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("logout revokes sessions", () => {
  test("a copied cookie stops working after logout, in the proxy and in route handlers", async () => {
    const pair = await login();
    const copy = pair;
    assert.equal((await gate("/dashboard", { cookie: copy })).status, 200);
    const before = await moneyGet(
      new Request("http://127.0.0.1:3000/api/money", { headers: { cookie: copy } }),
    );
    assert.equal(before.status, 200);

    const logged = await capture(async () => {
      const res = await logout({ cookie: pair });
      assert.equal(res.status, 303);
      assert.equal(res.headers.get("location"), "/");
      assert.match(res.headers.get("set-cookie") ?? "", /Max-Age=0/);
    });
    const line = logged.find((row) => row.event === "logout");
    assert.equal(line?.revoked, true);
    assert.equal(line?.level, "info");
    assert.equal(JSON.stringify(logged).includes(pair.split("=")[1] ?? "x"), false);

    const stolen = await gate("/dashboard", { cookie: copy });
    assert.equal(stolen.status, 401);
    assert.match(stolen.headers.get("www-authenticate") ?? "", /Basic/);
    const api = await gate("/api/dashboard", { cookie: copy });
    assert.equal(api.status, 401);
    const route = await moneyGet(
      new Request("http://127.0.0.1:3000/api/money", { headers: { cookie: copy } }),
    );
    assert.equal(route.status, 401);

    // Logging in again gives a cookie of the new generation, which works.
    const fresh = await login();
    assert.notEqual(fresh, pair);
    assert.equal((await gate("/dashboard", { cookie: fresh })).status, 200);
    assert.equal((await gate("/dashboard", { cookie: copy })).status, 401);
  });

  test("Basic credentials alone may revoke; an unauthenticated logout only clears the cookie", async () => {
    const pair = await login();

    const anonymous = await logout({});
    assert.equal(anonymous.status, 303);
    assert.match(anonymous.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);

    const forged = await logout({ cookie: `${pair}x` });
    assert.equal(forged.status, 303);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);

    const cross = await logoutPost(
      new Request("http://127.0.0.1:3000/api/auth/logout", {
        method: "POST",
        headers: { authorization: basic, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      }),
    );
    assert.equal(cross.status, 403);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);

    const withBasic = await logout({ authorization: basic });
    assert.equal(withBasic.status, 303);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
  });

  test("a restart does not bring a revoked cookie back", async () => {
    const pair = await login();
    assert.equal((await logout({ cookie: pair })).status, 303);
    restart();
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
  });

  test("when storage cannot be written, logout says so and still clears this browser", async () => {
    const pair = await login();
    unwritableDataDir();
    const logged = await capture(async () => {
      const res = await logout({ cookie: pair });
      assert.equal(res.status, 503);
      assert.ok(res.headers.get("retry-after"));
      assert.match(res.headers.get("set-cookie") ?? "", /Max-Age=0/);
      assert.match(await res.text(), /could not be revoked/);
    });
    const line = logged.find((row) => row.event === "logout");
    assert.equal(line?.revoked, false);
    assert.equal(line?.reason, "unavailable");
    assert.equal(line?.level, "warn");
  });

  test("with Upstash, a logout is seen by a freshly started instance", async () => {
    fakeUpstash();
    const pair = await login();
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);
    assert.equal((await logout({ cookie: pair })).status, 303);
    restart();
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
    const fresh = await login();
    restart();
    assert.equal((await gate("/dashboard", { cookie: fresh })).status, 200);
  });
});

describe("session generation cache", () => {
  test("a change made by another instance is picked up after the cache window", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const pair = await login();
    // Another instance logs out: the stored generation changes underneath us.
    writeFileSync(
      path.join(dataDir, GEN_FILE),
      JSON.stringify({ gen: "x".repeat(22), rotatedAt: new Date().toISOString() }),
    );
    clearDurableCache();
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);
    mock.timers.tick(SESSION_GENERATION_FRESH_MS - 1_000);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);
    mock.timers.tick(2_000);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
  });

  test("during an outage the last known generation is used for a while, then Basic is required", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const upstash = fakeUpstash();
    const pair = await login();
    upstash.down = true;
    mock.timers.tick(SESSION_GENERATION_FRESH_MS + 1);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);
    assert.equal(
      (
        await moneyGet(
          new Request("http://127.0.0.1:3000/api/money", { headers: { cookie: pair } }),
        )
      ).status,
      200,
    );

    mock.timers.tick(SESSION_GENERATION_STALE_LIMIT_MS);
    const expired = await gate("/dashboard", { cookie: pair });
    assert.equal(expired.status, 401);
    assert.match(expired.headers.get("www-authenticate") ?? "", /Basic/);
    // Basic still works, but no cookie can be issued without a known generation.
    const viaBasic = await gate("/dashboard", { authorization: basic });
    assert.equal(viaBasic.status, 200);
    assert.equal(viaBasic.headers.get("set-cookie"), null);

    upstash.down = false;
    mock.timers.tick(6_000);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);
  });

  test("after a restart during an outage no cookie is accepted and none is issued", async () => {
    const upstash = fakeUpstash();
    const pair = await login();
    upstash.down = true;
    restart();
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
    const viaBasic = await gate("/dashboard", { authorization: basic });
    assert.equal(viaBasic.status, 200);
    assert.equal(viaBasic.headers.get("set-cookie"), null);
  });

  test("with TOTP on and the generation unknown, a right code gets 503, not a cookie", async () => {
    env.VANOS_TOTP_SECRET = RFC_SECRET;
    const upstash = fakeUpstash();
    upstash.down = true;
    restart();
    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    const logged = await capture(async () => {
      const res = await gate("/dashboard", {
        authorization: basic,
        "x-vanos-totp": totpAt(secret, Date.now(), 6),
        "x-forwarded-for": "203.0.113.50",
      });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("set-cookie"), null);
      assert.equal(await res.text(), "MFA is unavailable");
    });
    assert.equal(
      logged.some((row) => row.event === "mfa_fail" && row.reason === "unavailable"),
      true,
    );
  });

  test("an unreadable generation document is an outage, not a reset", async () => {
    const pair = await login();
    writeFileSync(path.join(dataDir, GEN_FILE), "{not json");
    restart();
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
    const viaBasic = await gate("/dashboard", { authorization: basic });
    assert.equal(viaBasic.headers.get("set-cookie"), null);
    // An authenticated logout writes a fresh generation and repairs it.
    assert.equal((await logout({ authorization: basic })).status, 303);
    const fresh = await login();
    assert.equal((await gate("/dashboard", { cookie: fresh })).status, 200);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
  });

  test("a wiped store signs everyone out; the next login starts a new generation", async () => {
    const pair = await login();
    rmSync(path.join(dataDir, GEN_FILE));
    restart();
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
    const fresh = await login();
    assert.equal((await gate("/dashboard", { cookie: fresh })).status, 200);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 401);
  });
});

describe("TOTP state survives a restart", () => {
  const ipReq = (ip: string) => ({
    method: "POST",
    url: "http://127.0.0.1:3000/dashboard",
    headers: { get: (name: string) => (name === "x-forwarded-for" ? ip : null) },
  });

  beforeEach(() => {
    env.VANOS_TOTP_SECRET = RFC_SECRET;
  });

  test("a used code is rejected after a restart (local store)", async () => {
    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    const code = totpAt(secret, Date.now(), 6);
    const first = await submitTotp(ipReq("203.0.113.60"), code);
    assert.equal(first.ok, true);

    restart();
    const replay = await submitTotp(ipReq("203.0.113.61"), code);
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "replay");

    const viaProxy = await gate("/dashboard", {
      authorization: basic,
      "x-vanos-totp": code,
      "x-forwarded-for": "203.0.113.62",
    });
    assert.equal(viaProxy.status, 401);
    assert.equal(viaProxy.headers.get("x-vanos-mfa"), "failed");

    // The store names codes by an HMAC, never in the clear.
    const stored = readFileSync(path.join(dataDir, "totp-replay.json"), "utf8");
    assert.equal(stored.includes(code), false);
  });

  test("a used code is rejected after a restart (Upstash)", async () => {
    fakeUpstash();
    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    const code = totpAt(secret, Date.now(), 6);
    assert.equal((await checkMfaCode(code)).reason, "totp");
    restart();
    assert.equal((await checkMfaCode(code)).reason, "replay");
  });

  test("the attempt limit survives a restart (local store and Upstash)", async () => {
    env.VANOS_TOTP_MAX_ATTEMPTS = "2";
    for (const backend of ["local", "upstash"] as const) {
      if (backend === "upstash") fakeUpstash();
      restart();
      const ip = backend === "local" ? "203.0.113.70" : "203.0.113.71";
      const headers = { authorization: basic, "x-vanos-totp": "111111", "x-forwarded-for": ip };
      assert.equal((await gate("/dashboard", headers)).status, 401, backend);
      assert.equal((await gate("/dashboard", headers)).status, 401, backend);
      restart();
      const limited = await gate("/dashboard", headers);
      assert.equal(limited.status, 429, backend);
      assert.ok(limited.headers.get("retry-after"), backend);
      // Another client is unaffected.
      const other = await gate("/dashboard", { ...headers, "x-forwarded-for": "203.0.113.99" });
      assert.equal(other.status, 401, backend);
    }
  });

  test("when storage fails, a code is still single-use within the process", async () => {
    unwritableDataDir();
    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    const code = totpAt(secret, Date.now(), 6);
    const errors = mock.method(console, "error", () => undefined);
    try {
      assert.equal((await checkMfaCode(code)).reason, "totp");
      assert.equal((await checkMfaCode(code)).reason, "replay");
      assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes("totp-replay")));
      assert.equal(
        errors.mock.calls.some((call) => String(call.arguments[0]).includes(code)),
        false,
      );
    } finally {
      errors.mock.restore();
    }
    // The attempt limit falls back to the process counter instead of opening.
    env.VANOS_TOTP_MAX_ATTEMPTS = "1";
    const headers = { authorization: basic, "x-vanos-totp": "111111", "x-forwarded-for": "203.0.113.80" };
    assert.equal((await gate("/dashboard", headers)).status, 401);
    assert.equal((await gate("/dashboard", headers)).status, 429);
  });
});

describe("Basic credential compare", () => {
  const creds = { user: "jojo", pass: PASSWORD };
  const header = (user: string, pass: string) => ({
    headers: new Headers({ authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") }),
  });

  test("user name and password must both match, whatever their lengths", () => {
    assert.equal(credentialsMatch({ user: "jojo", pass: PASSWORD }, creds), true);
    assert.equal(credentialsMatch({ user: "joj0", pass: PASSWORD }, creds), false);
    assert.equal(credentialsMatch({ user: "jojo", pass: "q".repeat(32) }, creds), false);
    assert.equal(credentialsMatch({ user: "admin", pass: "x" }, creds), false);
    assert.equal(credentialsMatch({ user: "", pass: "" }, creds), false);
    assert.equal(credentialsMatch({ user: "j", pass: PASSWORD }, creds), false);
    assert.equal(credentialsMatch({ user: "jojo".repeat(100), pass: PASSWORD }, creds), false);
    assert.equal(credentialsMatch({ user: "jojo", pass: `${PASSWORD}x` }, creds), false);
    assert.equal(credentialsMatch({ user: "jojo", pass: PASSWORD.slice(1) }, creds), false);
  });

  test("the Basic header is parsed the same way and malformed input fails closed", () => {
    assert.equal(basicCredentialsMatch(header("jojo", PASSWORD), creds), true);
    assert.equal(basicCredentialsMatch(header("wrong", PASSWORD), creds), false);
    assert.equal(basicCredentialsMatch(header("jojo", "wrong"), creds), false);
    assert.equal(basicCredentialsMatch(header("", ""), creds), false);
    // A colon in the password stays part of the password.
    assert.equal(
      basicCredentialsMatch(header("jojo", `${PASSWORD}:extra`), creds),
      false,
    );
    assert.equal(
      basicCredentialsMatch(header("jojo", "a:b"), { user: "jojo", pass: "a:b" }),
      true,
    );
    const noColon = { headers: new Headers({ authorization: "Basic " + Buffer.from("jojo").toString("base64") }) };
    assert.equal(basicCredentialsMatch(noColon, creds), false);
    const garbage = { headers: new Headers({ authorization: "Basic %%%not-base64%%%" }) };
    assert.equal(basicCredentialsMatch(garbage, creds), false);
    const bearer = { headers: new Headers({ authorization: `Bearer ${PASSWORD}` }) };
    assert.equal(basicCredentialsMatch(bearer, creds), false);
  });

  test("the proxy challenges a wrong user name with the right password", async () => {
    const res = await gate("/dashboard", {
      authorization: "Basic " + Buffer.from(`admin:${PASSWORD}`).toString("base64"),
      "x-forwarded-for": "203.0.113.90",
    });
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /Basic/);
    assert.equal(res.headers.get("set-cookie"), null);
  });
});

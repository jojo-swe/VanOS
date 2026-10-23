import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { POST as mfaPost } from "@/app/api/auth/mfa/route";
import { GET as logoutGet, POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as moneyGet } from "@/app/api/money/route";
import { GET as snapshotGet } from "@/app/api/v1/snapshot/route";
import { proxy } from "@/proxy";
import { clearDurableCache } from "@/lib/durable/store";
import { getSessionTtlSeconds } from "@/lib/security/config";
import { clearRateLimits } from "@/lib/security/rate-limit";
import { clearSessionGenerationCache } from "@/lib/security/session-generation";
import { appVersion, reportStartup } from "@/lib/security/startup-log";
import {
  buildTotpSetup,
  checkMfaCode,
  clearTotpState,
  decodeBase32,
  hashRecoveryCode,
  hotp,
  issueSessionToken,
  mfaSubmissionAllowed,
  safeNextPath,
  sessionIsValid,
  submitTotp,
  totpAt,
  totpCounter,
} from "@/lib/security/totp";

/** RFC 6238 appendix B secret, ASCII "12345678901234567890", base32. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SESSION = "s".repeat(32);
const PASSWORD = "p".repeat(32);
const AGENT = "a".repeat(32);

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
  "AGENT_API_TOKEN_PREVIOUS",
  "BOTS_INGEST_SECRET",
  "BOTS_INGEST_SECRET_PREVIOUS",
  "VANOS_ALLOW_INGEST_AS_AGENT",
  "VANOS_TOTP_SECRET",
  "VANOS_SESSION_SECRET",
  "VANOS_SESSION_TTL_SECONDS",
  "VANOS_SESSION_TTL_DAYS",
  "VANOS_TOTP_MAX_ATTEMPTS",
  "VANOS_TOTP_ATTEMPT_WINDOW_SEC",
  "VANOS_TOTP_ISSUER",
  "VANOS_TOTP_ACCOUNT",
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

const basic = "Basic " + Buffer.from(`jojo:${PASSWORD}`).toString("base64");
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function gate(pathname: string, headers?: Record<string, string>, method = "GET") {
  return proxy(
    new NextRequest(new URL(pathname, "http://127.0.0.1:3000"), { method, headers }),
  );
}

async function capture(fn: () => void | Promise<void>): Promise<Array<Record<string, unknown>>> {
  const lines: string[] = [];
  const write = process.stdout.write;
  // The app logs strings. The test runner's own reporter writes bytes, and
  // can do so whenever a test awaits real I/O, so let those through.
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
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

let dataDir = "";

/**
 * Let a test submit the same code again: forget it in this process and in
 * the durable store. A restart alone (clearTotpState) is not enough any more.
 */
function forgetUsedCodes(): void {
  clearTotpState();
  rmSync(path.join(dataDir, "totp-replay.json"), { force: true });
  clearDurableCache();
}

beforeEach(() => {
  // Each test gets its own durable store (session generation, TOTP replay
  // records, attempt counters) and starts with nothing cached, as a fresh
  // process would.
  dataDir = mkdtempSync(path.join(tmpdir(), "vanos-totp-store-"));
  env.VANOS_DATA_DIR = dataDir;
  env.BOTS_DATA_DIR = dataDir;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  delete env.VANOS_STORE_PREFIX;
  clearDurableCache();
  clearSessionGenerationCache();
  clearTotpState();
  clearRateLimits();
  env.NODE_ENV = "production";
  env.VANOS_ACCESS_MODE = "private";
  env.VANOS_REQUIRE_NETWORK_GATE = "false";
  env.VANOS_TRUST_PROXY = "true";
  env.DASHBOARD_BASIC_USER = "jojo";
  env.DASHBOARD_BASIC_PASSWORD = PASSWORD;
  env.VANOS_TOTP_SECRET = RFC_SECRET;
  env.VANOS_SESSION_SECRET = SESSION;
  env.VANOS_TOTP_MAX_ATTEMPTS = "20";
  delete env.VANOS_SESSION_TTL_SECONDS;
  delete env.VANOS_SESSION_TTL_DAYS;
  delete env.VANOS_TOTP_ATTEMPT_WINDOW_SEC;
  delete env.VANOS_TOTP_RECOVERY_CODES;
  delete env.VANOS_TOTP_RECOVERY_FILE;
  delete env.VANOS_TOTP_RECOVERY_USED_FILE;
  delete env.VANOS_EDGE_DASHBOARD;
  delete env.VANOS_PUBLIC_INGEST;
  delete env.AGENT_API_TOKEN;
  delete env.BOTS_INGEST_SECRET;
  delete env.VANOS_ALLOW_INGEST_AS_AGENT;
});

afterEach(() => {
  clearTotpState();
  clearRateLimits();
  clearDurableCache();
  clearSessionGenerationCache();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("RFC 6238", () => {
  test("SHA1 vectors and a ±1 step window", async () => {
    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    assert.equal(secret.length, 20);
    const vectors: Array<[number, string]> = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, code] of vectors) {
      assert.equal(totpAt(secret, seconds * 1000, 8), code, String(seconds));
      assert.equal(hotp(secret, totpCounter(seconds * 1000), 8), code);
    }

    const now = 1111111111 * 1000;
    const current = totpAt(secret, now, 6);
    const previous = totpAt(secret, now - 30_000, 6);
    const next = totpAt(secret, now + 30_000, 6);
    const older = totpAt(secret, now - 60_000, 6);
    assert.notEqual(current, previous);
    assert.equal((await checkMfaCode(previous, now)).ok, true);
    assert.equal((await checkMfaCode(previous, now)).reason, "replay");
    assert.equal((await checkMfaCode(current, now)).reason, "totp");
    assert.equal((await checkMfaCode(next, now)).reason, "totp");
    const stale = await checkMfaCode(older, now);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "bad_code");
    assert.equal((await checkMfaCode(current, now)).reason, "replay");
  });
});

describe("session cookie", () => {
  const now = 1_700_000_000_000;

  test("signs a token, rejects tampering, expiry, and a rotated secret", async () => {
    env.VANOS_SESSION_TTL_DAYS = "1";
    const token = await issueSessionToken(now);
    assert.ok(token);
    assert.match(token, /^v3\./);
    assert.equal(sessionIsValid(token, now + 60_000), true);
    assert.equal(sessionIsValid(token, now + 24 * 60 * 60 * 1000 - 1000), true);
    assert.equal(sessionIsValid(token, now + 24 * 60 * 60 * 1000 + 1000), false);
    const [version, payload, sig] = token.split(".");
    assert.equal(sessionIsValid(`${version}.${payload}.${sig.slice(0, -1)}x`, now), false);
    const flipped = Buffer.from(payload, "base64url").toString("utf8").replace('"v":3', '"v":9');
    const badPayload = Buffer.from(flipped).toString("base64url");
    assert.equal(sessionIsValid(`${version}.${badPayload}.${sig}`, now), false);
    env.VANOS_SESSION_SECRET = "t".repeat(32);
    assert.equal(sessionIsValid(token, now), false);
  });

  test("defaults to 30 days and ignores VANOS_SESSION_TTL_SECONDS", async () => {
    env.VANOS_SESSION_TTL_SECONDS = "120";
    delete env.VANOS_SESSION_TTL_DAYS;
    assert.equal(getSessionTtlSeconds(), 30 * 24 * 60 * 60);
    const token = await issueSessionToken(now);
    assert.ok(token);
    assert.equal(sessionIsValid(token, now + 121_000), true);
    assert.equal(sessionIsValid(token, now + 30 * 24 * 60 * 60 * 1000 - 1000), true);
    assert.equal(sessionIsValid(token, now + 30 * 24 * 60 * 60 * 1000 + 1000), false);

    env.VANOS_SESSION_TTL_DAYS = "nope";
    assert.equal(getSessionTtlSeconds(), 30 * 24 * 60 * 60);
    env.VANOS_SESSION_TTL_DAYS = "400";
    assert.equal(getSessionTtlSeconds(), 365 * 24 * 60 * 60);
  });

  test("password or TOTP secret change invalidates the cookie", async () => {
    const token = await issueSessionToken(now);
    assert.equal(sessionIsValid(token, now), true);
    env.DASHBOARD_BASIC_PASSWORD = "q".repeat(32);
    assert.equal(sessionIsValid(token, now), false);
    env.DASHBOARD_BASIC_PASSWORD = PASSWORD;
    assert.equal(sessionIsValid(token, now), true);
    env.VANOS_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    assert.equal(sessionIsValid(token, now), false);
    delete env.VANOS_TOTP_SECRET;
    assert.equal(sessionIsValid(token, now), false);
  });
});

describe("recovery codes", () => {
  test("env and file hashes are one-time across a reload", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vanos-totp-"));
    try {
      const code = "ABCD-EFGH-IJKL";
      const other = "MNPQ-RSTU-VWXY";
      const hash = hashRecoveryCode(code);
      const file = path.join(dir, "hashes.txt");
      const used = path.join(dir, "hashes.txt.used");
      writeFileSync(file, `# comment\n\n${hashRecoveryCode(other)}\n`);
      env.VANOS_TOTP_RECOVERY_CODES = hash;
      env.VANOS_TOTP_RECOVERY_FILE = file;
      env.VANOS_TOTP_RECOVERY_USED_FILE = used;

      const req = {
        method: "POST",
        url: "http://127.0.0.1:3000/dashboard",
        headers: { get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.8" : null) },
      };
      const logged = (await capture(async () => {
        const first = await submitTotp(req, "abcd efgh ijkl");
        assert.equal(first.ok, true);
        if (first.ok) assert.equal(first.reason, "recovery");
        const again = await submitTotp(req, code);
        assert.equal(again.ok, false);
        if (!again.ok) assert.equal(again.reason, "recovery_used");
      }));
      assert.equal(logged.find((row) => row.event === "mfa_ok")?.reason, "recovery");
      assert.equal(logged.find((row) => row.event === "mfa_fail")?.reason, "recovery_used");
      assert.equal(JSON.stringify(logged).includes(code.replace(/-/g, "")), false);
      assert.equal(JSON.stringify(logged).includes(RFC_SECRET), false);
      assert.match(readFileSync(used, "utf8"), new RegExp(hash));

      clearTotpState();
      const afterRestart = await checkMfaCode(code);
      assert.equal(afterRestart.ok, false);
      assert.equal(afterRestart.reason, "recovery_used");

      const fromFile = await checkMfaCode(other);
      assert.equal(fromFile.reason, "recovery");
      const missing = await checkMfaCode("ZZZZ-ZZZZ-ZZZZ");
      assert.equal(missing.reason, "bad_code");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("proxy gate", () => {
  test("unset TOTP leaves basic auth unchanged when no session secret is set", async () => {
    delete env.VANOS_TOTP_SECRET;
    delete env.VANOS_SESSION_SECRET;
    const res = (await gate("/dashboard", { authorization: basic }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-vanos-mfa"), null);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal((await gate("/dashboard")).status, 401);
  });

  test("basic auth without TOTP issues a cookie that skips the next prompt", async () => {
    delete env.VANOS_TOTP_SECRET;
    const first = (await gate("/dashboard", { authorization: basic }));
    assert.equal(first.status, 200);
    const setCookie = first.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /vanos_session=v3\./);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Max-Age=2592000/);
    const pair = setCookie.split(";")[0] ?? "";

    const again = (await gate("/dashboard", { cookie: pair }));
    assert.equal(again.status, 200);
    assert.equal(again.headers.get("www-authenticate"), null);
    assert.equal(again.headers.get("set-cookie"), null);

    const api = (await gate("/api/dashboard", { cookie: pair }));
    assert.equal(api.status, 200);
    const money = await moneyGet(
      new Request("http://127.0.0.1:3000/api/money", { headers: { cookie: pair } }),
    );
    assert.equal(money.status, 200);

    env.AGENT_API_TOKEN = AGENT;
    const snapshot = await snapshotGet(
      new Request("http://127.0.0.1:3000/api/v1/snapshot", { headers: { cookie: pair } }),
    );
    assert.equal(snapshot.status, 401);
    const ingest = (await gate(
      "/api/bots/ingest",
      { cookie: pair, "x-forwarded-for": "203.0.113.70" },
      "POST",
    ));
    assert.equal(ingest.headers.get("set-cookie"), null);

    env.DASHBOARD_BASIC_PASSWORD = "q".repeat(32);
    const stale = (await gate("/dashboard", { cookie: pair }));
    assert.equal(stale.status, 401);
    assert.match(stale.headers.get("www-authenticate") ?? "", /Basic/);
  });

  test("basic auth then TOTP, and a bad password still challenges basic", async () => {
    const wrong = (await gate("/dashboard", {
      authorization: "Basic " + Buffer.from("jojo:nope").toString("base64"),
      "x-forwarded-for": "203.0.113.21",
    }));
    assert.equal(wrong.status, 401);
    assert.match(wrong.headers.get("www-authenticate") ?? "", /Basic/);
    assert.equal(wrong.headers.get("x-vanos-mfa"), null);

    const challenge = (await gate("/dashboard", {
      authorization: basic,
      "x-forwarded-for": "203.0.113.22",
    }));
    assert.equal(challenge.status, 401);
    assert.equal(challenge.headers.get("www-authenticate"), null);
    assert.equal(challenge.headers.get("x-vanos-mfa"), "required");
    const html = await challenge.text();
    assert.match(html, /Verification code/);
    assert.equal(html.includes(RFC_SECRET), false);
    assert.equal(html.includes(PASSWORD), false);

    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    const code = totpAt(secret, Date.now(), 6);
    const logged = (await capture(async () => {
      const bad = (await gate("/dashboard", {
        authorization: basic,
        "x-vanos-totp": "000000",
        "x-forwarded-for": "203.0.113.23",
      }));
      assert.equal(bad.status, 401);
      assert.equal(bad.headers.get("x-vanos-mfa"), "failed");
    }));
    const fail = logged.find((row) => row.event === "mfa_fail");
    assert.equal(fail?.reason, "bad_code");
    assert.equal(fail?.level, "warn");
    assert.equal(fail?.path, "/dashboard");
    assert.equal(JSON.stringify(logged).includes("000000"), false);
    assert.deepEqual(Object.keys(fail ?? {}).sort(), ["event", "ip", "level", "path", "reason", "ts"]);

    const opened = (await capture(async () => {
      const ok = (await gate("/dashboard", {
        authorization: basic,
        "x-vanos-totp": code,
        "x-forwarded-for": "203.0.113.24",
      }));
      assert.equal(ok.status, 200);
      const setCookie = ok.headers.get("set-cookie") ?? "";
      assert.match(setCookie, /vanos_session=v3\./);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /Secure/);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.match(setCookie, /Path=\//);
      assert.match(setCookie, new RegExp(`Max-Age=${getSessionTtlSeconds()}`));
      const pair = setCookie.split(";")[0] ?? "";
      const again = (await gate("/dashboard", { cookie: pair }));
      assert.equal(again.status, 200);
      assert.equal(again.headers.get("www-authenticate"), null);
      assert.equal(again.headers.get("x-vanos-mfa"), null);
      assert.equal(again.headers.get("set-cookie"), null);
      const withBasic = (await gate("/dashboard", { authorization: basic, cookie: pair }));
      assert.equal(withBasic.status, 200);
      const replay = (await gate("/dashboard", {
        authorization: basic,
        "x-vanos-totp": code,
        "x-forwarded-for": "203.0.113.25",
      }));
      assert.equal(replay.status, 401);
      assert.equal(replay.headers.get("x-vanos-mfa"), "failed");
    }));
    const ok = opened.find((row) => row.event === "mfa_ok");
    assert.equal(ok?.reason, "totp");
    assert.equal(ok?.level, "info");
    assert.equal(JSON.stringify(opened).includes(code), false);
    assert.equal(JSON.stringify(opened).includes(SESSION), false);
    assert.equal(opened.some((row) => row.event === "mfa_fail" && row.reason === "replay"), true);
  });

  test("rate limit, agent bearer, and ingest stay in their lanes", async () => {
    env.VANOS_TOTP_MAX_ATTEMPTS = "2";
    env.VANOS_TOTP_ATTEMPT_WINDOW_SEC = "300";
    const headers = {
      authorization: basic,
      "x-vanos-totp": "111111",
      "x-forwarded-for": "203.0.113.40",
    };
    assert.equal((await gate("/dashboard", headers)).status, 401);
    assert.equal((await gate("/dashboard", headers)).status, 401);
    const limited = (await gate("/dashboard", headers));
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
    const body = await limited.text();
    assert.equal(body, "Too many attempts");

    env.AGENT_API_TOKEN = AGENT;
    const agentOnly = (await gate("/dashboard", {
      "x-vanos-agent-token": AGENT,
      "x-forwarded-for": "203.0.113.39",
    }));
    assert.equal(agentOnly.status, 401);
    assert.match(agentOnly.headers.get("www-authenticate") ?? "", /Basic/);

    const agent = (await gate("/api/bots/dispatch", {
      authorization: basic,
      "x-vanos-agent-token": AGENT,
      "x-forwarded-for": "203.0.113.41",
    }));
    assert.equal(agent.status, 200);
    assert.equal(agent.headers.get("x-vanos-mfa"), null);
    assert.equal(agent.headers.get("set-cookie"), null);

    env.VANOS_ACCESS_MODE = "edge";
    delete env.VANOS_EDGE_DASHBOARD;
    delete env.VANOS_SESSION_SECRET;
    const ingest = (await gate("/api/bots/ingest", { "x-forwarded-for": "203.0.113.42" }, "POST"));
    assert.equal(ingest.status, 200);
    assert.equal(ingest.headers.get("x-vanos-mfa"), null);

    env.VANOS_ACCESS_MODE = "private";
    env.VANOS_PUBLIC_INGEST = "true";
    env.BOTS_INGEST_SECRET = "c".repeat(32);
    const privateIngest = (await gate(
      "/api/bots/ingest",
      { authorization: `Bearer ${"c".repeat(32)}`, "x-forwarded-for": "203.0.113.43" },
      "POST",
    ));
    assert.equal(privateIngest.status, 200);
    assert.equal(privateIngest.headers.get("x-vanos-mfa"), null);
  });
});

describe("logout", () => {
  test("clears the cookie and the next dashboard request challenges again", async () => {
    delete env.VANOS_TOTP_SECRET;
    const opened = (await gate("/dashboard", { authorization: basic }));
    const pair = (opened.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    assert.match(pair, /^vanos_session=v3\./);
    assert.equal((await gate("/dashboard", { cookie: pair })).status, 200);

    const cross = await logoutPost(
      new Request("http://127.0.0.1:3000/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: pair,
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    );
    assert.equal(cross.status, 403);
    assert.equal(cross.headers.get("set-cookie"), null);

    const res = await logoutPost(
      new Request("http://127.0.0.1:3000/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: pair,
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin",
        },
      }),
    );
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/");
    const cleared = res.headers.get("set-cookie") ?? "";
    assert.match(cleared, /vanos_session=/);
    assert.match(cleared, /Max-Age=0/);
    assert.match(cleared, /HttpOnly/i);
    assert.match(cleared, /Secure/);
    assert.match(cleared, /SameSite=Lax/i);

    const after = (await gate("/dashboard"));
    assert.equal(after.status, 401);
    assert.match(after.headers.get("www-authenticate") ?? "", /Basic/);

    const viaGet = await logoutGet(
      new Request("http://127.0.0.1:3000/api/auth/logout", {
        headers: { "sec-fetch-site": "none" },
      }),
    );
    assert.equal(viaGet.status, 303);
    assert.match(viaGet.headers.get("set-cookie") ?? "", /Max-Age=0/);

    const proxyPass = (await gate("/api/auth/logout"));
    assert.equal(proxyPass.status, 200);
    assert.equal(proxyPass.headers.get("www-authenticate"), null);
  });
});

describe("mfa submission origin", () => {
  const url = "http://127.0.0.1:3000/api/auth/mfa";

  function allowed(headers: Record<string, string>): boolean {
    return mfaSubmissionAllowed(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      }),
    );
  }

  test("allows Origin null when Sec-Fetch-Site is same-origin", async () => {
    assert.equal(allowed({ origin: "null", "sec-fetch-site": "same-origin" }), true);
  });

  test("rejects Origin null when Sec-Fetch-Site is cross-site", async () => {
    assert.equal(allowed({ origin: "null", "sec-fetch-site": "cross-site" }), false);
  });

  test("rejects Origin null without Sec-Fetch-Site", async () => {
    assert.equal(allowed({ origin: "null" }), false);
  });

  test("rejects a mismatched origin", async () => {
    assert.equal(allowed({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }), false);
  });

  test("allows a matching origin", async () => {
    assert.equal(allowed({ origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }), true);
  });
});

describe("safeNextPath", () => {
  test("keeps a same-origin path and rejects open redirects", async () => {
    assert.equal(safeNextPath("/dashboard"), "/dashboard");
    assert.equal(safeNextPath("/support"), "/support");
    assert.equal(safeNextPath("/dashboard?tab=agents#income"), "/dashboard");
    assert.equal(safeNextPath(undefined), "/dashboard");
    assert.equal(safeNextPath(""), "/dashboard");
    assert.equal(safeNextPath(null), "/dashboard");

    const rejected = [
      "//evil.example",
      "//evil.example/dashboard",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "https://evil.example",
      "https://evil.example/phish",
      "http://127.0.0.1:3000/dashboard",
      "https://0.0.0.0:3000/dashboard",
      "javascript:alert(1)",
      "javascript:alert(1)//",
      "/javascript:alert(1)",
      "https:evil.example",
      " /dashboard",
      "/api/auth/mfa",
      "/api/auth/logout",
      "dashboard",
      "/dash board",
    ];
    for (const input of rejected) {
      const path = safeNextPath(input);
      assert.equal(path, "/dashboard", input);
      assert.equal(path.startsWith("/"), true, input);
      assert.equal(path.startsWith("//"), false, input);
      assert.equal(path.includes(":"), false, input);
    }
  });
});

describe("mfa route", () => {
  test("form post sets the cookie and a cross-origin post does not burn the code", async () => {
    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    const code = totpAt(secret, Date.now(), 6);
    const blocked = await mfaPost(
      new Request("http://127.0.0.1:3000/api/auth/mfa", {
        method: "POST",
        headers: {
          authorization: basic,
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example",
        },
        body: new URLSearchParams({ code, next: "https://evil.example" }),
      }),
    );
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("set-cookie"), null);

    const res = await mfaPost(
      new Request("http://127.0.0.1:3000/api/auth/mfa", {
        method: "POST",
        headers: {
          authorization: basic,
          "content-type": "application/x-www-form-urlencoded",
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({ code, next: "/support" }),
      }),
    );
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/support");
    assert.equal(res.headers.get("location")?.includes("://"), false);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/i);
    const pair = setCookie.split(";")[0] ?? "";
    assert.equal((await gate("/support", { authorization: basic, cookie: pair })).status, 200);

    delete env.VANOS_TOTP_SECRET;
    const hidden = await mfaPost(
      new Request("http://127.0.0.1:3000/api/auth/mfa", {
        method: "POST",
        headers: { authorization: basic, "content-type": "application/json" },
        body: JSON.stringify({ code: "000000" }),
      }),
    );
    assert.equal(hidden.status, 404);
  });

  test("Location stays relative when the request URL is the proxy bind address", async () => {
    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    const code = totpAt(secret, Date.now(), 6);
    const headers = {
      authorization: basic,
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://0.0.0.0:3000",
      "sec-fetch-site": "same-origin",
    };

    const home = await mfaPost(
      new Request("https://0.0.0.0:3000/api/auth/mfa", {
        method: "POST",
        headers,
        body: new URLSearchParams({ code, next: "/dashboard" }),
      }),
    );
    assert.equal(home.status, 303);
    assert.equal(home.headers.get("location"), "/dashboard");
    assert.equal(home.headers.get("location")?.includes("0.0.0.0"), false);

    const openRedirects = [
      "//evil.example",
      "https://evil.example/phish",
      "javascript:alert(1)",
      "https://0.0.0.0:3000/dashboard",
      "/\\evil.example",
    ];
    for (const next of openRedirects) {
      forgetUsedCodes();
      const res = await mfaPost(
        new Request("https://0.0.0.0:3000/api/auth/mfa", {
          method: "POST",
          headers,
          body: new URLSearchParams({ code, next }),
        }),
      );
      assert.equal(res.status, 303, next);
      assert.equal(res.headers.get("location"), "/dashboard", next);
      const location = res.headers.get("location") ?? "";
      assert.equal(location.startsWith("/"), true, next);
      assert.equal(location.startsWith("//"), false, next);
      assert.equal(location.includes(":"), false, next);
      assert.equal(location.includes("evil.example"), false, next);
      assert.equal(location.includes("0.0.0.0"), false, next);
    }

    forgetUsedCodes();
    const omitted = await mfaPost(
      new Request("https://0.0.0.0:3000/api/auth/mfa", {
        method: "POST",
        headers: {
          authorization: basic,
          "content-type": "application/json",
          origin: "https://0.0.0.0:3000",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ code }),
      }),
    );
    assert.equal(omitted.status, 303);
    assert.equal(omitted.headers.get("location"), "/dashboard");
  });

  test("Origin null stays a relative redirect only when the site is same-origin", async () => {
    const secret = decodeBase32(RFC_SECRET);
    assert.ok(secret);
    const code = totpAt(secret, Date.now(), 6);
    const res = await mfaPost(
      new Request("https://0.0.0.0:3000/api/auth/mfa", {
        method: "POST",
        headers: {
          authorization: basic,
          "content-type": "application/x-www-form-urlencoded",
          origin: "null",
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({ code, next: "/support" }),
      }),
    );
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/support");
    assert.equal(res.headers.get("location")?.includes("0.0.0.0"), false);

    forgetUsedCodes();
    const rejected = await mfaPost(
      new Request("https://0.0.0.0:3000/api/auth/mfa", {
        method: "POST",
        headers: {
          authorization: basic,
          "content-type": "application/x-www-form-urlencoded",
          origin: "null",
        },
        body: new URLSearchParams({ code, next: "/support" }),
      }),
    );
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("location"), null);
    assert.equal(rejected.headers.get("set-cookie"), null);
  });
});

describe("startup", () => {
  test("refuses to boot when TOTP is on without a long session secret", async () => {
    delete env.AGENT_API_TOKEN;
    delete env.AGENT_API_TOKEN_PREVIOUS;
    delete env.BOTS_INGEST_SECRET;
    delete env.BOTS_INGEST_SECRET_PREVIOUS;
    delete env.VANOS_TOTP_SECRET;
    delete env.VANOS_SESSION_SECRET;
    const quiet = (await capture(async () => {
      reportStartup(() => {
        throw new Error("should not exit");
      });
    }));
    assert.equal(quiet[0]?.config_ok, true);
    assert.equal(quiet[0]?.version, appVersion());

    env.VANOS_TOTP_SECRET = RFC_SECRET;
    delete env.VANOS_SESSION_SECRET;
    const missing = (await capture(async () => {
      assert.throws(
        () =>
          reportStartup(() => {
            throw new Error("exit-now");
          }),
        /exit-now/,
      );
    }));
    assert.equal(missing[0]?.reason, "short_key");
    assert.equal(missing[0]?.config_ok, false);
    assert.equal(missing[0]?.level, "error");
    assert.equal(JSON.stringify(missing).includes(RFC_SECRET), false);

    env.VANOS_SESSION_SECRET = SESSION;
    env.VANOS_TOTP_SECRET = "not base32!!!";
    const bad = (await capture(async () => {
      assert.throws(
        () =>
          reportStartup(() => {
            throw new Error("exit-now");
          }),
        /exit-now/,
      );
    }));
    assert.equal(bad[0]?.reason, "mfa_config");
    assert.equal(JSON.stringify(bad).includes("not base32"), false);

    env.VANOS_TOTP_SECRET = RFC_SECRET;
    const ready = (await capture(async () => {
      reportStartup(() => {
        throw new Error("should not exit");
      });
    }));
    assert.equal(ready[0]?.config_ok, true);
    assert.equal("reason" in (ready[0] ?? {}), false);
  });
});

describe("totp:setup", () => {
  test("prints a new secret, uri, and QR without reading or writing secrets", async () => {
    env.VANOS_TOTP_SECRET = "CANARYBASE32SECRETVALUE";
    env.VANOS_TOTP_ACCOUNT = "sample";
    const setup = buildTotpSetup();
    assert.equal(setup.secret.includes("CANARY"), false);
    assert.match(setup.uri, /^otpauth:\/\/totp\/VanOS:sample\?/);
    assert.match(setup.uri, /algorithm=SHA1/);
    assert.match(setup.uri, /digits=6/);
    assert.match(setup.uri, /period=30/);
    assert.match(setup.uri, new RegExp(`secret=${setup.secret}`));
    assert.equal(setup.recoveryCodes.length, 8);
    assert.equal(setup.recoveryHashes[0], hashRecoveryCode(setup.recoveryCodes[0]!));
    assert.ok(decodeBase32(setup.secret));

    const dir = mkdtempSync(path.join(tmpdir(), "vanos-totp-cli-"));
    const script = path.join(appRoot, "scripts", "totp-setup.ts");
    const tsx = path.join(appRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(process.execPath, [tsx, script, "--account", "sample"], {
      cwd: appRoot,
      env: {
        ...process.env,
        VANOS_TOTP_SECRET: "CANARYBASE32SECRETVALUE",
        VANOS_TOTP_RECOVERY_USED_FILE: path.join(dir, "unused"),
      },
      encoding: "utf8",
    });
    try {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /otpauth:\/\/totp\//);
      assert.match(result.stdout, /VANOS_TOTP_SECRET=[A-Z2-7]{20,}/);
      assert.match(result.stdout, /VANOS_TOTP_RECOVERY_CODES=[0-9a-f,]{64,}/);
      assert.match(result.stdout, /[▀▄█]/);
      assert.equal(result.stdout.includes("CANARYBASE32SECRETVALUE"), false);
      assert.equal(result.stdout.includes(SESSION), false);
      assert.equal(readdirSync(dir).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { NextRequest } from "next/server";
import { authorizeAgent } from "../src/lib/agent-api/auth";
import { authorizeIngest } from "../src/lib/bots/auth";
import { parseCostIngest } from "../src/lib/costs/parse-ingest";
import { authorizeDashboardOrAgent } from "../src/lib/security/dashboard-auth";
import { resolveNetworkIdentity } from "../src/lib/security/identity";
import { classifyPath, edgeSurface } from "../src/lib/security/paths";
import { isPrivilegedRequest } from "../src/lib/security/request-auth";
import { proxy } from "../src/proxy";

let failed = 0;

function assert(label: string, cond: boolean) {
  if (cond) {
    console.log("OK ", label);
  } else {
    console.error("FAIL", label);
    failed += 1;
  }
}

async function check(
  label: string,
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
  expectStatus?: number,
) {
  const req = new NextRequest(new URL(path, "http://127.0.0.1:3000"), init);
  const res = await proxy(req);
  console.log(label, res.status);
  if (expectStatus != null) {
    assert(`${label} => ${expectStatus}`, res.status === expectStatus);
  }
}

function req(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/test", { headers });
}

async function main() {
  // ── Middleware (private) ─────────────────────────────────────────
  process.env.VANOS_ACCESS_MODE = "private";
  process.env.VANOS_EDGE_SECRET = "edge-test-secret";
  process.env.VANOS_ALLOWED_TAILSCALE_USERS = "jojo@github";
  process.env.DASHBOARD_BASIC_USER = "jojo";
  process.env.DASHBOARD_BASIC_PASSWORD = "testpass123";
  process.env.VANOS_PUBLIC_INGEST = "true";
  process.env.NODE_ENV = "production";
  process.env.AGENT_API_TOKEN = "agent-token-test";
  process.env.BOTS_INGEST_SECRET = "ingest-secret-test";
  delete process.env.VANOS_ALLOW_INGEST_AS_AGENT;

  const basic = "Basic " + Buffer.from("jojo:testpass123").toString("base64");

  await check("UI no gate", "/dashboard", undefined, 403);
  await check("support no gate", "/support", undefined, 403);
  await check("root no gate", "/", undefined, 403);
  await check("UI edge only", "/dashboard", {
    headers: { "X-VanOS-Edge": "edge-test-secret" },
  }, 401);
  await check("UI edge+basic", "/dashboard", {
    headers: { "X-VanOS-Edge": "edge-test-secret", Authorization: basic },
  }, 200);
  process.env.VANOS_TRUST_PROXY = "true";
  await check("UI bad ts user", "/dashboard", {
    headers: { "Tailscale-User-Login": "other@github", Authorization: basic },
  }, 403);
  await check("UI good ts+basic", "/dashboard", {
    headers: { "Tailscale-User-Login": "jojo@github", Authorization: basic },
  }, 200);
  await check("ingest open", "/api/v1/sync", { method: "POST" }, 200);
  await check("health", "/api/v1/health", undefined, 200);
  assert(
    "classify /api/mcp = public_bearer",
    classifyPath("/api/mcp") === "public_bearer",
  );
  await check("mcp edge reaches route auth", "/api/mcp", { method: "POST" }, 200);

  // Dispatch is private_ui — middleware must gate without auth
  assert(
    "classify /api/bots/dispatch = private_ui",
    classifyPath("/api/bots/dispatch") === "private_ui",
  );
  await check("dispatch no auth", "/api/bots/dispatch", { method: "POST" }, 403);
  // Money actions are dashboard writes: private_ui, never public or edge.
  assert(
    "classify /api/money/action = private_ui",
    classifyPath("/api/money/action") === "private_ui",
  );
  assert(
    "edge closes /api/money/action",
    edgeSurface("/api/money/action", true) === "closed",
  );
  await check("money action no auth", "/api/money/action", { method: "POST" }, 403);
  await check("dispatch with basic+ts", "/api/bots/dispatch", {
    method: "POST",
    headers: {
      "Tailscale-User-Login": "jojo@github",
      Authorization: basic,
    },
  }, 200);

  process.env.VANOS_ACCESS_MODE = "hybrid";
  delete process.env.DASHBOARD_BASIC_USER;
  delete process.env.DASHBOARD_BASIC_PASSWORD;
  await check("hybrid no basic => 503", "/dashboard", undefined, 503);

  process.env.DASHBOARD_BASIC_USER = "jojo";
  process.env.DASHBOARD_BASIC_PASSWORD = "testpass123";
  await check("hybrid with basic", "/dashboard", {
    headers: { Authorization: basic },
  }, 200);

  process.env.VANOS_ALLOWED_HOSTS = "vanos.example.ts.net";
  await check("bad host", "/dashboard", {
    headers: {
      Host: "evil.com",
      "Tailscale-User-Login": "jojo@github",
      Authorization: basic,
    },
  }, 421);
  delete process.env.VANOS_ALLOWED_HOSTS;

  // ── Identity: empty allowlist never trusts Tailscale header ──────
  delete process.env.VANOS_ALLOWED_TAILSCALE_USERS;
  process.env.VANOS_EDGE_SECRET = "edge-test-secret";
  const spoof = resolveNetworkIdentity(
    req({ "Tailscale-User-Login": "anyone@github" }),
  );
  assert("empty allowlist rejects Tailscale spoof", spoof.ok === false);

  const edgeOk = resolveNetworkIdentity(
    req({ "X-VanOS-Edge": "edge-test-secret" }),
  );
  assert("edge secret still accepted", edgeOk.ok && edgeOk.via === "edge-secret");

  process.env.VANOS_ALLOWED_TAILSCALE_USERS = "jojo@github";
  delete process.env.VANOS_TRUST_PROXY;
  const untrustedLogin = resolveNetworkIdentity(
    req({ "Tailscale-User-Login": "jojo@github" }),
  );
  assert(
    "tailscale login ignored unless proxy is trusted",
    untrustedLogin.ok === false,
  );
  process.env.VANOS_TRUST_PROXY = "true";
  const allowOk = resolveNetworkIdentity(
    req({ "Tailscale-User-Login": "jojo@github" }),
  );
  assert("allowlisted Tailscale accepted", allowOk.ok === true);

  // ── Dashboard / DF: spoofed Tailscale alone is not enough ────────
  assert(
    "dashboard auth rejects Tailscale spoof",
    authorizeDashboardOrAgent(req({ "Tailscale-User-Login": "jojo@github" })) ===
      false,
  );
  assert(
    "dashboard auth accepts basic",
    authorizeDashboardOrAgent(req({ Authorization: basic })) === true,
  );
  assert(
    "dashboard auth accepts agent bearer",
    authorizeDashboardOrAgent(
      req({ Authorization: "Bearer agent-token-test" }),
    ) === true,
  );
  assert(
    "dashboard auth rejects ingest bearer for DF/HA",
    authorizeDashboardOrAgent(
      req({ Authorization: "Bearer ingest-secret-test" }),
    ) === false,
  );
  assert(
    "dashboard auth accepts edge secret",
    authorizeDashboardOrAgent(req({ "X-VanOS-Edge": "edge-test-secret" })) ===
      true,
  );

  // ── Privileged health: agent bearer only ─────────────────────────
  assert(
    "privileged rejects Tailscale spoof",
    isPrivilegedRequest(req({ "Tailscale-User-Login": "jojo@github" })) === false,
  );
  assert(
    "privileged rejects ingest token",
    isPrivilegedRequest(
      req({ Authorization: "Bearer ingest-secret-test" }),
    ) === false,
  );
  assert(
    "privileged accepts agent token",
    isPrivilegedRequest(req({ Authorization: "Bearer agent-token-test" })) ===
      true,
  );

  // ── Token split ──────────────────────────────────────────────────
  assert(
    "ingest accepts ingest secret",
    authorizeIngest(req({ Authorization: "Bearer ingest-secret-test" })) === true,
  );
  assert(
    "ingest rejects agent token",
    authorizeIngest(req({ Authorization: "Bearer agent-token-test" })) === false,
  );
  assert(
    "agent accepts agent token",
    authorizeAgent(req({ Authorization: "Bearer agent-token-test" })) === true,
  );
  assert(
    "agent rejects ingest token",
    authorizeAgent(req({ Authorization: "Bearer ingest-secret-test" })) === false,
  );

  // ── Shared ingest validation ─────────────────────────────────────
  assert(
    "cost parse rejects empty",
    parseCostIngest({ lines: [] }).ok === false,
  );
  assert(
    "cost parse accepts line",
    parseCostIngest({
      lines: [
        {
          name: "OpenRouter",
          provider: "openrouter",
          category: "llm",
          amountUsd: 1.5,
        },
      ],
    }).ok === true,
  );

  // ── Edge deployment: ingest + MCP + health only ─────────────────
  process.env.VANOS_ACCESS_MODE = "edge";
  delete process.env.VANOS_EDGE_DASHBOARD;
  delete process.env.VANOS_ALLOWED_HOSTS;
  await check("edge ingest", "/api/bots/ingest", { method: "POST" }, 200);
  await check("edge mcp", "/api/mcp", { method: "POST" }, 200);
  await check("edge health", "/api/v1/health", undefined, 200);
  await check("edge dashboard hidden", "/dashboard", undefined, 404);
  await check("edge discovery hidden", "/api/v1", undefined, 404);
  await check("edge other ingest hidden", "/api/v1/ingest", { method: "POST" }, 404);
  const edgeHealth = await proxy(
    new NextRequest(new URL("/api/v1/health", "http://127.0.0.1:3000")),
  );
  assert(
    "edge health sends nosniff",
    edgeHealth.headers.get("x-content-type-options") === "nosniff",
  );

  // ── Private CGNAT is opt-in; public ingest defaults closed ──────
  process.env.VANOS_ACCESS_MODE = "private";
  delete process.env.VANOS_PUBLIC_INGEST;
  delete process.env.VANOS_TRUST_TAILSCALE_CGNAT;
  delete process.env.VANOS_ALLOWED_TAILSCALE_USERS;
  process.env.DASHBOARD_BASIC_USER = "jojo";
  process.env.DASHBOARD_BASIC_PASSWORD = "testpass123";
  await check(
    "private ingest closed by default",
    "/api/v1/sync",
    { method: "POST" },
    403,
  );
  await check(
    "cgnat ignored until enabled",
    "/dashboard",
    { headers: { "x-real-ip": "100.80.1.5", authorization: basic } },
    403,
  );
  process.env.VANOS_TRUST_TAILSCALE_CGNAT = "true";
  delete process.env.VANOS_TRUST_PROXY;
  await check(
    "cgnat header ignored without trusted proxy",
    "/dashboard",
    { headers: { "x-real-ip": "100.80.1.5", authorization: basic } },
    403,
  );
  process.env.VANOS_TRUST_PROXY = "true";
  await check(
    "cgnat plus basic opens dashboard",
    "/dashboard",
    { headers: { "x-real-ip": "100.80.1.5", authorization: basic } },
    200,
  );

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll security smoke assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Post-build check for VANOS_ACCESS_MODE=edge.
 *
 * 1. /dashboard, /, and /support must not be prerendered into static output.
 * 2. A production server must answer 404 for those paths and for /api/v1/*
 *    except /api/v1/health, with no dashboard payload.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(appRoot, ".next");
const port = 3456;
const origin = `http://127.0.0.1:${port}`;

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function assertStaticOutput() {
  const manifestPath = path.join(nextDir, "prerender-manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`missing ${manifestPath}; run next build first`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    routes?: Record<string, unknown>;
  };
  const staticRoutes = Object.keys(manifest.routes ?? {});
  for (const route of ["/", "/dashboard", "/support"]) {
    if (staticRoutes.includes(route)) {
      fail(`${route} is in the prerender manifest: ${staticRoutes.join(", ")}`);
    }
  }

  const banned = new Set([
    "index.html",
    "index.rsc",
    "dashboard.html",
    "dashboard.rsc",
    "support.html",
    "support.rsc",
  ]);
  const appDir = path.join(nextDir, "server", "app");
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (banned.has(name)) found.push(path.relative(nextDir, full));
    }
  };
  walk(appDir);
  if (found.length) {
    fail(`static page output present: ${found.join(", ")}`);
  }
  console.log("OK  dashboard, /, and /support are not prerendered");
}

async function waitForServer(child: ChildProcess): Promise<void> {
  let log = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (child.exitCode != null) {
      fail(`next start exited ${child.exitCode}\n${log}`);
    }
    try {
      const res = await fetch(`${origin}/api/v1/health`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`next start did not become ready\n${log}`);
}

async function expectStatus(
  pathname: string,
  status: number,
  bodyCheck?: (body: string) => void,
) {
  const res = await fetch(`${origin}${pathname}`);
  const body = await res.text();
  if (res.status !== status) {
    fail(`${pathname} status ${res.status}, expected ${status}\n${body.slice(0, 200)}`);
  }
  bodyCheck?.(body);
  console.log(`OK  ${pathname} ${status}`);
}

async function main() {
  assertStaticOutput();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VANOS_ACCESS_MODE: "edge",
    PORT: String(port),
  };
  for (const key of [
    "AGENT_API_TOKEN",
    "AGENT_API_TOKEN_PREVIOUS",
    "BOTS_INGEST_SECRET",
    "BOTS_INGEST_SECRET_PREVIOUS",
    "DASHBOARD_BASIC_USER",
    "DASHBOARD_BASIC_PASSWORD",
    "VANOS_EDGE_DASHBOARD",
  ]) {
    delete env[key];
  }

  const child = spawn(
    process.execPath,
    [path.join(appRoot, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
    { cwd: appRoot, env, stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    await waitForServer(child);
    const plain404 = (body: string) => {
      if (body !== "Not found") {
        fail(`expected a plain 404, got ${body.slice(0, 180)}`);
      }
    };
    await expectStatus("/dashboard", 404, plain404);
    await expectStatus("/", 404, plain404);
    await expectStatus("/support", 404, plain404);
    for (const pathname of [
      "/api/v1",
      "/api/v1/snapshot",
      "/api/v1/ingest",
      "/api/v1/dispatch",
      "/api/v1/sync",
      "/api/v1/homeassistant",
      "/api/v1/displayfusion",
      "/api/v1/github",
      "/api/v1/notion",
      "/api/v1/obsidian",
      "/api/dashboard",
      "/api/money/action",
    ]) {
      await expectStatus(pathname, 404, plain404);
    }
    const health = await fetch(`${origin}/api/v1/health`);
    const healthBody = await health.text();
    if (health.status !== 200) fail(`/api/v1/health status ${health.status}`);
    if (!healthBody.includes('"ok":true')) fail(`health body was ${healthBody}`);
    if (health.headers.get("x-vanos-access-mode") !== "edge") {
      fail("health response missing x-vanos-access-mode, so the proxy did not run");
    }
    console.log("OK  /api/v1/health 200");
    const ingest = await fetch(`${origin}/api/bots/ingest`, { method: "POST" });
    if (ingest.status === 404) fail("/api/bots/ingest was closed");
    console.log(`OK  /api/bots/ingest ${ingest.status}`);
    const mcp = await fetch(`${origin}/api/mcp`, { method: "POST" });
    if (mcp.status === 404) fail("/api/mcp was closed");
    console.log(`OK  /api/mcp ${mcp.status}`);
    console.log("Edge access check passed");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

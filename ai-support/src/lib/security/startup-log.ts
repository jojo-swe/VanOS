import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitLog } from "@/lib/security/access-log";
import { getAccessMode, isDemoMode } from "@/lib/security/config";
import { mfaConfigProblems } from "@/lib/security/totp";
import { dashboardPasswordProblems, tokenProblems } from "@/lib/security/tokens";

export type StartupReason = "short_key" | "shared_key" | "short_password" | "mfa_config";

/**
 * short_key wins when a secret is both too short and shared.
 * A TOTP secret that is not usable base32, with an otherwise valid session
 * key, is mfa_config. A missing or short VANOS_SESSION_SECRET is short_key.
 */
export function startupReason(problems: readonly string[]): StartupReason | null {
  if (problems.length === 0) return null;
  if (problems.some((problem) => problem.includes("shorter than"))) return "short_key";
  if (problems.some((problem) => problem.includes("must not equal"))) return "shared_key";
  return "mfa_config";
}

export function appVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "../../../package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * One startup line on stdout. When config is fatal, the line is written
 * before the process exits.
 */
export function reportStartup(exit: (code: number) => void = process.exit): void {
  const problems = [...tokenProblems(), ...mfaConfigProblems()];
  const passwordProblems = dashboardPasswordProblems();
  const fatal = startupReason(problems);
  const reason: StartupReason | null =
    fatal ?? (passwordProblems.length > 0 ? "short_password" : null);
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: fatal ? "error" : reason ? "warn" : "info",
    event: "startup",
    version: appVersion(),
    mode: getAccessMode(),
    demo: isDemoMode(),
    config_ok: reason === null,
  };
  if (reason) record.reason = reason;
  emitLog(record);
  if (fatal) {
    const message = `Refusing to start: ${[...problems, ...passwordProblems].join("; ")}`;
    console.error(`[vanos] ${message}`);
    exit(1);
    throw new Error(message);
  }
  if (passwordProblems.length > 0) {
    console.warn(`[vanos] ${passwordProblems.join("; ")}`);
  }
}

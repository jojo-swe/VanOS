function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getVaultPath(): string | undefined {
  return env("OBSIDIAN_VAULT_PATH");
}

export function obsidianInsecureTls(): boolean {
  return env("OBSIDIAN_API_INSECURE") === "true";
}

export type ObsidianApiConfig =
  | { state: "off" }
  | { state: "partial"; missing: "OBSIDIAN_API_URL" | "OBSIDIAN_API_KEY" }
  | { state: "invalid"; detail: string }
  | { state: "ready"; url: string; key: string; host: string };

export function readObsidianApi(): ObsidianApiConfig {
  const url = env("OBSIDIAN_API_URL");
  const key = env("OBSIDIAN_API_KEY");
  if (!url && !key) return { state: "off" };
  if (!url) return { state: "partial", missing: "OBSIDIAN_API_URL" };
  if (!key) return { state: "partial", missing: "OBSIDIAN_API_KEY" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { state: "invalid", detail: "OBSIDIAN_API_URL is not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { state: "invalid", detail: "OBSIDIAN_API_URL must be http or https." };
  }
  if (parsed.username || parsed.password) {
    return {
      state: "invalid",
      detail: "Put the key in OBSIDIAN_API_KEY, not in the URL.",
    };
  }
  parsed.search = "";
  parsed.hash = "";
  const base = parsed.toString().replace(/\/$/, "");
  return { state: "ready", url: base, key, host: parsed.hostname };
}

export function isObsidianConfigured(): boolean {
  return Boolean(getVaultPath() || env("OBSIDIAN_API_URL") || env("OBSIDIAN_API_KEY"));
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

/** Home Assistant base URL — prefer Tailscale, e.g. http://homeassistant:8123 or https://ha.tailnet.ts.net */
export function getHaBaseUrl(): string | undefined {
  const raw = env("HOME_ASSISTANT_URL") || env("HA_URL");
  if (!raw) return undefined;
  return raw.replace(/\/$/, "");
}

export function getHaToken(): string | undefined {
  return (
    env("HOME_ASSISTANT_TOKEN") ||
    env("HA_TOKEN") ||
    env("HA_LONG_LIVED_TOKEN")
  );
}

export function isHaConfigured(): boolean {
  return Boolean(getHaBaseUrl() && getHaToken());
}

/**
 * Services callers may run when HA_ALLOWED_SERVICES is unset. Locks,
 * alarms, covers, scripts, automations and `homeassistant.*` are left out
 * on purpose: an agent token should not be able to open the front door.
 */
const DEFAULT_ALLOWED_SERVICES = [
  "light.*",
  "switch.*",
  "fan.*",
  "media_player.*",
  "input_boolean.*",
  "scene.turn_on",
];

const NAME_PART = /^[a-z0-9_]+$/;

/**
 * Allowed `domain.service` entries. `domain.*` allows every service in a
 * domain. Set HA_ALLOWED_SERVICES (comma-separated) to replace the default.
 */
export function getHaAllowedServices(): string[] {
  const raw = env("HA_ALLOWED_SERVICES") || env("HOME_ASSISTANT_ALLOWED_SERVICES");
  const list = raw
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWED_SERVICES;
  return list.filter((entry) => {
    const [domain, service, extra] = entry.split(".");
    return (
      extra === undefined &&
      Boolean(domain && NAME_PART.test(domain)) &&
      (service === "*" || Boolean(service && NAME_PART.test(service)))
    );
  });
}

/** True when `domain.service` is on the allowlist. Names must be plain HA identifiers. */
export function isHaServiceAllowed(domain: string, service: string): boolean {
  const d = domain.trim().toLowerCase();
  const s = service.trim().toLowerCase();
  if (!NAME_PART.test(d) || !NAME_PART.test(s)) return false;
  const allowed = getHaAllowedServices();
  return allowed.includes(`${d}.${s}`) || allowed.includes(`${d}.*`);
}

/** Comma-separated entity_ids to surface on the dashboard */
export function getHaWatchEntities(): string[] {
  const raw =
    env("HOME_ASSISTANT_WATCH") ||
    env("HA_WATCH_ENTITIES") ||
    "sun.sun";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

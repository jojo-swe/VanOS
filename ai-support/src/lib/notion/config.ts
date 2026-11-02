function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getNotionToken(): string | undefined {
  return env("NOTION_TOKEN");
}

export function getNotionStatusProperty(): string {
  return env("NOTION_STATUS_PROPERTY") || "Status";
}

export function getNotionDoneValue(): string {
  return env("NOTION_DONE_VALUE") || "Klart";
}

/** Pull a 32-hex Notion id out of a raw id or a notion.so URL. */
export function normalizeNotionId(raw: string): string | null {
  const compact = raw.trim();
  const stripped = compact.replace(/-/g, "");
  if (/^[0-9a-f]{32}$/i.test(stripped) && compact.length <= 36) {
    return stripped.toLowerCase();
  }
  let source = compact;
  try {
    source = new URL(compact).pathname;
  } catch {
    source = compact;
  }
  const dashed = [
    ...source.matchAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ),
  ];
  if (dashed.length) {
    return dashed[dashed.length - 1][0].replace(/-/g, "").toLowerCase();
  }
  const plain = [...source.matchAll(/[0-9a-f]{32}/gi)];
  if (!plain.length) return null;
  return plain[plain.length - 1][0].toLowerCase();
}

export function getNotionDatabaseIds(): string[] {
  const raw = env("NOTION_DATABASE_IDS");
  if (!raw) return [];
  const ids: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const id = normalizeNotionId(part);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 10);
}

export function isNotionConfigured(): boolean {
  return Boolean(getNotionToken() && getNotionDatabaseIds().length);
}

export function notionDisabledDetail(): string | null {
  const token = getNotionToken();
  const raw = env("NOTION_DATABASE_IDS");
  if (!token && !raw) return null;
  if (!token) return "Notion is off until NOTION_TOKEN is set (internal integration).";
  if (!raw) {
    return "Set NOTION_DATABASE_IDS to the databases to read (comma-separated ids or URLs).";
  }
  if (!getNotionDatabaseIds().length) {
    return "NOTION_DATABASE_IDS did not include a Notion database id.";
  }
  return null;
}

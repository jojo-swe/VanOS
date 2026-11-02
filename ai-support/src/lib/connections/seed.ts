import type {
  ConnectionMeta,
  ConnectionsSnapshot,
  DriveSnapshot,
  GithubSnapshot,
  JoplinSnapshot,
  MailSnapshot,
  NotionSnapshot,
} from "./types";

/**
 * Production starting point: the services Mission Control knows about,
 * with nothing connected and no data. Agents fill it in through
 * connections ingest; GitHub, Notion, Slack, Home Assistant and
 * DisplayFusion turn live from their own config. Sample data for the
 * public demo lives in @/lib/demo/fixture.
 */
export function seedConnections(): ConnectionMeta[] {
  return [
    {
      id: "gmail",
      name: "Gmail",
      kind: "mail",
      wire: "mcp-ready",
      mcpAvailable: true,
      detail: "Agents can read it. Waiting for an inbox digest.",
    },
    {
      id: "github",
      name: "GitHub",
      kind: "code",
      wire: "mcp-ready",
      mcpAvailable: true,
      detail: "Agents can read it. Set it up under Integrations to see repos here.",
    },
    {
      id: "notion",
      name: "Notion",
      kind: "notes",
      wire: "mcp-ready",
      mcpAvailable: true,
      detail: "Agents can read it. Set it up under Integrations to see pages here.",
    },
    {
      id: "slack",
      name: "Slack",
      kind: "chat",
      wire: "missing",
      mcpAvailable: false,
      detail: "Not set up yet. See Integrations.",
    },
    {
      id: "joplin",
      name: "Joplin",
      kind: "notes",
      wire: "ingest-only",
      mcpAvailable: false,
      detail: "Waiting for an agent to send notes.",
    },
    {
      id: "gdrive",
      name: "Google Drive",
      kind: "files",
      wire: "mcp-ready",
      mcpAvailable: true,
      detail: "Agents can read it. Waiting for a file list.",
    },
    {
      id: "onedrive",
      name: "OneDrive",
      kind: "files",
      wire: "missing",
      mcpAvailable: false,
      detail: "Not connected.",
    },
    {
      id: "homeassistant",
      name: "Home Assistant",
      kind: "home",
      wire: "missing",
      mcpAvailable: false,
      detail: "Not set up yet. See Home / PC.",
    },
    {
      id: "displayfusion",
      name: "DisplayFusion",
      kind: "desktop",
      wire: "missing",
      mcpAvailable: false,
      detail: "Not set up yet. See Home / PC.",
    },
  ];
}

export function seedMail(): MailSnapshot {
  return { unread: 0, important: 0, threads: [] };
}

export function seedGithub(): GithubSnapshot {
  return { repos: [], prs: [] };
}

export function seedNotion(): NotionSnapshot {
  return { connected: false, note: "No pages sent yet.", pages: [] };
}

export function seedJoplin(): JoplinSnapshot {
  return { connected: false, noteCount: 0, note: "No notes sent yet.", notes: [] };
}

export function seedGdrive(): DriveSnapshot {
  return { provider: "gdrive", note: "No files sent yet.", files: [] };
}

export function seedConnectionsSnapshot(): Omit<ConnectionsSnapshot, "alerts" | "updatedAt"> {
  return {
    connections: seedConnections(),
    mail: seedMail(),
    github: seedGithub(),
    notion: seedNotion(),
    joplin: seedJoplin(),
    gdrive: seedGdrive(),
  };
}

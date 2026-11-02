import { isDfConfigured } from "@/lib/displayfusion/config";
import { isDemoMode } from "@/lib/security/config";
import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import { isGithubConfigured } from "@/lib/github/config";
import { isHaConfigured } from "@/lib/homeassistant/config";
import { isNotionConfigured } from "@/lib/notion/config";
import { demoConnectionsSnapshot } from "@/lib/demo/fixture";
import { buildConnectionsSnapshot } from "./compute";
import { seedConnectionsSnapshot } from "./seed";
import type {
  ConnectionMeta,
  ConnectionsIngestPayload,
  ConnectionsSnapshot,
  DriveSnapshot,
  GithubSnapshot,
  JoplinSnapshot,
  MailSnapshot,
  NotionSnapshot,
} from "./types";
import type { z } from "zod";
import {
  connectionPatchSchema,
  driveSectionSchema,
  githubSectionSchema,
  joplinSectionSchema,
  mailSectionSchema,
  notionSectionSchema,
} from "./parse-ingest";
import { isSlackConfigured, slackNotificationsEnabled } from "@/lib/slack/config";

function section<T extends z.ZodType>(schema: T, value: unknown): z.output<T> | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const KEY = "connections-overlay";

interface ConnectionsOverlay {
  updatedAt: string;
  reportedBy?: string;
  connections: ConnectionMeta[];
  mail?: Partial<MailSnapshot>;
  github?: Partial<GithubSnapshot>;
  notion?: Partial<NotionSnapshot>;
  joplin?: Partial<JoplinSnapshot>;
  gdrive?: Partial<DriveSnapshot>;
  replace?: boolean;
}

function emptyOverlay(): ConnectionsOverlay {
  return {
    updatedAt: new Date().toISOString(),
    connections: [],
  };
}

export async function getConnectionsOverlay(): Promise<ConnectionsOverlay> {
  return normalize(await durableGetJson<ConnectionsOverlay>(KEY));
}

function normalize(disk: ConnectionsOverlay | null): ConnectionsOverlay {
  if (!disk) return emptyOverlay();
  // Drop malformed sections an older version let in, so they cannot break reads.
  return {
    updatedAt: disk.updatedAt ?? new Date().toISOString(),
    reportedBy: disk.reportedBy,
    connections: (Array.isArray(disk.connections) ? disk.connections : []).filter(
      (c) => connectionPatchSchema.safeParse(c).success,
    ),
    mail: section(mailSectionSchema, disk.mail),
    github: section(githubSectionSchema, disk.github),
    notion: section(notionSectionSchema, disk.notion),
    joplin: section(joplinSectionSchema, disk.joplin),
    gdrive: section(driveSectionSchema, disk.gdrive),
  };
}

function upsertConnections(
  base: ConnectionMeta[],
  incoming: Partial<ConnectionMeta>[],
): ConnectionMeta[] {
  const map = new Map(base.map((c) => [c.id, c]));
  for (const row of incoming) {
    if (!row.id) continue;
    const prev = map.get(row.id as ConnectionMeta["id"]);
    if (!prev) continue;
    map.set(prev.id, { ...prev, ...row, id: prev.id });
  }
  return Array.from(map.values());
}

export async function applyConnectionsIngest(
  payload: ConnectionsIngestPayload,
): Promise<ConnectionsSnapshot> {
  if (isDemoMode()) return getConnectionsSnapshot();
  await durableUpdateJson<ConnectionsOverlay>(KEY, (disk) => {
    const overlay = normalize(disk);
    mergeConnectionsIngest(overlay, payload);
    overlay.updatedAt = new Date().toISOString();
    return overlay;
  });
  return getConnectionsSnapshot();
}

function mergeConnectionsIngest(
  overlay: ConnectionsOverlay,
  payload: ConnectionsIngestPayload,
): void {
  if (payload.reportedBy) overlay.reportedBy = payload.reportedBy;
  // `replace` applies to this ingest only. It used to stick on the overlay,
  // which turned every later merge into an overwrite.
  const replace = payload.replace === true;

  if (payload.connections?.length) {
    const seed = seedConnectionsSnapshot().connections;
    // Start from the seed so ids added after the overlay was first stored
    // (such as slack) can be updated too.
    overlay.connections = upsertConnections(
      upsertConnections(seed, overlay.connections),
      payload.connections,
    );
  }
  if (payload.mail) {
    overlay.mail = replace
      ? payload.mail
      : { ...overlay.mail, ...payload.mail };
  }
  if (payload.github) {
    overlay.github = replace
      ? payload.github
      : {
          ...overlay.github,
          ...payload.github,
          repos: payload.github.repos ?? overlay.github?.repos,
          prs: payload.github.prs ?? overlay.github?.prs,
        };
  }
  if (payload.notion) {
    overlay.notion = replace
      ? payload.notion
      : {
          ...overlay.notion,
          ...payload.notion,
          pages: payload.notion.pages ?? overlay.notion?.pages,
        };
  }
  if (payload.joplin) {
    overlay.joplin = replace
      ? payload.joplin
      : {
          ...overlay.joplin,
          ...payload.joplin,
          notes: payload.joplin.notes ?? overlay.joplin?.notes,
        };
  }
  if (payload.gdrive) {
    overlay.gdrive = replace
      ? payload.gdrive
      : {
          ...overlay.gdrive,
          ...payload.gdrive,
          files: payload.gdrive.files ?? overlay.gdrive?.files,
        };
  }
}

export async function getConnectionsSnapshot(): Promise<ConnectionsSnapshot> {
  if (isDemoMode()) {
    const seed = demoConnectionsSnapshot();
    return buildConnectionsSnapshot({
      updatedAt: new Date().toISOString(),
      ...seed,
    });
  }
  const seed = seedConnectionsSnapshot();
  const overlay = await getConnectionsOverlay();

  const connections = overlay.connections.length
    ? upsertConnections(seed.connections, overlay.connections)
    : seed.connections;

  const mail: MailSnapshot = {
    ...seed.mail,
    ...overlay.mail,
    threads: overlay.mail?.threads ?? seed.mail.threads,
  };

  const github: GithubSnapshot = {
    repos: overlay.github?.repos ?? seed.github.repos,
    prs: overlay.github?.prs ?? seed.github.prs,
  };

  const notion: NotionSnapshot = {
    ...seed.notion,
    ...overlay.notion,
    pages: overlay.notion?.pages ?? seed.notion.pages,
  };

  const joplin: JoplinSnapshot = {
    ...seed.joplin,
    ...overlay.joplin,
    notes: overlay.joplin?.notes ?? seed.joplin.notes,
  };

  const gdrive: DriveSnapshot = {
    ...seed.gdrive,
    ...overlay.gdrive,
    files: overlay.gdrive?.files ?? seed.gdrive.files,
    provider: overlay.gdrive?.provider ?? seed.gdrive.provider,
  };

  // Mark live when ingest brought real sync signals
  const liveConnections = connections.map((c) => {
    if (c.id === "github" && isGithubConfigured()) {
      return {
        ...c,
        wire: "live" as const,
        detail: "Read-only GitHub API — Integrations panel",
        lastSync: new Date().toISOString(),
      };
    }
    if (c.id === "slack" && c.wire !== "error" && (isSlackConfigured() || slackNotificationsEnabled())) {
      return {
        ...c,
        wire: "live" as const,
        detail: isSlackConfigured()
          ? slackNotificationsEnabled()
            ? "Read-only channels on the Integrations panel, alerts via incoming webhook"
            : "Read-only channels on the Integrations panel"
          : "Alerts via incoming webhook",
        lastSync: new Date().toISOString(),
      };
    }
    if (c.id === "notion" && isNotionConfigured()) {
      return {
        ...c,
        wire: "live" as const,
        detail: "Notion internal integration — open rows on the Integrations panel",
        lastSync: new Date().toISOString(),
      };
    }
    if (overlay.reportedBy && c.wire === "mcp-ready") {
      if (
        (c.id === "gmail" && overlay.mail) ||
        (c.id === "github" && overlay.github) ||
        (c.id === "notion" && overlay.notion?.connected) ||
        (c.id === "gdrive" && overlay.gdrive?.files) ||
        (c.id === "joplin" && overlay.joplin?.connected)
      ) {
        return {
          ...c,
          wire: "live" as const,
          lastSync: overlay.updatedAt,
        };
      }
    }
    if (c.id === "joplin" && joplin.connected) {
      return { ...c, wire: "live" as const, lastSync: overlay.updatedAt };
    }
    if (c.id === "notion" && notion.connected) {
      return { ...c, wire: "live" as const, lastSync: overlay.updatedAt };
    }
    if (c.id === "homeassistant" && isHaConfigured()) {
      return {
        ...c,
        wire: "live" as const,
        detail: "REST configured — Home / PC panel",
        lastSync: overlay.updatedAt,
      };
    }
    if (c.id === "displayfusion" && isDfConfigured()) {
      return {
        ...c,
        wire: "live" as const,
        detail: "Windows bridge configured — Home / PC panel",
        lastSync: overlay.updatedAt,
      };
    }
    return c;
  });

  return buildConnectionsSnapshot({
    updatedAt: overlay.reportedBy ? overlay.updatedAt : new Date().toISOString(),
    connections: liveConnections,
    mail,
    github,
    notion,
    joplin,
    gdrive,
    reportedBy: overlay.reportedBy,
  });
}

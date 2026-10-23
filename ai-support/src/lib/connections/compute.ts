import type { HealthStatus } from "@/lib/dashboard/types";
import type {
  ConnectionMeta,
  ConnectionsSnapshot,
  DriveSnapshot,
  GithubSnapshot,
  JoplinSnapshot,
  MailSnapshot,
  NotionSnapshot,
} from "./types";

export function buildConnectionsSnapshot(parts: {
  updatedAt: string;
  connections: ConnectionMeta[];
  mail: MailSnapshot;
  github: GithubSnapshot;
  notion: NotionSnapshot;
  joplin: JoplinSnapshot;
  gdrive: DriveSnapshot;
  reportedBy?: string;
}): ConnectionsSnapshot {
  const alerts: ConnectionsSnapshot["alerts"] = [];

  if (parts.mail.unread > 0) {
    alerts.push({
      id: "conn-mail",
      severity: parts.mail.important > 0 ? "warn" : "ok",
      title: `${parts.mail.unread} unread mail`,
      body:
        parts.mail.important > 0
          ? `${parts.mail.important} marked important`
          : "Inbox digest ready",
    });
  }

  const failingCi = parts.github.repos.filter((r) => r.ci === "error");
  if (failingCi.length) {
    alerts.push({
      id: "conn-ci",
      severity: "error",
      title: `CI failing on ${failingCi.length} repo(s)`,
      body: failingCi.map((r) => r.name).join(", "),
    });
  } else if (parts.github.prs.length) {
    alerts.push({
      id: "conn-pr",
      severity: "ok",
      title: `${parts.github.prs.length} open PR(s)`,
      body: parts.github.prs.map((p) => `#${p.number} ${p.title}`).join(" · "),
    });
  }

  if (!parts.notion.connected) {
    alerts.push({
      id: "conn-notion",
      severity: "idle",
      title: "Notion not linked",
      body: "Agents can read it; set it up under Integrations or have an agent send pages.",
    });
  }

  if (!parts.joplin.connected) {
    alerts.push({
      id: "conn-joplin",
      severity: "idle",
      title: "Joplin not linked",
      body: "Local notes need an agent or n8n flow to send them.",
    });
  }

  const missing = parts.connections.filter((c) => c.wire === "missing");
  if (missing.length) {
    alerts.push({
      id: "conn-missing",
      // Optional services: not connected is a note, not a warning.
      severity: "idle",
      title: `${missing.length} ${missing.length === 1 ? "service" : "services"} not connected`,
      body: missing.map((m) => m.name).join(", "),
    });
  }

  if (parts.reportedBy) {
    alerts.unshift({
      id: "conn-live",
      severity: "ok",
      title: "Live connections feed",
      body: `Last update from ${parts.reportedBy}.`,
    });
  }

  return {
    updatedAt: parts.updatedAt,
    connections: parts.connections,
    mail: parts.mail,
    github: parts.github,
    notion: parts.notion,
    joplin: parts.joplin,
    gdrive: parts.gdrive,
    alerts: alerts.slice(0, 10),
  };
}

export function connectionHealth(wire: ConnectionMeta["wire"]): HealthStatus {
  if (wire === "live") return "ok";
  if (wire === "mcp-ready" || wire === "ingest-only") return "warn";
  if (wire === "error") return "error";
  return "idle";
}

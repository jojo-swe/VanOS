import type { HealthStatus } from "@/lib/dashboard/types";

export type ConnectionId =
  | "gmail"
  | "github"
  | "notion"
  | "joplin"
  | "gdrive"
  | "onedrive"
  | "icloud"
  | "homeassistant"
  | "displayfusion"
  | "slack";

export type WireStatus =
  | "live"
  | "mcp-ready"
  | "ingest-only"
  | "missing"
  | "error";

export interface ConnectionMeta {
  id: ConnectionId;
  name: string;
  kind: "mail" | "code" | "notes" | "files" | "home" | "desktop" | "chat";
  wire: WireStatus;
  detail: string;
  mcpAvailable: boolean;
  lastSync?: string;
}

export interface MailThread {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  when: string;
  unread: boolean;
  important?: boolean;
  label?: string;
}

export interface MailSnapshot {
  unread: number;
  important: number;
  threads: MailThread[];
}

export interface GithubRepo {
  id: string;
  name: string;
  private: boolean;
  openPrs: number;
  openIssues: number;
  ci: HealthStatus;
  lastPush?: string;
  note?: string;
}

export interface GithubPr {
  id: string;
  repo: string;
  title: string;
  number: number;
  author: string;
  ci: HealthStatus;
  updated: string;
  url?: string;
}

export interface GithubSnapshot {
  repos: GithubRepo[];
  prs: GithubPr[];
}

export interface NotionPage {
  id: string;
  title: string;
  kind: "page" | "database";
  updated: string;
  space?: string;
}

export interface NotionSnapshot {
  connected: boolean;
  pages: NotionPage[];
  note?: string;
}

export interface JoplinNote {
  id: string;
  title: string;
  notebook: string;
  updated: string;
  tags?: string[];
}

export interface JoplinSnapshot {
  connected: boolean;
  notes: JoplinNote[];
  noteCount?: number;
  note?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mime: string;
  modified: string;
  shared?: boolean;
  path?: string;
}

export interface DriveSnapshot {
  provider: "gdrive" | "onedrive" | "icloud";
  files: DriveFile[];
  note?: string;
}

export interface ConnectionsSnapshot {
  updatedAt: string;
  connections: ConnectionMeta[];
  mail: MailSnapshot;
  github: GithubSnapshot;
  notion: NotionSnapshot;
  joplin: JoplinSnapshot;
  gdrive: DriveSnapshot;
  alerts: { id: string; severity: HealthStatus; title: string; body: string }[];
}

export interface ConnectionsIngestPayload {
  replace?: boolean;
  reportedBy?: string;
  connections?: Partial<ConnectionMeta>[];
  mail?: Partial<MailSnapshot>;
  github?: Partial<GithubSnapshot>;
  notion?: Partial<NotionSnapshot>;
  joplin?: Partial<JoplinSnapshot>;
  gdrive?: Partial<DriveSnapshot>;
}

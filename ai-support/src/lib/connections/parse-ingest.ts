import { z } from "zod";
import { describeError, health, optText, text, validItems } from "@/lib/http/schema";
import type { ConnectionsIngestPayload } from "./types";

export type ParseResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string };

const MAX_ITEMS = 200;
const id = text(200);
const when = text(60);
const count = z.number().int().min(0);

export const connectionPatchSchema = z.object({
  id: z.enum([
    "gmail",
    "github",
    "notion",
    "joplin",
    "gdrive",
    "onedrive",
    "icloud",
    "homeassistant",
    "displayfusion",
    "slack",
  ]),
  name: optText(120),
  kind: z.enum(["mail", "code", "notes", "files", "home", "desktop", "chat"]).optional(),
  wire: z.enum(["live", "mcp-ready", "ingest-only", "missing", "error"]).optional(),
  detail: optText(500),
  mcpAvailable: z.boolean().optional(),
  lastSync: optText(60),
});

const mailThreadSchema = z.object({
  id,
  from: text(200),
  subject: z.string().max(300),
  snippet: z.string().max(500).default(""),
  when,
  unread: z.boolean().default(false),
  important: z.boolean().optional(),
  label: optText(80),
});

const repoSchema = z.object({
  id,
  name: text(200),
  private: z.boolean().default(false),
  openPrs: count.default(0),
  openIssues: count.default(0),
  ci: health.default("idle"),
  lastPush: optText(60),
  note: optText(500),
});

const prSchema = z.object({
  id,
  repo: text(200),
  title: text(300),
  number: z.number().int().min(0),
  author: z.string().max(120).default(""),
  ci: health.default("idle"),
  updated: when,
  url: optText(500),
});

const notionPageSchema = z.object({
  id,
  title: text(300),
  kind: z.enum(["page", "database"]).default("page"),
  updated: when,
  space: optText(120),
});

const joplinNoteSchema = z.object({
  id,
  title: text(300),
  notebook: z.string().max(200).default(""),
  updated: when,
  tags: z.array(z.string().max(60)).max(30).optional(),
});

const driveFileSchema = z.object({
  id,
  name: text(300),
  mime: z.string().max(120).default(""),
  modified: when,
  shared: z.boolean().optional(),
  path: optText(500),
});

export const mailSectionSchema = z.object({
  unread: count.optional(),
  important: count.optional(),
  threads: validItems(mailThreadSchema, MAX_ITEMS).optional(),
});

export const githubSectionSchema = z.object({
  repos: validItems(repoSchema, MAX_ITEMS).optional(),
  prs: validItems(prSchema, MAX_ITEMS).optional(),
});

export const notionSectionSchema = z.object({
  connected: z.boolean().optional(),
  pages: validItems(notionPageSchema, MAX_ITEMS).optional(),
  note: optText(500),
});

export const joplinSectionSchema = z.object({
  connected: z.boolean().optional(),
  notes: validItems(joplinNoteSchema, MAX_ITEMS).optional(),
  noteCount: count.optional(),
  note: optText(500),
});

export const driveSectionSchema = z.object({
  provider: z.enum(["gdrive", "onedrive", "icloud"]).optional(),
  files: validItems(driveFileSchema, MAX_ITEMS).optional(),
  note: optText(500),
});

export const connectionPatchesSchema = validItems(connectionPatchSchema, 50);

const connectionsIngestSchema = z.object({
  replace: z.boolean().optional(),
  reportedBy: optText(120),
  connections: connectionPatchesSchema.optional(),
  mail: mailSectionSchema.optional(),
  github: githubSectionSchema.optional(),
  notion: notionSectionSchema.optional(),
  joplin: joplinSectionSchema.optional(),
  gdrive: driveSectionSchema.optional(),
});

/**
 * Validate a connections ingest. A section that is not an object, or has a
 * wrong-typed field, rejects the request; invalid rows inside a section's
 * lists are skipped.
 */
export function parseConnectionsIngest(
  raw: Record<string, unknown>,
): ParseResult<ConnectionsIngestPayload> {
  const parsed = connectionsIngestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: describeError(parsed.error) };
  const { replace, ...rest } = parsed.data;
  const payload: ConnectionsIngestPayload = { ...rest, replace: replace === true };

  const hasAny =
    (payload.connections?.length ?? 0) > 0 ||
    !!payload.mail ||
    !!payload.github ||
    !!payload.notion ||
    !!payload.joplin ||
    !!payload.gdrive;
  if (!hasAny) {
    return {
      ok: false,
      error: "Provide connections, mail, github, notion, joplin, and/or gdrive",
    };
  }
  return { ok: true, payload };
}

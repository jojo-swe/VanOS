import { z } from "zod";
import { amount, describeError, health, optText, text, validItems } from "@/lib/http/schema";

/**
 * "board" ingest: the Overview sections that have no integration of their
 * own (agent status, crons, content, social, income, life, KPIs, schedule,
 * system, vanlife progress). Each list an agent sends replaces that section;
 * agent status rows update the roster by id.
 */

export const MAX_BOARD_ROWS = 100;
const id = text(120);

export const agentReportSchema = z.object({
  id,
  status: health,
  focus: optText(300),
  /** ISO time of the agent's last activity. Defaults to the ingest time. */
  lastActive: optText(40),
});

export const cronSchema = z.object({
  id,
  name: text(200),
  agent: z.string().max(120).default(""),
  schedule: z.string().max(120).default(""),
  status: health.default("idle"),
  lastRun: optText(40),
});

export const contentSchema = z.object({
  id,
  title: text(300),
  channel: z.enum(["blog", "social", "newsletter", "video", "seo"]).default("blog"),
  owner: z.string().max(120).default(""),
  stage: z.enum(["idea", "draft", "review", "scheduled", "published"]).default("idea"),
  due: z.string().max(40).default("—"),
});

export const socialSchema = z.object({
  id,
  platform: z.enum(["x", "linkedin", "tiktok", "instagram", "youtube"]),
  status: z.enum(["queued", "live", "needs-approval", "failed"]).default("queued"),
  preview: text(1000),
  when: z.string().max(60).default(""),
  metrics: z
    .object({
      likes: z.number().int().min(0).optional(),
      views: z.number().int().min(0).optional(),
      comments: z.number().int().min(0).optional(),
    })
    .optional(),
});

export const incomeSchema = z.object({
  id,
  name: text(200),
  type: z.enum(["product", "affiliate", "freelance", "saas", "other"]).default("other"),
  mrr: amount,
  currency: z.enum(["SEK", "USD", "EUR"]).default("USD"),
  status: health.default("idle"),
  nextAction: z.string().max(300).default(""),
});

export const lifeSchema = z.object({
  id,
  area: z.enum(["focus", "health", "vanlife", "money", "relationships", "admin"]).default("admin"),
  title: text(200),
  detail: z.string().max(500).default(""),
  priority: z.enum(["now", "soon", "someday"]).default("soon"),
  done: z.boolean().optional(),
});

export const kpiSchema = z.object({
  id,
  label: text(80),
  value: text(80),
  target: optText(80),
  trend: z.enum(["up", "flat", "down"]).default("flat"),
  delta: optText(40),
  note: optText(200),
  status: health.optional(),
});

export const scheduleSchema = z.object({
  /** "06:00" or "Mon 08:00", in UTC. */
  time: text(20),
  title: text(200),
  owner: z.string().max(120).default(""),
});

export const systemSchema = z
  .object({
    uptime: optText(80),
    memory: optText(80),
    disk: optText(80),
    cpu: optText(80),
    gateway: health.optional(),
  })
  .strict();

const boardIngestSchema = z
  .object({
    reportedBy: optText(120),
    agents: validItems(agentReportSchema, MAX_BOARD_ROWS).optional(),
    crons: validItems(cronSchema, MAX_BOARD_ROWS).optional(),
    content: validItems(contentSchema, MAX_BOARD_ROWS).optional(),
    social: validItems(socialSchema, MAX_BOARD_ROWS).optional(),
    income: validItems(incomeSchema, MAX_BOARD_ROWS).optional(),
    life: validItems(lifeSchema, MAX_BOARD_ROWS).optional(),
    kpis: validItems(kpiSchema, 20).optional(),
    schedule: validItems(scheduleSchema, 50).optional(),
    system: systemSchema.optional(),
    vanlifeProgress: z.number().min(0).max(100).optional(),
  })
  .strict();

export type BoardIngestPayload = z.output<typeof boardIngestSchema>;

export type BoardParseResult =
  | { ok: true; payload: BoardIngestPayload }
  | { ok: false; error: string };

const SECTIONS = [
  "agents",
  "crons",
  "content",
  "social",
  "income",
  "life",
  "kpis",
  "schedule",
  "system",
  "vanlifeProgress",
] as const;

export function parseBoardIngest(raw: Record<string, unknown>): BoardParseResult {
  const parsed = boardIngestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: describeError(parsed.error) };
  if (!SECTIONS.some((key) => parsed.data[key] !== undefined)) {
    return { ok: false, error: `Send at least one of: ${SECTIONS.join(", ")}` };
  }
  return { ok: true, payload: parsed.data };
}

import { z } from "zod";
import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import { keepValid } from "@/lib/http/schema";
import { isDemoMode } from "@/lib/security/config";
import {
  agentReportSchema,
  contentSchema,
  cronSchema,
  incomeSchema,
  kpiSchema,
  lifeSchema,
  MAX_BOARD_ROWS,
  scheduleSchema,
  socialSchema,
  systemSchema,
  type BoardIngestPayload,
} from "./parse-ingest";

const KEY = "board";

type Rows<T extends z.ZodType> = z.output<T>[];

/** What agents have reported for the Overview sections. Unset = never reported. */
export interface BoardOverlay {
  updatedAt: string;
  reportedBy?: string;
  agents: Rows<typeof agentReportSchema>;
  crons?: Rows<typeof cronSchema>;
  content?: Rows<typeof contentSchema>;
  social?: Rows<typeof socialSchema>;
  income?: Rows<typeof incomeSchema>;
  life?: Rows<typeof lifeSchema>;
  kpis?: Rows<typeof kpiSchema>;
  schedule?: Rows<typeof scheduleSchema>;
  system?: z.output<typeof systemSchema>;
  vanlifeProgress?: number;
}

function emptyBoard(): BoardOverlay {
  return { updatedAt: new Date(0).toISOString(), agents: [] };
}

/** Drop anything malformed an older version (or a bad write) left behind. */
export function normalizeBoard(disk: Partial<BoardOverlay> | null): BoardOverlay {
  if (!disk || typeof disk !== "object") return emptyBoard();
  const list = <T extends z.ZodType>(schema: T, rows: unknown) =>
    rows === undefined ? undefined : keepValid(schema, rows);
  const system = systemSchema.safeParse(disk.system);
  const progress = disk.vanlifeProgress;
  return {
    updatedAt: typeof disk.updatedAt === "string" ? disk.updatedAt : emptyBoard().updatedAt,
    reportedBy: typeof disk.reportedBy === "string" ? disk.reportedBy : undefined,
    agents: keepValid(agentReportSchema, disk.agents),
    crons: list(cronSchema, disk.crons),
    content: list(contentSchema, disk.content),
    social: list(socialSchema, disk.social),
    income: list(incomeSchema, disk.income),
    life: list(lifeSchema, disk.life),
    kpis: list(kpiSchema, disk.kpis),
    schedule: list(scheduleSchema, disk.schedule),
    system: system.success ? system.data : undefined,
    vanlifeProgress:
      typeof progress === "number" && progress >= 0 && progress <= 100 ? progress : undefined,
  };
}

/**
 * Pure merge of one ingest into the stored board. Lists replace their
 * section; agent rows update the roster by id (a missing `lastActive`
 * becomes `now`).
 */
export function mergeBoardIngest(
  board: BoardOverlay,
  payload: BoardIngestPayload,
  now: string,
): BoardOverlay {
  const next: BoardOverlay = { ...board, updatedAt: now };
  if (payload.reportedBy) next.reportedBy = payload.reportedBy;
  if (payload.agents) {
    const byId = new Map(board.agents.map((a) => [a.id, a]));
    for (const a of payload.agents) byId.set(a.id, { ...a, lastActive: a.lastActive ?? now });
    next.agents = Array.from(byId.values()).slice(-MAX_BOARD_ROWS);
  }
  for (const key of ["crons", "content", "social", "income", "life", "kpis", "schedule"] as const) {
    if (payload[key]) (next as unknown as Record<string, unknown>)[key] = payload[key];
  }
  if (payload.system) next.system = { ...board.system, ...payload.system };
  if (payload.vanlifeProgress !== undefined) next.vanlifeProgress = payload.vanlifeProgress;
  return next;
}

export async function getBoard(): Promise<BoardOverlay> {
  if (isDemoMode()) return emptyBoard();
  return normalizeBoard(await durableGetJson<Partial<BoardOverlay>>(KEY));
}

export async function applyBoardIngest(payload: BoardIngestPayload): Promise<BoardOverlay> {
  if (isDemoMode()) throw new Error("Demo mode is read-only");
  const now = new Date().toISOString();
  let stored = emptyBoard();
  await durableUpdateJson<Partial<BoardOverlay>>(KEY, (disk) => {
    stored = mergeBoardIngest(normalizeBoard(disk), payload, now);
    return stored;
  });
  return stored;
}

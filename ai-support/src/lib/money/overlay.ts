import { parseRate } from "@/lib/currency/fx";
import { keepValid } from "@/lib/http/schema";
import {
  everydaySchema,
  sellSchema,
  subscriptionSchema,
  taxItemSchema,
} from "./parse-ingest";
import type { EverydayTxn, SellListing, Subscription, TaxItem } from "./types";

/** What agents (and dashboard actions) have stored on top of the seed. */
export interface MoneyOverlay {
  updatedAt: string;
  reportedBy?: string;
  usdToSek?: number;
  eurToSek?: number;
  /** ISO time an agent last sent each rate. Missing on rates stored before it was kept. */
  usdToSekAt?: string;
  eurToSekAt?: string;
  subscriptions: Subscription[];
  everyday: EverydayTxn[];
  taxItems: TaxItem[];
  sell: SellListing[];
  /** When true, overlay fully replaces seed for that collection */
  replaceAll?: boolean;
}

export type MoneyCollections = Pick<
  MoneyOverlay,
  "subscriptions" | "everyday" | "taxItems" | "sell"
>;

export function emptyOverlay(): MoneyOverlay {
  return {
    updatedAt: new Date().toISOString(),
    subscriptions: [],
    everyday: [],
    taxItems: [],
    sell: [],
  };
}

function isoTime(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function normalizeOverlay(disk: MoneyOverlay | null): MoneyOverlay {
  if (!disk) return emptyOverlay();
  return {
    updatedAt: disk.updatedAt ?? new Date().toISOString(),
    reportedBy: disk.reportedBy,
    usdToSek: parseRate(disk.usdToSek),
    eurToSek: parseRate(disk.eurToSek),
    usdToSekAt: isoTime(disk.usdToSekAt),
    eurToSekAt: isoTime(disk.eurToSekAt),
    replaceAll: disk.replaceAll,
    // Drop malformed rows an older version let in, so they cannot break reads.
    subscriptions: keepValid(subscriptionSchema, disk.subscriptions),
    everyday: keepValid(everydaySchema, disk.everyday),
    taxItems: keepValid(taxItemSchema, disk.taxItems),
    sell: keepValid(sellSchema, disk.sell),
  };
}

export function upsertById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
  const map = new Map(base.map((x) => [x.id, x]));
  for (const row of incoming) map.set(row.id, row);
  return Array.from(map.values());
}

/**
 * The rows a reader sees for one collection: the overlay on top of the
 * seed, or the overlay alone after a `replace` ingest (falling back to the
 * seed while that collection is still empty).
 */
export function effectiveRows<T extends { id: string }>(
  overlayRows: T[],
  seedRows: T[],
  replaceAll: boolean | undefined,
): T[] {
  if (replaceAll) return overlayRows.length ? overlayRows : seedRows;
  return upsertById(seedRows, overlayRows);
}

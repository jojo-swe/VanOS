import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import { timedFetch } from "@/lib/integrations/http";
import { isDemoMode } from "@/lib/security/config";
import { parseRate } from "./fx";

/**
 * Daily exchange rates from Riksbanken's public SWEA API (no key):
 * GET https://api.riksbank.se/swea/v1/Observations/Latest/{series}
 * answers `{ "date": "2026-10-16", "value": 9.90403 }`, kronor per unit.
 *
 * Rates are kept in the durable store for RIKSBANK_TTL_MS. A read never
 * waits for Riksbanken: it returns what is stored (or nothing yet) and
 * starts one refresh in the background when that is stale. A failed
 * refresh keeps the last good rates and is not retried for
 * RIKSBANK_RETRY_MS. Off in demo mode and with MONEY_FX_AUTO=off.
 */

export const RIKSBANK_HOST = "api.riksbank.se";
const OBSERVATIONS = `https://${RIKSBANK_HOST}/swea/v1/Observations/Latest/`;

/** Mid rates (PMI) in kronor per dollar and per euro. */
export const RIKSBANK_SERIES = { usd: "SEKUSDPMI", eur: "SEKEURPMI" } as const;

export const RIKSBANK_TTL_MS = 12 * 60 * 60 * 1000;
export const RIKSBANK_RETRY_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 5_000;
const KEY = "fx-riksbank";

export interface RiksbankRates {
  usdToSek: number;
  eurToSek: number;
  /** The day the rates are from (YYYY-MM-DD): the older of the two series. */
  date: string;
  /** ISO time of the fetch. */
  fetchedAt: string;
}

export interface RiksbankObservation {
  date: string;
  value: number;
}

/** MONEY_FX_AUTO=off (or false, 0, no) turns the daily fetch off. Default on. */
export function riksbankAutoEnabled(): boolean {
  if (isDemoMode()) return false;
  const raw = process.env.MONEY_FX_AUTO?.trim().toLowerCase();
  return !(raw === "off" || raw === "false" || raw === "0" || raw === "no");
}

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().startsWith(value);
}

/** One `Observations/Latest` answer, or undefined when it is not a sane rate. */
export function parseRiksbankObservation(json: unknown): RiksbankObservation | undefined {
  if (!json || typeof json !== "object" || Array.isArray(json)) return undefined;
  const { date, value } = json as { date?: unknown; value?: unknown };
  const rate = typeof value === "number" ? parseRate(value) : undefined;
  if (!rate || !isDay(date)) return undefined;
  return { date, value: rate };
}

function normalizeStored(raw: unknown): RiksbankRates | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RiksbankRates>;
  const usdToSek = parseRate(r.usdToSek);
  const eurToSek = parseRate(r.eurToSek);
  const fetchedAt = typeof r.fetchedAt === "string" ? r.fetchedAt : "";
  if (!usdToSek || !eurToSek || !isDay(r.date) || !Number.isFinite(Date.parse(fetchedAt))) {
    return null;
  }
  return { usdToSek, eurToSek, date: r.date, fetchedAt };
}

async function fetchSeries(
  series: string,
  fetchImpl: typeof fetch,
): Promise<RiksbankObservation | undefined> {
  const res = await timedFetch(
    `${OBSERVATIONS}${series}`,
    { headers: { Accept: "application/json" }, timeoutMs: TIMEOUT_MS, allowHosts: [RIKSBANK_HOST] },
    fetchImpl,
  );
  return res.ok ? parseRiksbankObservation(res.json) : undefined;
}

/** Fetch both rates now. Null when either one is missing or not sane. */
export async function fetchRiksbankRates(
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<RiksbankRates | null> {
  const [usd, eur] = await Promise.all([
    fetchSeries(RIKSBANK_SERIES.usd, fetchImpl),
    fetchSeries(RIKSBANK_SERIES.eur, fetchImpl),
  ]);
  if (!usd || !eur) return null;
  return {
    usdToSek: usd.value,
    eurToSek: eur.value,
    date: usd.date < eur.date ? usd.date : eur.date,
    fetchedAt: new Date(now).toISOString(),
  };
}

type RiksbankState = {
  /** Last good rates in this process, for when the durable store is down. */
  memory?: RiksbankRates;
  lastAttempt?: number;
  inflight?: Promise<RiksbankRates | null>;
};
type StateGlobal = { __vanosRiksbank?: RiksbankState };

function state(): RiksbankState {
  const g = globalThis as unknown as StateGlobal;
  if (!g.__vanosRiksbank) g.__vanosRiksbank = {};
  return g.__vanosRiksbank;
}

/** Tests only: forget the in-process copy and the retry clock. */
export function resetRiksbankState(): void {
  (globalThis as unknown as StateGlobal).__vanosRiksbank = {};
}

async function readStored(): Promise<RiksbankRates | null> {
  let stored: RiksbankRates | null = null;
  try {
    stored = normalizeStored(await durableGetJson<RiksbankRates>(KEY));
  } catch {
    stored = null;
  }
  const memory = state().memory;
  if (!stored) return memory ?? null;
  if (memory && Date.parse(memory.fetchedAt) > Date.parse(stored.fetchedAt)) return memory;
  return stored;
}

/**
 * Fetch from Riksbanken and store the result. On any failure the stored
 * rates stay as they are. Returns the rates now in use, or null.
 */
export async function refreshRiksbankRates(
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<RiksbankRates | null> {
  if (!riksbankAutoEnabled()) return null;
  state().lastAttempt = now;
  const fresh = await fetchRiksbankRates(fetchImpl, now);
  if (!fresh) return readStored();
  // Never step back to an older day than the one already stored.
  const current = await readStored();
  const next = current && current.date > fresh.date ? { ...current, fetchedAt: fresh.fetchedAt } : fresh;
  state().memory = next;
  try {
    await durableUpdateJson<RiksbankRates>(KEY, () => next);
  } catch {
    /* kept in memory; the next refresh tries the store again */
  }
  return next;
}

/**
 * The stored Riksbank rates (possibly old), or null when there are none yet
 * or the feature is off. Never waits for the network: when the rates are
 * older than the TTL, one background refresh starts.
 */
export async function getRiksbankRates(
  options: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<RiksbankRates | null> {
  if (!riksbankAutoEnabled()) return null;
  const now = options.now ?? Date.now();
  const stored = await readStored();
  const stale = !stored || now - Date.parse(stored.fetchedAt) > RIKSBANK_TTL_MS;
  const s = state();
  const mayRetry = s.lastAttempt === undefined || now - s.lastAttempt > RIKSBANK_RETRY_MS;
  if (stale && mayRetry && !s.inflight) {
    s.lastAttempt = now;
    s.inflight = refreshRiksbankRates(options.fetchImpl ?? fetch, now)
      .catch(() => null)
      .finally(() => {
        s.inflight = undefined;
      });
  }
  return stored;
}

/** Tests only: wait for a background refresh started by getRiksbankRates. */
export async function settleRiksbankRefresh(): Promise<void> {
  await state().inflight;
}

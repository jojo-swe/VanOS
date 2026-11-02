import { durableGetJson, durableUpdateJson } from "@/lib/durable/store";
import { isDemoMode } from "@/lib/security/config";
import { buildSnapshot } from "./compute";
import { demoMoneyParts } from "@/lib/demo/fixture";
import { DEFAULT_FX, parseRate, type FxRates, type FxSource } from "@/lib/currency/fx";
import { getRiksbankRates, type RiksbankRates } from "@/lib/currency/riksbank";
import { defaultFx, emptyMoneyBase } from "./seed";
import type { MoneyIngestPayload, MoneySnapshot } from "./types";
import { MAX_MONEY_ROWS } from "./parse-ingest";
import {
  effectiveRows,
  normalizeOverlay,
  upsertById,
  type MoneyOverlay,
} from "./overlay";
import {
  applyMoneyAction,
  keepChanges,
  keepEverydayChange,
  keepSellChange,
  keepSubscriptionChange,
  type MoneyActionOutcome,
  type MoneyActionRequest,
} from "./actions";

const KEY = "money-overlay";

export async function getMoneyOverlay(): Promise<MoneyOverlay> {
  return normalizeOverlay(await durableGetJson<MoneyOverlay>(KEY));
}

export async function applyMoneyIngest(
  payload: MoneyIngestPayload,
): Promise<MoneySnapshot> {
  if (isDemoMode()) return getMoneySnapshot();
  const now = new Date().toISOString();
  await durableUpdateJson<MoneyOverlay>(KEY, (disk) => {
    const overlay = normalizeOverlay(disk);
    mergeMoneyIngest(overlay, payload, now);
    overlay.subscriptions = overlay.subscriptions.slice(-MAX_MONEY_ROWS);
    overlay.everyday = overlay.everyday.slice(-MAX_MONEY_ROWS);
    overlay.taxItems = overlay.taxItems.slice(-MAX_MONEY_ROWS);
    overlay.sell = overlay.sell.slice(-MAX_MONEY_ROWS);
    overlay.updatedAt = now;
    return overlay;
  });
  return getMoneySnapshot();
}

/**
 * Merge an agent ingest into the overlay. Rows replace stored rows by id,
 * except that a dashboard change (paid, cancelled, sold) survives an agent
 * row that would undo it; see keep*Change in ./actions.
 */
export function mergeMoneyIngest(
  overlay: MoneyOverlay,
  payload: MoneyIngestPayload,
  now = new Date().toISOString(),
): void {
  if (payload.reportedBy) overlay.reportedBy = payload.reportedBy;
  if (typeof payload.usdToSek === "number" && payload.usdToSek > 0) {
    overlay.usdToSek = payload.usdToSek;
    overlay.usdToSekAt = now;
  }
  if (typeof payload.eurToSek === "number" && payload.eurToSek > 0) {
    overlay.eurToSek = payload.eurToSek;
    overlay.eurToSekAt = now;
  }

  const subscriptions = payload.subscriptions
    ? keepChanges(overlay.subscriptions, payload.subscriptions, keepSubscriptionChange)
    : undefined;
  const everyday = payload.everyday
    ? keepChanges(overlay.everyday, payload.everyday, keepEverydayChange)
    : undefined;
  const sell = payload.sell ? keepChanges(overlay.sell, payload.sell, keepSellChange) : undefined;

  if (payload.replace) {
    overlay.replaceAll = true;
    if (subscriptions) overlay.subscriptions = subscriptions;
    if (everyday) overlay.everyday = everyday;
    if (payload.taxItems) overlay.taxItems = payload.taxItems;
    if (sell) overlay.sell = sell;
  } else {
    if (subscriptions?.length) {
      overlay.subscriptions = upsertById(overlay.subscriptions, subscriptions);
    }
    if (everyday?.length) {
      overlay.everyday = upsertById(overlay.everyday, everyday);
    }
    if (payload.taxItems?.length) {
      overlay.taxItems = upsertById(overlay.taxItems, payload.taxItems);
    }
    if (sell?.length) {
      overlay.sell = upsertById(overlay.sell, sell);
    }
  }
}

/**
 * Run one dashboard action (mark a bill paid, cancel a subscription, mark a
 * sale sold or paid) as an atomic update of the overlay.
 */
export async function runMoneyAction(req: MoneyActionRequest): Promise<MoneyActionOutcome> {
  if (isDemoMode()) return { status: "invalid", error: "Demo mode is read-only" };
  const now = new Date().toISOString();
  const seed = emptyMoneyBase();
  // `update` may run more than once; the last run is the one that landed.
  let outcome = { status: "not-found" } as MoneyActionOutcome;
  await durableUpdateJson<MoneyOverlay>(KEY, (disk) => {
    const result = applyMoneyAction(normalizeOverlay(disk), seed, req, now);
    outcome = result.outcome;
    return result.next;
  });
  return outcome;
}

/** Riksbank rates count from the end of their day (UTC), see moneyFx. */
function riksbankTime(date: string): number {
  return Date.parse(`${date}T23:59:59Z`);
}

function pickRate(
  envRate: number | undefined,
  agentRate: number | undefined,
  agentAt: string | undefined,
  riksbankRate: number | undefined,
  riksbankAt: number,
  fallback: number,
): { value: number; source: FxSource } {
  if (envRate) return { value: envRate, source: "env" };
  if (agentRate && riksbankRate) {
    const at = agentAt ? Date.parse(agentAt) : Number.NaN;
    return Number.isFinite(at) && at > riksbankAt
      ? { value: agentRate, source: "agent" }
      : { value: riksbankRate, source: "riksbank" };
  }
  if (agentRate) return { value: agentRate, source: "agent" };
  if (riksbankRate) return { value: riksbankRate, source: "riksbank" };
  return { value: fallback, source: "default" };
}

const SOURCE_ORDER: FxSource[] = ["env", "agent", "riksbank", "default"];

/**
 * The rates every money total uses, chosen per currency:
 * 1. MONEY_USD_SEK_RATE / MONEY_EUR_SEK_RATE in env always win.
 * 2. Otherwise the newer of the agent's rate and Riksbanken's. Riksbank
 *    rates count from the end of their day (UTC), so an agent rate sent
 *    that day or earlier loses to them; one sent the next day wins until
 *    Riksbanken publishes again. An agent rate with no time (stored before
 *    times were kept) is older than any Riksbank rate.
 * 3. Otherwise the built-in default.
 */
export function moneyFx(
  overlay: Pick<MoneyOverlay, "usdToSek" | "eurToSek" | "usdToSekAt" | "eurToSekAt">,
  riksbank?: RiksbankRates | null,
): FxRates {
  const rbAt = riksbank ? riksbankTime(riksbank.date) : Number.NaN;
  const usd = pickRate(
    parseRate(process.env.MONEY_USD_SEK_RATE),
    overlay.usdToSek,
    overlay.usdToSekAt,
    riksbank?.usdToSek,
    rbAt,
    DEFAULT_FX.usdToSek,
  );
  const eur = pickRate(
    parseRate(process.env.MONEY_EUR_SEK_RATE),
    overlay.eurToSek,
    overlay.eurToSekAt,
    riksbank?.eurToSek,
    rbAt,
    DEFAULT_FX.eurToSek,
  );
  const fx: FxRates = {
    usdToSek: usd.value,
    eurToSek: eur.value,
    source: SOURCE_ORDER.find((s) => s === usd.source || s === eur.source) ?? "default",
  };
  if (usd.source !== eur.source) fx.sources = { usd: usd.source, eur: eur.source };
  if (riksbank && (usd.source === "riksbank" || eur.source === "riksbank")) {
    fx.riksbankDate = riksbank.date;
  }
  return fx;
}

export async function getMoneySnapshot(): Promise<MoneySnapshot> {
  if (isDemoMode()) {
    return buildSnapshot({
      fx: defaultFx(),
      ...demoMoneyParts(),
      updatedAt: new Date().toISOString(),
    });
  }
  const seed = emptyMoneyBase();
  const overlay = await getMoneyOverlay();
  // Stored rates only; a stale copy refreshes in the background.
  const fx = moneyFx(overlay, await getRiksbankRates());

  const subscriptions = effectiveRows(overlay.subscriptions, seed.subscriptions, overlay.replaceAll);
  const everyday = effectiveRows(overlay.everyday, seed.everyday, overlay.replaceAll);
  const taxItems = effectiveRows(overlay.taxItems, seed.taxItems, overlay.replaceAll);
  const sell = effectiveRows(overlay.sell, seed.sell, overlay.replaceAll);

  return buildSnapshot({
    updatedAt: overlay.subscriptions.length ||
      overlay.everyday.length ||
      overlay.taxItems.length ||
      overlay.sell.length
      ? overlay.updatedAt
      : new Date().toISOString(),
    fx,
    subscriptions,
    everyday,
    taxItems,
    sell,
    reportedBy: overlay.reportedBy,
  });
}

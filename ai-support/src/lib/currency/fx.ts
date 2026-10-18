/**
 * Currencies the dashboard can show and convert between. SEK is the home
 * currency: money totals are kept in SEK, costs arrive in USD, and the
 * viewer picks which one everything is shown in.
 */
export type Currency = "SEK" | "USD" | "EUR";

export const CURRENCIES: readonly Currency[] = ["SEK", "USD", "EUR"];

export const DEFAULT_CURRENCY: Currency = "SEK";

/**
 * Where a rate came from: pinned in env, sent by an agent, Riksbanken's
 * daily rate, or the built-in default.
 */
export type FxSource = "env" | "agent" | "riksbank" | "default";

/** Kronor per unit of foreign currency. */
export interface FxRates {
  usdToSek: number;
  eurToSek: number;
  /**
   * Where the rates came from. When USD and EUR come from different places,
   * this is the first of env, agent, riksbank, default, and `sources` has
   * each one.
   */
  source?: FxSource;
  /** Set only when USD and EUR come from different places. */
  sources?: { usd: FxSource; eur: FxSource };
  /** Day (YYYY-MM-DD) of the Riksbank rates, when a rate came from Riksbanken. */
  riksbankDate?: string;
}

export const DEFAULT_FX: FxRates = { usdToSek: 10.5, eurToSek: 11.5, source: "default" };

export function isCurrency(value: unknown): value is Currency {
  return value === "SEK" || value === "USD" || value === "EUR";
}

function rate(currency: Currency, fx: Pick<FxRates, "usdToSek" | "eurToSek">): number {
  if (currency === "USD") return fx.usdToSek;
  if (currency === "EUR") return fx.eurToSek;
  return 1;
}

export function toSek(
  amount: number,
  from: Currency,
  fx: Pick<FxRates, "usdToSek" | "eurToSek">,
): number {
  return amount * rate(from, fx);
}

export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  fx: Pick<FxRates, "usdToSek" | "eurToSek">,
): number {
  if (from === to) return amount;
  return toSek(amount, from, fx) / rate(to, fx);
}

const LOCALE: Record<Currency, string> = {
  // Swedish formatting for kronor and euro ("1 234 kr", "12 €"), US style for dollars.
  SEK: "sv-SE",
  EUR: "sv-SE",
  USD: "en-US",
};

/**
 * Format an amount. `decimals` defaults to 0 for kronor and 2 for small
 * dollar or euro amounts (under 100), so "$0.40/d" stays readable.
 */
export function formatCurrency(
  amount: number,
  currency: Currency,
  decimals?: number,
): string {
  const digits =
    decimals ?? (currency === "SEK" ? (Math.abs(amount) < 10 && amount !== 0 ? 2 : 0) : Math.abs(amount) < 100 ? 2 : 0);
  return new Intl.NumberFormat(LOCALE[currency], {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/** Short label for where a rate came from, e.g. "from Riksbanken, 2026-10-16". */
export function fxSourceLabel(source: FxSource | undefined, riksbankDate?: string): string {
  if (source === "riksbank") {
    return riksbankDate ? `from Riksbanken, ${riksbankDate}` : "from Riksbanken";
  }
  if (source === "agent") return "from agent";
  if (source === "env") return "from settings";
  return "default";
}

/** "Rates: 1 USD = 9,90 kr · 1 EUR = 11,15 kr (from Riksbanken, 2026-10-16)". */
export function describeFxRates(fx: FxRates): string {
  const usd = `1 USD = ${formatCurrency(fx.usdToSek, "SEK", 2)}`;
  const eur = `1 EUR = ${formatCurrency(fx.eurToSek, "SEK", 2)}`;
  if (fx.sources) {
    return `Rates: ${usd} (${fxSourceLabel(fx.sources.usd, fx.riksbankDate)}) · ${eur} (${fxSourceLabel(fx.sources.eur, fx.riksbankDate)})`;
  }
  return `Rates: ${usd} · ${eur} (${fxSourceLabel(fx.source, fx.riksbankDate)})`;
}

/** A positive, sane exchange rate, or undefined. */
export function parseRate(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1000 ? n : undefined;
}

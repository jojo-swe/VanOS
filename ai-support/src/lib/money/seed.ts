import { demoEveryday, demoSell, demoSubscriptions, demoTax } from "@/lib/demo/fixture";
import { isDemoMode } from "@/lib/security/config";
import { DEFAULT_FX, parseRate, toSek as fxToSek, type FxRates } from "@/lib/currency/fx";
import type { MoneyCurrency, MoneySnapshot, Subscription } from "./types";

/**
 * Exchange rates from env (MONEY_USD_SEK_RATE, MONEY_EUR_SEK_RATE), else
 * built-in defaults. The demo uses these; live snapshots add agent and
 * Riksbank rates through moneyFx in ./store.
 */
export function defaultFx(): FxRates {
  const usd = parseRate(process.env.MONEY_USD_SEK_RATE);
  const eur = parseRate(process.env.MONEY_EUR_SEK_RATE);
  return {
    usdToSek: usd ?? DEFAULT_FX.usdToSek,
    eurToSek: eur ?? DEFAULT_FX.eurToSek,
    source: usd || eur ? "env" : "default",
  };
}

export function defaultUsdToSek() {
  return defaultFx().usdToSek;
}

export function toSek(amount: number, currency: MoneyCurrency, fx: FxRates): number {
  return fxToSek(amount, currency, fx);
}

export function monthlySek(
  amount: number,
  currency: MoneyCurrency,
  cadence: Subscription["cadence"],
  fx: FxRates,
): number {
  const sek = toSek(amount, currency, fx);
  if (cadence === "monthly") return sek;
  if (cadence === "weekly") return sek * (52 / 12);
  return sek / 12;
}

/**
 * Starting rows. The public demo shows sample rows; production starts empty
 * and real figures arrive through ingest (and never go into git).
 */
export function seedSubscriptions(): Subscription[] {
  return isDemoMode() ? demoSubscriptions() : [];
}

export function seedEveryday() {
  return isDemoMode() ? demoEveryday() : [];
}

export function seedTax() {
  return isDemoMode() ? demoTax() : [];
}

export function seedSell() {
  return isDemoMode() ? demoSell() : [];
}

export function emptyMoneyBase(): Pick<
  MoneySnapshot,
  "subscriptions" | "everyday" | "taxItems" | "sell" | "usdToSek" | "eurToSek" | "currency"
> {
  const fx = defaultFx();
  return {
    currency: "SEK",
    usdToSek: fx.usdToSek,
    eurToSek: fx.eurToSek,
    subscriptions: seedSubscriptions(),
    everyday: seedEveryday(),
    taxItems: seedTax(),
    sell: seedSell(),
  };
}

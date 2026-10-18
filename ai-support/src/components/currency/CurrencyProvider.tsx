"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  DEFAULT_FX,
  convert,
  formatCurrency,
  isCurrency,
  type Currency,
  type FxRates,
} from "@/lib/currency/fx";

/** localStorage key for the viewer's display currency (a per-browser choice). */
export const CURRENCY_STORAGE_KEY = "vanos-currency";
const CHANGE_EVENT = "vanos-currency-change";

function readStored(): Currency {
  try {
    const v = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    return isCurrency(v) ? v : DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

type FormatOptions = { decimals?: number; per?: string };

interface CurrencyContextValue {
  currency: Currency;
  fx: FxRates;
  setCurrency: (next: Currency) => void;
  /** Convert from `from` into the chosen currency and format it. */
  format: (amount: number, from: Currency, options?: FormatOptions) => string;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: DEFAULT_CURRENCY,
  fx: DEFAULT_FX,
  setCurrency: () => {},
  format: (amount, from, options) =>
    formatCurrency(convert(amount, from, DEFAULT_CURRENCY, DEFAULT_FX), DEFAULT_CURRENCY, options?.decimals) +
    (options?.per ?? ""),
});

export function CurrencyProvider({
  fx,
  children,
}: {
  fx?: FxRates;
  children: ReactNode;
}) {
  // Server render and hydration use SEK; a stored choice applies right after.
  const currency = useSyncExternalStore(subscribe, readStored, () => DEFAULT_CURRENCY);
  const rates = fx ?? DEFAULT_FX;

  const setCurrency = useCallback((next: Currency) => {
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
    } catch {
      /* private mode: the choice lasts until reload */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      fx: rates,
      setCurrency,
      format: (amount, from, options) =>
        formatCurrency(convert(amount, from, currency, rates), currency, options?.decimals) +
        (options?.per ?? ""),
    }),
    [currency, rates, setCurrency],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  return useContext(CurrencyContext);
}

/**
 * An amount in the chosen currency. With `showOriginal`, an amount that was
 * converted also shows what it was ("129 kr · $12").
 */
export function Amount({
  value,
  from,
  per,
  decimals,
  showOriginal = false,
  className,
}: {
  value: number;
  from: Currency;
  per?: string;
  decimals?: number;
  showOriginal?: boolean;
  className?: string;
}) {
  const { currency, format } = useCurrency();
  const shown = format(value, from, { decimals, per });
  const original = formatCurrency(value, from, decimals) + (per ?? "");
  const converted = from !== currency;
  return (
    <span className={className} title={converted ? `${original} (converted)` : undefined}>
      {shown}
      {converted && showOriginal ? (
        <span className="ml-1 text-xs font-normal text-[var(--muted-fg)]">· {original}</span>
      ) : null}
    </span>
  );
}

export function CurrencyToggle({ idPrefix }: { idPrefix: string }) {
  const { currency, setCurrency } = useCurrency();

  function move(from: Currency, direction: 1 | -1) {
    const index = CURRENCIES.indexOf(from);
    const next = CURRENCIES[(index + direction + CURRENCIES.length) % CURRENCIES.length];
    setCurrency(next);
    document.getElementById(`${idPrefix}-${next}`)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Currency"
      className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--surface)]/80 p-0.5"
    >
      {CURRENCIES.map((option) => {
        const selected = currency === option;
        return (
          <button
            key={option}
            id={`${idPrefix}-${option}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setCurrency(option)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(option, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(option, -1);
              }
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              selected
                ? "bg-[var(--ink)] text-[var(--bg)]"
                : "text-[var(--muted-fg)] hover:text-[var(--ink)]"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

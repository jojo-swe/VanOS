import { z } from "zod";

/** A trimmed, non-empty string of at most `max` characters. */
export const text = (max: number) => z.string().trim().min(1).max(max);

/** An optional string of at most `max` characters. Longer values reject the item. */
export const optText = (max: number) => z.string().max(max).optional();

/** A finite number (zod 4 rejects NaN and Infinity). */
export const amount = z.number();

export const nonNegative = z.number().min(0);

export const health = z.enum(["ok", "warn", "error", "idle"]);

/**
 * An array whose invalid items are dropped instead of failing the whole
 * request, capped at `max` items. Agents keep their old behaviour (bad rows
 * are skipped) and nothing malformed reaches the store.
 */
export function validItems<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(z.unknown())
    .max(max, `At most ${max} items`)
    .transform((rows) =>
      rows.flatMap((row) => {
        const parsed = item.safeParse(row);
        return parsed.success ? [parsed.data as z.output<T>] : [];
      }),
    );
}

/** Keep only the items of a stored array that still match `item`. */
export function keepValid<T extends z.ZodType>(item: T, rows: unknown): z.output<T>[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const parsed = item.safeParse(row);
    return parsed.success ? [parsed.data as z.output<T>] : [];
  });
}

/** One readable line from a zod error, naming the first failing field. */
export function describeError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid payload";
  const where = issue.path.length ? issue.path.join(".") : "body";
  return `${where}: ${issue.message}`;
}

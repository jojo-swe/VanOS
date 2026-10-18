/** Constant-time string compare (Edge-safe, no Node crypto). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length, 1);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0;
}

/** Compare against every candidate so a miss does not return early. */
export function timingSafeEqualAny(
  presented: string,
  expected: readonly string[],
): boolean {
  let matched = 0;
  for (const token of expected) {
    if (timingSafeEqualString(presented, token)) matched = 1;
  }
  return matched === 1;
}

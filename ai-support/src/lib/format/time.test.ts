import assert from "node:assert/strict";
import test from "node:test";
import { formatClock, formatDateTime, formatRelative } from "./time";

const iso = "2026-10-17T12:05:00.000Z";

test("formatDateTime uses Swedish format in the given zone", () => {
  assert.equal(formatDateTime(iso, "Europe/Stockholm"), "2026-10-17 14:05");
  assert.equal(formatDateTime(iso, "UTC"), "2026-10-17 12:05");
});

test("formatClock shows hours and minutes", () => {
  assert.equal(formatClock(iso, "Europe/Stockholm"), "14:05");
});

test("invalid or missing dates format as empty", () => {
  assert.equal(formatDateTime("not a date"), "");
  assert.equal(formatDateTime(undefined), "");
  assert.equal(formatRelative(null, Date.now()), "");
});

test("formatRelative steps from minutes to dates", () => {
  const now = Date.parse(iso);
  assert.equal(formatRelative(now - 10_000, now), "just now");
  assert.equal(formatRelative(now + 30_000, now), "just now");
  assert.equal(formatRelative(now - 5 * 60_000, now), "5 min ago");
  assert.equal(formatRelative(now - 3 * 3_600_000, now), "3 h ago");
  assert.equal(formatRelative(now - 2 * 86_400_000, now), "2 d ago");
  assert.equal(
    formatRelative(now - 10 * 86_400_000, now, "UTC"),
    "2026-10-07 12:05",
  );
});

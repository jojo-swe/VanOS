import assert from "node:assert/strict";
import test from "node:test";
import {
  NAV_GROUPS,
  SECTION_LABEL,
  isSection,
  sectionBadges,
  sectionHref,
} from "./sections";

test("every section appears in exactly one menu group", () => {
  const listed = NAV_GROUPS.flatMap((g) => g.items);
  assert.equal(new Set(listed).size, listed.length);
  assert.deepEqual([...listed].sort(), Object.keys(SECTION_LABEL).sort());
});

test("isSection accepts known ids only", () => {
  assert.equal(isSection("costs"), true);
  assert.equal(isSection("constructor"), false);
  assert.equal(isSection("__proto__"), false);
  assert.equal(isSection(["costs"]), false);
  assert.equal(isSection(undefined), false);
});

test("sectionHref keeps Overview on the plain URL", () => {
  assert.equal(sectionHref("overview"), "/dashboard");
  assert.equal(sectionHref("money"), "/dashboard?s=money");
});

test("sectionBadges counts open alerts and turns red on any error", () => {
  const badges = sectionBadges([
    { severity: "warn", section: "money" },
    { severity: "error", section: "money" },
    { severity: "warn", section: "costs" },
    { severity: "ok", section: "costs" },
    { severity: "error" },
  ]);
  assert.deepEqual(badges.money, { count: 2, tone: "error" });
  assert.deepEqual(badges.costs, { count: 1, tone: "warn" });
  assert.equal(badges.bots, undefined);
});

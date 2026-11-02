import assert from "node:assert/strict";
import test from "node:test";
import { finishDashboard, needsAttention, rankAlerts } from "./alerts";
import { dashboardData } from "./data";
import type { Alert } from "./types";

function alert(id: string, severity: Alert["severity"], at?: string): Alert {
  return { id, severity, title: id, body: "", at };
}

test("rankAlerts puts broken first, then attention, idle, fine", () => {
  const ranked = rankAlerts([
    alert("ok", "ok"),
    alert("idle", "idle"),
    alert("warn", "warn"),
    alert("error", "error"),
  ]);
  assert.deepEqual(
    ranked.map((a) => a.id),
    ["error", "warn", "idle", "ok"],
  );
});

test("rankAlerts sorts newest first within a severity and keeps order otherwise", () => {
  const ranked = rankAlerts([
    alert("old", "warn", "2026-10-01T00:00:00Z"),
    alert("undated", "warn"),
    alert("new", "warn", "2026-10-17T00:00:00Z"),
    alert("undated-2", "warn"),
  ]);
  assert.deepEqual(
    ranked.map((a) => a.id),
    ["new", "old", "undated", "undated-2"],
  );
});

test("rankAlerts cuts after sorting so errors are never dropped", () => {
  const many = Array.from({ length: 30 }, (_, i) => alert(`ok-${i}`, "ok"));
  const ranked = rankAlerts([...many, alert("broken", "error")], 5);
  assert.equal(ranked.length, 5);
  assert.equal(ranked[0].id, "broken");
});

test("rankAlerts drops duplicate ids", () => {
  const ranked = rankAlerts([alert("a", "warn"), alert("a", "error")]);
  assert.equal(ranked.length, 1);
});

test("needsAttention keeps only broken and attention", () => {
  const list = [alert("a", "ok"), alert("b", "warn"), alert("c", "error"), alert("d", "idle")];
  assert.deepEqual(
    needsAttention(list).map((a) => a.id),
    ["b", "c"],
  );
});

test("finishDashboard makes the agents tile match the agent list", () => {
  const data = finishDashboard(dashboardData);
  const tile = data.pulse.find((p) => p.id === "agents-online");
  assert.ok(tile);
  const ok = data.agents.filter((a) => a.status === "ok").length;
  const attention = data.agents.filter(
    (a) => a.status === "warn" || a.status === "error",
  ).length;
  assert.equal(tile.value, `${ok} / ${data.agents.length}`);
  if (attention) {
    assert.equal(tile.note, `${attention} need attention`);
    assert.notEqual(tile.status, "ok");
  }
});

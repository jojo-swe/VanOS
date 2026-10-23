import { getBridgeState } from "@/lib/bots/store";
import { isDemoMode } from "@/lib/security/config";
import { getGrokBotTargets, isIngestConfigured, publicTargetView } from "@/lib/bots/config";
import { getConnectionsSnapshot } from "@/lib/connections/store";
import { categoryTotals, getCostSnapshot } from "@/lib/costs/store";
import { getDashboardData } from "@/lib/dashboard/data";
import { getDfSnapshot } from "@/lib/displayfusion/store";
import { getHaSnapshot } from "@/lib/homeassistant/store";
import { getMoneySnapshot } from "@/lib/money/store";

/** Full Mission Control state for agents */
export async function getAgentSnapshot() {
  const [dashboard, costs, money, connections, bots, homeassistant, displayfusion] =
    await Promise.all([
      getDashboardData(),
      getCostSnapshot(),
      getMoneySnapshot(),
      getConnectionsSnapshot(),
      getBridgeState(),
      getHaSnapshot(),
      getDfSnapshot(),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    version: "1",
    dashboard,
    costs: {
      ...costs,
      byCategoryDaily: categoryTotals(costs.lines),
    },
    money,
    connections,
    homeassistant,
    displayfusion,
    bots: {
      targets: publicTargetView(getGrokBotTargets()),
      ingestConfigured: isDemoMode() ? false : isIngestConfigured(),
      state: bots,
    },
  };
}

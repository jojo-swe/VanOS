import type { LifeItem } from "@/lib/dashboard/types";
import type {
  ConnectionMeta,
  ConnectionsSnapshot,
  DriveSnapshot,
  GithubSnapshot,
  JoplinSnapshot,
  MailSnapshot,
  NotionSnapshot,
} from "@/lib/connections/types";
import type {
  EverydayTxn,
  SellListing,
  Subscription,
  TaxItem,
} from "@/lib/money/types";

/**
 * Fictional sample data for VANOS_DEMO_MODE and for the default seeds.
 * A made-up operator, generic tasks, and round numbers. Nothing here is a
 * real person, household, or account.
 */
export const DEMO_PERSONA = {
  name: "Alex Rivera",
  role: "Sample operator",
} as const;

function isoDaysFromNow(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

export function demoLifeItems(): LifeItem[] {
  return [
    {
      id: "l1",
      area: "focus",
      title: "Pick sample goals for the week",
      detail: `${DEMO_PERSONA.name} — three generic outcomes, written down.`,
      priority: "now",
    },
    {
      id: "l2",
      area: "money",
      title: "Review the sample subscription list",
      detail: "Round figures only. Mark one sample service to pause.",
      priority: "now",
    },
    {
      id: "l3",
      area: "admin",
      title: "File the sample receipts folder",
      detail: "Placeholder documents. Not a real ledger.",
      priority: "soon",
    },
    {
      id: "l4",
      area: "focus",
      title: "Draft a sample launch checklist",
      detail: "Ten generic steps. No live systems attached.",
      priority: "someday",
    },
  ];
}

export function demoSubscriptions(): Subscription[] {
  return [
    {
      id: "sub-editor",
      name: "Sample editor",
      provider: "Example Tools",
      category: "ai",
      amount: 20,
      currency: "USD",
      cadence: "monthly",
      status: "active",
      nextBilling: isoDaysFromNow(12),
      note: "Fictional seat for the public demo",
    },
    {
      id: "sub-models",
      name: "Sample model credits",
      provider: "Example Models",
      category: "ai",
      amount: 10,
      currency: "USD",
      cadence: "monthly",
      status: "active",
      note: "Round top-up. Not a live bill",
    },
    {
      id: "sub-hosting",
      name: "Sample hosting",
      provider: "Example Host",
      category: "hosting",
      amount: 0,
      currency: "USD",
      cadence: "monthly",
      status: "active",
      note: "Free-tier placeholder",
    },
    {
      id: "sub-domain",
      name: "Sample domain",
      provider: "Example Registrar",
      category: "domain",
      amount: 200,
      currency: "SEK",
      cadence: "yearly",
      status: "active",
      nextBilling: isoDaysFromNow(90),
      note: "Round yearly figure",
    },
    {
      id: "sub-code",
      name: "Sample code host",
      provider: "Example Forge",
      category: "productivity",
      amount: 0,
      currency: "USD",
      cadence: "monthly",
      status: "active",
      note: "Placeholder repository host",
    },
    {
      id: "sub-music",
      name: "Sample music",
      provider: "Example Audio",
      category: "media",
      amount: 100,
      currency: "SEK",
      cadence: "monthly",
      status: "active",
      nextBilling: isoDaysFromNow(5),
    },
    {
      id: "sub-video",
      name: "Sample video",
      provider: "Example Video",
      category: "media",
      amount: 100,
      currency: "SEK",
      cadence: "monthly",
      status: "cancel-soon",
      nextBilling: isoDaysFromNow(8),
      cancelBy: isoDaysFromNow(6),
      note: "Sample candidate to pause",
    },
    {
      id: "sub-storage",
      name: "Sample storage",
      provider: "Example Cloud",
      category: "productivity",
      amount: 50,
      currency: "SEK",
      cadence: "monthly",
      status: "active",
    },
    {
      id: "sub-notes",
      name: "Sample notes",
      provider: "Example Notes",
      category: "productivity",
      amount: 0,
      currency: "USD",
      cadence: "monthly",
      status: "needed",
      note: "Upgrade only in the sample story",
    },
  ];
}

export function demoEveryday(): EverydayTxn[] {
  return [
    {
      id: "ev-stipend",
      kind: "income",
      label: "Sample stipend",
      amount: 20000,
      currency: "SEK",
      category: "work",
      recurring: true,
      note: "Round fictional income",
    },
    {
      id: "ev-revenue",
      kind: "income",
      label: "Sample product revenue",
      amount: 0,
      currency: "SEK",
      category: "business",
      recurring: true,
      note: "Still zero in the sample",
    },
    {
      id: "ev-rent",
      kind: "bill",
      label: "Sample rent",
      amount: 8000,
      currency: "SEK",
      due: isoDaysFromNow(10),
      paid: false,
      recurring: true,
      category: "housing",
    },
    {
      id: "ev-food",
      kind: "expense",
      label: "Sample groceries",
      amount: 3000,
      currency: "SEK",
      recurring: true,
      category: "food",
    },
    {
      id: "ev-transit",
      kind: "expense",
      label: "Sample transport",
      amount: 1000,
      currency: "SEK",
      recurring: true,
      category: "transport",
    },
    {
      id: "ev-phone",
      kind: "bill",
      label: "Sample phone",
      amount: 300,
      currency: "SEK",
      due: isoDaysFromNow(3),
      paid: false,
      recurring: true,
      category: "utilities",
    },
    {
      id: "ev-electric",
      kind: "bill",
      label: "Sample electricity",
      amount: 500,
      currency: "SEK",
      due: isoDaysFromNow(18),
      paid: false,
      recurring: true,
      category: "utilities",
    },
    {
      id: "ev-buffer",
      kind: "buffer",
      label: "Sample cash buffer",
      amount: 5000,
      currency: "SEK",
      category: "buffer",
      note: "Round fictional reserve",
    },
  ];
}

export function demoTax(): TaxItem[] {
  const year = new Date().getUTCFullYear();
  return [
    {
      id: "tax-software",
      year,
      kind: "expense",
      label: "Sample software",
      amount: 500,
      currency: "SEK",
      date: `${year}-03-01`,
      forBusiness: true,
      note: "Sample receipt. Not a real invoice.",
      receipt: "example-tools",
    },
    {
      id: "tax-editor",
      year,
      kind: "expense",
      label: "Sample editor seat",
      amount: 200,
      currency: "SEK",
      date: `${year}-02-01`,
      forBusiness: true,
      note: "Round figure for the sample books",
    },
    {
      id: "tax-domain",
      year,
      kind: "expense",
      label: "Sample domain",
      amount: 200,
      currency: "SEK",
      date: `${year}-01-15`,
      forBusiness: true,
    },
    {
      id: "tax-sales",
      year,
      kind: "income",
      label: "Sample second-hand sales",
      amount: 0,
      currency: "SEK",
      date: `${year}-01-01`,
      forBusiness: false,
      note: "Placeholder. No marketplace account is connected.",
    },
  ];
}

export function demoSell(): SellListing[] {
  return [
    {
      id: "sell-lamp",
      title: "Sample lamp",
      channel: "other",
      stage: "idea",
      askPrice: 500,
      currency: "SEK",
      taxRelevant: false,
      note: "Fictional listing",
    },
    {
      id: "sell-shelf",
      title: "Sample bookshelf",
      channel: "other",
      stage: "listed",
      askPrice: 1000,
      currency: "SEK",
      listedAt: isoDaysFromNow(-4),
      taxRelevant: false,
      note: "Two sample watchers",
    },
    {
      id: "sell-books",
      title: "Sample book lot",
      channel: "other",
      stage: "negotiating",
      askPrice: 200,
      currency: "SEK",
      listedAt: isoDaysFromNow(-10),
      taxRelevant: false,
    },
    {
      id: "sell-speaker",
      title: "Sample speaker",
      channel: "other",
      stage: "sold",
      askPrice: 800,
      soldPrice: 800,
      fees: 100,
      currency: "SEK",
      listedAt: isoDaysFromNow(-20),
      soldAt: isoDaysFromNow(-2),
      taxRelevant: false,
      note: "Sample payout, not a real sale",
    },
  ];
}

export function demoMoneyParts(): {
  subscriptions: Subscription[];
  everyday: EverydayTxn[];
  taxItems: TaxItem[];
  sell: SellListing[];
} {
  return {
    subscriptions: demoSubscriptions(),
    everyday: demoEveryday(),
    taxItems: demoTax(),
    sell: demoSell(),
  };
}

export function demoConnectionList(): ConnectionMeta[] {
  return [
    {
      id: "gmail",
      name: "Sample mail",
      kind: "mail",
      wire: "mcp-ready",
      mcpAvailable: true,
      detail: "Fictional inbox. Nothing is fetched.",
    },
    {
      id: "github",
      name: "Sample code host",
      kind: "code",
      wire: "mcp-ready",
      mcpAvailable: true,
      detail: "Sample repositories only. No live git host is called.",
      lastSync: hoursAgo(2),
    },
    {
      id: "notion",
      name: "Sample notes",
      kind: "notes",
      wire: "mcp-ready",
      mcpAvailable: true,
      detail: "Sample pages. No workspace is connected.",
    },
    {
      id: "slack",
      name: "Sample chat",
      kind: "chat",
      wire: "missing",
      mcpAvailable: false,
      detail:
        "Sample chat. No workspace is connected. A webhook or bot token marks it live outside the demo.",
    },
    {
      id: "joplin",
      name: "Sample notebook",
      kind: "notes",
      wire: "ingest-only",
      mcpAvailable: false,
      detail: "Local placeholder. No vault is mounted.",
    },
    {
      id: "gdrive",
      name: "Sample drive",
      kind: "files",
      wire: "mcp-ready",
      mcpAvailable: true,
      detail: "Sample files. No drive account is linked.",
    },
    {
      id: "onedrive",
      name: "Sample second drive",
      kind: "files",
      wire: "missing",
      mcpAvailable: false,
      detail: "Not connected in the sample.",
    },
    {
      id: "homeassistant",
      name: "Sample home",
      kind: "home",
      wire: "missing",
      mcpAvailable: false,
      detail: "Sample home panel. No house is contacted.",
    },
    {
      id: "displayfusion",
      name: "Sample desktop",
      kind: "desktop",
      wire: "missing",
      mcpAvailable: false,
      detail: "Sample layout button. No desktop bridge is called.",
    },
  ];
}

export function demoMail(): MailSnapshot {
  return {
    unread: 3,
    important: 1,
    threads: [
      {
        id: "m1",
        from: DEMO_PERSONA.name,
        subject: "Sample weekly plan",
        snippet: "Three generic tasks. This mailbox is fictional.",
        when: "1h ago",
        unread: true,
        important: true,
        label: "sample",
      },
      {
        id: "m2",
        from: "Example Host",
        subject: "Sample deployment finished",
        snippet: "The sample preview is ready. No project was deployed.",
        when: "3h ago",
        unread: true,
        label: "sample",
      },
      {
        id: "m3",
        from: "Example Billing",
        subject: "Sample receipt",
        snippet: "A round number for the demo. Not a real invoice.",
        when: "Yesterday",
        unread: true,
        label: "billing",
      },
    ],
  };
}

export function demoGithub(): GithubSnapshot {
  return {
    repos: [
      {
        id: "r-sample",
        name: "demo/mission-control",
        private: false,
        openPrs: 1,
        openIssues: 0,
        ci: "ok",
        lastPush: "today",
        note: "Fictional repository",
      },
      {
        id: "r-notes",
        name: "demo/sample-notes",
        private: false,
        openPrs: 0,
        openIssues: 2,
        ci: "idle",
        lastPush: "last week",
        note: "Second fictional repository",
      },
    ],
    prs: [
      {
        id: "pr-7",
        repo: "demo/mission-control",
        title: "Sample: mobile layout",
        number: 7,
        author: "demo",
        ci: "ok",
        updated: "today",
        url: "https://example.com/demo/mission-control/pull/7",
      },
    ],
  };
}

export function demoNotion(): NotionSnapshot {
  return {
    connected: false,
    note: "Sample pages. No notes workspace is connected.",
    pages: [
      {
        id: "n1",
        title: "Sample ops page",
        kind: "page",
        updated: "—",
        space: "Sample",
      },
      {
        id: "n2",
        title: "Sample calendar",
        kind: "database",
        updated: "—",
        space: "Sample",
      },
    ],
  };
}

export function demoJoplin(): JoplinSnapshot {
  return {
    connected: false,
    noteCount: 0,
    note: "Sample notebook. No local notes app is connected.",
    notes: [
      {
        id: "j1",
        title: "Sample project checklist",
        notebook: "Sample",
        updated: "—",
        tags: ["sample"],
      },
      {
        id: "j2",
        title: "Sample model tiers",
        notebook: "Sample",
        updated: "—",
        tags: ["ops"],
      },
    ],
  };
}

export function demoGdrive(): DriveSnapshot {
  return {
    provider: "gdrive",
    note: "Sample files. No drive is connected.",
    files: [
      {
        id: "d1",
        name: "Sample brief.gdoc",
        mime: "document",
        modified: "5d ago",
        path: "/Sample",
      },
      {
        id: "d2",
        name: "Sample receipts",
        mime: "folder",
        modified: "2d ago",
        path: "/Sample",
        shared: false,
      },
      {
        id: "d3",
        name: "Sample photos",
        mime: "folder",
        modified: "1d ago",
        path: "/Sample",
      },
    ],
  };
}

export function demoConnectionsSnapshot(): Omit<
  ConnectionsSnapshot,
  "alerts" | "updatedAt"
> {
  return {
    connections: demoConnectionList(),
    mail: demoMail(),
    github: demoGithub(),
    notion: demoNotion(),
    joplin: demoJoplin(),
    gdrive: demoGdrive(),
  };
}

import type { BotBridgeState } from "@/lib/bots/types";
import type { GithubIntegrationSnapshot } from "@/lib/github/types";
import type { HaSnapshot } from "@/lib/homeassistant/types";
import type { DfSnapshot } from "@/lib/displayfusion/types";
import type { NotionIntegrationSnapshot } from "@/lib/notion/types";
import type { ObsidianIntegrationSnapshot, ObsidianNote } from "@/lib/obsidian/types";
import type { SlackIntegrationSnapshot } from "@/lib/slack/types";

const AT = "2026-10-16T12:00:00.000Z";

export function sampleGithubSnapshot(): GithubIntegrationSnapshot {
  return {
    updatedAt: AT,
    configured: true,
    owner: "demo",
    status: "ok",
    detail: "Sample data. This demo does not call GitHub.",
    repoCount: 1,
    reposScanned: 1,
    openPrs: [
      {
        repo: "demo/vanos",
        number: 7,
        title: "Sample: mobile layout for Mission Control",
        author: "demo",
        url: "https://example.com/demo/mission-control",
        updatedAt: AT,
      },
    ],
    commits: [
      {
        repo: "demo/vanos",
        sha: "a1b2c3d4e5f6",
        message: "Sample commit. Not from a live repository.",
        author: "demo",
        url: "https://example.com/demo/mission-control",
        committedAt: AT,
      },
    ],
    failingRuns: [],
    cached: false,
  };
}

export function sampleNotionSnapshot(): NotionIntegrationSnapshot {
  return {
    updatedAt: AT,
    configured: true,
    status: "ok",
    detail: "Sample data. This demo does not call Notion.",
    statusProperty: "Status",
    doneValue: "Done",
    rows: [
      {
        id: "sample-notion-1",
        databaseId: "sample-db",
        databaseTitle: "Sample board",
        title: "Sample task — fund the first van month",
        status: "In progress",
        editedAt: AT,
      },
    ],
    databases: [{ id: "sample-db", title: "Sample board", openCount: 1 }],
    cached: false,
  };
}

export function sampleSlackSnapshot(): SlackIntegrationSnapshot {
  return {
    updatedAt: AT,
    configured: true,
    status: "ok",
    detail: "Sample data. This demo does not call Slack.",
    workspace: "Sample workspace",
    channels: [
      {
        id: "C0SAMPLE01",
        name: "mission-control",
        messages: [
          {
            ts: "1760000000.000100",
            author: "Muddy",
            text: "Daily digest posted — 3 PRs open, costs under budget.",
            at: AT,
            replies: 0,
          },
        ],
      },
    ],
    notifications: false,
    notifyLevel: "errors",
    cached: false,
  };
}

const SAMPLE_NOTES: ObsidianNote[] = [
  {
    path: "sample/welcome.md",
    title: "Welcome to the sample vault",
    updatedAt: AT,
    excerpt: "This note is fake. Obsidian is not connected.",
    source: "vault",
  },
  {
    path: "sample/road.md",
    title: "Sample road notes",
    updatedAt: AT,
    excerpt: "A placeholder page for the public demo.",
    source: "vault",
  },
];

export function sampleObsidianSnapshot(query?: string | null): ObsidianIntegrationSnapshot {
  const q = (query ?? "").trim().slice(0, 200);
  const base = {
    updatedAt: AT,
    configured: true,
    vaultConfigured: false,
    apiConfigured: false,
    cached: false,
  };
  if (q && q.length < 2) {
    return {
      ...base,
      status: "warn",
      detail: "Type at least 2 characters to search notes.",
      mode: "search",
      query: q,
      notes: [],
    };
  }
  const notes = q
    ? SAMPLE_NOTES.filter((note) =>
        `${note.title} ${note.excerpt} ${note.path}`.toLowerCase().includes(q.toLowerCase()),
      )
    : SAMPLE_NOTES;
  return {
    ...base,
    status: "ok",
    detail: "Sample notes. This demo does not read a vault or call Obsidian.",
    mode: q ? "search" : "recent",
    query: q || null,
    notes,
  };
}

export function sampleHaSnapshot(): HaSnapshot {
  return {
    updatedAt: AT,
    configured: true,
    reachable: false,
    entities: [
      {
        entityId: "light.sample_desk",
        state: "off",
        friendlyName: "Sample desk lamp",
        domain: "light",
      },
    ],
    recentCalls: [],
    status: "ok",
    detail: "Sample data. Home Assistant is not contacted.",
  };
}

export function sampleDfSnapshot(): DfSnapshot {
  return {
    updatedAt: AT,
    configured: false,
    scripts: [
      {
        id: "sample-coding",
        name: "Sample coding layout",
        command: "sample-only",
        description: "Not sent to a Windows bridge.",
      },
    ],
    recentRuns: [],
    status: "idle",
    detail: "Sample data. DisplayFusion is not contacted.",
  };
}

export function sampleBridgeState(): BotBridgeState {
  return {
    updatedAt: AT,
    events: [
      {
        id: "sample-evt-muddy",
        botId: "muddy",
        botName: "Muddy",
        type: "status",
        title: "Sample heartbeat",
        body: "Fake status for the public demo.",
        summary: "Sample heartbeat. No bot is connected.",
        status: "ok",
        focus: "Showing the demo dashboard",
        receivedAt: AT,
        timestamp: AT,
      },
    ],
    dispatches: [],
    latestByBot: {
      muddy: {
        id: "sample-evt-muddy",
        botId: "muddy",
        botName: "Muddy",
        type: "status",
        title: "Sample heartbeat",
        body: "Fake status for the public demo.",
        summary: "Sample heartbeat. No bot is connected.",
        status: "ok",
        focus: "Showing the demo dashboard",
        receivedAt: AT,
        timestamp: AT,
      },
    },
  };
}

import type { HealthStatus } from "@/lib/dashboard/types";

export interface GithubPullRequest {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  updatedAt: string;
}

export interface GithubCommit {
  repo: string;
  sha: string;
  message: string;
  author: string;
  url: string;
  committedAt: string;
}

export interface GithubWorkflowFailure {
  repo: string;
  name: string;
  branch: string;
  url: string;
  conclusion: string;
  updatedAt: string;
}

export interface GithubIntegrationSnapshot {
  updatedAt: string;
  configured: boolean;
  owner: string | null;
  status: HealthStatus;
  detail: string;
  repoCount: number;
  reposScanned: number;
  openPrs: GithubPullRequest[];
  commits: GithubCommit[];
  failingRuns: GithubWorkflowFailure[];
  cached: boolean;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** Fine-grained personal access token. Missing means the integration stays off. */
export function getGithubToken(): string | undefined {
  return env("GITHUB_TOKEN");
}

/** Repository owner. Defaults to jojo-swe when unset. */
export function getGithubOwner(): string {
  return env("GITHUB_OWNER") || "jojo-swe";
}

export function isGithubConfigured(): boolean {
  return Boolean(getGithubToken());
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export function githubOwnerProblem(owner: string): string | null {
  if (!OWNER_RE.test(owner)) {
    return "GITHUB_OWNER must be a GitHub login (letters, numbers, and hyphens).";
  }
  return null;
}

# CI

## GitHub Actions

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It lints, tests, builds, and runs the security smoke check in `ai-support/`.

Dependabot (`.github/dependabot.yml`) opens weekly updates for npm and GitHub Actions.

Security smoke locally:

```bash
cd ai-support && npm run smoke:security
```

## CodeRabbit

CodeRabbit needs the GitHub App installed on VanOS.

`.coderabbit.yaml` sets the review language to Swedish (`sv-SE`) and the profile to `chill`. Automatic review is enabled for the base branch `main` and skips draft pull requests. Lockfiles are excluded: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, and `**/*.lock`. Poems are off, and CodeRabbit does not request changes when comments are resolved.

## Devin

Devin needs the repository secret `DEVIN_API_KEY` and the Devin GitHub integration.

Add the `devin` label to a pull request to start a review. `.github/workflows/devin.yml` runs only when the person who added that label is the repository owner. The workflow does not check out pull request code. It asks Devin to review the pull request for bugs and security, comment the findings, and not push or merge. It posts the session URL as a pull request comment, then removes the `devin` label.

The same workflow can be started with `workflow_dispatch` (`prompt`, and `max_acu` which defaults to 2). That path is limited to the repository owner as well. A repeated request with the same prompt returns the existing session (`idempotent: true`).

If `DEVIN_API_KEY` is missing, the workflow comments on the pull request, removes the label, and finishes without failing the check.

Create the label once (repo admin):

```bash
gh label create devin --repo jojo-swe/VanOS --description "Ask Devin to review this pull request" --color 1D76DB
```

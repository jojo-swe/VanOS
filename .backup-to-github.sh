#!/bin/bash
# VanOS Auto-Backup to GitHub
# Backs up main workspace + all agent workspaces

set -e
export PATH="$HOME/.local/bin:$PATH"

TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")
# Paths come from the environment (OPENCLAW_HOME, VANOS_WORKSPACE,
# VANOS_AGENTS_DIR, VANOS_LOCAL_BACKUP_DIR), so the same script works in the
# Docker image and in a native install. Defaults are relative to $HOME.
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
WORKSPACE="${VANOS_WORKSPACE:-$OPENCLAW_HOME/workspace}"
AGENTS_DIR="${VANOS_AGENTS_DIR:-$OPENCLAW_HOME/agents}"
BRANCH="main"

cd "$WORKSPACE"

# Only main is ever backed up or pushed. Any other branch (for example a local
# old-history branch that still holds the personal files) is refused.
current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" != "$BRANCH" ]; then
    echo "❌ Backup stopped: on branch $current, expected $BRANCH. Nothing was committed." >&2
    exit 1
fi

# The main agent's SOUL.md, USER.md, MEMORY.md and memory/ are gitignored
# (they hold real personal data), so git no longer backs them up. Keep
# dated local tarballs outside the repo instead, newest 30 kept. Copy this
# folder off the machine now and then: it is the only backup they have.
LOCAL_BACKUP_DIR="${VANOS_LOCAL_BACKUP_DIR:-$OPENCLAW_HOME/backups/main-agent}"
PERSONAL=()
for p in SOUL.md USER.md MEMORY.md memory; do
    [ -e "$p" ] && PERSONAL+=("$p")
done
if [ ${#PERSONAL[@]} -gt 0 ]; then
    mkdir -p "$LOCAL_BACKUP_DIR"
    chmod 700 "$LOCAL_BACKUP_DIR"
    STAMP=$(date -u +"%Y%m%d-%H%M%S")
    tar -czf "$LOCAL_BACKUP_DIR/main-agent-$STAMP.tar.gz" "${PERSONAL[@]}"
    chmod 600 "$LOCAL_BACKUP_DIR/main-agent-$STAMP.tar.gz"
    ls -1t "$LOCAL_BACKUP_DIR"/main-agent-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
    echo "Local backup of main agent files: $LOCAL_BACKUP_DIR/main-agent-$STAMP.tar.gz"
fi

# Local copy of every agent workspace in agents-backup/. The folder is
# gitignored and blocked by the privacy guard: it stays on this machine and
# is never committed or pushed.
mkdir -p agents-backup
for agent_dir in "$AGENTS_DIR"/*/workspace; do
    [ -d "$agent_dir" ] || continue
    agent_name=$(basename $(dirname "$agent_dir"))
    echo "Backing up agent: $agent_name"
    rm -rf "agents-backup/$agent_name"
    mkdir -p "agents-backup/$agent_name"
    # Copy files but exclude .git directories
    find "$agent_dir" -mindepth 1 -maxdepth 1 ! -name ".git" -exec cp -r {} "agents-backup/$agent_name/" \; 2>/dev/null || true
done

# Stage all changes (agents-backup/ and personal files are gitignored)
git add -A

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo "No changes to backup"
    exit 0
fi

# Refuse to push anything that looks like a secret or personal data. Agents
# can write any file into their workspace. On a hit, unstage
# everything and stop: nothing is committed or pushed.
abort_backup() {
    echo "❌ Backup stopped: $1" >&2
    echo "   Nothing was committed. Remove the file or secret, then rerun." >&2
    git reset -q
    exit 1
}

SENSITIVE_FILES=$(git diff --staged --name-only --diff-filter=AM \
    | grep -Ei '(^|/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519)[^/]*|credentials(\.json)?|service-account[^/]*\.json)$' \
    | grep -Ev '(^|/)\.env\.example$' || true)
if [ -n "$SENSITIVE_FILES" ]; then
    abort_backup "secret-looking files staged:
$SENSITIVE_FILES"
fi

if command -v gitleaks >/dev/null 2>&1; then
    if ! gitleaks protect --staged --redact --config .gitleaks.toml; then
        abort_backup "gitleaks found a possible secret in the staged changes"
    fi
else
    echo "⚠️  gitleaks not installed; using the built-in pattern check" >&2
    SECRET_PATTERNS='sk-[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
    if git diff --staged -U0 --no-color | grep -E '^\+' | grep -Eq "$SECRET_PATTERNS"; then
        abort_backup "a staged line matches a known API key or private key pattern"
    fi
fi

# Same check as CI: the main agent's personal files and personal keywords
# must never reach the repo. Stopping here beats a red CI after the push.
# The guard is mandatory: without it, nothing is committed or pushed.
if [ ! -f scripts/privacy-guard.sh ]; then
    abort_backup "scripts/privacy-guard.sh is missing"
fi
if ! bash scripts/privacy-guard.sh; then
    abort_backup "privacy guard found personal files or keywords"
fi

# Create commit with timestamp
CHANGES=$(git diff --staged --name-status | wc -l)
git commit -m "🔄 Auto-backup: $TIMESTAMP

$CHANGES files changed in the main workspace"

# Push to GitHub
# Push only main, with an explicit refspec: never other branches or tags.
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
    echo "❌ Push stopped: not on $BRANCH." >&2
    exit 1
fi
git push origin "refs/heads/$BRANCH:refs/heads/$BRANCH" 2>&1

echo "✅ Backup complete: $TIMESTAMP ($CHANGES changes)"

#!/usr/bin/env bash
# One-time move of the live OpenClaw workspace from the archived history
# (jojo-swe/VanOS-old-history) to the new jojo-swe/VanOS history.
#
# Nothing on disk is deleted or overwritten. The main agent's SOUL.md,
# USER.md, MEMORY.md and memory/ stay where they are; afterwards they are
# simply untracked and gitignored. The old history stays reachable in a
# local branch called old-history.
#
# Usage: bash scripts/move-workspace-to-new-history.sh [workspace-dir]
#        (default $VANOS_WORKSPACE, else $OPENCLAW_HOME/workspace)
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
WORKSPACE="${1:-${VANOS_WORKSPACE:-$OPENCLAW_HOME/workspace}}"
BACKUP_DIR="${VANOS_LOCAL_BACKUP_DIR:-$OPENCLAW_HOME/backups/main-agent}"
cd "$WORKSPACE"
git rev-parse --is-inside-work-tree >/dev/null

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
    echo "Expected branch main, found $branch. Switch to main first." >&2
    exit 1
fi

# 1. Safety copy of the main agent's personal files, before anything else.
PERSONAL=()
for p in SOUL.md USER.md MEMORY.md memory; do
    [ -e "$p" ] && PERSONAL+=("$p")
done
if [ ${#PERSONAL[@]} -gt 0 ]; then
    mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
    snap="$BACKUP_DIR/before-history-move-$(date -u +%Y%m%d-%H%M%S).tar.gz"
    tar -czf "$snap" "${PERSONAL[@]}"
    chmod 600 "$snap"
    echo "Saved ${PERSONAL[*]} to $snap"
fi

# 2. Fetch the new history and make sure it really is the new one.
git fetch origin main
if ! git cat-file -e "FETCH_HEAD:scripts/privacy-guard.sh" 2>/dev/null; then
    echo "origin/main does not look like the new history (no scripts/privacy-guard.sh)." >&2
    echo "Check: git remote get-url origin  (should be github.com/jojo-swe/VanOS)" >&2
    exit 1
fi
if git merge-base --is-ancestor HEAD FETCH_HEAD 2>/dev/null; then
    echo "Already on the new history. Nothing to do."
    exit 0
fi

# 3. Remember what the live agents changed since the last backup commit.
declare -A LOCAL=()
while IFS= read -r -d '' f; do
    LOCAL["$f"]=1
done < <(git diff --name-only -z HEAD)

# 4. Keep the old history reachable, then move the branch. --mixed resets
#    only the index, so nothing on disk is touched yet.
git branch -f old-history HEAD
git reset -q --mixed FETCH_HEAD
git branch --set-upstream-to=origin/main main >/dev/null

# 5. Files the agents did not touch take the new version (otherwise the next
#    backup would push the old content, or delete files new in this history).
#    Files the agents changed are kept as they are.
KEPT=()
while IFS= read -r -d '' f; do
    if [ -n "${LOCAL[$f]:-}" ]; then
        KEPT+=("$f")
    else
        git checkout -q -- "$f"
    fi
done < <(git diff --name-only -z)
if [ ${#KEPT[@]} -gt 0 ]; then
    echo "Kept local changes (check them before the next backup):"
    printf '  %s\n' "${KEPT[@]}"
fi

# 6. Check the personal files are still there and are now ignored.
for p in "${PERSONAL[@]}"; do
    if [ ! -e "$p" ]; then
        echo "MISSING after the move: $p (restore it from the tarball above)" >&2
        exit 1
    fi
    if ! git check-ignore -q "$p"; then
        echo "WARNING: $p is not ignored. Do not commit it." >&2
    fi
done

echo
echo "Done. The workspace now follows the new history."
echo "Differences from the new main (live agent changes the next backup will commit):"
git status --short | head -30
echo
echo "Old history: local branch old-history. The next .backup-to-github.sh run commits and pushes as usual."

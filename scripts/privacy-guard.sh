#!/usr/bin/env bash
# Fails if the main agent's personal files reach the repo.
# SOUL.md, USER.md, MEMORY.md, memory/ (except *.example.md) and agents-backup/
# are forbidden at any depth.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0

# Personal files at ANY depth: SOUL.md, USER.md, MEMORY.md, anything under a
# memory/ directory (except *.example.md templates), and agents-backup/.
# Only what git would commit counts: in the live workspace these files exist
# on disk on purpose (gitignored).
while IFS= read -r f; do
  base="${f##*/}"
  case "$f" in
    agents-backup/*|*/agents-backup/*)
      echo "::error file=$f::agents-backup/ must not be committed"; fail=1; continue ;;
  esac
  case "$base" in
    SOUL.md|USER.md|MEMORY.md)
      echo "::error file=$f::Personal file $base must not be committed (use ${base%.md}.example.md)"; fail=1; continue ;;
  esac
  case "/$f" in
    */memory/*.example.md) ;;
    */memory/*) echo "::error file=$f::Files under memory/ must not be committed"; fail=1 ;;
  esac
done < <(git ls-files)

# Personal keywords come from the PRIVACY_KEYWORDS secret (an extended regex), never from this file.
# A secret saved with a trailing newline or CRLF would add an empty alternative that matches every line,
# so drop CRs and blank lines and join the rest into one alternation. Without the secret the scan is skipped.
keywords=$(printf '%s' "${PRIVACY_KEYWORDS:-}" | tr -d '\r' | grep -v '^$' | paste -sd'|' - || true)
if [ -z "$keywords" ]; then
  echo "PRIVACY_KEYWORDS is not set: keyword scan skipped."
else
  # grep exits 2 on an invalid regex. Fail here instead of letting the suppressed grep below pass every file.
  rc=0
  printf '' | grep -E -- "$keywords" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "::error file=PRIVACY_KEYWORDS::PRIVACY_KEYWORDS is not a valid extended regex"; fail=1
  else
    hits=$(git ls-files -z \
      | grep -zv -E '^(scripts/privacy-guard\.sh|\.github/workflows/privacy-guard\.yml)$' \
      | xargs -0 -r grep -I -n -i -E "$keywords" -- 2>/dev/null | cut -d: -f1,2 || true)
    if [ -n "$hits" ]; then
      echo "Personal keywords found (file:line, text not shown):"
      echo "$hits" | while IFS= read -r h; do echo "::error file=${h%%:*},line=${h#*:}::Personal keyword"; done
      fail=1
    fi
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "Privacy guard failed."
  exit 1
fi
echo "Privacy guard passed."

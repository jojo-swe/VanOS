#!/usr/bin/env bash
# Fails if the main agent's personal files or personal keywords reach the repo.
# SOUL.md, USER.md, MEMORY.md, memory/ (except *.example.md) and agents-backup/
# are forbidden at any depth. The keyword scan skips the fictional demo fixture, the demo test
# that lists the same keywords, and this script.
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

pattern='adhd|kreditkris|credit crisis|\bkris\b|few friends|få vänner|12[ ,.]?000 ?(kr|sek)|johnjohansson81'
hits=$(git ls-files -z \
  | grep -zv -E '^(ai-support/src/lib/demo/fixture\.ts|ai-support/src/lib/demo/demo\.test\.ts|scripts/privacy-guard\.sh|\.github/workflows/privacy-guard\.yml)$' \
  | xargs -0 -r grep -I -n -i -E "$pattern" -- 2>/dev/null | cut -d: -f1,2 || true)
if [ -n "$hits" ]; then
  echo "Personal keywords found (file:line, text not shown):"
  echo "$hits" | while IFS= read -r h; do echo "::error file=${h%%:*},line=${h#*:}::Personal keyword"; done
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "Privacy guard failed."
  exit 1
fi
echo "Privacy guard passed."

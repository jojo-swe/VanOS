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

if [ "$fail" -ne 0 ]; then
  echo "Privacy guard failed."
  exit 1
fi
echo "Privacy guard passed."

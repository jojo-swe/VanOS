#!/bin/bash
set -e

agents="muddy elon gary warren atlas shield pixel pipeline probe quill thread digest script echo canvas-agent lens radar forge compass funnel signal bridge harbor beacon pulse"

for agent in $agents; do
  echo "Binding $agent to telegram..."
  openclaw agents bind --agent "$agent" --bind telegram --json 2>&1 | grep -v "Config overwrite" | tail -1 || true
done

echo ""
echo "All agents bound to Telegram!"

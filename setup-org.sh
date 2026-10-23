#!/bin/bash
set -e

# ============================================================
# PHASE 1 — Create C-Suite + All Department Agents
# ============================================================

MODEL="kilocode/anthropic/claude-opus-4.6"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
BASE="${VANOS_AGENTS_DIR:-$OPENCLAW_HOME/agents}"

declare -A AGENTS=(
  # C-Suite (Muddy already exists)
  ["elon"]="CTO"
  ["gary"]="CMO"
  ["warren"]="CRO"
  # CTO Department
  ["atlas"]="Backend Engineer"
  ["shield"]="Security Engineer"
  ["pixel"]="Frontend Engineer"
  ["pipeline"]="DevOps Engineer"
  ["probe"]="QA Engineer"
  # CMO Department
  ["quill"]="Blog Writer"
  ["thread"]="Social Media Manager"
  ["digest"]="Newsletter Writer"
  ["script"]="Video Scriptwriter"
  ["echo"]="SEO Specialist"
  ["canvas-agent"]="Graphic Designer"
  ["lens"]="Visual Strategist"
  ["radar"]="Market Intelligence Analyst"
  # CRO Department
  ["forge"]="Product Manager"
  ["compass"]="UX Researcher"
  ["funnel"]="Growth Hacker"
  ["signal"]="Analytics Engineer"
  ["bridge"]="Partnerships Manager"
  # Community (Direct to COO)
  ["harbor"]="Community Manager"
  ["beacon"]="Developer Relations"
  ["pulse"]="Support Lead"
)

declare -A EMOJIS=(
  ["elon"]="⚙️" ["gary"]="📣" ["warren"]="📊"
  ["atlas"]="🗺️" ["shield"]="🛡️" ["pixel"]="🎨" ["pipeline"]="🔧" ["probe"]="🔍"
  ["quill"]="✒️" ["thread"]="🧵" ["digest"]="📨" ["script"]="🎬" ["echo"]="🔊"
  ["canvas-agent"]="🖼️" ["lens"]="📷" ["radar"]="📡"
  ["forge"]="🔨" ["compass"]="🧭" ["funnel"]="⏳" ["signal"]="📶" ["bridge"]="🌉"
  ["harbor"]="⚓" ["beacon"]="🔦" ["pulse"]="💓"
)

declare -A DISPLAY_NAMES=(
  ["canvas-agent"]="Canvas"
)

for agent in "${!AGENTS[@]}"; do
  role="${AGENTS[$agent]}"
  emoji="${EMOJIS[$agent]}"
  display="${DISPLAY_NAMES[$agent]:-${agent^}}"

  echo "Creating agent: $agent ($role)..."

  # Create the agent
  openclaw agents add "$agent" \
    --workspace "$BASE/$agent/workspace" \
    --non-interactive \
    --model "$MODEL" \
    --json 2>&1 | tail -1

  # Set identity
  openclaw agents set-identity --agent "$agent" --name "$display" --emoji "$emoji" --json 2>&1 | tail -1

  # Create memory directory
  mkdir -p "$BASE/$agent/workspace/memory"

  echo "  ✓ $agent created"
done

echo ""
echo "All agents created. Setting up workspace files next..."

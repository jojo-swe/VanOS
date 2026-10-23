# ORG-CHART.md — VanOS Organization

_The complete organizational structure and agent registry._

---

## Hierarchy

```
🧑 CEO: Jojo (Human — Final Authority)
└── 🦬 COO: Muddy — Research · Delegation · Execution · Orchestration
    ├── ⚙️ CTO: Elon — Technical execution · Architecture · Code quality · Security
    │   ├── Backend & Security
    │   │   ├── 🗺️ Atlas (Backend Engineer)
    │   │   └── 🛡️ Shield (Security Engineer)
    │   ├── Frontend & DevOps
    │   │   ├── 🎨 Pixel (Frontend Engineer)
    │   │   └── 🔧 Pipeline (DevOps Engineer)
    │   └── QA
    │       └── 🔍 Probe (QA Engineer)
    │
    ├── 📣 CMO: Gary — Content strategy · Brand voice · Creative direction
    │   ├── Content
    │   │   ├── ✒️ Quill (Blog Writer)
    │   │   ├── 🧵 Thread (Social Media Manager)
    │   │   ├── 📨 Digest (Newsletter Writer)
    │   │   ├── 🎬 Script (Video Scriptwriter)
    │   │   └── 🔊 Echo (SEO Specialist)
    │   ├── Creative
    │   │   ├── 🖼️ Canvas (Graphic Designer)
    │   │   └── 📷 Lens (Visual Strategist)
    │   └── Intelligence
    │       └── 📡 Radar (Market Intelligence Analyst)
    │
    ├── 📊 CRO: Warren — Revenue ops · Growth metrics · Product-market fit
    │   ├── Products
    │   │   ├── 🔨 Forge (Product Manager)
    │   │   └── 🧭 Compass (UX Researcher)
    │   ├── Growth
    │   │   ├── ⏳ Funnel (Growth Hacker)
    │   │   └── 📶 Signal (Analytics Engineer)
    │   └── Partnerships
    │       └── 🌉 Bridge (Partnerships Manager)
    │
    └── Community (Direct to COO)
        ├── ⚓ Harbor (Community Manager)
        ├── 🔦 Beacon (Developer Relations)
        └── 💓 Pulse (Support Lead)
```

## Agent Registry

| Agent ID | Name | Role | Model | Reports To |
|----------|------|------|-------|------------|
| muddy | Muddy | COO | opus-4.6 | Jojo (CEO) |
| elon | Elon | CTO | opus-4.6 | Muddy |
| gary | Gary | CMO | opus-4.6 | Muddy |
| warren | Warren | CRO | opus-4.6 | Muddy |
| atlas | Atlas | Backend Engineer | sonnet-4.5 | Elon |
| shield | Shield | Security Engineer | sonnet-4.5 | Elon |
| pixel | Pixel | Frontend Engineer | sonnet-4.5 | Elon |
| pipeline | Pipeline | DevOps Engineer | sonnet-4.5 | Elon |
| probe | Probe | QA Engineer | sonnet-4.5 | Elon |
| quill | Quill | Blog Writer | sonnet-4.5 | Gary |
| thread | Thread | Social Media Manager | sonnet-4.5 | Gary |
| digest | Digest | Newsletter Writer | sonnet-4.5 | Gary |
| script | Script | Video Scriptwriter | sonnet-4.5 | Gary |
| echo | Echo | SEO Specialist | sonnet-4.5 | Gary |
| canvas-agent | Canvas | Graphic Designer | sonnet-4.5 | Gary |
| lens | Lens | Visual Strategist | sonnet-4.5 | Gary |
| radar | Radar | Market Intelligence | sonnet-4.5 | Gary |
| forge | Forge | Product Manager | sonnet-4.5 | Warren |
| compass | Compass | UX Researcher | sonnet-4.5 | Warren |
| funnel | Funnel | Growth Hacker | sonnet-4.5 | Warren |
| signal | Signal | Analytics Engineer | sonnet-4.5 | Warren |
| bridge | Bridge | Partnerships Manager | sonnet-4.5 | Warren |
| harbor | Harbor | Community Manager | sonnet-4.5 | Muddy |
| beacon | Beacon | Developer Relations | sonnet-4.5 | Muddy |
| pulse | Pulse | Support Lead | sonnet-4.5 | Muddy |

## Communication Protocol

- **Telegram gateway:** Muddy (COO) — all CEO comms route through Muddy
- **Inter-agent:** `sessions_send` with agent labels
- **Cron announcements:** Key meetings and reports announce to Telegram
- **Hierarchy enforced:** Agents can only spawn sessions with their direct reports + chief

## Cron Schedule

| Time (UTC) | Job | Agent | Frequency |
|------------|-----|-------|-----------|
| Every 2h | Market Intelligence | Radar | Continuous |
| Every 6h | Infra Health Check | Pipeline | Continuous |
| 06:00 | Security Scan | Shield | Daily |
| 09:00 | Content Pipeline Review | Gary | Daily |
| 09:30 | Executive Standup | Muddy | Daily |
| 10:00 | Community Pulse | Harbor | Daily |
| Mon 08:00 | Weekly Growth Report | Warren | Weekly |
| Mon 14:00 | Sprint Planning | Elon | Bi-weekly |
| Tue 11:00 | Content Strategy Sync | Gary | Weekly |
| Fri 15:00 | Weekly All-Hands | Muddy | Weekly |

---

_Updated: 2026-03-04_

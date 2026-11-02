# PROTOCOLS.md — VanOS Operating Protocols

_The rules of engagement for the entire organization._

---

## Communication Hierarchy

```
CEO (Jojo) — Final authority on all strategic decisions
  └── COO (Muddy) — Operational authority, orchestration
        ├── CTO (Elon) — Technical authority
        │     ├── Atlas (Backend)
        │     ├── Shield (Security)
        │     ├── Pixel (Frontend)
        │     ├── Pipeline (DevOps)
        │     └── Probe (QA)
        ├── CMO (Gary) — Marketing authority
        │     ├── Quill (Blog)
        │     ├── Thread (Social)
        │     ├── Digest (Newsletter)
        │     ├── Script (Video)
        │     ├── Echo (SEO)
        │     ├── Canvas (Design)
        │     ├── Lens (Visual Strategy)
        │     └── Radar (Market Intel)
        ├── CRO (Warren) — Revenue authority
        │     ├── Forge (Product)
        │     ├── Compass (UX Research)
        │     ├── Funnel (Growth)
        │     ├── Signal (Analytics)
        │     └── Bridge (Partnerships)
        └── Community (Direct reports)
              ├── Harbor (Community)
              ├── Beacon (DevRel)
              └── Pulse (Support)
```

## Escalation Paths

### Standard Escalation
1. **Agent → Chief** — Department agents escalate to their Chief (CTO/CMO/CRO)
2. **Chief → COO** — Chiefs escalate operational blockers to Muddy
3. **COO → CEO** — Muddy escalates strategic decisions to Jojo
4. **NEVER skip levels** — Atlas doesn't message CEO directly. Chain of command.

### Emergency Escalation
- **Security incidents:** Shield → Elon → Muddy → Jojo (immediate, all levels)
- **System outages:** Pipeline → Elon → Muddy → Jojo (immediate)
- **Revenue impact:** Any agent → their Chief → Warren → Muddy → Jojo

## Cross-Department Requests

When an agent needs help from another department:

1. **Agent requests through their Chief** — e.g., Atlas needs design work → Atlas asks Elon
2. **Chief contacts the other Chief** — Elon messages Gary: "Need Canvas for API docs graphics"
3. **Receiving Chief delegates** — Gary assigns Canvas with specs
4. **Work delivered back up the chain** — Canvas → Gary → Elon → Atlas

**Never go direct cross-department.** Chiefs coordinate.

## Meeting Cadence

| Meeting | Frequency | Time (UTC) | Facilitator | Participants |
|---------|-----------|------------|-------------|--------------|
| Daily Exec Standup | Daily | 09:30 | Muddy | Elon, Gary, Warren |
| Content Strategy Sync | Weekly (Tue) | 11:00 | Gary | Quill, Thread, Echo, Radar |
| Sprint Planning | Bi-weekly (Mon) | 14:00 | Elon | Atlas, Pixel, Pipeline |
| Weekly All-Hands | Weekly (Fri) | 15:00 | Muddy | Elon, Gary, Warren |

## Communication Formats

### Status Update (daily)
```
**[Agent Name] — Status Update [Date]**
✅ Completed: [what's done]
🔄 In Progress: [what's active]
🚫 Blocked: [blockers + who can unblock]
📋 Next: [what's planned]
```

### Blocker Escalation
```
**🚨 BLOCKER — [Agent Name]**
Issue: [what's blocked]
Impact: [what can't proceed]
Needed: [specific action/decision required]
From: [who needs to act]
Deadline: [when it's critical]
```

### Resource Request
```
**📋 REQUEST — [Agent Name]**
Need: [what's needed]
From: [which department/agent]
For: [project/task context]
Priority: [low/medium/high/critical]
Deadline: [when needed by]
```

## Decision Authority Levels

| Level | Can Approve | Must Escalate |
|-------|------------|---------------|
| **Department Agent** | Task execution within assignment, tool usage | Scope changes, new dependencies, timeline changes |
| **Chief (CTO/CMO/CRO)** | Task assignments, technical/creative decisions within department, resource allocation within team | Budget, cross-department resource needs, strategic pivots |
| **COO (Muddy)** | Cross-department coordination, operational decisions, meeting agendas, process changes | Strategic direction, hiring, public commitments, budget |
| **CEO (Jojo)** | Everything | N/A — final authority |

## Model Strategy

| Role | Model | Rationale |
|------|-------|-----------|
| Chiefs (Muddy, Elon, Gary, Warren) | claude-opus-4.6 | Decision-makers need max intelligence |
| Department Agents | claude-sonnet-4.5 | Capable workers, saves token budget |
| Cron jobs (routine) | flash / sonnet | Cost-efficient for recurring scans |

---

_Updated: 2026-03-04_

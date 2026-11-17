# HANDOVER.md

Överlämning mellan agenter och sessioner. Läs innan du börjar, uppdatera innan du slutar.

## Aktuellt läge

*Senast inventerat 2026-11-04 av Claude (Cowork).*

Projekt: **An autonomous AI company operating system — built to fund #vanlife.**

- Huvudbranch: `main`
- Senaste commit på `main`: 2026-11-02 `f5a190b` VanOS: clean public start
- Öppna PR:er: 7
- Andra brancher på remote: 7

## Pågående arbete

| Agent/vem | Branch | Status | Beskrivning |
|-----------|--------|--------|-------------|
| Claude (Claude Code) | `agent/claude/privacy-guard-keywords` | PR öppen (draft), 2026-11-17 | Privacy guard: nyckelord från secreten `PRIVACY_KEYWORDS`, normalisering av secreten, neutralt lönebelopp i `ai-support/MONEY.md` |
| app/dependabot | `dependabot/npm_and_yarn/ai-support/eslint-10.14.0` | PR #7 öppen, uppdaterad 2026-11-02 | chore(deps): bump eslint from 9.39.3 to 10.14.0 in /ai-support |
| app/dependabot | `dependabot/npm_and_yarn/ai-support/typescript-7.0.2` | PR #6 öppen, uppdaterad 2026-11-02 | chore(deps): bump typescript from 5.9.3 to 7.0.2 in /ai-support |
| app/dependabot | `dependabot/npm_and_yarn/ai-support/types/node-26.6.6` | PR #5 öppen, uppdaterad 2026-11-02 | chore(deps): bump @types/node from 20.19.35 to 26.6.6 in /ai-support |
| app/dependabot | `dependabot/npm_and_yarn/ai-support/development-minor-patch-74beeef66b` | PR #4 öppen, uppdaterad 2026-11-02 | chore(deps): bump eslint-config-next from 16.4.2 to 16.4.3 in /ai-support in the development-minor-patch group |
| app/dependabot | `dependabot/npm_and_yarn/ai-support/production-minor-patch-623335c07a` | PR #3 öppen, uppdaterad 2026-11-02 | chore(deps): bump the production-minor-patch group in /ai-support with 2 updates |
| app/dependabot | `dependabot/github_actions/actions/setup-node-7` | PR #2 öppen, uppdaterad 2026-11-02 | chore(ci): bump actions/setup-node from 4 to 7 |
| app/dependabot | `dependabot/github_actions/actions/checkout-7` | PR #1 öppen, uppdaterad 2026-11-02 | chore(ci): bump actions/checkout from 4 to 7 |

## Nästa steg

- Granska och besluta om de öppna PR:erna ovan (merga eller stäng).
- Fyll på "Bygga och testa" i AGENTS.md om något saknas eller är fel.

## Kända problem

- Inga dokumenterade ännu.

## Senaste commits

- 2026-11-02 `f5a190b` VanOS: clean public start

## Logg

| Datum | Agent | Vad som gjordes |
|-------|-------|-----------------|
| 2026-11-04 | Claude (Cowork) | Lade till AGENTS.md, HANDOVER.md och CLAUDE.md; inventerade PR:er, brancher och commits. |
| 2026-11-17 | Claude (Claude Code) | Privacy guard: personliga nyckelord läses från secreten `PRIVACY_KEYWORDS` (workflowen skickar den till steget), aldrig från en lista i repot. Secreten normaliseras (CR, tomma rader, avslutande radbrytning) och en ogiltig regex ger ett tydligt fel. Bytte exempellönen i `ai-support/MONEY.md` mot ett neutralt belopp. Verifierat lokalt i sex lägen; `npm test` och build kördes inte, ändringen rör bara bash, workflow och en doc-rad. |

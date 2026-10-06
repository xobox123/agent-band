# 001: UI screen specification (Lens style)

## Read first
- `docs/superpowers/specs/2026-10-06-agent-band-design.md` (whole file, especially "Domain model", "Audit" and "UI")
- `handoff/chatgpt/README.md`

## Goal
A precise screen specification that a frontend developer can implement
without asking questions. Visual reference: Lens, the Kubernetes IDE (dark
theme, icon rail, resource sidebar, dense tables, right details panel,
bottom dock with logs).

## Deliverable
`docs/ui/screens.md` (in English, because developers implement from it), containing:

1. Global layout: icon rail, sidebar sections and items, header, details
   panel, bottom dock. Sizes in px, behaviour on narrow windows
   (min width 1024 px).
2. For each screen (Board, Dashboard, Agents, Tasks, Runs, Policies, Accounts, Audit).
   The Board is a Jira-like kanban (see "Board" in the spec UI section) and
   the most important screen: specify columns, card anatomy, filters,
   swimlanes, drag and drop rules and live updates in detail. For every screen:
   - purpose in one sentence,
   - table columns (name, source field from the domain model, format, sortable yes/no),
   - toolbar actions and filters,
   - details panel content (sections and fields),
   - create/edit form fields with validation rules and help text,
   - empty state and error state texts.
3. Status vocabulary: every status from the domain model mapped to a dot colour
   token (`--ok`, `--warn`, `--crit`, `--muted`, `--text-dim`) and a label.
4. Agent details: how identity (handle, git identity), current policy and
   version, recent runs and audit history are shown.
5. Audit screen: filters, chain verification indicator, export button.
6. Keyboard shortcuts worth having (max 10).
7. A short list of things in Lens worth copying and things to avoid.

Use ASCII wireframes for the layout and for Dashboard and Agent details.

## Out of scope
Code, colours beyond the tokens named above, marketing copy.

## Report
`handoff/chatgpt/reports/001-report.md` per the template in the README.

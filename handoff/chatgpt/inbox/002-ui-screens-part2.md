# 002: UI screens part 2 (skills, groups, people) and decisions update

## Read first
- `docs/superpowers/specs/2026-10-06-agent-band-design.md` (current main; read "Domain model", "Authorization (humans)", "Policy engine", "Skills", "Research-driven decisions" and "Decisions from UI review")
- `docs/ui/screens.md` (your previous work, now merged)
- `handoff/chatgpt/README.md`

## Architect note on 001
Accepted and merged. Missing: the screens added at the end of task 001
(Skills, Agent groups, People and teams, extended Agent details). Answers to
your questions are in the spec section "Decisions from UI review".

## Goal
Bring `docs/ui/screens.md` to full coverage of the current spec.

## Deliverable
Edit `docs/ui/screens.md` (English):
1. New sections with the same structure as the existing ones (purpose,
   table columns with source fields, toolbar and filters, details panel,
   forms with validation and help text, empty and error states):
   - Skills (library, versions, assignments at org/group/agent level,
     import flow: zip upload, local path, git URL; content hash display;
     where-used view).
   - Agent groups (members, group policy, group skills, role bindings
     scoped to the group).
   - People and teams (users, teams, role bindings owner/admin/operator/
     viewer with scope; stage 1 shows the single local owner but the screens
     must work for many users).
2. Extend Agents details: persona, avatar, groups, effective policy table
   (each rule with the level that set it: org, group, agent, and whether the
   provider enforces it at runtime or only at admission), effective skills
   with versions and hashes, tool decisions (allowed/denied tool calls) in
   the run log.
3. Update the Board section for P0..P3 + rank, "no eligible agent" state,
   and SSE replay with Last-Event-ID.
4. Update section 12 (contract gaps): remove the items now decided, add any
   new gaps you find.
5. Keep the document consistent: sidebar order, status vocabulary,
   shortcuts.

## Out of scope
Code. Changes to any file other than `docs/ui/screens.md` and your report.

## Report
`handoff/chatgpt/reports/002-report.md` per the template in the README.

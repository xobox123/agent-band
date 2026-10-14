# agent-band: operator redesign of the web UI (mint direction)

Date: 2026-10-14. Requested by the product owner. Based on an Impeccable critique of `apps/web` (26/40, Acceptable), the Claude Design mockup "Agent Band Operator UI" and a reference screenshot chosen by the owner. The result is documented as a system in `docs/ui/design-system.md`.

## Goal

Make the existing UI faster to scan, more accessible and more distinctive, without changing behaviour. The surface is an operator tool: scanability and consistency outrank decoration. The look is dark first with a mint accent.

## Decisions

- Direction: mint. Dark theme is the default. A light theme with the same structure stays supported and meets the same contrast rules.
- Scope: the whole of `apps/web`, in phases (below). Behaviour, API and data layer do not change.
- Cards carry a state frame (new, running, rate limited, failed, done). Glow only on states that are live or need attention.
- No paired error and success tiles on the dashboard. The dashboard leads with account limits.

## Critique findings that shape the work

- Contrast failures: primary button 3.2:1, active link 4.1:1, muted text 3.5:1, limit rows 2.4 to 2.8:1, 11px chips and 9px avatar initials.
- No type scale, 9 radii, 9 font sizes, duplicated CSS blocks.
- Board cards carry up to 8 rows, status repeated in column, chip strip and card.
- Icon rail duplicates the sidebar and its glyphs are unlabeled.
- Dashboard totals are 13px labels, limits sit below trivial counts.

## Rules from the craft floor

No gradient text, no glass as decoration, no coloured side stripe on cards or nav, no zero-offset halo, no nested cards, real icons in one stroke weight. The mockup used an inset stripe on the active nav link and a left bar on running cards. Both are replaced by soft fills and frames.

## Phases

1. Foundation: tokens for both themes, bundled font, type and radius scales, buttons, badges, focus, selection and scrollbars. Fixes all measured contrast failures.
2. Shell: floating sidebar with icons and grouped sections, workspace header, removal of the icon rail.
3. Board: columns, state frames, three-row cards, New pill, list view, details panel.
4. Dashboard: limits (ring, weekly bar, reset), numbers with hierarchy, running list, next schedules. Charts only where the data exists.
5. Remaining screens (agents, accounts, audit, schedules, settings, policies and others): tables, forms, dialogs on the new tokens.
6. Verification: one batch of screenshots (1440px, both themes), one detector run, critique re-run, target 32/40 or higher.

Each phase ends with `npm run format:check`, `lint`, `typecheck` and `test` green, and is committed separately.

## Out of scope

- Command palette, legend popovers and keyboard card actions (critique P2 follow ups).
- Mobile layout. The 1024px minimum stays.
- Any change to `apps/server`, `packages/contracts`, routing or data sources. `apps/server/test/fixtures/*` is never touched.

## Risks

- Tests that assert removed rows, labels or the icon rail are updated with the change, never loosened.
- Manrope has different metrics from the system font. Dense grids (limit rows, tables) need a check.
- "New" needs a creation time on the card model. `createdAt` exists on tasks, so no API change is needed.
- Glow and frames must not hide the existing drop, selected and error outlines. State frame yields to selection.

# agent-band design system

Visual language of `apps/web`. Direction: operator tool, dark first, mint accent, soft rounded surfaces, hierarchy over decoration. Source of truth for tokens is `apps/web/src/theme/theme.css`; this document explains how to use them. Decisions and rationale: `docs/superpowers/specs/2026-10-14-web-operator-design.md`.

## Principles

1. Scan first. The screen answers "what is running, what is stuck, what needs me" before anything else.
2. State is shown by form, not by colour alone: text, shape or position always say the same thing as the colour.
3. One accent. Mint means "active or primary". Status colours are separate and never reused as accent.
4. Effects are functional. A glow or tinted frame marks a state (running, waiting, failed, new). It is never ornament.
5. Both themes are first class. Every colour is a token with a dark and a light value.

## Tokens

All colours come from CSS variables on `:root` and `:root[data-theme='light']`. Components never use literal colours.

### Surfaces and text

| Token                         | Role                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `--bg`                        | page background                                                  |
| `--panel`                     | recessed panel behind cards (board columns)                      |
| `--surface`                   | cards, sidebar, dialogs                                          |
| `--surface-2`                 | inputs, hover fills, segmented controls                          |
| `--surface-3`                 | pressed fills, avatars                                           |
| `--border`, `--border-strong` | hairlines, emphasised hairlines                                  |
| `--text`, `--text-dim`        | primary and secondary text, both at least 4.5:1 on every surface |
| `--muted`                     | decoration only (dividers, disabled glyphs). Never for text      |

### Accent and status

| Token                                      | Meaning                                   | Where                              |
| ------------------------------------------ | ----------------------------------------- | ---------------------------------- |
| `--accent`, `--accent-fg`, `--accent-soft` | primary action, active nav, running       | buttons, active link, running card |
| `--ok`                                     | done, healthy                             | done card frame, healthy badge     |
| `--warn`                                   | rate limited, near limit, needs attention | limited card frame, banners        |
| `--crit`                                   | failed, denied, blocked                   | failed card frame, errors          |
| `--new`                                    | newly created                             | new card frame and badge           |

Each status has a `-soft` fill (about 14 percent alpha) for badges and notes, and a text colour that passes 4.5:1 on that fill.

### Scales

| Scale   | Values                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type    | `--fs-xs` 11 (uppercase labels only), `--fs-sm` 12, `--fs` 13, `--fs-lg` 15, `--fs-xl` 20, `--fs-2xl` 26                                                   |
| Radius  | `--radius-sm` 6 (chips), `--radius` 10 (buttons, inputs, menus), `--radius-lg` 14 (cards), `--radius-xl` 20 (panels, sidebar), 999px for pills and avatars |
| Spacing | 4, 8, 12, 16, 24                                                                                                                                           |
| Font    | Manrope (variable, bundled with the app), `--mono` for ids, keys and logs. Numbers in columns use tabular figures                                          |

Page titles use `--fs-xl` or `--fs-2xl`, panel titles `--fs-lg` or 13px at 600, labels `--fs-sm` dim. Totals and key numbers are at least `--fs-xl`.

## Layout

- App shell: a floating sidebar card (`--radius-xl`) on the page background, content to its right. The icon rail is gone, the sidebar carries icons.
- Sidebar order: workspace switcher, search field, groups with an uppercase label (Workspace, Execution, Governance), footer with theme toggle. Active link has a soft accent fill and accent text, no side stripe.
- Page header: breadcrumb left, search centre, notifications and user right. Page title below it with a one-line summary.
- Minimum window width stays 1024px.

## Components

### Buttons

Primary: accent fill, `--accent-fg` text, 600 weight, one per view. Secondary: `--surface-2` fill with border. Danger: outlined in `--crit`, never filled. Icon button: transparent until hover. Height 32px (28px in dense toolbars), radius `--radius`.

### Badges and pills

Priority pill: P0 filled with the text colour, P1 accent soft, P2 and P3 outlined dim. Status badge: soft fill, status text colour, pill radius. Minimum text size 11px for pills, 12px otherwise.

### Cards (board)

A card has a frame colour that states its state:

| State          | Frame               | Extra                                                                     |
| -------------- | ------------------- | ------------------------------------------------------------------------- |
| New            | `--new`             | "New" pill next to the key, shown for the first 15 minutes after creation |
| Queued, draft  | `--border`          | none                                                                      |
| Running        | `--accent`          | soft glow                                                                 |
| Rate limited   | `--warn`            | soft glow, reason line in a warn soft note                                |
| Failed, denied | `--crit`            | soft glow, reason line in a crit soft note                                |
| Done           | `--ok` at low alpha | no glow                                                                   |

Rules: at most three rows for a typical card (key and priority, title, assignee and meta). A status line that repeats the column title is not shown. Errors and limit reasons are visible text. Glow uses an offset and a blur, never a zero-offset halo. Selection uses `--accent` with `--accent-soft` fill and replaces the state frame while selected.

### Columns and panels

Recessed `--panel` with a hairline, `--radius-xl`. Header: state dot, title, count pill. Drop targets keep the dashed outline (`ok` or `crit`).

### Tables and lists

Header row `--surface-2`, 12px dim, no uppercase except short labels. Row separators hairline. Numeric columns right aligned, tabular figures. Sort buttons keep a visible focus ring.

### Limits and usage

An account limit shows the 5 hour window as a ring with the percentage inside, the weekly window as a bar, and the reset time as text. Colour follows level: accent below 70 percent, `--warn` from 70, `--crit` from 90. The level is also stated in a badge (Healthy, Near limit, Rate limited).

### Charts

Stepped line over a faint grid, one highlighted bar for the selected or peak step, labels from tokens. A chart has a text alternative (`aria-label`) with the peak value.

## Interaction and accessibility

- Focus ring: 2px `--accent`, offset 2px, on every interactive element.
- Contrast: text 4.5:1, large text and UI boundaries 3:1, checked in both themes.
- Minimum target: 32px height for buttons and rows, 24px for dense controls with 8px spacing.
- Motion: only the details panel slide-in and a 120ms colour transition on hover. `prefers-reduced-motion` disables both.
- Selection, scrollbars and caret use palette colours (`accent-color`, `scrollbar-color`, `::selection`).

## What not to do

- No glass, blur or gradient fills on cards, no gradient text.
- No coloured side stripes on cards, list items or nav links.
- No nested cards. A card inside a panel is fine, a card inside a card is not.
- No new colour outside the tokens. Add a token first.
- No external font or CDN requests. The app runs locally and ships its font.

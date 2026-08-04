# NodeWarden Next — Phase 3a: Design System

**Issue:** #16 · **Depends on:** `02-ia-interaction-model.md`
**Canonical tokens:** `webapp/src/styles/next/tokens.css` (fork-owned, imported by nothing until slice 1 — zero effect on stock build)
**Date:** 2026-08-03

**Direction (owner directive, 2026-08-03):** precision developer-tool aesthetic — the class of Linear/Raycast/Vercel — explicitly **no editorial styling or themes**. The ICP is a developer/self-hoster who trusts instruments, not magazines. This cashes in the issue's "calm, heavy, precise" as *precision-tool calm*.

---

## 1. Principles

**Instrument, not editorial.** Every visual choice must earn its place functionally.
This means: no display/serif type, no decorative illustration, no themed "worlds," weight ceiling at 600, radius ceiling at 10px.
This does NOT mean: sterile. Weight and calm come from surface contrast, spacing discipline, and restraint.

**The query owns the light.** Visual hierarchy exists to serve the retrieval moment; nothing may compete with the search field and the highlighted result.
This means: one accent color, spent almost entirely on focus/selection; chrome is hairlines and muted ink.
This does NOT mean: everything else is illegible — secondary text still passes AA.

**Credentials are artifacts.** Data the user came for (passwords, usernames, codes, URIs) renders in monospace with tabular figures, visually distinct from UI chrome.
This means: `--nx-font-data` + `.nx-data` for every credential value, everywhere, no exceptions.
This does NOT mean: the whole UI is monospace.

**Focus is the flagship state.** In a keyboard-first product the focus/selection treatment is the brand.
This means: every interactive element has a visible 2-ring focus treatment (`--nx-focus-ring`); the highlighted result row is the most designed element in the system.
This does NOT mean: focus styling may be swapped for subtle-but-invisible alternatives.

**Accessible by default.** WCAG 2.2 AA is the floor; the stock `ConfirmDialog` focus behavior is the interaction bar.
This means: all ink-on-surface pairs verified ≥4.5:1 (computed, see §3); reduced-motion collapses all durations to 0.
This does NOT mean: a11y review waits until the end — it's in each slice's parity gate (issue requirement).

## 2. Coexistence architecture (merge-safety)

- Every token is namespaced `--nx-*` and scoped under a `.nw-next` root class. Stock tokens (`--panel`, `--line`, …) and skin overrides (`:root[data-skin='…']`) cannot reach Next surfaces, and Next cannot leak into stock.
- Dark mode reuses the existing signal: `:root[data-theme='dark'] .nw-next { … }`. The stock theme toggle drives both worlds; no new theme plumbing.
- Skins do not apply inside Next (they override stock names only). Recorded as intended behavior: Next *is* a design register, not a skinnable shell — revisit only if dogfooding demands it.
- New files only: `webapp/src/styles/next/` is the style home for all Next CSS.

## 3. Color

Two registers of the same graphite system. Light: white surfaces on a cool paper ground, soft shadows. Dark (the "heavy" register): near-black ground `#0c0e11`, elevation expressed as *surface lightness* instead of shadow, hairlines carry structure.

One accent — **vault steel blue** (`#2257c5` light / `#7aa5ff` dark) — spent on: focus ring, selected/highlighted row, primary button, active chip, TOTP countdown. Semantic trio: `ok` (copied/success), `warn` (weak), `danger` (breached/destructive), each with a `-soft` wash for badges and row states.

**Verified contrast (WCAG, computed 2026-08-03):**

| Pair | Light | Dark | Gate |
|---|---|---|---|
| ink / surface | 17.1 | 14.8 | AA ✓ (AAA) |
| ink-muted / surface | 5.9 | 7.0 | AA ✓ |
| accent / surface | 6.5 | 7.4 | AA ✓ |
| accent-ink / accent (buttons) | 6.5 | 8.0 | AA ✓ |
| ok · warn · danger / surface | 5.3–5.7 | 6.7–8.6 | AA ✓ |
| ink-faint / surface | 3.1 | 3.6 | **placeholder/incidental only** — never body text |

## 4. Typography

- **UI face: system stack** (`--nx-font-ui`), CJK fallbacks preserved for the 10-locale gate. Rationale: zero font payload, no FOUT, native rendering per OS, offline-PWA clean, and **no font CDN ever touches a password manager**. (Revisit note: if mockups read generic, self-hosting Inter variable is the one sanctioned upgrade — still no network fonts.)
- **Data face: `ui-monospace` stack** with `font-variant-numeric: tabular-nums` — TOTP countdowns and revealed passwords must not jitter.
- **Scale (7 steps, ceiling 24px):** 11 / 12.5 / 14 (default) / 16 / 19 (**the search query — this system's display type**) / 24 (unlock heading). Nothing larger exists; a vault does not have hero type.
- Weights 400/500/600 only. ALL-CAPS only for overline labels and badges, always with `--nx-tracking-caps`.

## 5. Space, shape, layout, elevation

- 4px base scale (`--nx-sp-*`). Key metrics: result row 44px, inputs/buttons 36px, search field 56px, retrieval column max 680px, detail side-panel breakpoint ~1100px (from `02-…md` §3).
- Radii 4/6/8/10 — one step tighter than stock everywhere; 10px is reserved for the shell container.
- Elevation: 3 levels. Light = shadow + hairline; dark = raised-surface lightness + hairline, shadows only for true overlays (menus, dialogs).

## 6. Motion

Three durations (80/140/220ms), one ease (`cubic-bezier(0.2,0,0,1)`), zero springs/bounce. Highlight movement is `--nx-dur-1` (must feel synchronous with the arrow key). The only "expressive" moment in the system is the **copied confirmation**: row flashes `ok-soft`, toast shows the auto-clear countdown. `prefers-reduced-motion` zeroes all durations via token override.

## 7. Foundational components (specs; anatomy finalized in 3b mockups)

| Component | Spec essentials |
|---|---|
| **Search field** | 56px, `--nx-text-xl`, inset ground (`--nx-inset`), no border until focus (focus ring), leading scope-chips render inside; placeholder in `ink-faint` |
| **Result row** | 44px: type icon (16px) · title (`md`/500) · username in `.nx-data` (`sm`, muted) · right-aligned badges (org, TOTP presence) — highlighted state: `accent-soft` wash + 2px accent left rail; copied state: `ok-soft` flash |
| **Hint bar** | `sm`, muted; `<kbd>` caps: 18px height, `xs` mono, `radius-sm`, hairline border, `inset` ground |
| **Button** | primary (accent), ghost (hairline), danger; 36px; focus ring; loading = label swap + spinner, never width change |
| **Field row** (detail/editor) | overline label (`xs` caps, muted) above value; credential values `.nx-data` `md`; reveal/copy affordances right-aligned, visible on row hover *and* row focus |
| **Generator well** | dashed-accent well under the password field: candidate (`.nx-data`) + strength badge + `⌘G` use/reroll + ⚙ rules disclosure. Rules row (site constraints): words/characters segmented switch, length stepper, character-class toggles (A-Z, 0-9, symbols, no-ambiguous). Any rule change rerolls instantly; rules persist per session; logic reuses stock `password-generator.ts` |
| **Dialog** | `radius-lg`, `shadow-3`, overlay `--nx-overlay`; must match stock `ConfirmDialog` focus behavior (trap, restore, Enter/Esc) |
| **Toast** | bottom-center above hint bar; copied variant carries auto-clear countdown ("Password copied · clears in 30s") |
| **Chip** (scope) | 24px, `radius-sm`, `accent-soft`/`accent-line` when active; removable with Backspace per `02-…md` §3 |
| **Action menu** (Tab) | `surface-raised`, `shadow-2`; same row mechanics as results — one list idiom everywhere |
| **Select / multi-select** | the single styled idiom from issue #16's evidence comment — no native popover chrome anywhere in Next |

## 8. Deliverable map

- `webapp/src/styles/next/tokens.css` — canonical, live.
- Phase 3b: `docs/nodewarden-next/mockups/*.html` link the canonical file directly (relative path) — one source of truth; iterating tokens re-skins every mockup.
- Slice 1 wires `tokens.css` into the app via the V2 entry (new-file import; one-line hook at the shell mount only).

# NodeWarden Next — Slice 4 (Dashboard-First + Palette Modal) Implementation Plan

> Executing inline (superpowers:executing-plans). Owner directive 2026-08-04 (overrides doc 02 §3's palette-as-shell): **the primary surface is a full mouse-first dashboard**; the palette becomes a **⌘K modal** — the two are complementary. "Most beautiful tech-forward UI" within the recorded precision-instrument direction.

**Goal:** Reimagined dashboard at `/next` — rail navigation, browsable item list with per-row actions (copy/edit/archive/delete/restore/share), sorting, counts, refined states — with the existing retrieval surface refactored into a command-palette modal opened by ⌘K or the header search button.

**Enter-semantics decision:** dashboard list = browsing context → Enter/click opens detail. Palette = retrieval context → Enter copies password (logins), opens otherwise. This resolves the per-type-Enter tension recorded in doc 02 §5.

## Architecture
- `VaultNextPage` becomes the dashboard owner (scope/sort/panels/share/toast/gate/palette state + copy machinery + all data plumbing).
- New components: `CommandPalette.tsx` (modal; own query/activeIndex/command/create state; callbacks onCopy/onOpen/onEdit/onCreate/onCommand/onClose), `DashboardRail.tsx` (nav + counts), `ItemRow` hover quick-actions + `⋯` per-row menu (scope-aware: archive/unarchive, trash/restore/delete-forever, share, open URI, open in classic), `ConfirmMini` (destructive confirm, Enter/Esc), gate becomes a small centered dialog usable from palette and dashboard alike.
- `search.ts` gains `revisionDate`/`creationDate` on `SearchEntry` + `sortEntries(entries, 'name'|'edited'|'created')` (TDD).
- New props from `effectiveMainRoutesProps`: `onDelete`, `onArchive`, `onUnarchive`, `onRestore(ids)`, `onBulkPermanentDelete(ids)` (signatures verified against VaultPage.tsx:53-59).
- `styles/next/dashboard.css`: rail (220px, collapsible under 900px to header scope select), header (palette trigger reading "Search vault… ⌘K", sort menu, + New split button, overflow), list density 44px rows, panel transitions (dur-3 slide), palette modal (top-centered 640px, scrim, dur-2 scale-fade), mini dialogs.
- Fix shipped alongside: stock global `:focus-visible` double-ring inside Next (tokens.css override, done).

## Gates
Unit tests (sort + existing 62), build, extensive Chrome walk with screenshots: rail nav + counts, sort, hover/menu actions incl. archive→unarchive, trash→restore→delete-forever (confirmed), share entry, palette ⌘K full retrieval walk (copy/chords/create/commands/gate), gate-from-row, dirty guard, both themes, ~860px narrow pass, live deploy to vault-test + verification.

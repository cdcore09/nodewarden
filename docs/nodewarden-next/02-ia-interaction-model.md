# NodeWarden Next — Phase 2: Information Architecture + Interaction Model

**Issue:** #16 · **Depends on:** `01-journey-narratives.md` (Phase 1)
**Status:** Phase 2 deliverable — structure and keyboard model, pre-visual-design
**Date:** 2026-08-03
**Rule carried forward:** every structural decision below cites the journey (J1–J6) it serves. A structure that adds steps to a narrative loses.

---

## State as of 2026-08-06

This is a Phase 2 design artifact (dated 2026-08-03), written when only slices 1–3 existed. Slices 4–14 shipped since; the surface map and non-goals below describe the plan at that point, not today's ownership. Corrections:

- **Stale "stock-only" scoping corrected:** orgs, Sends, TOTP, security audit, generator, import, and settings are now native Next surfaces (slices 5–12), not command-mode jumps to the classic UI. §2's surface map and §6's command-mode description below predate this and are annotated in place.
- **Settled architecture:** classic is the permanent, upstream-maintained admin console for the long tail Next deliberately does not port — exactly the pages `NextSettingsPage.tsx`'s "Security & account" section links out to: master password & hint, two-step login (TOTP/YubiKey/passkeys), API keys & recovery code, authorized devices, domain rules, backup center, admin panel, log center. Next is now the default daily driver for everything else.
- **Slice 13 (vault completeness):** bulk operations, folder CRUD, and vault export shipped natively in Next, superseding §4's "deliberately not rebuilt" list below.
- **Slice 14:** Sends parity and create-organization shipped natively in Next.
- **Default flip:** `nodewarden.ui.v2` now defaults to `'v2'` (Next) for any absent or unrecognized stored value. Opting out to classic persists the literal `'v1'` in storage (previously the key was removed on opt-out). `?classic=1` remains a query-string bypass. Next stays English-only; non-English users see a locale note in Next Settings pointing them at the classic interface.

---

## 1. The organizing idea

The stock UI is a **hierarchical admin panel** (sidebar → filter → list → detail) where search is a field bolted onto a toolbar. Next inverts this: **the search surface *is* the shell.** Everything else — browsing, commands, admin — is reached *through* it or deliberately parked outside it in the stock UI.

This is a hub-and-spoke IA where the hub is a live query, not a dashboard:

```
                    ┌─────────────────────────────┐
                    │       UNLOCK  (slice 1)      │
                    └──────────────┬──────────────┘
                                   ▼
       ┌───────────────────────────────────────────────────┐
       │           RETRIEVAL SURFACE  (slice 2)             │
       │   search field (always focused) + results list     │
       │   · plain query  → items (vault-global)            │
       │   · no-match     → "Create ‹query›…" affordance    │
       │   · ">" prefix   → command mode                    │
       │   · scope chips  → explicit, visible narrowing     │
       └───┬───────────────┬───────────────┬───────────────┘
           ▼               ▼               ▼
     ITEM DETAIL      EDITOR (new/edit)   AUDIT SURFACE
     (slice 3)        (slice 3, one       (slice 5,
     side panel /      component serves    native Next —
     takeover          J2 + J3 + J5)       see 2026-08-06)
           │
           ▼
     SHARE DIALOG (Next-styled, J4)

     Command mode ("​>") ──────────► STOCK UI surfaces
     (admin, backup, logs, help, domain rules, device/2FA/API-key
     ceremonies — see the 2026-08-06 changelog: orgs/settings/import/
     sends are native Next now, no longer this arrow's targets)
```

Browsing does not disappear; it collapses into **scope chips + a browse panel** (§4). Admin does not disappear; it lives behind **command mode** and never occupies retrieval-surface chrome (§6).

---

## 2. Surface map: what Next owns vs. delegates

Stock route inventory (from `AppMainRoutes.tsx:224-561`): `/vault`, `/vault/totp`, `/generator`, `/security/password-health`, `/sends`, `/organizations`, `/organizations/:id`, `/settings` (+ subpages, domain-rules), `/admin`, `/logs`, `/help`, `/backup`, `/import`.

| Surface | Owner | Rationale |
|---|---|---|
| Unlock / login / register | **Next** (slice 1) | J1 entry, J6 |
| Retrieval surface (search + results) | **Next** (slice 2) | J1 — the star |
| Item detail | **Next** (slice 3) | J1, J3 |
| Item editor (login type, full) | **Next** (slice 3) | J2, J3, J5 — one component, three journeys |
| Item editor (other 7 types) | **Next**, functional V2 form; polish later | J2 non-goal boundary |
| Share dialog | **Next** (slice 3 or 3.5) | J4 + the design-system evidence on #16 |
| Security audit + fix loop | **Next** (shipped slice 5, `NextAuditPage.tsx`) | J5 |
| Generator | **Inline component in Next editor**, *and* a standalone native Next generator page (shipped slice 8, `NextGeneratorPage.tsx`) — the classic `/generator` page is no longer the only standalone option | J2/J5 need it inline; page has separate uses |
| Sends, TOTP page, organizations mgmt, settings, import | **Next** (shipped slices 5–14 — see the 2026-08-06 changelog above) | superseded; these were originally scoped as stock-only |
| Admin, backup, logs, domain rules, master password/2FA/API keys/devices | **Stock**, permanently — the settled admin console, reached via the Settings escape hatches | settled architecture: admin long tail stays upstream |
| Help | **Stock**, reached via command mode (no native Next page) | unchanged from original scoping |
| Onboarding (register → first item) | **Next** (rides slices 1+2+3) | J6 |

**Escape hatch (standing decision):** stock UI stays one toggle away. The switch to classic lives in Next Settings → Interface — the only in-Next place it lives — plus the `?classic=1` URL bypass and direct classic-route URLs. The `nodewarden.ui.v2` flag flips both ways instantly. (As of the 2026-08-06 default flip, Next is the default read on an absent/unrecognized flag value; opting out to classic now persists the literal `'v1'` rather than clearing the key — see the changelog above.)

---

## 3. The retrieval surface (hub) — structure

**Layout:** a single centered column (~680px max) — search field on top, results beneath, a one-line **hint bar** at the bottom showing the live key map. On screens ≥ ~1100px, opening an item slides a **detail panel** in beside the column (results stay visible and navigable); narrower, detail is a takeover with Esc back. Editor replaces the detail region. No sidebar. No toolbar. (Emotional register — calm, heavy, precise — is Phase 3's job; structure here just refuses to compete with the query.)

**Focus model (the core mechanic, J1):**
- The search input is focused on entry and **regains focus after every completed action** (copy, close detail, save). Focus is never parked on a button.
- Arrow keys move the highlight through results *while focus stays in the input* (combobox pattern: `role=listbox` + `aria-activedescendant`). First result is always pre-highlighted.
- All accelerators are modifier-based so they work regardless of what's focused (§5).
- The input accepts typing immediately even while the vault index is still streaming in post-unlock (J1 criterion: never a frozen input on a live screen).

**Query grammar:**

| Input | Result |
|---|---|
| plain text | Vault-global fuzzy-ish match (name, username, **all** URIs, folder name; fixes stock index gaps at `VaultPage.tsx:324-338`). Never scoped by residual state — scoping exists only as visible chips. |
| `>` prefix | **Command mode**: commands fuzzy-matched (`>new card`, `>audit`, `>settings`, `>import`, `>lock`, `>admin`, `>organizations`, `>sends`, `>generator`…). VS Code convention; keeps item results and commands from polluting each other. (No `>classic ui` command was ever built — superseded, see the 2026-08-06 changelog; the switch lives in Settings → Interface.) |
| no matches | The result list offers **“Create login ‘‹query›’”** — Enter opens the editor with the name prefilled (J2 shortcut; also converts every failed retrieval into a capture opportunity). |
| scope chip active | Chip renders *inside* the search bar (e.g. `[folder: Work] fas`). Added via browse panel or `in:`/`type:` tokens; removed with Backspace at query start. Visible = never silent (J1 criterion). |

**Reprompt-gated items (J1):** the gate renders inline where the hint bar sits — password field autofocused, Enter submits, Esc cancels. Costs exactly `P`+1 keystrokes, no dialog navigation.

---

## 4. What browsing collapses into

Browsing is the fallback mode (issue thesis), so it gets exactly two affordances:

1. **Scope chips** (above) — browsing-by-narrowing without leaving the keyboard or the surface.
2. **Browse panel** (`⌘B`) — a flat overlay listing: Favorites, item types (8), folders, organizations/collections, Archive, Trash, Duplicates. Selecting an entry sets a chip and returns focus to the input with results showing that scope (empty query = "everything in scope", replacing the stock sidebar's filter-then-scan pattern). It is a *chip picker*, not a persistent pane — it closes on selection or Esc.

Depth check (IA hygiene): maximum navigation depth anywhere in Next is **2** (surface → panel/detail). The stock sidebar's tree stays available in stock for whoever wants it.

Deliberately *not* rebuilt: duplicates resolution — command mode jumps to stock for this. (Folder management (create/rename/delete) and bulk selection/operations shipped natively in slice 13, superseding their original listing here as non-goals — see the 2026-08-06 changelog above.)

---

## 5. Keyboard command map

### The browser constraint (design input, not footnote)

Next runs in a browser/PWA. Some shortcuts **cannot be intercepted** and must not be assigned: `⌘T` (new tab), `⌘N` (new window), `⌘W` (close), `⌘⇧N`, `⌘L` (address bar), `⌘M`/`⌘H`/`⌘Q` (macOS window/app), `Ctrl+T/N/W` on Windows/Linux. Also avoided: bare-letter accelerators (focus lives in a text input — letters must type), and `Option+letter` on macOS (inserts special characters into the focused input). Interceptable and therefore usable: `⌘K E R U I O P S D F G J B` and Enter/Esc/arrows/Tab. This kills the classic `⌘N = new item` and `⌘T = TOTP`; the map below is designed around that.

### Global (any Next surface)

| Key (mac / win-linux) | Action | Journey |
|---|---|---|
| `⌘K` / `Ctrl+K` | Return to retrieval surface, search focused, query selected. In a dirty editor, triggers the same guard as Esc. | J1 |
| `Esc` | One rung down the ladder: dirty-editor guard → close editor → close detail/panel → clear query → no-op | J1–J3 |
| `⌘B` / `Ctrl+B` | Toggle browse panel (chip picker) | J1 fallback |

### Retrieval surface, result highlighted

| Key | Login item | Non-login item | Journey |
|---|---|---|---|
| `↑` `↓` | move highlight (input keeps focus) | same | J1 |
| `Enter` | **Copy password** | **Open detail** | J1 |
| `⌘Enter` | Open detail | Open detail | J3 |
| `⌘U` | Copy username | — | J1 |
| `⌘O` | Copy **o**ne-time code (TOTP), countdown shown in the row | — | J1 |
| `⌘E` | Edit (editor opens, first field focused) | Edit | J3 |
| `⌘S` | Share… (Next share dialog) | Share… | J4 |
| `Tab` | **Action menu** for the highlighted item — every remaining action (open URI, copy URI, archive, delete, move, reprompt-gated reveals…), arrow/Enter/typeahead navigable. Tab's focus-move role is deliberately repurposed here; documented, and the menu itself is standard-focus navigable. | same | all |

**The Enter rule (resolves the J3 flag):** Enter's meaning is decided **per item type, not per mode** — for a login it always copies the password (the retrieval moment is the product's job; J1 counted on it); for everything else it opens. `⌘Enter` opens uniformly. The hint bar makes the asymmetry visible at all times: `↵ copy password · ⌘↵ open · ⌘U username · ⌘O code · ⇥ actions`.

### Detail view (item open)

Same accelerators as above act on the open item (`⌘U`, `⌘O`, `⌘E`, `⌘S`, Tab-menu). Plus: `⌘F`? — no; typing any character returns focus to search with that character (type-to-search-through). Esc closes detail back to results, highlight preserved.

### Editor

| Key | Action | Journey |
|---|---|---|
| (on open) | First relevant field autofocused; complete Tab order name → username → password → TOTP → URIs → rest | J2, J3 |
| `⌘G` | **G**enerate password into the password field; press again to reroll. Field is masked with reveal toggle. A ⚙ disclosure on the generator well exposes the rules row (words/characters, length, character classes) for sites with restrictive password requirements — any rule change rerolls immediately; rules persist per session. | J2, J5 |
| `⌘Enter` (alias `⌘S`) | Save. On save: return to where you came from (results with highlight, or audit findings list) with the saved item selected. | J2, J3, J5 |
| `Esc` | Cancel; if dirty, an inline guard (Enter = discard, Esc = keep editing) | J3 |

### Audit surface (shipped slice 5, native Next — see the 2026-08-06 changelog)

Findings list uses the identical list mechanics: arrows, `Enter` = open fix (editor, password focused, generated candidate offered), save returns to the findings list with position preserved and the finding locally resolved. Fix loop = `Enter · ⌘G · ⌘Enter` — the 3 keystrokes J5 counted.

### Platform + a11y notes

- All `⌘` bindings are `Ctrl` on Windows/Linux; `Ctrl+U`/`Ctrl+O` etc. are preventable (view-source/open-file defaults) — verified against the reserved list above.
- The map is the a11y skeleton, not a bypass of it: results are a proper combobox/listbox (`aria-activedescendant`), the hint bar has a screen-reader equivalent (`aria-keyshortcuts` on actions + polite announcements for copies: "Password copied, clears in 30 seconds"), the action menu and dialogs must meet the focus-trap/restore bar the stock `ConfirmDialog.tsx:118-207` already sets.
- Copy actions announce clipboard auto-clear (J1 criterion) — the countdown is part of the toast and the SR announcement.

---

## 6. Where org/admin surfaces live (so retrieval pays no tax)

- **Zero admin chrome on the retrieval surface.** No sidebar entries, no toolbar buttons, no nav tabs. The only persistent non-search UI: the hint bar and one unobtrusive **app menu** button (top corner) containing: account/lock/logout, theme/skin, and links into stock surfaces — the same list command mode exposes, for mouse users. (The switch to classic UI is not in this menu — it lives in Next Settings → Interface, plus the `?classic=1` bypass; see the 2026-08-06 changelog.)
- **Command mode is the front door to everything else.** As of the 2026-08-06 changelog above, `>settings`, `>organizations`, `>import`, `>sends`, `>generator`, and `>audit` now open native Next surfaces rather than jumping to stock. Genuine jumps to the classic admin console remain `>admin`, `>backup`, `>logs`, `>help`, plus the security escape hatches inside Next Settings (master password, 2FA, API keys, devices, domain rules). Jumping to a stock surface is a normal navigation; `⌘K` in stock is *not* claimed (stock stays untouched per merge-safety) — returning to Next is via the vault nav link, which the shell hook points at the Next surface while the flag is on.
- **Org-ness inside Next appears exactly twice:** the org badge on shared items (detail + result row, J4) and the share dialog. Collection browsing is a browse-panel scope, not a persistent tree.

---

## 7. Onboarding placement (J6)

- Register lives in the Next unlock surface (slice 1): first field autofocused, inline as-you-type validation (length/match), Enter submits.
- **Auto-login after registration** — flagged in Phase 1 with a scope caveat: if it can't be done via the V2 shell + a one-line hook (registration currently ends in `setPhase('login')` at `App.tsx:872-875`), fall back to prefilled email + focused password field and record the decision in the slice-1 PR.
- Empty vault = two CTAs (create first login → J2 editor; import → stock import surface) + a one-time dismissible `⌘K` hint after the first item is saved. No tour.

---

## 8. Validation: narratives replayed against this IA

| Journey | Path through the IA | Count | Phase 1 target | Holds? |
|---|---|---|---|---|
| J1 retrieval | unlock → type `fas` → `Enter` → `⌘U` → `⌘O` | 3 chars + 3 chords = 6 keys, 0 clicks | 6 keys, 0 clicks | ✅ |
| J2 save new | `⌘K` → type name → (no match) `Enter` on Create → editor prefilled, username focused → Tab/paste → `⌘G` → `⌘Enter` | name + ~6 keys, 0 clicks | name + 7 keys | ✅ (create-from-query beats the narrative by prefilling name) |
| J3 find+edit | type query → `⌘E` → Tab to field → paste → `⌘Enter` | ≤ 10 keys, 0 clicks | ≤ 10 keys | ✅ |
| J4 share | highlight/open item → `⌘S` → dialog paints instantly, collections load in-dialog → select (one idiom) → `Enter` | ≤ 4 interactions, 0 silent resets, 1 visual language | same | ✅ |
| J5 audit fix | `>audit` → `Enter` → `⌘G` → `⌘Enter` → next finding highlighted | 3 keys per finding, 0 navigations | 3 keys | ✅ |
| J6 onboarding | register (Enter) → unlocked empty vault → CTA → J2 editor → `⌘K` hint | one screen + `P` keys saved vs stock | same | ✅ (pending auto-login scope check) |

One deliberate amendment to a Phase 1 count: J2's "⌘N" is impossible in a browser (unpreventable). The create-from-query affordance replaces it and lands *better* than the original narrative (name arrives prefilled). Phase 1 doc does not need editing — the acceptance criterion was the count, and the count improves.

---

## 9. Open questions carried into Phase 3 (visual design)

1. **Hint bar density** — full map vs. contextual three-hint rotation; decide against real mockups.
2. **Detail panel vs. takeover breakpoint** and the transition (this is where "calm, heavy, precise" gets cashed in).
3. **Result row anatomy** — icon, name, username, org badge, TOTP presence/countdown, matched-field indicator; what the "copied ✓ (clears in 28s)" state looks like.
4. **`⌘O`/`⌘G`/`⌘S` mnemonics under i18n** — accelerators stay fixed across locales (muscle memory > mnemonic), but hint-bar labels localize; verify no locale renders the hint bar too wide.
5. **Chip syntax** (`in:`, `type:`) — power-user affordance; typed tokens may slip to a later slice, browse-panel chips are the slice-2 floor.
6. Exact command list for `>` mode at slice 2 (minimum: new ×8 types, audit, generator, settings, import, lock, logout). (`classic ui` dropped — superseded, see the 2026-08-06 changelog; the switch lives in Settings → Interface.)

## Phase 3 next step (per plan of record)

`/create-design-system` for tokens/type/palette, then `/visual-design` per surface — browser-viewable HTML mockups of: unlock, retrieval surface (empty query / query with results / copied state / reprompt inline), detail panel, editor, share dialog — iterated on before any app code.

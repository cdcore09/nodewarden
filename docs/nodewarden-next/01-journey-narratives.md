# NodeWarden Next — Phase 1: Journey Narratives

**Issue:** #16 (retrieval-first alternate UI shell)
**Status:** Phase 1 deliverable — journey narratives as acceptance tests
**Date:** 2026-08-03
**Method:** Current-state walkthroughs are traced from code (file:line cited), not guessed. Target narratives count seconds and keystrokes; **a screen that adds steps to its narrative loses.** That is the acceptance rule for every Next slice.

**Counting conventions**
- *Mouse acquisition* (hand leaves keyboard, locate target): ~1.5s. *Click on already-located target:* ~0.5s. *Keystroke burst* (typing a word you know): ~0.15s/char. *Panel/route transition:* ~0.3s perceived. Waits (KDF, network, decrypt) counted separately as *machine time*.
- "Keystrokes" counts every key press including modifiers and Enter. Master password length is denoted `P` (not counted against the UI — it's the price of a vault).

---

## State as of 2026-08-06

This is a Phase 1 design artifact (dated 2026-08-03), written when only slices 1–3 existed. Slices 4–14 shipped since. The journey walkthroughs and their "Non-goals" callouts below are the acceptance tests slice 2/3 had to satisfy at the time — read them as history, not as today's feature inventory. Corrections:

- **Stale "stock-only" scoping corrected:** orgs, Sends, TOTP, security audit, generator, import, and settings are now native Next surfaces (slices 5–12) — no longer command-mode jumps out to the classic UI. See `02-ia-interaction-model.md`'s matching changelog for the corrected surface map.
- **Settled architecture:** classic is the permanent, upstream-maintained admin console for the long tail Next deliberately does not port — exactly the pages `NextSettingsPage.tsx`'s "Security & account" section links out to: master password & hint, two-step login (TOTP/YubiKey/passkeys), API keys & recovery code, authorized devices, domain rules, backup center, admin panel, log center. Next is now the default daily driver for everything else.
- **Slice 13 (vault completeness):** bulk operations (select, move, archive/unarchive, restore, trash, delete-forever), folder CRUD (create/rename/delete), and vault export shipped natively in Next. This supersedes the folder-management/bulk-operations non-goals recorded in Journey 1 below.
- **Slice 14:** Sends parity (notes, expiration days, max access count, disabled toggle) and create-organization shipped natively in Next.
- **Default flip:** `nodewarden.ui.v2` now defaults to `'v2'` (Next) for any absent or unrecognized stored value. Opting out to classic persists the literal `'v1'` in storage (previously the key was removed on opt-out). `?classic=1` remains a query-string bypass. Next stays English-only; non-English users see a locale note in Next Settings pointing them at the classic interface.

---

## Journey 1 — Retrieval (the star): mid-login, need the credential *now*

**Persona moment:** I'm on `app.fastmail.com/login` in another tab. The login form is staring at me. Every second here is a second I'm not doing the thing I actually opened the browser for.

### Current state (stock UI), traced

1. Open the vault tab/PWA. Stored session → **Unlock** screen, password field autofocused (`AuthViews.tsx:141`). Good start.
2. Type master password, Enter (`AuthViews.tsx:129-134`). Wait: PBKDF2 600k iterations + sequential network round-trips (`app-auth.ts:712-794`), feedback is only a button label change.
3. Land on `/vault`. The list shows a skeleton until the **entire vault** is decrypted in the worker (`App.tsx:1460`, `AppMainRoutes.tsx:301`) — no progressive rows, and the IndexedDB cache stores no decrypted fields (`vault-cache.ts:24-36`), so this wait recurs every unlock.
4. Search is **not focused** and has **no hotkey** (no `/`, no ⌘K anywhere in `webapp/src`). Mouse acquisition → click the search field (`VaultListPanel.tsx:333-358`). **+2s**
5. Type "fastmail". Substring match only, and only within the active sidebar filter (`VaultPage.tsx:404-430`) — if I left the vault filtered to a folder last time, my match is silently hidden.
6. No keyboard selection (no arrow/Enter on the list). Mouse → click the row. **+2s**
7. Detail view renders. Click **Copy** on password (`VaultDetailView.tsx:211`). **+2s**
8. Alt-tab, paste. Realize the site wants the email first. Alt-tab back, click Copy on username (`VaultDetailView.tsx:196`). **+3s**
9. Site asks for TOTP. Back again, click Copy on the TOTP row (`VaultDetailView.tsx:258`). **+3s**
10. My password is now sitting in the OS clipboard indefinitely — there is **no clipboard auto-clear** (`lib/clipboard.ts:13-34`).

**Tally (post-unlock):** 4 mouse acquisitions + 4 clicks, 3 tab-switch round-trips, ~12–15s of human time on top of unlock + full-vault decrypt. Zero keyboard path exists.

### Target narrative (acceptance test)

> I hit the PWA. Password field is already focused — muscle memory types `P` chars, Enter. While the KDF runs I see the vault breathing, not a dead button label. The instant it opens **I am already in the search field** — no reaching for anything. I type `fas` — three keystrokes — and Fastmail is the top result, already highlighted, matched across my whole vault no matter what filter I left behind. I press **Enter: password copied.** Toast tells me so, and tells me it will clear itself in 30 seconds. Alt-tab, paste. It wants the email — alt-tab back, **one keystroke** (⌘U or `u`) copies the username; the result is still selected, nothing moved. TOTP prompt: one keystroke (⌘T or `t`), code copied with its countdown visible. I never touched the mouse. I never saw a sidebar, a toolbar, or a folder tree.

**Counted:** post-unlock cost = 3 chars + Enter + 1 key + 1 key = **6 keystrokes, 0 clicks, 0 mouse acquisitions**, ~4–5s human time for all three credentials.

**Hard acceptance criteria**
- [ ] Search focused at vault-open; additionally reachable from anywhere in one keystroke (⌘K / `/`).
- [ ] Search is vault-global, never silently scoped by a residual filter.
- [ ] First result auto-highlighted; arrow keys move; **Enter = copy password** (primary action of a login item in retrieval context).
- [ ] Single-keystroke copy for username and TOTP on the highlighted/selected item; TOTP countdown visible.
- [ ] Clipboard auto-clear with visible countdown/notice.
- [ ] Reprompt-gated items: the master-password gate appears inline in the flow, field focused, Enter submits — adds exactly `P`+1 keystrokes, nothing else.
- [ ] Perceived readiness: search accepts input even while decrypt finishes (index streams in); never a dead skeleton with a frozen input.

**Non-goals (slice 2):** browsing IA, folder management, bulk operations, mobile layout parity.

---

## Journey 2 — Saving a new credential

**Persona moment:** I just signed up for a new service. Its "save this somewhere" window is the most fragile ten seconds in the product — if saving is annoying, the password ends up in a text file.

### Current state, traced

1. Click **+** (`VaultListPanel.tsx:259-281`) → dropdown of 8 types → click **Login**. 2 clicks. (A `nodewarden:add-item` quick-add listener exists at `VaultPage.tsx:166-172` but nothing dispatches it — dead wiring.)
2. Editor renders inline. **No field is focused** (no `autoFocus` anywhere in `VaultEditor.tsx`). Click Name, type.
3. Click Password. It's a **plain visible text input** — no mask, no reveal toggle, and **no inline generator** (`VaultEditor.tsx:405`). Generating a strong password means navigating to `/generator`, generating, copying, navigating back, pasting — a full context switch with no draft hand-off.
4. Click "Add website" / type URI. Nothing is ever prefilled (`vault-page-helpers.tsx:480`).
5. **No Enter-to-save** — the editor is not a form; Confirm is a manual button click (`VaultEditor.tsx:793`).

**Tally:** minimum ~6 clicks + 4 field acquisitions for a generated-password login; the generator detour adds two navigations and two more copies/pastes.

### Target narrative (acceptance test)

> One keystroke (⌘N, or "new" in the palette) and I'm in a new-login editor with **Name already focused**. I type the service name, Tab, paste the email, Tab. The password field offers me a generated password *right there* — one keystroke accepts it (or I paste my own; the field is masked with a reveal toggle either way). Tab, paste the URL. **⌘Enter saves.** The toast confirms, and the new item is selected so an immediate copy is one keystroke away. Keyboard never abandoned; I was never taken to another page.

**Counted:** 1 open keystroke + type name + 2 Tab + 1 accept-generator keystroke + 1 Tab + paste + ⌘Enter ≈ **name-length + 7 keystrokes, 0 clicks**, ~8s.

**Hard acceptance criteria**
- [ ] Single-keystroke / palette entry to "new login"; other types one step deeper, never costing the login path.
- [ ] First field autofocused; logical Tab order through name → username → password → URI.
- [ ] Inline password generator in the editor (accept/reroll without leaving the field); password field masked with reveal.
- [ ] ⌘Enter (or Enter outside textareas) saves; Esc cancels with an unsaved-changes guard.
- [ ] After save, item is selected and copy actions are live.

**Non-goals:** browser-extension capture, non-login type editor redesign (they keep a functional V2 form, polish later), attachment UX.

---

## Journey 3 — Finding + editing an existing item

**Persona moment:** I rotated a password on a website; the vault entry is now wrong. Or a URI changed. Small correction, should feel small.

### Current state, traced

1. Same unfocused, unscoped-search entry as Journey 1: mouse → search → type → mouse → click row.
2. Click **Edit** (`VaultDetailView.tsx:560`). Editor replaces detail inline.
3. **No focus** lands anywhere; click the field to change (`VaultEditor.tsx` — zero focus management). Type select is disabled post-create (`VaultEditor.tsx:363`) — a wrong-type item can never be converted.
4. Click **Confirm** (no Enter-to-save). No unsaved-changes guard on cancel/navigation (`VaultPage.tsx:692-704`).

**Tally:** ~4 mouse acquisitions + 4 clicks for a one-field correction.

### Target narrative (acceptance test)

> Palette, type `fas`, the item is highlighted. **`e`** (or ⌘E) drops me into edit with the first field focused; Tab reaches the field I need, or I click it once — my choice, both work. I paste the new password (masked, reveal available, generator one keystroke away). **⌘Enter.** Saved, back on the item detail, change visible. If I'd hit Esc with dirty fields, it would have asked before discarding.

**Counted:** 3 chars + `e` + Tabs (≤4) + paste + ⌘Enter ≈ **≤10 keystrokes, 0 required clicks**, ~7s.

**Hard acceptance criteria**
- [ ] Edit reachable from search-highlighted item in one keystroke; detail view also one keystroke (Enter behavior context-dependent: copy in retrieval palette, open in browse — decided in Phase 2's interaction model).
- [ ] Editor autofocus + complete Tab order; ⌘Enter save; Esc with dirty-state guard.
- [ ] Edit is inline/in-place — the search context I came from is restored on save/cancel.

**Non-goals:** item-type conversion (record as V2 backlog, not slice scope), history/attachments redesign.

---

## Journey 4 — Sharing an item to an organization

**Persona moment:** Deliberate admin-flavored act, done occasionally. It should be *calm and correct* more than fast — but it must not lose my work.

### Current state, traced

1. Share only exists in detail view (`VaultDetailView.tsx:572-576`) — select item → click Share.
2. `openShareDialog` awaits the collections network call before the dialog is usably ready (`VaultPage.tsx:895-901`) — the button can appear to hang.
3. Dialog: **native `<select>`** for org (`VaultPage.tsx:1441`) next to app-styled checkboxes for collections — two visual languages in one dialog (the design-system evidence already recorded on issue #16). Switching org **silently wipes** the collection selection (`VaultPage.tsx:1445-1449`). No collection search; flat checkbox list.
4. Tick collection(s) → Confirm. To the dialog's credit: ConfirmDialog autofocuses the first control, traps focus, Enter confirms, Esc cancels (`ConfirmDialog.tsx:118-207`).

**Tally:** ~4 clicks + 2 async waits; the failure modes are perceptual (hang, silent reset), not click count.

### Target narrative (acceptance test)

> From the item, one action — key or click — opens Share. The dialog is *instantly* visible with its own skeleton while collections load; nothing hangs. Org picker and collection list are the same visual language — our styled select and our one multi-select idiom, no OS chrome. I switch org and the dialog *tells me* my collection choice was reset instead of silently discarding it. Enter confirms; the item now wears its org badge in detail and list.

**Counted:** ≤4 interactions, but the real acceptance is: **0 silent state loss, 0 perceived hangs, 1 visual language.**

**Hard acceptance criteria**
- [ ] Dialog paints immediately; collection loading is an in-dialog state.
- [ ] Styled select + the single Next multi-select idiom (no native popovers anywhere in Next surfaces).
- [ ] Org switch that resets selection says so (or preserves compatible selections).
- [ ] Full keyboard operability retained (focus, Enter, Esc — already the stock dialog's strength; do not regress it).

**Non-goals:** bulk share, share-from-list-row, collection management surfaces. (Org management itself now lives natively in Next — see the 2026-08-06 changelog above; this non-goal originally covered orgs too, but that has since landed.)

---

## Journey 5 — Security audit / password health review

**Persona moment:** Saturday-morning hygiene. I want the vault to tell me what's wrong and let me fix it *without losing my place in the list of problems*.

### Current state, traced

1. Navigate to `/security/password-health`. Nothing runs automatically — click **"Check password security"** (`PasswordSecurityPage.tsx:93-96`); HIBP k-anonymity calls throttled to 5 concurrent (`password-security.ts:4,83`), numeric progress only.
2. Findings list with metric-tile filters (good bones: real buttons, `aria-pressed`, live region — `PasswordSecurityPage.tsx:109,168`).
3. Fixing one finding: **"Jump"** navigates to the vault and merely *selects* the item — `isEditing` stays false (`PasswordSecurityPage.tsx:153`, `VaultPage.tsx:510-561`). Then: click Edit → no generator inline → possibly a `/generator` detour → Confirm → navigate *back* to the security page → **manually re-run the scan** to see the finding clear.
4. Meanwhile, risk is invisible everywhere else: no health badges in list or detail; the per-item breach check is a manual button (`VaultDetailView.tsx:214-223`).

**Tally per finding fixed:** 2 page navigations + ~5 clicks + a manual re-scan. Fixing 5 passwords means doing that loop 5 times.

### Target narrative (acceptance test)

> I open the audit surface. My last scan's results are already there with a freshness timestamp; one action re-scans, with progress I can watch. The first finding is highlighted. I press Enter: the item opens *in the fix context* — editor, password field focused, a generated replacement already offered. I accept it, ⌘Enter, and I'm **back on the findings list, next finding highlighted, the fixed one visibly resolved** — no re-scan, no navigation, no lost position. Five weak passwords take five repetitions of a ten-second loop, not five expeditions.

**Counted per finding:** Enter + accept-generator + ⌘Enter = **3 keystrokes**, ~10s including the save round-trip.

**Hard acceptance criteria**
- [ ] Fix loop never leaves the audit context; position in findings list preserved; resolved findings update locally without a full re-scan.
- [ ] Inline generator inside the fix step (same component as Journey 2).
- [ ] Scan reuses cache with a visible freshness stamp; scan progress is visual, not just a counter.
- [ ] Keyboard path through the entire loop.

**Non-goals:** passive health badges across the whole vault list (candidate for later; record as backlog), changing HIBP mechanics, server-side scanning.

---

## Journey 6 — First-run onboarding

**Persona moment:** I just self-hosted this thing. The first five minutes decide whether I trust it with my digital life.

### Current state, traced

1. Register screen: **no autofocus on any field** (`AuthViews.tsx:207-266` — inconsistent with login/locked, which do autofocus). All validation deferred to submit as toasts (`App.tsx:846-857`).
2. Success does **not** log you in: back to the login screen to re-type the master password you created eight seconds ago (`App.tsx:872-875`).
3. First vault view: `"No items"` / `"Select an item"` (`VaultListPanel.tsx:441`, `VaultPage.tsx:1417`). No create CTA, no import prompt, no guidance. A dead end at the exact moment of maximum motivation.

### Target narrative (acceptance test)

> Name field is focused when the register screen appears. I type name, Tab, email, Tab, master password — the strength/length requirement is shown *while I type*, not as a toast after I fail. Confirm, Enter. **I land unlocked in my empty vault** — no second sign-in. The empty vault is not "No items": it offers exactly two paths — *create your first login* (which drops me into Journey 2's editor) and *import from another manager* (which hands off to the stock import surface). I create one item, and the retrieval palette hints at itself once: "Press ⌘K anytime." Now I know the whole product model.

**Counted:** registration = field typing + Tabs + Enter (no re-login = `P` keystrokes and one full screen saved); first item = Journey 2's count.

**Hard acceptance criteria**
- [ ] Register: first field autofocused; inline (as-you-type) validation for length/match; Enter submits.
- [ ] Auto-login after successful registration (or at minimum: password preserved, single-click entry). *Note: auto-login touches auth flow — verify it stays within V2 shell scope; if it requires upstream-file surgery beyond a one-line hook, downgrade to prefilled-email + focused password and record the decision.*
- [ ] Empty-vault state offers create + import CTAs; create leads into the Journey 2 editor.
- [ ] One-time, dismissible palette hint after first item; no tour, no overlay sequence.

**Non-goals:** invite/org-invite deep-link flows (recently fixed upstream-adjacent, leave stock), 2FA setup promotion, multi-step tutorial.

---

## Cross-journey findings (what the narratives collectively demand)

1. **The palette is the product.** Journeys 1, 2, 3, and 5 all start or pivot through search-with-focus + keyboard selection + single-keystroke actions. That one surface pays for the whole project.
2. **One editor, done right, serves three journeys.** Autofocus + Tab order + masked password + inline generator + ⌘Enter/Esc-with-guard shows up in save (J2), edit (J3), and audit-fix (J5).
3. **The stock dialogs are the accessibility high-water mark** (`ConfirmDialog.tsx`: focus trap, restore, Enter/Esc). Next's shell must meet that bar everywhere, not just in modals — it's currently *only* met in modals.
4. **Clipboard is a security surface** — auto-clear with visible notice is a retrieval-flow feature, not a settings checkbox afterthought.
5. **Perceived readiness beats raw speed.** Full-vault worker decrypt gates everything today; Next should let search accept input immediately and stream results, and dialogs should paint before their data arrives.
6. **Design-system consequence (already on the issue):** one styled select + one multi-select idiom, zero native popovers in any Next surface.

## Backlog candidates surfaced (explicitly *not* in slices 1–3)

- Item-type conversion (type select is permanently disabled post-create today).
- Passive health badges in list/detail.
- Wiring or removing the dead `nodewarden:add-item` listener upstream.
- "Remember email" on full login (distinct from the locked-screen path).
- Clipboard auto-clear could also be upstreamed as a standalone fix — it is small, self-contained, and valuable in the stock UI too.

## Next step (Phase 2)

Derive the information architecture + interaction model from these narratives: the palette-first shell, what browsing collapses into, the keyboard command map (including the Enter-means-copy vs Enter-means-open context rule flagged in J3), and where org/admin surfaces live so they never tax the retrieval path.

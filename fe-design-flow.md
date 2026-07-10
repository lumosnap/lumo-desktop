# LumoSnap Desktop — Screen-by-Screen Functional Reference

> A design-neutral walkthrough of every screen: the regions, the elements on them, what
> each element does, and the states each screen can be in. No colors, typography, shapes,
> or motion are prescribed — those are open design decisions. LumoSnap is a desktop app
> for photographers to organize albums, share them with clients, and manage bookings.
>
> Each screen also carries a **Feel / intent** note: the emotional goal the screen should
> achieve. This is design *input* (the brief), not a design *solution* — it says what the
> user should feel, not how to render it. Where useful, a "previously" line records how the
> old design delivered that feel, purely as reference; a redesign is free to achieve the
> same feel any other way.

---

## App-wide behavior (applies everywhere)

**Overall product feel / intent:** a professional creative tool for photographers — should
feel polished, calm, and content-first, putting the user's photos at the center while
chrome stays quiet. Trustworthy and dependable for client-facing work, friendly without
being toylike. System messages (offline, low storage, errors) should inform without
alarming — clear, honest, recoverable.

- **Header pattern (most screens):** each screen has a section label and a title.
- **State variants:** every data-driven screen has three variants — a **loading** state, an
  **empty** state (message + a call-to-action), and an **error** state.
- **Global banners** (can appear on any signed-in screen):
  - **Offline:** informs the user they're offline and that sync and album creation are
    disabled.
  - **Low storage:** warns the user is low on disk and to free space or change the storage
    location. Dismissible.

### Primary navigation (on all signed-in screens)
Three destinations; the current one is indicated as active:
- **Albums** → the library home.
- **Bookings** → client bookings.
- **Profile** → settings.

---

## 1. Setup Wizard (first run) — multi-step

**Feel / intent:** welcoming and reassuring — a first impression that makes a new user feel
the product is polished, friendly, and effortless to start. Low cognitive load, one clear
action per step, a sense of forward momentum and arrival.
*Previously:* a celebratory tone — decorative animation per step (camera badge, photos
flying into a cloud, confetti on completion) and a filling progress bar to signal progress.

A multi-step flow with two regions: a **visual/decorative region** and a **content
region** (text + controls). A **progress indicator** advances as the user moves through
steps. **2 steps are active**; a middle "Watch Folder" step exists but is currently
disabled.

### Step 1 — Welcome
- Section label "Introduction", heading "Welcome to LumoSnap", a short description.
- **Action:** "Get Started" → advances to the Connect step.

### Step 2 — Connect to Cloud (sign in)
- Section label "Synchronization", heading "Connect to Cloud", description about signing
  in to sync albums/settings.
- **Action:** "Connect to LumoSnap" → opens the system browser to sign in.
- **While waiting for authentication**, the content region shows:
  - A "Waiting for browser authentication…" indicator.
  - A **Cancel** action.
  - A hint to use the manual code if the browser doesn't return.
  - A **device-code section** (titled "Authorize with device code"): a **Copy code**
    action, the code itself, a clickable **verification URL**, and an "expires in N min"
    note.
  - An **error message** if sign-in fails.

### Step 3 — All Set
- Section label "Complete", heading "You're All Set!", confirmation text.
- **Action:** "Launch LumoSnap" → enters the app (Albums).

---

## 2. Login (returning user)

**Feel / intent:** familiar and quick — a returning user should feel recognized and get back
in with minimal friction. Trust and security around the sign-in, with a clear fallback if
the browser flow stalls so the user never feels stuck.
*Previously:* same welcoming visual language as the wizard for continuity.

A single screen with two regions: a **visual region** and a **content region**.
- Section label "Welcome Back", heading "Connect to Cloud", short description.
- A progress indicator.
- **Primary action:** "Connect to LumoSnap" → opens the system browser to sign in.
- **While waiting**, shows the same waiting indicator + Cancel + hint as the wizard, plus
  a **device-code section**:
  - An "Alternate Sign-In" label + an "Expires in N min" note.
  - A "Use this device code" heading + caption + a **Copy code** action.
  - The code shown alongside an **"Open Verification Page"** action.
  - A labeled, clickable **verification URL**.
- An **error message** if sign-in fails.
- **Responsive:** on a narrow window the content stacks vertically and controls go
  full-width.

> Note: the device-code section here is titled "Use this device code"; the wizard's is
> titled "Authorize with device code" — to be reconciled.

---

## 3. Albums (home / library)

**Feel / intent:** the home base — calm, organized, and content-first. The photographer's
work (album covers) should be the hero; chrome stays quiet. Scanning many albums should
feel fast and uncluttered, and status (needs sync, uploading, orphaned) should be legible
at a glance without alarming.
*Previously:* a light, card-based grid where thumbnails carried the visual weight and the
header stayed minimal.

The main landing screen after sign-in. Two regions: a **header** and a scrollable
**content area**.

### Header
- **Section label** "Library" + **title** "Albums".
- **Actions:**
  - **Open Watch Folder** — only shown if a watch folder is set; opens that folder in the
    OS file explorer.
  - **Refresh** — re-checks the file system for changes (indicates progress while
    working).
  - **New Album** — opens the Create Album popup.
  - **Upload progress widget** — only appears while photos are processing (see §9).
  - **Profile control** — shows a **usage indicator**, an **avatar** (first letter of the
    business name), and the **business name**. If near or over the image limit, an
    **Upgrade** indicator appears. Activating it goes to Profile.

### Content area
- **Loading:** loading indicator.
- **Empty:** a message, supporting copy, and a "Create Your First Album" action.
- **Albums grid:** responsive cards. Each **album card**:
  - **Cover area:** the album thumbnail, or a placeholder if there's no thumbnail.
    - **SYNC indicator** if the album's source folder changed and needs syncing.
    - **ORPHANED indicator** if the source folder was deleted.
    - A **loading overlay** while that album is uploading.
  - **Info row:** album title + "N photos". An **actions menu** (revealed on hover):
    - **Open Folder** — opens the album's folder in the OS.
    - **Sync Album** — only if changes detected; opens the Sync popup.
    - **Delete Album**.
  - **Hints:** a hint "Add photos via 'Open Folder'…" for empty albums; a "Processing…"
    hint while uploading.
  - Activating a card opens that album's gallery (disabled while it's uploading).

### Delete Album confirmation (popup)
- Heading "Delete Album", warning that deletion is permanent (cloud + local).
- A **type-to-confirm field**: the user must type the album's exact name; the **Delete
  Album** action stays disabled until it matches.
- **Cancel** / **Delete** actions.

---

## 4. Album Gallery (a single album)

**Feel / intent:** immersive and gallery-like — the photos are the point, so the grid should
feel spacious and let images breathe. Actions (share, favorites, copy) stay accessible but
secondary. Selection and the lightbox should feel precise and responsive, like a
professional review tool.
*Previously:* a split layout keeping actions to one side and giving the photo grid the
dominant space, with a dark full-screen lightbox for focused viewing.

Opened by activating an album. Two regions: an **info/actions region** and a **photo
grid region**.

### Loading / error
- **Loading:** placeholder info region + placeholder photo grid.
- **Error:** "Failed to Load Album", the error text, and a **Try Again** action.

### Info / actions region
- **Back to Albums** action.
- **Album info:** section label "Album" + a **sync-status indicator** ("Synced"); the album
  **title**; a subline with the event date and photo count.
- **Actions:**
  - **Favorites toggle** — switches between "Show Favorites (N)" and "Show All Images";
    indicates active state.
  - **Filter by Client** dropdown — appears when clients have favorited; lets the user view
    favorites for a specific client (or all).
  - **Share Album** — generates/opens a shareable client link (see Share popup below).
  - **Refresh** — reloads the album's photos.

### Photo grid region
- **Selection header (appears once photos are selected):** a **cancel** action, "N
  selected", a **Select All** action, and a **Copy to…** action (copies the chosen photos
  to a folder the user picks).
- **Empty state:** distinct messaging for the favorites view vs the all-photos view; the
  favorites view includes a "View All Photos" action.
- **The grid:** responsive thumbnails, infinite-scroll (loads more as the user scrolls; a
  loading indicator appears at the bottom while the next batch loads). Each **photo tile**
  exposes (on hover/selection):
  - **Selection control** — indicates selected state.
  - **Favorite indicator** (with count) — hovering reveals a "Favorited by:" list of client
    names.
  - **Notes indicator** (with count) — opens the client-notes panel. Its position shifts to
    avoid overlapping the selection control when selection mode is active.
  - **Hover bar:** the filename + a **Show Original in Folder** action.
  - **Status indicator:** "Processing" or "Failed" while not done; failed photos show an
    "Image Failed" placeholder instead of an image.
  - Activating a photo opens the **full-screen lightbox**.

### Lightbox (full-screen viewer)
- Full-screen viewer with: previous/next navigation, zoom, close, and a **Notes** action
  that opens the client-notes panel for that photo.

### Share Album popup
- A confirmation ("Your share link is ready!"), the link in a read-only field with a
  **copy** action, a "✓ Copied to clipboard!" confirmation after copying, then **Open in
  Browser** and **Done** actions.

### Client Notes panel (slides in)
- **Header:** "Client Notes" + the photo's filename.
- **Body:** a list of client comments (client name + date + note text). Empty state: "No
  Notes Yet".
- **Footer:** "N notes from clients".

---

## 5. Profile / Settings

**Feel / intent:** controlled and trustworthy — a place to manage account, plan, and
storage with confidence. Clear structure, obvious save/confirm feedback, and appropriate
caution around destructive or irreversible actions (reset, storage change). Should feel
orderly, not overwhelming, despite holding many settings.
*Previously:* a tabbed split layout with a persistent settings navigation and one content
panel per tab.

Two regions: a **navigation region** + a **content region**. The content swaps based on
the selected tab.

### Navigation region
- Section label "Account" + title "Settings".
- **Tabs:** My Profile, Watch Folder, Billing & Plan, Advanced, Updates. Active tab is
  indicated.
- **Back to Albums** and **Logout** actions.

### Tab — My Profile
- "Public Profile" heading (a transient "Saved" confirmation appears after saving).
- **Form (2-column):**
  - **Full Name** — read-only (managed by Google account).
  - **Business Name** — editable.
  - **Email** — read-only (Google).
  - **Phone Number** — editable.
- **Booking URL section:** description + a **Get Link** action that opens a popup with the
  shareable booking link.
- **Save Changes** action.

### Tab — Watch Folder
- Heading + explanation (a master folder auto-creates albums from its subfolders).
- **Master Watch Folder section:** a control showing the current path (or "Not configured")
  — activating it lets the user pick a folder. A warning appears when changing an existing
  folder. An **Open Watch Folder** action, and a **"How it works"** 3-step list.

### Tab — Billing & Plan
- **Current plan section:** plan name, expiry date, an "Active" indicator, and an
  **image-usage indicator** ("N / limit"). Warnings appear when near or at the limit.
- **Available Plans section:** a grid of plans, each with name, price, image limit, and
  description. The current plan is tagged; upgrade options show a **Request Upgrade**
  action. Success/error feedback appears after requesting.

### Tab — Advanced
- **Internal Storage Location section:** explains where compressed images are kept before
  upload; a control to change it (changing prompts a confirmation warning that
  old-location albums won't be accessible). A **free-space** indicator with a low-space
  warning.
- **Reset All Data section:** lists what gets deleted (albums, images, settings, login), a
  "cannot be undone" warning, and a **Reset All Data** action (with its own confirmation
  popup).

### Tab — Updates
- **App Updates section:** shows the app version and a **Check Now** action. A status
  message reports whether an update is available.

---

## 6. Bookings

**Feel / intent:** efficient and scannable — a working list the photographer checks at a
glance. Should feel like a clean, dependable schedule: quick to find the next event, easy
to act on contact details, no clutter. Utilitarian over decorative.
*Previously:* a straightforward tabbed table (Upcoming/Past) with details expanding inline.

Two regions: a **header** + a **tabbed table** of client bookings.

### Header
- **Back to Albums** action.
- Section label "Management" + title "Bookings".
- **Get Booking Link** action — opens the same booking-link popup as Profile.
- **Tabs:** **Upcoming** / **Past**, each with a count (split by event date).

### Content
- **Error:** message with a **Try Again** action.
- **Loading:** placeholder table.
- **Empty:** "No upcoming/past bookings" message.
- **Table columns:**
  - **Client** — name.
  - **Event Type** — a tag.
  - **Date & Location** — date; location.
  - **Contact** — a click-to-call phone number.
  - **Details** — a preview; activating it expands the full details (or "No details" if
    empty).

---

## 7. Create Album (popup)

**Feel / intent:** light and quick — a focused task that should feel like a small, friendly
step, not a form to dread. Guidance should feel helpful (explaining what each choice does)
rather than demanding. Limits and offline states communicated gently, without blocking
comprehension.

A popup titled "Create New Album".
- **Limit warning** (if near/at the image limit): a banner with an **Upgrade Plan** action.
- **Album Name** — required text field.
- **Source Folder** (optional):
  - If none chosen: a **Select Existing Folder** action (auto-fills the album name from the
    folder name).
  - If chosen: the path shown with a clear action.
  - Helper text adapts to explain what will happen (create a folder in the watch folder, a
    standalone album, or a watch-folder album).
- **Tip section** with context-specific guidance.
- **Cancel** / **Create Album** actions. When offline, the create action is disabled and
  labeled "Offline".

---

## 8. Sync Album (popup)

**Feel / intent:** clear and confidence-building — the user is reconciling files and needs to
trust what will change. Should feel precise and transparent (exactly what's new, modified,
renamed, deleted, skipped) so the user feels in control before committing. Calm, not
alarming, even when many changes are listed.
*Previously:* a visually distinct popup (set apart from the rest of the app) with
color-coded, expandable change categories.

A popup for reviewing and applying source-folder changes.
- **Header:** "Sync Album" + the album name, close action.
- **Loading:** "Detecting changes…" indicator.
- **No changes:** "Album is in sync".
- **Changes summary:** collapsible sections, each expandable to a file list:
  - **New**, **Modified**, **Renamed** (shows old → new), **Deleted**, **Skipped/duplicate**
    (shows reason).
- **Actions:** Cancel + **Sync Now** (disabled and labeled "Offline" when offline).

---

## 9. Upload Progress widget (Albums header)

**Feel / intent:** quietly reassuring — background work should feel handled and on-track
without demanding attention. At a glance the user knows things are progressing; on demand
they can see detail. Failures surface clearly but without panic. Unobtrusive when collapsed.
*Previously:* a compact progress control that expanded to per-stage detail on demand.

Only visible while photos are processing.
- **The control:** a progress indicator with a percentage and a status label
  ("Compressing…", "Uploading…", "Completed", etc.); shows progress until done, then a
  completion indicator.
- **Expanded panel:** "Upload Progress", a "done / total" count, and per-stage counters —
  Compressing, Uploading, Completed, Failed — plus an overall progress indicator.

---

## 10. Shared popups & elements

- **Generic popup (modal):** centered over a dimmed backdrop, optional title bar with a
  close action; closes on backdrop click or Escape. Used by Share, Booking link, Create
  Album.
- **Dropdown menu:** an anchored menu used by album-card actions, the progress widget, and
  booking details.
- **Booking link popup:** the booking URL in a read-only field + a copy action, plus
  **Close** and **Open Link** actions.

---

## Open items (functional, not design)

- A **disabled onboarding "Watch Folder" step** and an unused **secondary navigation region
  with a mini-calendar + recent albums** exist in the codebase — decide whether to revive
  or drop them.
- The two device-code sections (Wizard §1, Login §2) use different titles — reconcile.
- **Copy-to-folder feedback** currently uses a plain OS alert — decide on the confirmation
  mechanism.

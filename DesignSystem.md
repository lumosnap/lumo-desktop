# LumoSnap Design System

> **Reference**: Calendar/Scheduler UI with dark glassmorphism sidebar and light content area.
> **Aesthetic**: "Modly" - Dark, sophisticated, neon accents (Turquoise/Deep Teal), glassmorphism.

---

## 1. Core Philosophy

- **Dual-theme Layout**: Dark glassmorphism sidebar (`#1e1e23` base) vs. Clean light content area (`#ffffff`).
- **Glassmorphism**: Heavy use of `backdrop-filter: blur()` on sidebars, floating panels, and auth cards.
- **Vibrant Accents**: Turquoise (`#00E0C6`) and Deep Teal (`#005F73`) gradients against dark backgrounds.
- **Premium Feel**: Soft, large shadows (`box-shadow`), rounded corners (`border-radius: 12px+`), and smooth transitions (`transition: all 0.3s`).
- **Interactive**: Hover effects, micro-interactions, and fluid layout changes.

---

## 2. Color Palette

### Brand Colors

| Name         | Hex       | CSS Variable             | Usage                                        |
| ------------ | --------- | ------------------------ | -------------------------------------------- |
| Turquoise    | `#00E0C6` | `--color-turquoise`      | Primary accent, active states, buttons, glow |
| Turquoise Dk | `#00B39F` | `--color-turquoise-dark` | Hover states for primary buttons             |
| Deep Teal    | `#005F73` | `--color-deep-teal`      | Secondary accent, gradients                  |
| Off-White    | `#f5f6f7` | `--color-off-white`      | Main content background base                 |
| Charcoal     | `#262626` | `--color-charcoal`       | Dark text, neutral dark elements             |
| Dark Base    | `#0f0f13` | N/A (Tailwind arbitrary) | Auth page background, deep darks             |

### Semantic Colors

| Name          | Hex       | CSS Variable      | Usage                  |
| ------------- | --------- | ----------------- | ---------------------- |
| Success/Green | `#34D399` | `--color-success` | Confirmed, completed   |
| Warning/Amber | `#FBBF24` | `--color-warning` | Pending, attention     |
| Error/Red     | `#F87171` | `--color-error`   | Errors, delete actions |
| Info/Blue     | `#60A5FA` | `--color-info`    | Information, links     |

### Album Card Colors (Pastel)

Used for calendar events/albums to differentiate categories.

| Name   | Hex       | CSS Variable          | Class                |
| ------ | --------- | --------------------- | -------------------- |
| Yellow | `#FEF3C7` | `--color-card-yellow` | `.album-card-yellow` |
| Green  | `#D1FAE5` | `--color-card-green`  | `.album-card-green`  |
| Purple | `#EDE9FE` | `--color-card-purple` | `.album-card-purple` |
| Pink   | `#FCE7F3` | `--color-card-pink`   | `.album-card-pink`   |
| Blue   | `#DBEAFE` | `--color-card-blue`   | `.album-card-blue`   |
| Peach  | `#FFEDD5` | `--color-card-peach`  | `.album-card-peach`  |

### Surface Colors

| Name           | Value                       | CSS Variable             | Usage             |
| -------------- | --------------------------- | ------------------------ | ----------------- |
| Sidebar BG     | `rgba(30, 30, 35, 0.92)`    | `--color-sidebar-bg`     | Sidebar with blur |
| Sidebar Border | `rgba(255, 255, 255, 0.08)` | `--color-sidebar-border` | Subtle border     |
| Content BG     | `#FFFFFF`                   | `--color-content-bg`     | Main content area |

---

## 3. Typography

### Font Family

- **Primary**: `'Outfit', sans-serif`
- **Fallback**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

### Text Colors

| Context            | Color                      | CSS Variable                  |
| ------------------ | -------------------------- | ----------------------------- |
| On Dark (sidebar)  | `#FFFFFF`                  | `--color-text-on-dark`        |
| On Dark Muted      | `rgba(255, 255, 255, 0.6)` | `--color-text-on-dark-muted`  |
| On Light (content) | `#1F2937`                  | `--color-text-on-light`       |
| On Light Muted     | `#6B7280`                  | `--color-text-on-light-muted` |

---

## 4. Layouts & Structure

### Main Layout (`MainLayout.vue`)

The core application interface.

#### Root Container

- **Style**: `relative flex h-screen w-full overflow-hidden`

#### Background Layer

- **Container**: `absolute inset-0 z-0`
- **Dark Base**: `absolute inset-0 bg-[#0f0f13]`
- **Ambient Blobs** (3 gradient orbs for glassmorphism depth):
  1.  **Turquoise/Blue Blob**: `absolute -left-32 top-1/4 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-teal-500/40 to-blue-600/30 blur-[100px]`
  2.  **Cyan/Emerald Blob**: `absolute -left-20 bottom-0 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-cyan-500/30 to-emerald-400/20 blur-[80px]`
  3.  **Blue/Teal Blob**: `absolute left-32 top-0 h-[300px] w-[300px] rounded-full bg-gradient-to-br from-blue-500/20 to-teal-400/20 blur-[60px]`

#### Sidebar (Left)

- Renders `<Sidebar />` component.
- **Width**: Fixed (280px).
- **Style**: Glassmorphism (`.glass-sidebar`).

#### Content Area (Right)

- **Container**: `<main class="content-area relative z-10 flex-1 overflow-hidden">`
- **Style** (from `.content-area` in `main.css`):
  - `background: var(--color-content-bg)` (#FFFFFF)
  - `border-radius: 24px 0 0 24px`
  - `box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1)`
- **Slot**: `<slot />` for page content.

#### Floating Bottom Navbar

**Purpose**: Quick navigation between primary routes.

- **Positioning Container**: `absolute bottom-6 left-1/2 z-50 -translate-x-1/2` (centered at bottom)
- **Nav Container Style**:
  - `flex items-center gap-2`
  - `rounded-full` (pill shape)
  - `bg-gradient-to-r from-[#1a1a1f]/90 to-[#1f1f24]/90` (dark gradient)
  - `px-4 py-3`
  - `shadow-2xl`
  - `ring-1 ring-white/10` (subtle border)
  - `backdrop-blur-xl` (glass effect)

- **Albums Button** (`router-link to="/albums"`):
  - Container: `group relative flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200`
  - Active State: `bg-white/10`
  - Inactive State: `hover:bg-white/5`
  - Icon: `LayoutGrid` from Lucide, `h-5 w-5`
  - Icon Active: `text-white`
  - Icon Inactive: `text-white/60 group-hover:text-white`

- **Profile Button** (`router-link to="/profile"`):
  - Container: `group relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full ring-2 transition-all duration-200`
  - Active State: `ring-white`
  - Inactive State: `ring-transparent hover:ring-white/30`
  - Avatar Container: `flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-turquoise)] to-[var(--color-deep-teal)]`
  - Icon: `Camera` from Lucide, `h-5 w-5 text-white`

### Auth Layout (`LoginView.vue`, `SignupView.vue`)

Full-screen immersive experience.

1.  **Background**: Deep dark (`#0f0f13`) with large, animated gradient blobs (Turquoise/Blue top-left, Cyan/Emerald bottom-right).
2.  **Card**: Central glass card (`.sidebar-card`).
    - `background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))`
    - `backdrop-filter: blur(16px)`
    - `border: 1px solid rgba(255,255,255,0.08)`
    - `border-radius: 20px`

---

## 5. Page Designs & Features

### 1. Album View (Calendar) - `AlbumView.vue`

**Purpose**: The main dashboard for photographers to see their schedule of shoots.

#### Container

- **Layout**: `flex h-full flex-col` - Full height flexbox column layout.

#### Header Section

- **Container**: `flex items-center justify-between px-8 py-6` - Horizontal flex with space-between, generous padding.
- **Month/Year Title**:
  - Style: `text-3xl font-bold text-[var(--color-text-on-light)]`
  - Format: "December, 2024"
- **Controls Container**: `flex items-center gap-4` - Groups view toggle and navigation.

#### View Toggle (`.view-toggle`)

- **Container Style**: `display: inline-flex`, `background: rgba(0, 0, 0, 0.05)`, `border-radius: 9999px`, `padding: 4px`
- **Button Style** (`.view-toggle-btn`):
  - Base: `padding: 8px 16px`, `border-radius: 9999px`, `font-size: 14px`, `font-weight: 500`, `transition: all 0.2s ease`, `cursor: pointer`, `border: none`, `background: transparent`, `color: var(--color-text-on-light-muted)`
  - Active State (`.active`): `background: white`, `color: var(--color-text-on-light)`, `box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1)`
- **Options**: Month, Week, Day

#### Navigation Controls

- **Container**: `flex items-center gap-2`
- **Chevron Buttons** (Prev/Next Week):
  - Style: `rounded-lg p-2 text-[var(--color-text-on-light-muted)] hover:bg-black/5`
  - Icon: `ChevronLeft` / `ChevronRight` from Lucide, `h-5 w-5`
- **Today Button**:
  - Style: `rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-on-light)] hover:bg-black/5`

#### Week Day Headers

- **Container**: `grid grid-cols-[80px_repeat(7,1fr)] border-b border-black/5 px-4`
  - First column (80px) is empty spacer for time labels.
  - 7 equal columns for each day of the week.
- **Day Cell**:
  - Base Style: `cursor-pointer py-4 text-center transition-all hover:bg-black/5`
  - **Today Highlight**: `rounded-2xl bg-[#1e1e2d] hover:bg-[#252535]`
- **Day Name**:
  - Normal: `text-xs font-medium text-[var(--color-text-on-light-muted)]`
  - Today: `text-white/70`
- **Day Number**:
  - Normal: `text-2xl font-bold text-[var(--color-text-on-light)]`
  - Today: `text-white`
- **Click Action**: Navigates to clicked date.

#### Calendar Grid

- **Scrollable Container**: `content-scrollable flex-1 overflow-y-auto` - Uses custom scrollbar styling.
- **Grid**: `grid grid-cols-[80px_repeat(7,1fr)]`
  - First column (80px) for time labels.
  - 7 equal columns for days.

#### Time Slots

- **Slots**: `['6 am', '7 am', '8 am', '9 am', '10 am', '11 am', '12 pm', '1 pm']`
- **Time Label Cell**:
  - Style: `flex h-24 items-start justify-end pr-4 pt-2`
  - Text: `text-xs font-medium text-[var(--color-text-on-light-muted)]`

#### Day Column Cells

- **Style**: `relative h-24 border-b border-l border-black/5 p-1`
- **Each cell**: 96px height (`h-24`), subtle borders.

#### Album Cards (`.album-card`)

- **Base Style** (from `main.css`):
  - `border-radius: 12px`
  - `padding: 12px`
  - `transition: all 0.3s ease`
- **Hover Effect**: `transform: translateY(-4px)`, `box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15)`
- **Color Variants**: Applied via class (e.g., `.album-card-yellow`, `.album-card-purple`)
- **Cursor**: `cursor-pointer`
- **Dynamic Height**: Calculated as `album.span * 96 - 8 + 'px'` based on duration.
- **Content**:
  - **Title**: `text-xs font-semibold text-[var(--color-text-on-light)]`
  - **Time**: `text-[11px] text-[var(--color-text-on-light-muted)]`
  - **Avatar Stack** (`.avatar-stack`):
    - Container: `display: flex`, `margin-top: 8px`
    - Avatars: Overlapping circles, `h-6 w-6 rounded-full`, colored backgrounds (purple-400, blue-400, pink-400)
    - Overlap: `margin-left: -8px` (except first child), `border: 2px solid white`
  - **Download Button** (conditional, only if `photoCount > 0`):
    - Position: `absolute bottom-2 right-2`
    - Style: `rounded-full bg-white/80 p-1.5 text-[var(--color-text-on-light)] hover:bg-white`
    - Icon: `Download` from Lucide, `h-3 w-3`
- **Click Action**: Navigates to `/albums/:id` (album detail/images view).

#### Album Data Structure

```typescript
interface Album {
  id: number
  title: string
  time: string // Display format: "06:00 - 07:30"
  client: string
  photoCount: number
  color: 'yellow' | 'green' | 'purple' | 'pink' | 'blue' | 'peach'
  dayIndex: number // 0 = Sunday, 6 = Saturday
  timeSlot: number // Index in timeSlots array
  span: number // Duration in time slots
}
```

---

### 2. Images View (Gallery) - `ImagesView.vue`

**Purpose**: Viewing photos within a specific album.

- **Header**:
  - Breadcrumb-style back navigation.
  - Album Title & Metadata.
  - **Toolbar**: View Mode (Grid/List), Filter, Download All.
- **Selection Mode**:
  - Appears when images are selected.
  - **Bar**: Purple bar (`bg-[var(--color-card-purple)]`) with actions (Share, Delete).
- **Grid View**:
  - Responsive grid (`grid-cols-2` to `grid-cols-5`).
  - **Image Cards**: Aspect square, rounded corners (`rounded-2xl`).
  - **Hover Overlay**: Gradient fade-in from bottom with actions (Like, More).
  - **Selection**: Checkbox appearing on hover or when selected.
- **List View**:
  - Horizontal rows with thumbnail, metadata, and inline actions.

### 3. Profile View (Settings) - `ProfileView.vue`

**Purpose**: User settings and account management.

- **Structure**: Sidebar Tabs + Content Layout.
- **Sidebar Tabs**:
  - Vertical buttons (Profile, Billing, Security).
  - Active state: Turquoise background (`bg-[var(--color-turquoise)]`) with shadow.
- **Content**:
  - **Cards**: White sections with light borders (`border-black/5`).
  - **Forms**: Clean inputs with Turquoise focus rings.
  - **Billing**: Gradient card (`from-teal-50 to-cyan-50`) highlighting current plan.

### 4. Authentication (Login/Signup)

**Purpose**: Entry point.

- **Visuals**: High-end glassmorphism.
- **Inputs**: Dark semi-transparent backgrounds (`bg-white/5`) with white text.
- **Buttons**: Large, Turquoise gradient buttons with glow (`shadow-teal-500/30`).

---

## 6. UI Components & Styles

### Buttons (`Button.vue`)

- **Primary Button**: Solid Turquoise (`#00E0C6`) background with dark text (`#111827`). Rounded corners, subtle glow shadow.
- **Secondary Button**: Transparent background with white border.
- **Ghost Button**: Transparent background, hover effect only.
- **Outline**: Transparent, Turquoise border and text.
- **Danger**: Red background tint (`bg-red-500/10`), red text.

### Inputs (`Input.vue`)

- **Style**: Designed for dark backgrounds (mostly used in Auth/Sidebar contexts, though Profile uses a light variant).
  - Background: `bg-[var(--color-surface-3)]`.
  - Border: `1px solid rgba(255,255,255,0.1)`.
  - Text: White, placeholder muted.
- **States**:
  - **Focus**: Turquoise border (`var(--color-primary)`) + Ring.
  - **Error**: Red border + Error message text.

### Cards (`Card.vue`)

- **Base Style**: `glass-panel`, `rounded-xl`.
- **Hover Option**: `hover` prop enables lift (`-translate-y-1`) and enhanced shadow.
- **Padding**: Configurable (`none`, `sm`, `md`, `lg`).

### Modal (`Modal.vue`)

- **Overlay**: `bg-black/60` with `backdrop-blur-sm`.
- **Container**: `glass-panel`, `rounded-2xl`, `shadow-xl`.
- **Animation**: Scale in (`scale-95` to `scale-100`) and Fade in.

### Sidebar (`Sidebar.vue`)

**Purpose**: Main navigation and quick-access widgets on the left side.

#### Container

- **Style**: `glass-sidebar relative z-10 flex h-screen w-[280px] flex-col overflow-hidden`
- **Width**: Fixed 280px.

#### Scrollable Content

- **Container**: `sidebar-scrollable flex-1 space-y-4 overflow-y-auto p-4`
- Uses custom scrollbar styling (`.sidebar-scrollable` from `main.css`).

#### Internal Cards (`.sidebar-card` - scoped style)

```css
.sidebar-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 16px;
  backdrop-filter: blur(8px);
}
```

---

#### CARD 1: User Profile + Mini Calendar

**User Profile Section**:

- **Container**: `mb-6 flex items-center gap-3`
- **Avatar**:
  - Container: `relative`
  - Circle: `flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-turquoise)] to-[var(--color-deep-teal)]`
  - Icon: `Camera` from Lucide, `h-6 w-6 text-white`
- **Notification Badge**:
  - Position: `absolute -right-1 -top-1`
  - Style: `flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-turquoise)] text-[10px] font-bold text-white`
- **User Info**:
  - Name: `font-semibold text-white`
  - Subtitle: `text-xs text-[var(--color-text-on-dark-muted)]`
- **Calendar Icon Button**:
  - Style: `ml-auto rounded-lg p-2 text-[var(--color-text-on-dark-muted)] hover:bg-white/5`
  - Icon: `Calendar` from Lucide, `h-5 w-5`

**Mini Calendar Section**:

- **Month Navigation**:
  - Container: `mb-4 flex items-center justify-between`
  - Title: `text-sm font-semibold text-white` (e.g., "December 2024")
  - Nav Buttons: `rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white`
  - Icons: `ChevronLeft` / `ChevronRight`, `h-4 w-4`

- **Day Name Headers**:
  - Container: `mb-2 grid grid-cols-7 gap-0`
  - Style: `text-center text-[11px] font-medium text-[var(--color-text-on-dark-muted)]`
  - Days: `['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']`

- **Calendar Grid**:
  - Container: `grid grid-cols-7 gap-1`
  - **Day Button**:
    - Base: `flex h-8 w-8 items-center justify-center rounded-full text-xs transition-all duration-150`
    - **Today**: `bg-[#5B8DEF] text-white font-bold`
    - **Current Month**: `text-white hover:bg-white/10`
    - **Other Month**: `text-white/30`
    - **Selected (not today)**: `ring-2 ring-[var(--color-turquoise)]`

- **Calendar Day Data Structure**:

```typescript
interface CalendarDay {
  date: number
  isCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
}
```

---

#### CARD 2: Upcoming Shoot Preview

- **Container**: `sidebar-card overflow-hidden !p-0` (no padding override)
- **Inner Container**: `relative bg-gradient-to-br from-amber-700/40 to-amber-900/60 p-4`

- **Time Badge**:
  - Position: `absolute right-3 top-3`
  - Container: `time-badge flex items-center gap-1` (uses `.time-badge` from `main.css`)
  - Pulsing Dot: `inline-block h-2 w-2 animate-pulse rounded-full bg-green-400`
  - Text: Minutes away (e.g., "14 min")

- **Time Range**: `mb-1 text-xs text-white/70` (e.g., "12:00 - 13:30")
- **Title**: `mb-3 text-sm font-semibold leading-tight text-white`

- **Action Buttons**:
  - Container: `flex gap-2`
  - **Later Button**: `rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-white/20`
  - **Details Button**: `rounded-full bg-[var(--color-turquoise)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-turquoise-dark)]`

- **Upcoming Shoot Data Structure**:

```typescript
interface UpcomingShoot {
  time: string // "12:00 - 13:30"
  title: string // "Wedding Shoot at the Grand Hotel"
  client: string // "Smith Couple"
  minutesAway: number // 14
}
```

---

#### CARD 3: My Albums Section

- **Header Button** (collapsible):
  - Style: `mb-3 flex w-full items-center justify-between text-sm font-semibold text-white`
  - Chevron: `ChevronDown`, `h-4 w-4 text-white/60 transition-transform`
  - Collapsed State: `rotate-180`

- **Album List** (when expanded):
  - Container: `space-y-2`
  - **Album Item**:
    - Container: `flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5`
    - **Checkbox**: `h-4 w-4 rounded border-white/20 bg-transparent text-[var(--color-turquoise)] focus:ring-[var(--color-turquoise)] focus:ring-offset-0`
    - **Name**: `flex-1 text-sm text-white`
    - **Count Badge**: `rounded-full bg-[var(--color-turquoise)] px-2 py-0.5 text-[10px] font-bold text-white`

- **Album Data Structure**:

```typescript
interface AlbumFilter {
  name: string // "Weddings"
  count: number // 8
  checked: boolean
}
```

---

#### CARD 4: Categories Section

- **Header Button** (collapsible):
  - Same styling as My Albums header.

- **Category List** (when expanded):
  - Container: `space-y-3`
  - **Category Item**:
    - Container: `flex items-center gap-3`
    - **Color Indicator**: `.category-indicator` (`w-8 h-8 rounded-full`, dynamic `backgroundColor`)
    - **Name**: `flex-1 text-sm text-white`
    - **Progress Bar**: `.progress-bar w-16`
      - Track: `height: 4px`, `background: rgba(255, 255, 255, 0.1)`, `border-radius: 2px`
      - Fill: `.progress-bar-fill`, dynamic `width` and `backgroundColor`

- **Category Data Structure**:

```typescript
interface Category {
  name: string // "Personal"
  color: string // "#F87171"
  progress: number // 70 (percentage)
}
```

---

## 7. Assets & Global Styles

- **`base.css`**: CSS variables for basic colors and resets.
- **`main.css`**: Tailwind theme configuration and custom component classes:
  - `.glass-sidebar`: Sidebar glass effect (`backdrop-filter: blur(24px)`, `box-shadow: 0 0 40px rgba(0, 0, 0, 0.3)`).
  - `.glass-panel`: Generic glass card.
  - `.content-area`: Main content container.
  - `.album-card`: Pastel album cards with hover effects.
  - `.album-card-*`: Color variants (yellow, green, purple, pink, blue, peach).
  - `.view-toggle`: Pill-shaped view switcher.
  - `.view-toggle-btn`: Individual toggle buttons.
  - `.mini-calendar-cell`: Calendar day styling.
  - `.avatar-stack`: Overlapping avatar circles.
  - `.content-scrollable`: Custom scrollbar for content area (6px width, subtle gray).
  - `.sidebar-scrollable`: Custom scrollbar for sidebar (4px width, very subtle).
  - `.time-badge`: Blurred badge for time display.
  - `.category-indicator`: Small colored circle.
  - `.progress-bar` / `.progress-bar-fill`: Thin progress indicator.

---

## 8. Premium Design Checklist

To maintain the "Modly" aesthetic:

1.  [ ] **Glassmorphism**: Is the sidebar/overlay using `backdrop-filter: blur()`?
2.  [ ] **Shadows**: Are shadows soft and colored (e.g., turquoise glow) rather than harsh black?
3.  [ ] **Spacing**: Is there ample whitespace (padding `p-6` or `p-8`)?
4.  [ ] **Typography**: Is 'Outfit' used? Are headings bold and hierarchy clear?
5.  [ ] **Contrast**: Is the text legible against the glass/dark backgrounds?
6.  [ ] **Borders**: Are borders subtle (`border-white/10` or `border-black/5`)?
7.  [ ] **Gradients**: Are background blobs used to create depth behind glass elements?

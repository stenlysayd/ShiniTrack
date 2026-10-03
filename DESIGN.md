# Design System: ShiniTrack — Modern Manga Archive & Release Radar

## 1. Visual Theme & Atmosphere
A focused, distraction-free **Modern Manga Archive** atmosphere designed for mobile-first reading and precision release tracking. The aesthetic balances the sleek, tactile utility of a Japanese editorial catalog with the cinematic mood of an anime production house. The visual density is **Daily App Balanced (5/10)**, the variance is **Offset Asymmetric (7/10)** to avoid generic cookie-cutter grids, and the motion is **Fluid Spring (6/10)** with zero jarring jumps.

- **Vibe:** Cinematic dark mode, razor-sharp vector typography, subtle frosted glass HUDs, and tactile tactile push states.
- **Canvas:** Deep Void Charcoal (`#090a0f`), avoiding muddy grays and avoiding harsh pure black (`#000000`) for content containers.
- **Lighting:** Warm micro-scrims on manga covers, delicate 1px whisper borders, and an authoritative Shinigami Crimson accent.

---

## 2. Color Palette & Roles
Strict single-accent calibration. Oversaturated neon blues, rainbow glows, and AI-purple gradients are strictly banned.

| Role | Color Name | Hex / RGBA | Usage |
| :--- | :--- | :--- | :--- |
| **Canvas Background** | Void Black | `#090a0f` | Main viewport canvas, reader background |
| **Surface Card** | Deep Slate | `#12151e` | Manga cards, day schedule containers, modal body |
| **Surface Elevated** | Elevated Ink | `#191e2b` | Hover states, active chips, dropdowns, inputs |
| **Surface Translucent** | Frosted Obsidian | `rgba(12, 15, 23, 0.88)` | Top bar, tab bar, floating reader HUD (with 16px blur) |
| **Border Whisper** | Subtle Glass Border | `rgba(255, 255, 255, 0.06)` | Structural container dividers, card outlines |
| **Border Active** | Focus Stroke | `rgba(225, 29, 72, 0.35)` | Selected filters, active input focus ring |
| **Primary Accent** | Shinigami Crimson | `#e11d48` | Primary CTA buttons, unread badges, active tab indicator |
| **Accent Glow / Hover** | Rose Flame | `#f43f5e` | Active state button interaction, active scrubber pill |
| **Secondary Accent** | Ghost Cyan | `#38bdf8` | Reading progress numbers, timeline clock badges |
| **Status Success** | Muted Emerald | `#10b981` | Completed / read status, up-to-date indicator |
| **Status Warning** | Amber Warning | `#f59e0b` | Medium confidence predictions, schedule changes |
| **Status Hiatus** | Crimson Alert | `#ef4444` | Hiatus warning, overdue releases |
| **Text Primary** | Pure Ivory | `#f8fafc` | Titles, headlines, primary button text |
| **Text Secondary** | Steel Slate | `#94a3b8` | Chapter subtitles, metadata, release times |
| **Text Faint** | Dark Iron | `#64748b` | Category headers, inactive icons, timestamps |

---

## 3. Typography Rules
- **Font Stack:** Modern sans-serif system stack optimized for mobile screens (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Helvetica Neue", sans-serif`).
- **Display Headlines:** Track-tight (`letter-spacing: -0.025em; font-weight: 700; color: #f8fafc`). Controlled scale: 18px–22px on mobile, never screaming or bloated.
- **Section Headers:** Uppercase tracking (`font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b;`).
- **Body & Subtitles:** Relaxed leading (`line-height: 1.5; font-size: 13px–14px; color: #94a3b8`). Max 65 characters per line for synopsis readability.
- **Monospace Numbers:** Chapters, timestamps, and page numbers use tabular numbers (`font-variant-numeric: tabular-nums`) to prevent layout jitter during scrubber drags.

---

## 4. Component Stylings

### 4.1 Buttons & Touch Targets
- **Tactile Push Feedback:** Active state scales slightly (`transform: scale(0.97)`) with instantaneous spring recovery.
- **Minimum Tap Target:** Every interactive element has at least a 44×44px hit-box to ensure ergonomic one-handed mobile use.
- **Primary CTA:** Solid Shinigami Crimson (`#e11d48`), white text, crisp 10px rounded corners, subtle bottom depth shadow (`box-shadow: 0 3px 12px rgba(225, 29, 72, 0.3)`).
- **Secondary / Ghost:** Elevated Ink background (`#191e2b`), 1px whisper border, text secondary.

### 4.2 Manga Grid Cards (Mihon Library)
- **Aspect Ratio:** `3 / 4.4` vertical poster ratio.
- **Cover Glass Scrim:** Bottom linear-gradient overlay (`linear-gradient(to top, rgba(9,11,16,0.95) 0%, rgba(9,11,16,0.6) 55%, transparent 100%)`).
- **Indicators:**
  - Unread / Baru badge: Top-right crimson pill with bold white tracking.
  - Notification state: Top-left subtle bell icon.
  - Reading progress: Bottom micro progress bar or chapter badge (`Ch. X`).
- **Corners:** Consistent 12px corner radius with `overflow: hidden;`.

### 4.3 Search & Inputs
- Integrated SVG magnifying glass icon inside the input bar.
- Background: Elevated surface (`#12151e`), subtle border (`#222738`), text primary.
- Focus: Border transitions to Crimson focus stroke with a 3px diffused outer halo (`box-shadow: 0 0 0 3px rgba(225, 29, 72, 0.15)`).

### 4.4 Toggle Switches
- Native-like iOS/Material pill switches (`width: 44px; height: 26px; border-radius: 999px;`) with smooth thumb glide transition. Replaces generic HTML checkboxes.

### 4.5 Filter Chips
- Rounded pill buttons (`border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 600;`).
- Inactive: Deep Slate background with whisper border.
- Active: Crimson tinted background (`rgba(225, 29, 72, 0.18)`), Crimson border, pure white text.

### 4.6 Floating Reader HUD
- Top Bar & Bottom Bar: Frosted Obsidian with 16px backdrop blur, whisper border divider.
- Scrubber: Minimalist range slider with custom crimson thumb and floating page pill (`Page X / Y`).
- Reading modes: Quick toggle between Webtoon continuous strip and Paged book mode.

### 4.7 Empty States & Loaders
- Composed vector SVG illustrations (Book, Radar, Bell, Search) with subtle muted colors.
- Clear title + descriptive action button. Never plain unstyled text.
- Skeletal shimmer loaders matching exact card dimensions during data fetch.

---

## 5. Layout Principles
- **Grid-First & Mobile-First:** Single-column layout on mobile, dynamic 3-to-4 column responsive grid for manga covers (`repeat(auto-fill, minmax(105px, 1fr))`).
- **Safe Area Insets:** Strict enforcement of `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` so content is never obscured by camera punch-holes or navigation gesture bars.
- **No Overlapping Clutter:** Clear visual hierarchy. Text never collides with floating icons.
- **Fixed Top & Bottom chrome:** Header and Tabbar remain anchored with frosted glass translucency, providing effortless thumb navigation.

---

## 6. Motion & Interaction
- **Physics:** Snappy spring transitions (`cubic-bezier(0.16, 1, 0.3, 1)`) for modal popups, tab switching, and card taps.
- **HUD Visibility:** Reader HUD smoothly fades and slides (`opacity: 0; transform: translateY(-8px)`) on tap, allowing full-screen immersive reading.
- **Micro-interactions:**
  - Sync button: 360° infinite spin during sync action.
  - Download progress bar: Smooth CSS width transition with animated gradient shimmer.
  - Toast alert: Snappy slide-up and fade-in from bottom.

---

## 7. Anti-Patterns (Strictly BANNED)
1. 🚫 **NO EMOJIS ANYWHERE in the UI** — Replace every emoji (`⭐`, `📅`, `🔍`, `🔔`, `⚙️`, `←`, `⟳`, `⚠️`, `✓`, `🔲`, `☰`) with sharp, clean inline SVG vector icons.
2. 🚫 **NO generic AI neon-purple gradients** — Strict single-accent palette centered around Shinigami Crimson (`#e11d48`) and Deep Void Slate.
3. 🚫 **NO pure black `#000000` surfaces** for content cards (reserves `#000000` only for the comic reader canvas).
4. 🚫 **NO unstyled raw HTML inputs or checkboxes** — Every input, switch, and button is custom-designed.
5. 🚫 **NO plain text empty states** — All empty states feature tailored SVG illustrations and clear CTAs.
6. 🚫 **NO awkward layout jumps** — Skeleton loaders and fixed-dimension aspect-ratios prevent cumulative layout shifts (CLS).
7. 🚫 **NO oversized floating headers** — Top bar strictly 56px (+ safe-area) with clean truncation for long titles.

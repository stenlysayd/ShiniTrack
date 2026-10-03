# ROADMAP

Work in order. One task card = one chat. Tick the box in `docs/PROGRESS.md` when done.
Phases 0-2 have full task cards. For Phase 3+, first ask the AI: "Expand Phase N into task cards using the same format as Phase 0", then do the cards one by one.

Task card format: GOAL / READ / EDIT / STEPS / DONE WHEN.

---

## PHASE 0 - Safety, cleanup, refactor (no new features)

### 0.1 Audit the UI (read only, change nothing)
- GOAL: Know what `app/ui/app.js` really contains.
- READ: `app/ui/index.html`, `app/ui/app.js`, `app/src-tauri/src/lib.rs`.
- STEPS:
  1. List every route (`#/...`) and which function renders it.
  2. List every `invoke('...')` call in app.js.
  3. List every command in `generate_handler![]`.
  4. Compare 2 and 3. Report commands used but missing, and commands defined but never used.
  5. Write result to `docs/AUDIT.md`.
- DONE WHEN: `docs/AUDIT.md` exists. No other file changed.

### 0.2 Fix small known bugs
- READ: `docs/PROJECT_MAP.md` (Known Issues), then the files named in each issue.
- EDIT: only files named in issues 2, 3, 4, 5, 6, 7, 9.
- STEPS: fix issues 2,3,4,5,6,7,9 one by one. For issue 3 make `CURRENT_APP_VERSION` come from `env!("CARGO_PKG_VERSION")` and keep the Gradle fallback equal to the workspace version.
- DONE WHEN: `cargo check --workspace` passes. List what you changed per issue number.

### 0.3 Fix the read-state bug (issue 1)
- READ: `crates/core/src/store.rs` (functions `mark_chapter_read`, `list_read_chapter_ids`, `save_reading_progress`), UI reader code in app.js that calls `mark_chapter_read`.
- STEPS:
  1. `list_read_chapter_ids` must read ONLY from `chapter_read`.
  2. The reader must call `mark_chapter_read(read=true)` when the user reaches the last page.
  3. Update the unit tests in store.rs (`reading_progress_flow`) so they match.
- DONE WHEN: `cargo test --workspace` passes. Opening a chapter and leaving at page 2 does NOT mark it read.

### 0.4 Add DB migration system
- READ: `crates/core/src/store.rs` (top: `SCHEMA`, `Store::init`).
- STEPS:
  1. Keep the existing `SCHEMA` as version 1.
  2. Add `const MIGRATIONS: &[&str]` (index 0 = migration to version 2).
  3. Store `schema_version` in `kv`. On `init`, run missing migrations in order, inside a transaction.
  4. Add a test: open an in-memory DB, check `schema_version`.
- DONE WHEN: tests pass. Old databases still open.

### 0.5 Split app.js into modules
- GOAL: Small files, so AI context stays small.
- READ: `app/ui/app.js`, `app/ui/index.html`.
- TARGET STRUCTURE:
```
app/ui/js/main.js        entry, starts router
app/ui/js/api.js         ONLY invoke() wrappers, one function per command
app/ui/js/router.js      hash router: routes table -> view function
app/ui/js/state.js       small shared state + prefs cache
app/ui/js/utils.js       formatters (time ago, chapter number), escapeHtml
app/ui/js/components/    toast.js, modal.js, chip.js, switch.js, empty.js
app/ui/js/views/         library.js, updates.js, history.js, explore.js, detail.js, reader.js, more.js, settings/*.js
```
- STEPS:
  1. In index.html use `<script type="module" src="js/main.js"></script>` (keep `icons.js` as normal script before it).
  2. Move code. Do NOT change behavior. Move one view per commit-sized step.
  3. All user text must stay the same.
- DONE WHEN: app behaves the same. Every file under 300 lines. No leftover `app.js`.

### 0.6 Add `escapeHtml` everywhere
- GOAL: Titles from the API are put into `innerHTML`. Escape them.
- STEPS: use `utils.escapeHtml()` for every API string inserted in a template.
- DONE WHEN: grep for `${m.title}` style raw inserts finds none.

---

## PHASE 1 - Mihon-style shell

### 1.1 New bottom navigation (5 tabs, same as Mihon)
- Tabs and labels: Pustaka (`#/library`), Pembaruan (`#/updates`), Riwayat (`#/history`), Jelajahi (`#/explore`), Lainnya (`#/more`).
- EDIT: `index.html`, `router.js`, `style.css`. Keep old hashes working with redirects (`#/favorites` -> `#/library`, `#/search` -> `#/explore`, `#/settings` -> `#/more/settings`).
- Style: active tab = pill background behind icon (crimson tint), label always visible.
- DONE WHEN: all 5 tabs open a view (empty view is OK for More until 1.2).

### 1.2 "Lainnya" (More) screen
Layout, top to bottom, like Mihon:
1. App logo header.
2. Switch: "Hanya yang sudah diunduh" - subtitle "Saring semua entri di pustaka Anda".
3. Switch: "Mode penyamaran" - subtitle "Jeda riwayat membaca".
4. Divider.
5. Rows: Antrean unduhan (subtitle shows queue state), Kategori, Statistik, Data dan penyimpanan.
6. Divider.
7. Rows: Pengaturan, Dukung Kami (hide for now), Tentang, Bantuan (opens GitHub issues link).
- Each row: icon left, title, optional subtitle, tap = go to route.
- Switch values are stored through the prefs system (task 1.3).
- DONE WHEN: all rows navigate to a placeholder screen with a back button.

### 1.3 Preferences system (backend + JS)
- GOAL: One generic way to save settings.
- RUST: add commands `pref_get_all() -> HashMap<String,String>` and `pref_set(key, value)`. Store in `kv` with key prefix `pref.`. Do NOT touch existing `settings_get/settings_set`.
- JS: `state.js` loads all prefs once at start into a Map. `getPref(key, default)`, `setPref(key, value)` (updates Map + calls backend).
- DONE WHEN: set a pref, restart app, value is still there.

### 1.4 Reusable UI components
Create in `js/components/`: `switch-row.js`, `list-row.js`, `section-header.js`, `select-dialog.js` (radio list in a modal), `bottom-sheet.js` (tabs inside), `confirm-dialog.js`, `top-bar.js` (back arrow + title + optional actions).
- Each returns an HTML string or a DOM element. Each has a short comment on how to use it.
- DONE WHEN: a temporary test page `#/dev/components` shows all of them. Remove or hide that route in release.

---

## PHASE 2 - Categories + real Library

### 2.1 DB: categories
- Migration: `category(id INTEGER PK, name TEXT UNIQUE, sort_order INTEGER, flags INTEGER DEFAULT 0)`, `manga_category(manga_id TEXT, category_id INTEGER, PRIMARY KEY(manga_id, category_id))`.
- Store functions: `list_categories_with_count`, `create_category`, `rename_category`, `delete_category`, `reorder_categories(ids)`, `set_manga_categories(manga_id, ids)`.
- A manga with no category appears in the virtual category "Bawaan" (default).
- Add unit tests.

### 2.2 Commands for categories
- Add the 7 commands (3 places rule). Names: `category_list`, `category_create`, `category_rename`, `category_delete`, `category_reorder`, `set_manga_categories`, `get_manga_categories`.

### 2.3 Category screen ("Ubah kategori")
- Route `#/more/categories`. Cards with drag handle, edit (pencil), delete (trash). Floating button "Tambah" bottom right. Dialogs for add/rename/delete confirm.
- Drag reorder: use pointer events, no library. Save order on drop.

### 2.4 Library with category tabs
- Top bar: title "Pustaka" + count pill, buttons: search, filter, more menu.
- Horizontal scrollable tabs: each tab shows `name` + count pill. Active tab has crimson underline.
- Grid shows only manga of the active category.
- Long-press a card -> multi-select mode -> action "Ubah kategori".
- In manga detail: tapping the heart opens a dialog to choose categories (if any category exists).

### 2.5 Fast library query
- GOAL: handle 5000+ entries.
- RUST: new store function `library_page(category, sort, filters, search, limit, offset)` returning rows with `unread_count`, `last_read_at`, `downloaded_count`. New command `library_list`.
- Needs table `chapter(manga_id, chapter_id, number, name, released_at, PRIMARY KEY(chapter_id))` filled when a manga's chapters are fetched. Add as migration.
- Keep prediction OUT of this query (load prediction only in the detail screen / schedule).
- JS: render in batches of 30 with IntersectionObserver (infinite scroll).
- DONE WHEN: with 5000 fake rows in a test, first page returns in under 100 ms.

### 2.6 Library display and sort settings (bottom sheet with 3 tabs)
- Tab "Filter": Terunduh, Belum dibaca, Dimulai, Selesai (tri-state checkbox: off / include / exclude).
- Tab "Urutkan": Alfabet, Terakhir dibaca, Terakhir diperbarui, Jumlah belum dibaca, Terakhir ditambahkan, Acak. Tap again = reverse.
- Tab "Tampilan": Compact grid, Comfortable grid, List. Switches: badge belum dibaca, badge terunduh, badge notifikasi, jumlah item di tab.
- Save to prefs.

---

## PHASE 3 - Settings (see docs/SETTINGS_SPEC.md)
Order: framework (3.1) -> Tampilan -> Pustaka -> Pembaca -> Unduhan -> Sinkronisasi -> Jelajahi -> Keamanan dan privasi -> Lanjutan -> Tentang.
- 3.1 Build a declarative settings renderer (`js/views/settings/schema.js` + `render.js`). Each screen = array of items. Item types: `switch`, `select`, `text`, `button`, `info`, `header`. Renderer is written ONCE.
- 3.2+ One screen per card. Each screen = only a schema file plus the backend it needs.
- Settings main list (exact order and subtitles): see SETTINGS_SPEC.md section 0.

## PHASE 4 - Download queue
- Table `download_queue(chapter_id, manga_id, title, chapter_number, status, position, added_at)`.
- Rust queue manager: one worker, pause/resume, reorder, remove, retry. Events to UI: `download-progress`.
- UI screen "Antrean unduhan" (grouped by manga, progress bar, drag handle, three-dot menu, floating button Lanjut/Jeda).
- Detail screen: select chapters -> download (next 1/5/10/all unread). Settings: Wi-Fi only, delete after read.
- "Hanya yang sudah diunduh" mode filters library and chapter lists.

## PHASE 5 - Updates and History like Mihon
- Pembaruan: list grouped by day ("Hari Ini", "Kemarin", date). Row = cover, title, chapter, check/download button. Top: filter, calendar (upcoming from predictions), refresh. Text "Pustaka terakhir diperbarui: X jam yang lalu". Filter bottom sheet: Terunduh, Belum dibaca, Dimulai, Ditandai; tab Kategori.
- Riwayat: grouped by day, cover, title, "Bab N - HH.mm", delete button, search, clear-all.
- Needs a global library update command that checks all favorites (batched, with progress).

## PHASE 6 - Manga detail and Reader upgrade
- Detail: blurred cover header, action row (Di pustaka, Segera/prediksi, WebView/open site), collapsible description, genre chips, chapter count, chapter list with read dot, bookmark, download state, sticky button "Lanjut".
- Reader: top bar (title, chapter, bookmark, menu), bottom bar (orientation, rotate, crop borders, settings), vertical scrubber on the right with page numbers, chapter transition page, preload next chapter, keep screen on, page number overlay, reading mode per manga.

## PHASE 7 - Statistik + Backup
- Statistik screen: Ringkasan (di pustaka, durasi baca, entri selesai), Entri, Bab (total, baca, terunduh). Needs `read_duration` tracking in reading_progress (migration).
- Backup: export JSON (favorites, categories, manga_category, chapter_read, reading_progress, prefs; NOT the server token unless user ticks a box). Restore with merge. Auto-backup through Kotlin WorkManager (every 6h/12h/daily/weekly), keep last N files, save in app files dir + optional SAF folder.

## PHASE 8 - GSAP polish (read docs/GSAP_RULES.md)
- 8.1 Vendor GSAP + `motion.js` helper.
- 8.2 Page transitions, 8.3 list/grid stagger, 8.4 bottom sheet/dialog, 8.5 tab indicator, 8.6 reader HUD, 8.7 reduced-motion support.

## PHASE 9 - Release
- CI: cargo test + build debug APK artifact. Signed release workflow on tag. Update README (screenshots, correct API level). Keep MIT license, add third-party notices (GSAP license note).

---

## NOT IN SCOPE (say no if asked)
Extensions/sources system, trackers (MAL, AniList), light-novel/epub, local source files, Shizuku installer, widgets.

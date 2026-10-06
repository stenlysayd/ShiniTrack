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

### 3.1 Settings Framework & Main List
- GOAL: Build a declarative settings renderer and the main settings menu.
- READ: `docs/SETTINGS_SPEC.md` (Section 0 and Renderer item shapes).
- EDIT: `app/ui/js/views/settings/render.js`, `app/ui/js/views/settings/index.js`, `app/ui/js/router.js`, `app/ui/style.css`.
- STEPS:
  1. Create `render.js` with a function `renderSettings(container, schema)` that loops over the schema array to build DOM for `header`, `switch`, `select`, `text`, `button`, and `info`. Bind values using `state.js`.
  2. Create `index.js` displaying the 10 main categories matching Section 0. Each row is a button navigating to its sub-route.
  3. Add CSS classes for the new settings controls in `style.css`.
  4. Register `#/more/settings` in `router.js`.
- DONE WHEN: `#/more/settings` shows 10 items. The renderer successfully binds a dummy switch to preferences.

### 3.2 Settings: Tampilan (Appearance)
- GOAL: Implement the Tampilan settings screen.
- READ: `docs/SETTINGS_SPEC.md` (Section 1), `app/ui/js/state.js` (function `getPref`).
- EDIT: `app/ui/js/views/settings/tampilan.js`, `app/ui/js/router.js`, `app/ui/js/main.js`, `app/ui/style.css`.
- STEPS:
  1. Create `tampilan.js` defining the schema array for Section 1.
  2. Register `#/more/settings/tampilan` in `router.js`.
  3. Update `style.css` to add `--bg: #000` for `.amoled` and support `--accent` variable overrides.
  4. Add logic in `main.js` (or `state.js`) to apply `ui.theme_mode`, `ui.amoled`, and `ui.accent` to the `<html>` element on load and when they change.
- DONE WHEN: Changing the theme or AMOLED toggle updates the UI instantly.

### 3.3 Settings: Pustaka (Library)
- GOAL: Implement the Pustaka settings screen and backend bindings.
- READ: `docs/SETTINGS_SPEC.md` (Section 2), `app/src-tauri/src/commands.rs` (function `pref_set`).
- EDIT: `app/ui/js/views/settings/pustaka.js`, `app/ui/js/router.js`, `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`.
- STEPS:
  1. Create `pustaka.js` schema for Section 2.
  2. Register `#/more/settings/pustaka` in `router.js`.
  3. Add a Tauri command `update_worker_interval(interval: &str)` in `commands.rs`.
  4. Register the new command in `lib.rs` inside `generate_handler![]`.
- DONE WHEN: Pustaka settings are rendered and values persist across restarts.

### 3.4 Settings: Pembaca (Reader)
- GOAL: Implement the Pembaca settings screen.
- READ: `docs/SETTINGS_SPEC.md` (Section 3), `app/src-tauri/src/commands.rs` (function `pref_set`).
- EDIT: `app/ui/js/views/settings/pembaca.js`, `app/ui/js/router.js`, `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`.
- STEPS:
  1. Create `pembaca.js` schema for Section 3.
  2. Register `#/more/settings/pembaca` in `router.js`.
  3. Add a Tauri command `set_keep_awake(keep: bool)` in `commands.rs` to toggle the Android screen-on flag.
  4. Register the command in `lib.rs` inside `generate_handler![]`.
- DONE WHEN: Pembaca settings are rendered and values persist.

### 3.5 Settings: Unduhan (Downloads)
- GOAL: Implement the Unduhan settings screen.
- READ: `docs/SETTINGS_SPEC.md` (Section 4).
- EDIT: `app/ui/js/views/settings/unduhan.js`, `app/ui/js/router.js`.
- STEPS:
  1. Create `unduhan.js` schema for Section 4.
  2. Ensure `dl.low_quality` correctly modifies the existing `low_quality` key (use a mapping if necessary to fit the new pref system).
  3. Register `#/more/settings/unduhan` in `router.js`.
- DONE WHEN: Unduhan settings render correctly and integrate with the existing `low_quality` setting.

### 3.6 Settings: Sinkronisasi (Sync)
- GOAL: Implement the Sinkronisasi settings screen reusing existing keys.
- READ: `docs/SETTINGS_SPEC.md` (Section 5), `app/src-tauri/src/backend.rs` (functions `settings_get`, `settings_set`).
- EDIT: `app/ui/js/views/settings/sinkronisasi.js`, `app/ui/js/router.js`, `app/ui/js/api.js`.
- STEPS:
  1. Create `sinkronisasi.js` schema for Section 5.
  2. Override the getter/setter for the Server URL and Token fields to call `settings_set` and `settings_get` instead of the generic pref system.
  3. Add the "Uji koneksi" button logic (triggering the existing health check via `api.js`).
  4. Register `#/more/settings/sinkronisasi` in `router.js`.
- DONE WHEN: Server settings are displayed, updating them hits `settings_set`, and connection testing works.

### 3.7 Settings: Jelajahi (Explore)
- GOAL: Implement the Jelajahi settings screen.
- READ: `docs/SETTINGS_SPEC.md` (Section 6).
- EDIT: `app/ui/js/views/settings/jelajahi.js`, `app/ui/js/router.js`.
- STEPS:
  1. Create `jelajahi.js` schema for Section 6.
  2. Register `#/more/settings/jelajahi` in `router.js`.
- DONE WHEN: Jelajahi settings are rendered and values persist.

### 3.8 Settings: Data dan penyimpanan (UI)
- GOAL: Implement Data dan penyimpanan UI layout.
- READ: `docs/SETTINGS_SPEC.md` (Section 7).
- EDIT: `app/ui/js/views/settings/penyimpanan.js`, `app/ui/js/router.js`.
- STEPS:
  1. Create `penyimpanan.js` schema for Section 7 with placeholders for storage usage stats.
  2. Register `#/more/settings/penyimpanan` in `router.js`.
  3. Add "Buat cadangan", "Hapus cache bab", and "Ekspor" buttons with empty `onClick` handlers.
- DONE WHEN: The screen renders with the correct layout and placeholder buttons.

### 3.9 Backend: Data dan penyimpanan
- GOAL: Implement backend commands for Data dan penyimpanan.
- READ: `crates/core/src/store.rs` (function `Store::init` or backup struct).
- EDIT: `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`, `app/ui/js/api.js`, `app/ui/js/views/settings/penyimpanan.js`.
- STEPS:
  1. Add `storage_info()`, `clear_cache()`, `backup_create()`, `backup_restore()` commands in `commands.rs`.
  2. Register the commands in `lib.rs` and `api.js`.
  3. Update `penyimpanan.js` to call these APIs and show actual disk sizes and trigger backups.
- DONE WHEN: Storage info shows real sizes, and clearing cache works.

### 3.10 Settings: Keamanan dan privasi
- GOAL: Implement Keamanan dan privasi screen.
- READ: `docs/SETTINGS_SPEC.md` (Section 8).
- EDIT: `app/ui/js/views/settings/keamanan.js`, `app/ui/js/router.js`, `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`.
- STEPS:
  1. Create `keamanan.js` schema for Section 8.
  2. Add `set_secure_screen(secure: bool)` in `commands.rs` to toggle the Android `FLAG_SECURE`.
  3. Register the command in `lib.rs`.
  4. Register `#/more/settings/keamanan` in `router.js`.
- DONE WHEN: Privacy settings are rendered and values persist.

### 3.11 Settings: Lanjutan
- GOAL: Implement the Lanjutan settings screen.
- READ: `docs/SETTINGS_SPEC.md` (Section 9), `app/src-tauri/src/commands.rs` (to check where to add commands).
- EDIT: `app/ui/js/views/settings/lanjutan.js`, `app/ui/js/router.js`, `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`.
- STEPS:
  1. Create `lanjutan.js` schema for Section 9.
  2. Add a `generate_crash_log()` command in `commands.rs` to fetch recent logs.
  3. Register the command in `lib.rs` and hook up UI buttons like "Reset pengaturan" and "Bersihkan basis data".
  4. Register `#/more/settings/lanjutan` in `router.js`.
- DONE WHEN: The Lanjutan screen renders and all buttons trigger their respective actions.

### 3.12 Settings: Tentang
- GOAL: Implement the Tentang settings screen.
- READ: `docs/SETTINGS_SPEC.md` (Section 10), `app/src-tauri/src/updater.rs` (function `check_app_update`).
- EDIT: `app/ui/js/views/settings/tentang.js`, `app/ui/js/router.js`, `app/ui/js/api.js`.
- STEPS:
  1. Create `tentang.js` schema for Section 10.
  2. Reuse `check_app_update` for the "Periksa pembaruan" button via `api.js`.
  3. Fetch the app version using the Tauri API or `env!("CARGO_PKG_VERSION")` and display it in the UI.
  4. Register `#/more/settings/tentang` in `router.js`.
- DONE WHEN: The About screen renders with the correct version and update checks work.

## PHASE 4 - Download queue

### 4.1 DB: download_queue table
- GOAL: Add a `download_queue` table so chapters can be queued before downloading.
- READ: `crates/core/src/store.rs` (const `MIGRATIONS`, struct `Download`, function `Store::init`, function `save_download`).
- EDIT: `crates/core/src/store.rs`.
- STEPS:
  1. Add migration (version 4) creating: `download_queue(chapter_id TEXT PRIMARY KEY, manga_id TEXT NOT NULL, title TEXT NOT NULL, chapter_number REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', position INTEGER NOT NULL, added_at TEXT NOT NULL)`. Statuses: `pending`, `downloading`, `paused`, `error`.
  2. Add struct `QueueItem { chapter_id, manga_id, title, chapter_number, status, position, added_at }`.
  3. Add store functions: `queue_add(item: &QueueItem)`, `queue_list() -> Vec<QueueItem>`, `queue_remove(chapter_id)`, `queue_update_status(chapter_id, status)`, `queue_reorder(chapter_ids: &[String])`, `queue_clear_done()`, `queue_next_pending() -> Option<QueueItem>`, `queue_count() -> (pending, total)`.
  4. Add unit tests: insert 3 items, reorder, remove, verify `queue_next_pending` returns the lowest-position pending item.
- DONE WHEN: `cargo test --workspace` passes. `schema_version` is `"4"` in a fresh in-memory DB.

### 4.2 Tauri commands for the queue
- GOAL: Expose queue CRUD to the UI through Tauri commands.
- READ: `app/src-tauri/src/commands.rs` (struct `AppCtx`, function `download_chapter`), `app/src-tauri/src/lib.rs` (`generate_handler![]`), `app/ui/js/api.js`.
- EDIT: `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`, `app/ui/js/api.js`.
- STEPS:
  1. Add commands in `commands.rs`: `queue_add(manga_id, chapter_id, title, chapter_number)`, `queue_list()`, `queue_remove(chapter_id)`, `queue_pause(chapter_id)`, `queue_resume(chapter_id)`, `queue_reorder(chapter_ids)`, `queue_clear()`, `queue_retry(chapter_id)`.
  2. Register all 8 commands in `generate_handler![]` in `lib.rs`.
  3. Add matching wrapper functions in `api.js`.
- DONE WHEN: `cargo check --workspace` passes. Each new command has a wrapper in `api.js`.

### 4.3 Rust queue worker (download loop)
- GOAL: A single background worker that pops `pending` items from the queue and downloads them one at a time, emitting `download-progress` events.
- READ: `app/src-tauri/src/download.rs` (function `download_chapter`, const `PARALLEL`, struct `Progress`), `app/src-tauri/src/lib.rs` (function `run`, the `.setup()` block).
- EDIT: `app/src-tauri/src/download.rs`, `app/src-tauri/src/lib.rs`.
- STEPS:
  1. In `download.rs`, add `pub struct QueueWorker` holding an `Arc<AtomicBool>` for pause and a `tokio::sync::Notify` for wake. Methods: `start(app)` (spawns a loop), `pause()`, `resume()`, `wake()`.
  2. The loop: call `store.queue_next_pending()`. If found, set status to `downloading`, call existing `download_chapter`, on success set status to `done` + call `store.save_download()` + `store.queue_remove()`, on error set status to `error`. Emit `queue-changed` event after each state change. If paused, `notified().await`. If no pending, `notified().await`.
  3. In `lib.rs` `.setup()`, create `QueueWorker`, manage it as Tauri state, call `worker.start(app)`.
  4. In `commands.rs`, after `queue_add`/`queue_resume`/`queue_retry`, call `worker.wake()` so the loop picks up new work immediately.
- DONE WHEN: `cargo check --workspace` passes. Adding a queue item triggers the worker to download it. Pausing stops the loop.

### 4.4 UI: Download queue screen
- GOAL: Build the "Antrean unduhan" screen at `#/more/downloads`.
- READ: `app/ui/js/router.js` (the `#/more/downloads` placeholder block at line 101), `app/ui/js/views/more.js` (function `renderMore`, the "Antrean unduhan" list row), `app/ui/js/api.js` (the `queue_*` wrappers from 4.2).
- EDIT: `app/ui/js/views/download-queue.js` (new), `app/ui/js/router.js`, `app/ui/style.css`.
- STEPS:
  1. Create `download-queue.js` with `renderDownloadQueue()`. Call `api.queue_list()`. Group items by `manga_id`. For each manga group: show cover, title, chapters list with status icon and progress bar.
  2. Each chapter row: status icon (pending/downloading spinner/error/paused), chapter number, three-dot menu (retry, remove). Drag handle for reorder (pointer events, no library, save order via `api.queue_reorder`).
  3. Floating action button: "Lanjut" (calls `api.queue_resume`) or "Jeda" (calls `api.queue_pause`) based on current state.
  4. Listen for `queue-changed` Tauri event via `api.eventApi.listen()` to auto-refresh the list.
  5. Replace the placeholder route in `router.js` with `renderDownloadQueue()`. Import the new view.
  6. Add CSS for `.queue-*` classes in `style.css`.
- DONE WHEN: `#/more/downloads` shows queued chapters grouped by manga with working pause/resume/remove/reorder.

### 4.5 UI: Download queue progress events
- GOAL: Show real-time progress (page count) for the currently downloading chapter in the queue screen.
- READ: `app/src-tauri/src/download.rs` (struct `Progress`, the `app.emit("download-progress", ...)` call), `app/ui/js/views/download-queue.js` (the chapter row from 4.4).
- EDIT: `app/ui/js/views/download-queue.js`, `app/ui/js/views/more.js`.
- STEPS:
  1. In `download-queue.js`, listen for the `download-progress` Tauri event. When received, find the matching chapter row by `chapter_id` and update its progress bar width (`done/total * 100%`) and text (`done/total halaman`).
  2. When `done === total`, auto-refresh the list (the item should be gone from the queue).
  3. In `more.js` function `renderMore`, update the "Antrean unduhan" subtitle dynamically: call `api.queue_list()` on mount and show `"N item dalam antrean"` or `"Tidak ada unduhan berjalan"`.
- DONE WHEN: Progress bar fills in real time. Queue subtitle in More screen shows correct count.

### 4.6 Detail screen: batch download actions
- GOAL: Let users queue multiple chapters for download from the manga detail screen.
- READ: `app/ui/js/views/detail.js` (function `renderMangaDetail`, the chapter toolbar HTML), `app/ui/js/views/detail-events.js` (function `attachDetailEvents`, the `.dl-btn` click handler and batch-actions block).
- EDIT: `app/ui/js/views/detail.js`, `app/ui/js/views/detail-events.js`.
- STEPS:
  1. In the chapter toolbar (inside `renderMangaDetail`), add a download menu button next to the existing sort/filter/batch buttons. On click, show a small dropdown: "Unduh 1 berikutnya", "Unduh 5 berikutnya", "Unduh 10 berikutnya", "Unduh semua belum dibaca". "Berikutnya" means next N unread chapters in ascending order.
  2. Each option collects the matching chapter IDs and calls `api.queue_add` for each, then shows a toast `"N chapter ditambahkan ke antrean"`.
  3. In batch mode (existing batch bar), add a "Unduh" button alongside "Dibaca" and "Belum". On click, queue all selected chapters via `api.queue_add`.
  4. Change the per-chapter `.dl-btn` handler: instead of calling `api.download_chapter` directly, call `api.queue_add` and show toast `"Ditambahkan ke antrean"`. Keep the "Hapus" flow unchanged (`api.delete_download`).
- DONE WHEN: Tapping download on a chapter adds it to the queue. Batch download menu adds multiple chapters. Toast confirms.

### 4.7 "Downloaded only" filter mode
- GOAL: When the "Hanya yang sudah diunduh" switch is on, the library grid and chapter lists show only downloaded content.
- READ: `app/ui/js/views/more.js` (function `renderMore`, the `switchDownloaded` onChange handler), `app/ui/js/views/library.js` (the function that calls `api.library_list`), `app/ui/js/views/detail.js` (function `renderMangaDetail`, the filter logic around `mangaDetailState.filter`), `app/ui/js/state.js` (function `getPref`).
- EDIT: `app/ui/js/views/library.js`, `app/ui/js/views/detail.js`.
- STEPS:
  1. In `library.js`, before calling `api.library_list`, check `getPref('app.downloaded_only', '0')`. If `'1'`, force `filter_downloaded: 1` regardless of the user's library filter setting.
  2. In `detail.js` `renderMangaDetail`, if `getPref('app.downloaded_only', '0') === '1'`, filter the chapter list to only show chapters in `downloadedSet`.
- DONE WHEN: With the switch on, library shows only manga with downloads, and detail shows only downloaded chapters.

### 4.8 Download settings: Wi-Fi only & delete after read
- GOAL: Add two download-related prefs and wire them into the queue worker and reader.
- READ: `app/ui/js/views/settings/unduhan.js` (the schema array), `app/src-tauri/src/download.rs` (the `QueueWorker` loop from 4.3), `app/src-tauri/src/commands.rs` (function `open_chapter`, function `pref_set`).
- EDIT: `app/ui/js/views/settings/unduhan.js`, `app/src-tauri/src/download.rs`, `app/src-tauri/src/commands.rs`.
- STEPS:
  1. In `unduhan.js`, add two items to the schema: switch `dl.wifi_only` ("Hanya unduh lewat Wi-Fi", default off) and switch `dl.delete_after_read` ("Hapus bab setelah dibaca", default off).  2. In the `QueueWorker` loop (in `download.rs`), before starting a download, read pref `pref.dl.wifi_only`. If `"1"`, check network type. On Android, use JNI to query `ConnectivityManager`. If not Wi-Fi, skip and emit a `queue-wifi-wait` event. On desktop, always proceed.
  3. In `commands.rs` function `open_chapter`, after successfully opening a chapter, check pref `pref.dl.delete_after_read`. If `"1"`, and the chapter being opened is a *different* chapter than the one previously open (i.e., the user moved on), delete the previous chapter's download via `store.delete_download` + remove files. This requires reading `get_last_reading_progress` for the manga to find the previously read chapter.
- DONE WHEN: With Wi-Fi only on, queue pauses on mobile data. With delete-after-read on, finishing a chapter deletes its downloaded files.

## PHASE 5 - Updates and History like Mihon
- Pembaruan: list grouped by day ("Hari Ini", "Kemarin", date). Row = cover, title, chapter, check/download button. Top: filter, calendar (upcoming from predictions), refresh. Text "Pustaka terakhir diperbarui: X jam yang lalu". Filter bottom sheet: Terunduh, Belum dibaca, Dimulai, Ditandai; tab Kategori.
- Riwayat: grouped by day, cover, title, "Bab N - HH.mm", delete button, search, clear-all.
- Needs a global library update command that checks all favorites (batched, with progress).

### 5.1 DB: history item delete + history search
- GOAL: Add store functions to delete a single history entry and to search history by title.
- READ: `crates/core/src/store.rs` (functions `list_history`, `clear_reading_history`, struct `HistoryItem`).
- EDIT: `crates/core/src/store.rs`.
- STEPS:
  1. Add `delete_history_item(manga_id, chapter_id)` that deletes the matching row from `reading_progress` by both keys.
  2. Add `search_history(query, limit)` returning `Vec<HistoryItem>`. Same SQL as `list_history` but add `WHERE (COALESCE(m.title, f.title, p.manga_id) LIKE '%query%')` before the `ORDER BY`.
  3. Add unit tests: insert 3 progress entries with different `manga_meta` titles, search for one title → 1 result, delete it → 0 results for that search, `list_history` → 2 remaining.
- DONE WHEN: `cargo test --workspace` passes. Both new functions are tested.

### 5.2 Commands: history delete + search
- GOAL: Expose history delete-item and search to the UI through Tauri commands.
- READ: `app/src-tauri/src/commands.rs` (functions `get_reading_history`, `clear_reading_history`), `app/src-tauri/src/lib.rs` (`generate_handler![]`), `app/ui/js/api.js`.
- EDIT: `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`, `app/ui/js/api.js`.
- STEPS:
  1. Add command `delete_history_item(ctx, manga_id: String, chapter_id: String)` calling `store.delete_history_item`.
  2. Add command `search_history(ctx, query: String, limit: Option<u32>)` calling `store.search_history` with a default limit of 200.
  3. Register both in `generate_handler![]` in `lib.rs`.
  4. Add wrapper functions `delete_history_item(args)` and `search_history(args)` in `api.js`.
- DONE WHEN: `cargo check --workspace` passes. Each new command has a wrapper in `api.js`.

### 5.3 Library update command with progress events
- GOAL: A command that fetches new chapters for every favorite, creates update events, and emits progress so the UI can show a progress indicator.
- READ: `app/src-tauri/src/commands.rs` (functions `refresh_all`, struct `AppCtx`, method `AppCtx::refresh_history`), `app/src-tauri/src/backend.rs` (functions `direct_check`, `accept_event`), `crates/core/src/store.rs` (functions `list_favorites`, `save_chapters`, `save_history`, `kv_set`, `kv_get`).
- EDIT: `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`, `app/ui/js/api.js`.
- STEPS:
  1. Add async command `library_update<R: Runtime>(app, ctx)`. Get all favorites via `store.list_favorites()`. For each favorite (index `i`, total `n`): fetch chapters page 1 via `ctx.api.chapters(manga_id, 1, 30)`, call `store.save_chapters` and `store.save_history`, check for new chapters with `shinitrack_core::detect::is_newer`, create events via `backend::accept_event` for any newer chapter. Emit Tauri event `"library-update-progress"` with payload `{current: i+1, total: n, manga_id, title}`. Sleep 300 ms between requests to avoid rate limiting.
  2. After the loop, call `store.kv_set("last_library_update", &Utc::now().to_rfc3339())`.
  3. Add command `get_last_library_update(ctx)` returning `Option<String>` from `store.kv_get("last_library_update")`.
  4. Register both commands in `generate_handler![]` in `lib.rs` and add wrappers in `api.js`.
- DONE WHEN: `cargo check --workspace` passes. Calling `library_update` iterates favorites, emits progress events, and stores the timestamp.

### 5.4 Updates UI: grouped-by-day list with refresh
- GOAL: Rewrite the Pembaruan screen to group events by day with a refresh toolbar showing last-update time and a progress indicator.
- READ: `app/ui/js/views/updates.js` (function `renderUpdates`), `app/ui/js/api.js` (functions `recent_events`, `mark_events_seen`, `library_update`, `get_last_library_update`, `queue_add`), `app/ui/js/utils.js` (functions `formatRelativeTime`, `coverUrl`, `escapeHtml`).
- EDIT: `app/ui/js/views/updates.js`, `app/ui/style.css`.
- STEPS:
  1. Add a toolbar at the top of `renderUpdates`. Show text "Pustaka terakhir diperbarui: X jam yang lalu" (fetch from `api.get_last_library_update()`, format with `formatRelativeTime`). Add three icon buttons: refresh (sync icon, calls `api.library_update()`), calendar (calendar icon, navigates to `#/schedule`), filter (filter icon, placeholder for 5.5).
  2. Fetch events via `api.recent_events()`. Group by day: compare each event's `created_at` date to today → section header "Hari Ini", yesterday → "Kemarin", else format as `dd MMM yyyy` using `id-ID` locale.
  3. Each event row: cover thumbnail (via `coverUrl`), manga title (escaped), "Bab N", and a download button (download icon, calls `api.queue_add`). Tap the row → `navigate('#/read/' + chapter_id)`.
  4. Listen for `library-update-progress` Tauri event via `api.eventApi.listen()`. While active, show a progress bar or text under the toolbar: "Memperbarui pustaka... (current/total)". When `current === total`, re-render the entire list.
  5. Add CSS classes `.updates-toolbar`, `.updates-day-header`, `.updates-row`, `.updates-progress` in `style.css`.
- DONE WHEN: Updates screen shows events grouped by day. Tapping refresh triggers `library_update` with a visible progress indicator. Calendar button opens the schedule view.

### 5.5 Updates filter bottom sheet
- GOAL: Add a filter bottom sheet to the Pembaruan screen with a Filter tab and a Kategori tab.
- READ: `app/ui/js/views/updates.js` (function `renderUpdates`, the filter button from 5.4), `app/ui/js/components/bottom-sheet.js`, `app/ui/js/state.js` (functions `getPref`, `setPref`), `app/ui/js/api.js` (functions `category_list`, `list_read_chapters`).
- EDIT: `app/ui/js/views/updates.js`, `app/ui/style.css`.
- STEPS:
  1. Wire the filter icon button from 5.4. On tap, open a bottom sheet (reuse `bottom-sheet.js`) with two tabs: "Filter" and "Kategori".
  2. Tab "Filter": four tri-state checkboxes — Terunduh, Belum dibaca, Dimulai, Ditandai. Tri-state cycle: off → include → exclude → off. Save state to prefs `updates.filter_downloaded`, `updates.filter_unread`, `updates.filter_started`, `updates.filter_bookmarked` via `setPref`.
  3. Tab "Kategori": fetch categories via `api.category_list()`. Render each as a checkbox. Save selected IDs to pref `updates.filter_categories` as a comma-separated string.
  4. On close, re-render the events list. Apply filters client-side: check each event's manga against downloaded/read state and selected categories before rendering.
  5. Add CSS for `.updates-filter-sheet`, `.updates-tristate` in `style.css`.
- DONE WHEN: Filter bottom sheet opens with two tabs. Toggling any filter re-renders the list. Filter values persist across navigations and restarts.

### 5.6 History UI: grouped-by-day, search, delete, clear-all
- GOAL: Rewrite the Riwayat screen with day grouping, per-item delete, a search bar, and a clear-all button.
- READ: `app/ui/js/views/history.js` (function `renderHistory`), `app/ui/js/api.js` (functions `get_reading_history`, `delete_history_item`, `search_history`, `clear_reading_history`), `app/ui/js/utils.js` (functions `formatRelativeTime`, `coverUrl`, `escapeHtml`).
- EDIT: `app/ui/js/views/history.js`, `app/ui/style.css`.
- STEPS:
  1. Add a toolbar at the top: search icon button (toggles a text input), clear-all button (trash icon, shows a `confirm()` dialog then calls `api.clear_reading_history()` and re-renders the empty state).
  2. Fetch history via `api.get_reading_history({limit: 200})`. Group by day: compare `updated_at` to today → "Hari Ini", yesterday → "Kemarin", else format as `dd MMM yyyy` using `id-ID` locale.
  3. Each row: cover thumbnail, manga title, "Bab N — HH:mm" (extract hours and minutes from `updated_at`), delete button (trash icon). Tap row → `navigate('#/manga/' + manga_id)`. Tap delete → call `api.delete_history_item({manga_id, chapter_id})`, remove the row from DOM; if the day section becomes empty, remove the section header too.
  4. Search: when the search input receives input (debounce 300 ms), call `api.search_history({query, limit: 200})` and re-render the grouped list with results. On clear or empty query, revert to full `get_reading_history`.
  5. Add CSS classes `.history-toolbar`, `.history-search-input`, `.history-day-header`, `.history-row`, `.history-row-delete` in `style.css`.
- DONE WHEN: History shows entries grouped by day. Search filters results by title in real time. Per-item delete removes one entry. Clear-all empties the entire history.

## PHASE 6 - Manga detail and Reader upgrade

### 6.1 Detail header action row
- GOAL: Make the manga detail header match the target layout: blurred cover header, "Di pustaka" action, "Segera" prediction action, and open-site action.
- READ: `app/ui/js/views/detail.js` (function `renderMangaDetail`), `app/ui/js/views/detail-events.js` (function `attachDetailEvents`), `app/ui/js/utils.js` (function `formatPrediction`), `crates/core/src/models.rs` (struct `Manga`).
- EDIT: `app/ui/js/views/detail.js`, `app/ui/js/views/detail-events.js`, `app/ui/style.css`.
- STEPS:
  1. In `renderMangaDetail`, replace the existing header action buttons with a compact action row: "Di pustaka"/"Tambah", "Segera", and "Buka situs".
  2. Keep the existing favorite/category behavior in `attachDetailEvents` for the "Di pustaka" action.
  3. Move the prediction text from `formatPrediction(detail.prediction)` into the "Segera" action row area without changing prediction calculation.
  4. Add an open-site click handler in `attachDetailEvents`. First search the existing `Manga` fields for a canonical web URL. If no URL field exists, use a small helper that builds the Shinigami site URL from `manga_id` and document the assumption in the code.
  5. Add CSS for the action row, icon buttons, and mobile wrapping.
- DONE WHEN: Detail header shows the cover backdrop and the three actions. Favorite/category behavior still works. Open-site action opens the manga page in the system browser or WebView.

### 6.2 Detail metadata, description, and genre chips
- GOAL: Improve the information area below the detail header: collapsible description, chapter count, status metadata, and genre chips when the API provides them.
- READ: `app/ui/js/views/detail.js` (function `renderMangaDetail`), `app/ui/js/views/detail-events.js` (function `attachDetailEvents`), `crates/core/src/models.rs` (struct `Manga`), `crates/core/src/api.rs` (function `ShinigamiClient::detail`).
- EDIT: `crates/core/src/models.rs`, `app/ui/js/views/detail.js`, `app/ui/style.css`.
- STEPS:
  1. Inspect a live `manga_detail` response or existing serialized fields before adding any genre field. If the API field is NOT FOUND, keep the chips container hidden and do not invent data.
  2. If a genre/tag field exists, add it to `Manga` with `#[serde(default)]` and render escaped chips in `renderMangaDetail`.
  3. Keep `#desc-box` collapsible, but add a visible compact/expanded state that does not rely on inline styles.
  4. Add a metadata strip with total chapter count, unread count, downloaded count, and manga status when present.
  5. Add CSS for `.detail-meta`, `.detail-genre-chips`, and the revised `.desc-card`.
- DONE WHEN: Detail shows metadata and a clean collapsible description. Genre chips appear only when real API data exists.

### 6.3 Chapter row states and sticky "Lanjut"
- GOAL: Upgrade the chapter list to show read dot, bookmark state, download state, and a sticky "Lanjut" button.
- READ: `app/ui/js/views/detail.js` (function `renderMangaDetail`), `app/ui/js/views/detail-events.js` (function `attachDetailEvents`), `app/ui/js/api.js` (functions `get_reading_progress`, `list_read_chapters`, `delete_download`, `queue_add`), `app/ui/js/state.js` (function `getPref`).
- EDIT: `app/ui/js/views/detail.js`, `app/ui/js/views/detail-events.js`, `app/ui/style.css`.
- STEPS:
  1. In `renderMangaDetail`, change each chapter row to show a read dot/check area, title/number/date text, bookmark icon placeholder, and download state icon/text.
  2. Keep existing mark-read, queue download, delete download, sort, filter, and batch behavior in `attachDetailEvents`.
  3. Add a sticky bottom "Lanjut" button that opens `progress.chapter_id` when progress exists, otherwise opens the oldest chapter.
  4. Hide or disable the sticky button when there are no chapters after the downloaded-only/filter logic.
  5. Add CSS for `.chapter-read-dot`, `.chapter-bookmark-btn`, `.chapter-download-state`, and `.detail-sticky-resume`.
- DONE WHEN: Chapter rows show read/download states clearly. The sticky "Lanjut" button opens the correct chapter and does not cover the batch bar.

### 6.4 DB and commands for chapter bookmarks
- GOAL: Add a real per-chapter bookmark store so detail and reader bookmark buttons persist.
- READ: `crates/core/src/store.rs` (const `MIGRATIONS`, functions `mark_chapter_read`, `list_read_chapter_ids`, `Store::init`), `app/src-tauri/src/commands.rs` (functions `mark_chapter_read`, `list_read_chapters`), `app/src-tauri/src/lib.rs` (`generate_handler![]`), `app/ui/js/api.js`.
- EDIT: `crates/core/src/store.rs`, `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`, `app/ui/js/api.js`.
- STEPS:
  1. Add a numbered migration creating `chapter_bookmark(chapter_id TEXT PRIMARY KEY, manga_id TEXT NOT NULL, chapter_number REAL NOT NULL, bookmarked_at TEXT NOT NULL)` with an index on `manga_id`.
  2. Add store functions `set_chapter_bookmark(manga_id, chapter_id, chapter_number, bookmarked)` and `list_bookmarked_chapter_ids(manga_id) -> HashSet<String>`.
  3. Add Tauri commands `set_chapter_bookmark` and `list_bookmarked_chapters` in `commands.rs`.
  4. Register both commands in `generate_handler![]` and add wrappers in `api.js`.
  5. Add store unit tests for set, unset, and list.
- DONE WHEN: `cargo test --workspace` passes. The two new commands compile and have JS wrappers.

### 6.5 Wire bookmarks into detail and reader
- GOAL: Let users toggle bookmarks from the detail list and reader top bar.
- READ: `app/ui/js/views/detail.js` (function `renderMangaDetail`), `app/ui/js/views/detail-events.js` (function `attachDetailEvents`), `app/ui/js/views/reader.js` (function `renderReader`), `app/ui/js/api.js` (functions `set_chapter_bookmark`, `list_bookmarked_chapters`).
- EDIT: `app/ui/js/views/detail.js`, `app/ui/js/views/detail-events.js`, `app/ui/js/views/reader.js`, `app/ui/style.css`.
- STEPS:
  1. In `renderMangaDetail`, load `api.list_bookmarked_chapters({ mangaId })` and mark chapter bookmark buttons as active when needed.
  2. In `attachDetailEvents`, wire `.chapter-bookmark-btn` to call `api.set_chapter_bookmark` and update the row state without reloading the whole screen.
  3. In `renderReader`, add a bookmark button to the top HUD and initialize it from `api.list_bookmarked_chapters({ mangaId: data.manga_id })`.
  4. In `renderReader`, toggle the current chapter bookmark via `api.set_chapter_bookmark`.
  5. Add active/inactive bookmark CSS.
- DONE WHEN: Bookmark state can be toggled in detail and reader, survives restart, and uses the same stored data.

### 6.6 Reader HUD controls and settings shell
- GOAL: Replace the current reader HUD with the target top and bottom bars without changing reading behavior yet.
- READ: `app/ui/js/views/reader.js` (function `renderReader`, nested functions `setHudVisibility`, `markChapterCompleted`, `renderModeView`), `app/ui/js/views/reader-paged.js` (function `renderPagedMode`), `app/ui/js/views/settings/pembaca.js` (const `pembacaSchema`), `app/ui/js/state.js` (functions `getPref`, `setPref`).
- EDIT: `app/ui/js/views/reader.js`, `app/ui/js/views/reader-paged.js`, `app/ui/style.css`.
- STEPS:
  1. In `renderReader`, make the top bar show back, manga/chapter title text, bookmark button, and menu button.
  2. Make the bottom bar show controls for orientation, rotate, crop borders, settings, and chapter navigation.
  3. Store control values in prefs using existing keys or new `reader.*` keys through `setPref`; do not add backend commands.
  4. Remove any emoji from reader end-card text in `reader.js` and `reader-paged.js`.
  5. Keep `renderModeView` and `renderPagedMode` behavior unchanged except for the HUD/control markup they receive.
- DONE WHEN: Reader top and bottom bars match the requested controls. Existing webtoon and paged navigation still works.

### 6.7 Reader vertical scrubber and page overlay
- GOAL: Add a right-side vertical scrubber with page numbers and a page number overlay.
- READ: `app/ui/js/views/reader.js` (function `renderReader`, nested function `renderModeView`, `slider` input handler), `app/ui/js/views/reader-paged.js` (function `renderPagedMode`), `app/ui/js/state.js` (function `getPref`).
- EDIT: `app/ui/js/views/reader.js`, `app/ui/js/views/reader-paged.js`, `app/ui/style.css`.
- STEPS:
  1. Replace the bottom horizontal page slider with a right-side vertical scrubber element in `renderReader`.
  2. Add a page overlay element that respects pref `reader.page_number`; hide it when the pref is `"0"`.
  3. Update webtoon scroll tracking in `renderModeView` to update the vertical scrubber and overlay.
  4. Update `renderPagedMode` so page changes update the same scrubber and overlay through the shared context.
  5. Add CSS for `.reader-vertical-scrubber` and `.reader-page-overlay`.
- DONE WHEN: Current page is visible as an overlay. Dragging the vertical scrubber jumps pages in both webtoon and paged modes.

### 6.8 Reader transition page and next-chapter preload
- GOAL: Make chapter ending smoother with a transition page and preload the next chapter when enabled.
- READ: `app/ui/js/views/reader.js` (function `renderReader`, nested functions `markChapterCompleted`, `renderModeView`), `app/ui/js/views/reader-paged.js` (function `renderPagedMode`), `app/ui/js/api.js` (function `open_chapter`), `app/ui/js/state.js` (function `getPref`).
- EDIT: `app/ui/js/views/reader.js`, `app/ui/js/views/reader-paged.js`, `app/ui/style.css`.
- STEPS:
  1. Replace the existing end-card markup with a reusable transition page in both webtoon and paged modes.
  2. Respect pref `reader.auto_next`; if `"1"`, show the next-chapter action as primary, otherwise show it as secondary.
  3. Respect pref `reader.preload`; when `data.next_chapter_id` exists, call `api.open_chapter({ chapterId: data.next_chapter_id })` in the background and preload the first N page image URLs.
  4. Do not mark the next chapter as read or save progress during preload.
  5. Add CSS for the transition page.
- DONE WHEN: End of chapter shows a clean transition page. Next chapter pages begin loading in the background without changing reading progress.

### 6.9 Per-manga reading mode
- GOAL: Save reading mode per manga while keeping the global default from settings.
- READ: `app/ui/js/views/reader.js` (function `renderReader`, mode button click handler), `app/ui/js/state.js` (state field `readerMode`, functions `getPref`, `setPref`), `app/ui/js/views/settings/pembaca.js` (const `pembacaSchema`).
- EDIT: `app/ui/js/views/reader.js`, `app/ui/js/state.js`, `app/ui/js/views/settings/pembaca.js`.
- STEPS:
  1. On reader load, choose mode in this order: pref `reader.mode.${manga_id}`, pref `reader.mode`, then localStorage fallback.
  2. Normalize settings values from `pembacaSchema` (`webtoon`, `paged_lr`, `manga_rl`) to the existing runtime values (`webtoon`, `paged-ltr`, `paged-rtl`).
  3. When the reader mode button is tapped, save the selected mode to `reader.mode.${manga_id}` with `setPref`.
  4. Keep `state.readerMode` updated so `renderPagedMode` continues to work.
  5. Stop writing reader mode to localStorage except as a backward-compatible fallback.
- DONE WHEN: Changing mode in one manga does not change another manga. The global setting still controls manga that have no per-manga override.

### 6.10 Reader keep-awake and cleanup
- GOAL: Apply keep-awake while the reader is open and clean up reader event handlers when leaving.
- READ: `app/ui/js/views/reader.js` (function `renderReader`, nested function `renderModeView`, assignments to `window.onscroll`), `app/ui/js/router.js` (reader route branch in `handleRoute`), `app/ui/js/api.js` (function `set_keep_awake`), `app/ui/js/state.js` (function `getPref`).
- EDIT: `app/ui/js/views/reader.js`, `app/ui/js/router.js`, `app/ui/style.css`.
- STEPS:
  1. In `renderReader`, when pref `reader.keep_awake` is `"1"`, call `api.set_keep_awake({ keep: true })` after opening a chapter.
  2. Add an exported cleanup function in `reader.js` that clears `window.onscroll`, disables keep-awake with `api.set_keep_awake({ keep: false })`, and removes reader-only body/classes if needed.
  3. In `router.js`, call the reader cleanup before rendering any non-reader route.
  4. Ensure leaving the reader does not leave scroll handlers active on history, updates, or detail screens.
  5. Keep CSS changes limited to reader cleanup/layout fixes found during testing.
- DONE WHEN: Keep-awake is active only inside the reader. Navigating away clears reader scroll behavior and restores normal app chrome.

## PHASE 7 - Statistik + Backup

### 7.1 DB Migration for `read_duration`
- GOAL: Track read duration per chapter.
- READ: `crates/core/src/store.rs` (const `MIGRATIONS`, struct `ReadingProgress`, function `save_reading_progress`).
- EDIT: `crates/core/src/store.rs`.
- STEPS:
  1. Add a migration adding `read_duration` (INTEGER DEFAULT 0) to `reading_progress` table.
  2. Update `ReadingProgress` struct to include `read_duration: u64`.
  3. Update `save_reading_progress` to accept `read_duration` and update it in DB.
  4. Add a unit test.
- DONE WHEN: `cargo test` passes.

### 7.2 Commands and Reader integration for `read_duration`
- GOAL: Save time spent reading from UI to the backend.
- READ: `app/src-tauri/src/commands.rs` (function `save_reading_progress`, struct `BackupData`), `app/ui/js/api.js`, `app/ui/js/views/reader.js`.
- EDIT: `app/src-tauri/src/commands.rs`, `app/ui/js/api.js`, `app/ui/js/views/reader.js`.
- STEPS:
  1. Update `save_reading_progress` in `commands.rs` to take `read_duration: u64`. Update `BackupData` to reflect struct change.
  2. Update the wrapper in `api.js`.
  3. In `reader.js`, track reading duration (elapsed time) while active.
  4. Pass the elapsed time to `api.save_reading_progress` whenever progress is saved.
- DONE WHEN: Reading for 5 seconds saves 5s to DB. Backup JSON contains `read_duration`.

### 7.3 DB & Commands for Statistik
- GOAL: Add backend logic to calculate library statistics.
- READ: `crates/core/src/store.rs`, `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`, `app/ui/js/api.js`.
- EDIT: `crates/core/src/store.rs`, `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`, `app/ui/js/api.js`.
- STEPS:
  1. Add `Statistics` struct and `get_statistics()` in `store.rs`. Query: total favorites, sum of `read_duration`, count of manga finished, total chapters in DB, total read chapters, total downloads.
  2. Add Tauri command `get_statistics()` in `commands.rs`.
  3. Register in `lib.rs`.
  4. Add wrapper in `api.js`.
- DONE WHEN: Command compiles and returns correct aggregated data.

### 7.4 UI for Statistik screen
- GOAL: Build the "Statistik" screen at `#/more/stats`.
- READ: `app/ui/js/views/statistik.js` (new), `app/ui/js/router.js`, `app/ui/style.css`, `app/ui/js/api.js` (function `get_statistics`).
- EDIT: `app/ui/js/views/statistik.js`, `app/ui/js/router.js`, `app/ui/style.css`.
- STEPS:
  1. Create `statistik.js` displaying Ringkasan, Entri, and Bab sections.
  2. Fetch data via `api.get_statistics()`.
  3. Format `read_duration` into a readable string (e.g., "5 hari 2 jam 10 menit").
  4. Register `#/more/stats` route in `router.js` and ensure it's linked from More.
  5. Add CSS for layout.
- DONE WHEN: Stats screen displays accurate aggregated numbers.

### 7.5 Include Server Token in Backup
- GOAL: Allow user to optionally include the server token in the backup JSON.
- READ: `app/src-tauri/src/commands.rs` (functions `backup_create`, `backup_restore`), `app/ui/js/api.js`, `app/ui/js/views/settings/penyimpanan.js`.
- EDIT: `app/src-tauri/src/commands.rs`, `app/ui/js/api.js`, `app/ui/js/views/settings/penyimpanan.js`.
- STEPS:
  1. Add `include_token: bool` to `backup_create` in `commands.rs`. Use it to conditionally filter out the "token" pref.
  2. Update the wrapper in `api.js`.
  3. In `penyimpanan.js`, add a checkbox "Sertakan token server" next to "Buat cadangan". Pass its value to `api.backup_create`.
- DONE WHEN: Ticking the box includes the token in the JSON. Un-ticking excludes it. Restore works for both.

### 7.6 Auto-backup through Kotlin WorkManager
- GOAL: Run backup periodically via Android WorkManager and keep only last N files.
- READ: `app/src-tauri/src/jni_bridge.rs`, `app/src-tauri/src/commands.rs` (function `backup_create`), `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/BackupWorker.kt` (new), `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/MainActivity.kt`.
- EDIT: `app/src-tauri/src/jni_bridge.rs`, `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/BackupWorker.kt`, `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/MainActivity.kt`.
- STEPS:
  1. Implement `BackupWorker.kt` that calls a JNI method to trigger backup.
  2. In `jni_bridge.rs`, add `Java_id_shinitrack_app_BackupWorker_triggerBackup` which calls backup logic headlessly.
  3. In `MainActivity.kt`, enqueue `BackupWorker` based on a periodic schedule (e.g. daily).
  4. Enhance backup logic in Rust to delete older backup files to keep only the latest 5 in the directory.
- DONE WHEN: Background backup runs on schedule and removes old files.

## PHASE 8 - GSAP polish (read docs/GSAP_RULES.md)
- 8.1 Vendor GSAP + `motion.js` helper.
- 8.2 Page transitions, 8.3 list/grid stagger, 8.4 bottom sheet/dialog, 8.5 tab indicator, 8.6 reader HUD, 8.7 reduced-motion support.

## PHASE 9 - Release
- CI: cargo test + build debug APK artifact. Signed release workflow on tag. Update README (screenshots, correct API level). Keep MIT license, add third-party notices (GSAP license note).

---

## NOT IN SCOPE (say no if asked)
Extensions/sources system, trackers (MAL, AniList), light-novel/epub, local source files, Shizuku installer, widgets.

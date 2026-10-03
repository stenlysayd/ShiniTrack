# PROJECT MAP (facts about the current code)

Version in workspace: 0.2.3. Package: `id.shinitrack.app`. Min SDK: 26.

## Layers
```
UI (app/ui)  --invoke()-->  Tauri commands (app/src-tauri/src/commands.rs)
                                  |
                                  v
                   core crate (crates/core): api.rs, store.rs (SQLite), detect.rs, predict.rs
                                  ^
Kotlin (WorkManager, push) --JNI--+  (jni_bridge.rs -> backend.rs)
Server (crates/server): polls Shinigami every ~1s, sends push. Optional.
```

## Important files
| File | What it does |
|---|---|
| `app/ui/index.html` | Shell: topbar, 5-tab bottom bar, update modal, toast. Loads `icons.js` and `app.js`. |
| `app/ui/app.js` | Router + all views (big single file). Refactor planned in Phase 0. |
| `app/ui/style.css` | All CSS, tokens in `:root`. |
| `app/ui/icons.js` | `window.Icons.*` SVG icons. |
| `app/src-tauri/src/lib.rs` | App start + `generate_handler![]` list of commands. |
| `app/src-tauri/src/commands.rs` | All `#[tauri::command]` functions. |
| `app/src-tauri/src/backend.rs` | Settings (kv), notices, server client, background check (also used by Kotlin). |
| `app/src-tauri/src/reader.rs` | `shimg://` protocol: serves page/cover images with Referer. |
| `app/src-tauri/src/download.rs` | Chapter download (4 parallel). |
| `app/src-tauri/src/updater.rs` | GitHub OTA update. |
| `crates/core/src/store.rs` | SQLite schema + all DB functions. |
| `crates/core/src/api.rs` | Shinigami API client. |

## Current DB tables
favorites, events, release_history, downloads, reading_progress, kv, chapter_read, manga_meta.
Settings are stored in `kv` (key/value text).

## Current UI tabs
Library (#/favorites), Update (#/updates), Riwayat (#/history), Eksplor (#/search), Setelan (#/settings).

## KNOWN ISSUES (verify each one by reading code BEFORE fixing)
1. **Read-state bug.** `store.rs::list_read_chapter_ids` merges `reading_progress` and `chapter_read`. Result: opening a chapter marks it as read. Fix: only `chapter_read` means read. `reading_progress` only stores the page.
2. **Secret in repo.** `config.toml` in repo root has a real-looking token. Add to `.gitignore`, keep only `config.example.toml`, rotate the token.
3. **Version mismatch.** `app/build.gradle.kts` fallback is `0.2.2`/`2002`; `updater.rs` has `CURRENT_APP_VERSION` and `CURRENT_BUILD_CODE` hardcoded; workspace is `0.2.3`. Make one source of truth.
4. **Referer mismatch.** `Notif.kt` uses `https://shinigami.asia/`, `api.rs` uses `https://shinigami.id/`. Use the same.
5. **Notification color** in `Notif.kt` is indigo `0xFF6366F1`. Design color is crimson `#e11d48`.
6. **Emoji** in `updater.rs::mock_update_info` release notes. Design bans emoji.
7. **FileProvider too wide.** `res/xml/file_paths.xml` exposes `external-path "."`. Only the update cache folder is needed.
8. **Slow list.** `commands.rs::list_favorites` runs a prediction query for every favorite. `store.rs::get_favorite` loads ALL favorites then filters. Will be very slow with thousands of entries.
9. **README mismatch.** README says Android API 24, `tauri.conf.json` says 26.
10. **Fake data.** `test_notification` uses a fake cover URL.

## Target library size
The owner's Mihon library has about 5000 entries. Design for 5000+ items: SQL paging, lazy rendering. Never load everything into the DOM.

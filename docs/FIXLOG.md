# FIXLOG - ShiniTrack v1.0.2

## T0: Persiapan dan baseline
Status: DONE
File yang diubah: docs/FIXLOG.md

Paths nyata:
- `api.rs`: `crates/core/src/api.rs`
- `error.rs`: `crates/core/src/error.rs`
- `store.rs`: `crates/core/src/store.rs`
- `commands.rs`: `app/src-tauri/src/commands.rs`
- `download.rs`: `app/src-tauri/src/download.rs`
- `updater.rs`: `app/src-tauri/src/updater.rs`
- `reader.rs`: `app/src-tauri/src/reader.rs`
- `backend.rs`: `app/src-tauri/src/backend.rs`
- `ShiniBridge.kt`: `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/ShiniBridge.kt`
- `MainActivity.kt`: `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/MainActivity.kt`
- `BackupWorker.kt`: `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/BackupWorker.kt`
- `AndroidManifest.xml`: `app/src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- `file_paths.xml`: `app/src-tauri/gen/android/app/src/main/res/xml/file_paths.xml`
- `library.js`: `app/ui/js/views/library.js`
- `detail.js`: `app/ui/js/views/detail.js`
- `detail-events.js`: `app/ui/js/views/detail-events.js`
- `reader.js`: `app/ui/js/views/reader.js`
- `reader-paged.js`: `app/ui/js/views/reader-paged.js`
- `explore.js`: `app/ui/js/views/explore.js`
- `more.js`: `app/ui/js/views/more.js`
- `categories.js`: `app/ui/js/views/categories.js`
- `statistik.js`: `app/ui/js/views/statistik.js`
- `penyimpanan.js`: `app/ui/js/views/settings/penyimpanan.js`
- `state.js`: `app/ui/js/state.js`
- `main.js`: `app/ui/js/main.js`
- `index.html`: `app/ui/index.html`
- `style.css`: `app/ui/style.css`

Baseline cargo check:
    Checking shinitrack-core v1.0.1 (C:\Users\MSI15\Pictures\New folder (2)\shinitrack\crates\core)
   Compiling shinitrack-app v1.0.1 (C:\Users\MSI15\Pictures\New folder (2)\shinitrack\app\src-tauri)
    Checking shinitrack-server v1.0.1 (C:\Users\MSI15\Pictures\New folder (2)\shinitrack\crates\server)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 43.37s

Baseline cargo test:
TBD

Perintah build Android (Kotlin):
TBD

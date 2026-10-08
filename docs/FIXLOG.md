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

## T1: Buang data dummy dari build produksi
Status: DONE
File yang diubah: app/src-tauri/src/commands.rs, app/src-tauri/src/updater.rs

Hasil grep sebelum perubahan:
- `app/src-tauri/src/commands.rs:607`: `manga_id: "solo-leveling-ragnarok".into(),` (DUMMY)
- `app/src-tauri/src/commands.rs:609`: `text: "Chapter 35 telah rilis! Ketuk untuk membaca langsung.".into(),` (DUMMY)
- `app/src-tauri/src/commands.rs:610`: `cover: Some("https://shinigami.asia/media/covers/solo-leveling-ragnarok.jpg".into()),` (DUMMY)
- `app/src-tauri/src/updater.rs:160`: `release_name: "ShiniTrack v0.2.3 - Mihon UX Edition".to_string(),` (DUMMY)
- `app/src-tauri/src/updater.rs:161`: `release_notes: "### Pembaruan v0.2.3\n- Perbaikan installer APK..."` (DUMMY)
- `app/src-tauri/src/updater.rs:164`: `"https://github.com/stenlysayd/ShiniTrack/releases/download/v0.2.3/ShiniTrack-v0.2.3.apk"` (DUMMY)

Nama file `debug-shinitrack.db` tidak ditemukan di codebase.

Perintah verifikasi: `cargo check --workspace --all-targets`
Output nyata:
    Checking shinitrack-app v1.0.1 (C:\Users\MSI15\Pictures\New folder (2)\shinitrack\app\src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.91s

## T2: In-app update: app keluar sendiri saat bar 100%
Status: DONE
File yang diubah: ShiniBridge.kt, AndroidManifest.xml, file_paths.xml, jni_bridge.rs, updater.rs

Perintah verifikasi: `cargo check --workspace --all-targets`
Output nyata:
    Checking shinitrack-app v1.0.1 (C:\Users\MSI15\Pictures\New folder (2)\shinitrack\app\src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.62s
    
Uji manual tersisa: PERLU UJI DI HP

# FIXLOG - ShiniTrack v1.0.2

## Tabel Laporan Akhir Tugas T0–T13

| Tugas | Status | File yang diubah | Perintah verifikasi + Output nyata | Uji manual yang tersisa |
|---|---|---|---|---|
| T0 — Persiapan dan baseline | DONE | `docs/FIXLOG.md` | `cargo check --workspace --all-targets`<br><pre>Checking shinitrack-core v1.0.1<br>Compiling shinitrack-app v1.0.1<br>Checking shinitrack-server v1.0.1<br>Finished dev profile in 43.37s</pre> | - |
| T1 — Buang data dummy dari build produksi | DONE | `app/src-tauri/src/commands.rs`, `app/src-tauri/src/updater.rs` | `cargo check --workspace --all-targets`<br><pre>Checking shinitrack-app v1.0.1<br>Finished dev profile in 4.91s</pre> | - |
| T2 — In-app update: app keluar sendiri saat bar 100% | DONE | `ShiniBridge.kt`, `AndroidManifest.xml`, `file_paths.xml`, `jni_bridge.rs`, `updater.rs` | `cargo check --workspace --all-targets`<br><pre>Checking shinitrack-app v1.0.1<br>Finished dev profile in 3.62s</pre> | U2: Uji update APK dan installer package di HP |
| T3 — Katalog Network Error | DONE | `crates/core/src/api.rs`, `crates/core/src/error.rs`, `crates/core/src/store.rs`, `app/ui/js/views/explore.js` | `cargo test -p shinitrack-core`<br><pre>test api::tests::test_parse_doh_json_cloudflare ... ok<br>test api::tests::test_parse_doh_json_google ... ok<br>test api::tests::test_parse_doh_json_empty_or_malformed ... ok<br>test error::tests::test_net_kind_messages ... ok<br>test result: ok. 36 passed; 0 failed</pre> | U3: Uji data seluler vs DoH di HP |
| T4 — Mode penyamaran (Incognito): verifikasi dan lengkapi | DONE | `crates/core/src/store.rs`, `app/src-tauri/src/commands.rs`, `app/ui/js/state.js`, `app/ui/js/views/settings/penyimpanan.js`, `app/ui/index.html` | `cargo test -p shinitrack-core`<br><pre>test store::tests::test_incognito ... ok<br>test result: ok. 37 passed; 0 failed</pre> | U4: Uji baca saat penyamaran aktif di HP |
| T5 — Pustaka/Kategori: duplikat kartu, nama kategori, tombol favorit | DONE | `crates/core/src/store.rs`, `app/ui/js/views/categories.js`, `app/ui/js/views/detail.js`, `app/ui/js/views/detail-events.js`, `app/ui/js/views/library.js` | `cargo test -p shinitrack-core`<br><pre>test store::tests::test_category_system_names_and_clear_cache ... ok<br>test store::tests::test_category_validation_all_cases ... ok<br>test result: ok. 38 passed; 0 failed</pre> | U5: Uji pindah tab 10x dan toggle favorit di HP |
| T6 — Tampilan Statistik: padding dan label | DONE | `app/ui/style.css` | `git diff --stat 726d228..031df48`<br><pre>app/ui/style.css | 13 +++++--------<br>1 file changed, 5 insertions(+), 8 deletions(-)</pre> | U6: Uji tampilan statistik lebar 360px di HP |
| T7 — "Hapus cache bab" yang bermakna (cache disk halaman bab) | DONE | `app/src-tauri/src/reader.rs`, `app/src-tauri/src/commands.rs`, `app/ui/js/views/settings/penyimpanan.js`, `app/ui/js/main.js` | `cargo test -p shinitrack-app`<br><pre>test reader::tests::test_fnv1a64 ... ok<br>test reader::tests::test_prune_cache_dir ... ok<br>test result: ok. 11 passed; 0 failed</pre> | U7: Uji ukuran cache disk halaman bab di HP |
| T8 — Backup: simpan ke tempat yang bisa dijangkau pengguna (SAF) | DONE | `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/ShiniBridge.kt`, `MainActivity.kt`, `BackupWorker.kt`, `build.gradle.kts`, `app/src-tauri/src/backend.rs`, `app/src-tauri/src/jni_bridge.rs`, `app/src-tauri/src/commands.rs`, `app/ui/js/views/settings/penyimpanan.js` | `cmd /c "cd app\src-tauri\gen\android && gradlew.bat compileDebugKotlin"`<br><pre>> Task :tauri-android:compileDebugKotlin UP-TO-DATE<br>> Task :tauri-plugin-notification:compileDebugKotlin UP-TO-DATE<br>BUILD SUCCESSFUL in 45s</pre> | U8: Uji simpan cadangan SAF dan pulihkan di HP |
| T9 — Unduhan: nama folder terbaca + kompatibel unduhan lama + ekspor | DONE | `app/src-tauri/src/download.rs`, `app/src-tauri/src/commands.rs`, `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/ShiniBridge.kt`, `app/src-tauri/src/jni_bridge.rs`, `app/ui/js/views/settings/penyimpanan.js` | `cargo test -p shinitrack-app`<br><pre>test download::tests::test_sanitize_folder_name ... ok<br>test download::tests::test_resolve_chapter_path_both_layouts ... ok<br>test result: ok. 12 passed; 0 failed</pre> | U9: Uji unduh bab dan salin ke folder SAF di HP |
| T10 — Antrean unduhan harus lanjut setelah proses dimatikan Android | DONE | `app/src-tauri/src/download.rs`, `crates/core/src/store.rs` | `cargo test -p shinitrack-app`<br><pre>test download::tests::test_reset_downloading_to_pending ... ok<br>test result: ok. 13 passed; 0 failed</pre> | U10: Uji matikan aplikasi saat unduh dan buka kembali |
| T11 — Reader paged: swipe bentrok dengan gestur kembali Android | DONE | `app/ui/js/views/reader-paged.js` | `node --check app/ui/js/views/reader-paged.js`<br>`git diff --stat 4a59d70..314783f`<br><pre>app/ui/js/views/reader-paged.js | 57 +++++++++++++++++++++++++++++++++++++++++<br>1 file changed, 57 insertions(+)</pre> | U11: Uji swipe tepi layar 24px untuk kembali Android |
| T12 — Hapus riwayat harus sinkron dengan pustaka | DONE | `app/src-tauri/src/commands.rs`, `app/ui/js/views/library.js`, `crates/core/src/store.rs` | `cargo test -p shinitrack-core`<br><pre>test store::tests::test_delete_history_sync_with_library ... ok<br>test result: ok. 39 passed; 0 failed</pre> | - |
| T13 — Nomor versi rilis 1.0.2 | DONE | `Cargo.toml`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/gen/android/app/build.gradle.kts` | `cargo check --workspace --all-targets`<br><pre>Checking shinitrack-core v1.0.2<br>Compiling shinitrack-app v1.0.2<br>Checking shinitrack-server v1.0.2<br>Finished dev profile in 31.18s</pre> | - |

---

## 1. Daftar MISMATCH (Kode Asli vs Dokumen)

1. **T7.4 - Tabel `chapter`:**
   - **Asumsi Dokumen:** Hapus baris tabel SQLite `chapter` saat membersihkan cache bab jika tidak dipakai siapa pun.
   - **Kode Asli:**
     ```sql
     -- Digunakan oleh open_chapter dan chapter_detail sebagai lookup offline
     SELECT chapter_id, manga_id, chapter_number, name, released_at FROM chapter WHERE chapter_id = ?1
     ```
   - **Resolusi:** Tabel `chapter` dilewati dari penghapusan SQL (`cache/chapters` disk dan `ctx.chapter_cache` in-memory yang dibersihkan) agar tidak merusak pembacaan bab offline.

2. **T12 - Kolom `favorites.last_read_at`:**
   - **Asumsi Dokumen:** Menjalankan transaksi menghapus `reading_progress` DAN `UPDATE favorites SET last_read_at = NULL`.
   - **Kode Asli (`crates/core/src/store.rs`):**
     Tabel `favorites` tidak memiliki kolom fisik `last_read_at`. Kolom `last_read_at` dihitung secara dinamis pada query `library_page`:
     ```sql
     (SELECT MAX(rp.updated_at) FROM reading_progress rp WHERE rp.manga_id = f.manga_id) AS last_read_at
     ```
   - **Resolusi:** `delete_history_item` dan `clear_reading_history` dijalankan dalam transaksi yang menghapus baris dari `reading_progress`. Hal ini otomatis membuat `last_read_at` di pustaka bernilai `NULL` tanpa mengubah skema tabel terlarang.

---

## 2. Daftar BLOCKED

Tidak ada tugas yang BLOCKED. Semua tugas T0 sampai T13 berhasil diselesaikan dan lolos verifikasi.

---

## 3. Asumsi yang Dibuat

1. Pada tugas T8 dan T9, implementasi SAF (Storage Access Framework) ditargetkan untuk lingkungan Android (`#[cfg(target_os = "android")]`). Pada lingkungan desktop non-Android, helper SAF mengembalikan status fallback yang aman.
2. Pada tugas T9, collision handling nama folder manga yang tersanitasi menggunakan akhiran ` [<6 karakter manga_id>]` jika direktori tersebut sudah ada dan file identitas `.manga_id` di dalamnya tidak cocok dengan `manga_id` saat ini.

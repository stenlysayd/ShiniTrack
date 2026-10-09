# AUDIT ShiniTrack Stabilize

Baseline: `b699e88` di cabang `codex/stabilize`.

## A. Katalog network error
- Status: RUSAK.
- Bukti: `crates/core/src/error.rs:7` menampilkan `network error: {0}` langsung; `crates/core/src/api.rs:34-35` memakai timeout 20/35 detik; `crates/core/src/api.rs:56-77` retry semua error termasuk 4xx/decode; `app/ui/js/views/explore.js:81-89` hanya menampilkan error dan tombol "Coba Lagi"; `app/src-tauri/src/lib.rs:38-109` belum mendaftarkan `diagnose_network`.
- Rencana: klasifikasi error reqwest, retry selektif, tambah DoH resolver + command diagnosa nyata, wrapper API, tombol diagnosa, dan pengaturan DNS-over-HTTPS.

## B. In-app update / installer APK
- Status: RUSAK.
- Bukti: dummy update masih ada di `app/src-tauri/src/updater.rs:155-170`; unduhan langsung menulis ke APK final tanpa `.part` di `app/src-tauri/src/updater.rs:187-216`; progres 100 dapat dikirim sebelum install tetapi tidak dipastikan final setelah rename karena belum ada rename di `app/src-tauri/src/updater.rs:195-223`; JNI belum memeriksa exception Java setelah `call_static_method` di `app/src-tauri/src/jni_bridge.rs:72-78`; Kotlin installer sebagian try/catch tetapi cek file/permission berada di luar blok utama di `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/ShiniBridge.kt:116-138`; FileProvider sudah ada dan path cache `updates` sudah tercakup di `app/src-tauri/gen/android/app/src/main/res/xml/file_paths.xml:3`.
- Rencana: hapus dummy produksi, perketat installer Kotlin/JNI, tulis APK ke `.part` lalu rename atomik, validasi ukuran, log tahap ke `shinitrack.log`, dan pastikan install dipanggil setelah event 100%.

## C. Mode penyamaran
- Status: BEKERJA.
- Bukti: guard backend memakai `pref.privacy.incognito` di `app/src-tauri/src/commands.rs:830-840`, `app/src-tauri/src/commands.rs:899-909`, dan `app/src-tauri/src/commands.rs:953-963`; reader JS memeriksa `privacy.incognito` sebelum menyimpan di `app/ui/js/views/reader.js:58-67`; badge topbar ada di `app/ui/js/main.js:82-93`.
- Rencana: tidak diubah.

## D. Pustaka/kategori
- Status: RUSAK sebagian.
- Bukti: pustaka memakai `library_page` backend dan dedupe DOM ada di `app/ui/js/views/library.js:90-107`; tombol favorit detail memakai helper terpisah kategori di `app/ui/js/views/detail-events.js:74-96`; JS menolak "Semua"/"Bawaan" di `app/ui/js/views/categories.js:178-186` dan `app/ui/js/views/categories.js:258-266`; Rust hanya trim dan menolak kosong/"semua"/"bawaan" di `crates/core/src/store.rs:881-895` serta `crates/core/src/store.rs:916-930`, belum kolaps spasi, belum menolak `default`, belum batas >40, dan duplikat masih mengandalkan UNIQUE mentah `crates/core/src/store.rs:89`.
- Rencana: pakai validasi Rust di `create_category` dan `rename_category` dengan pesan galat bersih tanpa mengubah validasi JS.

## E. Statistik
- Status: BEKERJA.
- Bukti: struktur HTML memakai `.stats-container`, `.stats-hero-card`, `.stats-grid`, `.stats-card`, `.stats-card-label` di `app/ui/js/views/statistik.js:49-105`; CSS untuk selector yang sama lengkap di `app/ui/style.css:3315-3479`.
- Rencana: tidak diubah.

## F. Hapus/cache bab
- Status: RUSAK.
- Bukti: halaman bab dari jaringan langsung `fetch_bytes` dan direspons tanpa tulis disk di `app/src-tauri/src/reader.rs:124-128`; `clear_cache` menghapus `cache/chapters` di `app/src-tauri/src/commands.rs:1201-1206`, tetapi folder itu tidak pernah diisi; `storage_info` menghitung `cache` umum di `app/src-tauri/src/commands.rs:1162`.
- Rencana: tambah cache file `cache/chapters/<fnv1a64>.bin` + `.ct`, pruning 200 MB, dan kosongkan folder itu saat `clear_cache`.

## G. Lokasi cadangan
- Status: RUSAK.
- Bukti: backup selalu ditulis ke `dir/backups` di `app/src-tauri/src/commands.rs:1344-1349`; UI membuat Blob dan klik anchor download di `app/ui/js/views/settings/penyimpanan.js:86-97`; worker otomatis hanya memanggil backup internal di `app/src-tauri/src/backend.rs:283-319`; belum ada command SAF di `app/src-tauri/src/lib.rs:38-109`.
- Rencana: tambah SAF Kotlin/SharedPreferences + command `saf_*`, ubah UI "Buat cadangan" menjadi bottom sheet "Simpan ke..." dan "Bagikan", serta sinkronkan backup otomatis ke folder terpilih.

## H. Lokasi unduhan
- Status: RUSAK.
- Bukti: unduhan tersimpan di `ctx.dir/downloads/<Judul>/Chapter N` di `app/src-tauri/src/download.rs:63-70`; lokasi internal hanya ditampilkan sebagai teks di `app/ui/js/views/settings/penyimpanan.js:21-25`; belum ada command ekspor unduhan SAF di `app/ui/js/api.js:77-96` atau `app/src-tauri/src/lib.rs:38-109`.
- Rencana: tambah folder ekspor SAF dan command salin rekursif unduhan ke tree ekspor.

## I. Antrean unduhan
- Status: RUSAK.
- Bukti: worker mengambil hanya status `pending` di `crates/core/src/store.rs:1249-1256`; status diubah ke `downloading` di `app/src-tauri/src/download.rs:260-266`; tidak ada reset `downloading` saat `QueueWorker::run_loop` mulai di `app/src-tauri/src/download.rs:203-205`.
- Rencana: tambah `Store::queue_reset_downloading()`, panggil sekali di awal loop, lalu emit `queue-changed`.

## J. Hapus riwayat
- Status: RUSAK.
- Bukti: `clear_reading_history` hanya `DELETE FROM reading_progress` di `crates/core/src/store.rs:976-978`; `last_read_at` berasal dari `reading_progress` di query pustaka `crates/core/src/store.rs:1122`; UI memakai `last_read_at` untuk filter/status mulai baca di `app/ui/js/views/library.js:159` dan `app/ui/js/views/updates-filter.js:152-153`.
- Rencana: clear history dalam transaksi dan reset metadata "terakhir dibaca" yang tersimpan di favorit jika ada, lalu refresh pustaka.

## K. Diff `fix/shinitrack-1.0.2` (`git diff b699e88 b713db9`)
- Status: RUSAK sebagian, hanya ide boleh diambil manual.
- Bukti T1 dummy: hunk `commands.rs` membungkus notifikasi contoh dengan `debug_assertions` tetapi string dummy tetap ada; hunk `updater.rs` membungkus mock v0.2.3 dengan `debug_assertions` tetapi string dummy tetap ada. Ini tidak memenuhi syarat grep bersih.
- Bukti T2 installer: hunk `updater.rs` menambah `.part`, ukuran, event 100, dan log; layak sebagai ide tetapi perlu disesuaikan agar progress 100 tidak terpotong dan log tidak bergantung hanya pada `data_dir_override`. Hunk `jni_bridge.rs` menambah `exception_check/describe/clear`; layak sebagai ide tetapi format `"OK"/"ERR"` mengganti kontrak JSON Kotlin. Hunk `ShiniBridge.kt` memindahkan installer ke try/catch dan memakai application context; layak sebagai ide tetapi perlu kembali ke JSON `InstallOutcome`. Hunk `file_paths.xml` menambah path `updates`; aman tetapi baseline sudah punya `cache-path updates` dan perlu tetap cocok dengan lokasi `updater.rs`.
- Rencana: terapkan ulang hunk yang benar secara manual, bukan cherry-pick.

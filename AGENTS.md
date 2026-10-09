# AGENTS.md — ShiniTrack (aturan tetap untuk semua agen AI)

Aplikasi pembaca manga: Tauri v2 + Rust (crates/core, app/src-tauri) + Webview JS (app/ui) + Android Kotlin (app/src-tauri/gen/android).
Pemilik: Eryl. Bahasa kerja dan semua teks UI: Bahasa Indonesia. Balasan dan laporan: Indonesia, singkat, tanpa pujian.

## 1. Cabang
- Kerja HANYA di cabang `codex/stabilize` yang dibuat dari `main` (main == commit b699e88, release v1.0.1 yang bersih).
- DILARANG checkout, merge, rebase, atau cherry-pick buta dari `fix/shinitrack-1.0.2`, `fix/shinitrack-v2`, `upgrade-mihon`.
  Cabang itu hanya boleh DIBACA (`git show`, `git diff`) untuk mengambil ide. Isinya banyak yang rusak (lihat Bagian 5).
- Satu perubahan logis = satu commit kecil. Jangan commit file sampah (log, skrip bantu, *.py, *_log.txt).

## 2. Verifikasi wajib (tidak boleh dilewati, tidak boleh dipalsukan)
Sebelum setiap commit jalankan `.\verify.ps1` dan baca hasilnya sendiri. Semua langkah harus berstatus PASS:
1. ESLint no-undef + parse pada seluruh `app/ui/js` (menangkap variabel tak dideklarasikan dan sintaks rusak).
2. `cargo check --workspace --all-targets`
3. `cargo test --workspace --no-fail-fast` (SEMUA crate)
4. `cargo tauri android build --debug --apk -t aarch64` dari root repo (ini mengompilasi Rust untuk Android termasuk `jni_bridge.rs`, plus Kotlin). JANGAN menjalankan `gradlew assembleArm64Debug` langsung: Gradle butuh Tauri CLI yang sedang berjalan (galat `cli-options-server.json`).
Aturan keras:
- `jni_bridge.rs` hanya dikompilasi di Android. `cargo check` di Windows TIDAK memeriksanya. Perubahan di sana wajib lolos langkah 4. Jika `cargo tauri` belum ada: `cargo install tauri-cli --version "^2.0"`.
- Dilarang mengubah, menghapus, atau melemahkan test supaya lulus. Test gagal = perbaiki kodenya.
- Dilarang menulis "berhasil/lulus" tanpa menempelkan baris ringkasan asli dari output verify.
- Perilaku di HP tidak bisa kamu uji. Tulis "PERLU UJI DI HP" + langkah ujinya. Jangan klaim sudah terverifikasi di perangkat.

## 3. Cara mengedit (penyebab utama kegagalan sebelumnya)
- Dilarang edit lewat skrip Python/PowerShell dengan `replace`/regex buta. Edit file langsung. Setelah SETIAP edit jalankan `git diff -- <file>` dan baca hasilnya.
  Penggantian yang diam-diam tidak cocok pernah membuat perbaikan "tercatat selesai" padahal tidak berubah.
- Dilarang menghapus aturan CSS yang ada. Ubah nilainya saja. (Pernah `.stats-card` diganti satu baris sehingga gaya kartu hilang.)
- Dilarang membuat stub (`Ok(())`, fungsi kosong, penanda kerja belum selesai) untuk menutupi fungsi yang belum ada.
- Dilarang menghapus validasi/perilaku yang sudah benar di v1.0.1 lalu menggantinya dengan kode yang belum terpakai.
- Dilarang refactor/rename/format ulang file yang tidak terkait. Jangan `cargo fmt` seluruh workspace.
- Dilarang menambah dependency atau menaikkan versi dependency/Gradle/Tauri kecuali tugas menyebutnya.
- Setiap fungsi/API yang dipakai harus terbukti ada (kompilasi lolos atau `git grep`). Jangan mengarang API.

## 4. Fakta kode yang SUDAH BENAR di v1.0.1 (jangan dikerjakan ulang)
- Mode penyamaran sudah lengkap: guard di `commands.rs` (`save_reading_progress`, `mark_chapter_read`, `mark_chapters_batch`) memakai kunci kv `pref.privacy.incognito`;
  `reader.js` sudah punya guard; badge topbar + `updateIncognitoUI` sudah ada.
- Tombol favorit di detail sudah toggle benar (hapus langsung) + tombol terpisah `#det-cat-btn`.
- Library sudah dedupe lewat DOM dan sentinel di-unobserve saat reset.
- `categories.js` sudah memvalidasi nama "Semua"/"Bawaan" di sisi JS.
- Unduhan sudah memakai folder `downloads/<Judul>/Chapter N`. Lokasi bab untuk dibaca offline disimpan di record unduhan, jangan diubah.
- CSS `.stats-*` sudah memakai padding yang benar. Jangan diubah kecuali ada bukti masalah.
- Penyimpanan preferensi: di JS `getPref('a.b')` / `setPref('a.b')` = baris kv `pref.a.b` di Rust (`store.kv_get("pref.a.b")`). Salah kunci = guard mati diam-diam.
- Tauri v2: di JS pakai `window.__TAURI__.core.invoke` (bukan `__TAURI__.invoke`), dan lewat wrapper `app/ui/js/api.js`. Di Rust pakai `app.emit(...)` (bukan `emit_all`). Tidak ada `crate::APP_HANDLE`.
- Pola JNI yang benar ada di `jni_bridge.rs` (`can_install_packages`, `trigger_install_apk`): `JAVA_VM.get()` -> `attach_current_thread()` -> `find_class("id/shinitrack/app/ShiniBridge")` -> `call_static_method`.
  Fungsi `run_in_jni` TIDAK ada. Jangan mengubah tipe kembalian fungsi JNI yang ada tanpa mengubah deklarasi `external` Kotlin pasangannya.
- `global Icons` dipakai di JS (dari `icons.js`). Komponen UI yang ada: `createBottomSheet({tabs, content})` di `components/bottom-sheet.js`. Periksa dengan `git grep` sebelum memakai helper lain (mis. `utils.showSheet` belum tentu ada).
- Preferensi cadangan: `pref.storage.auto_backup_freq` bernilai `off|6h|12h|24h|weekly`; `pref.storage.last_backup`; `pref.storage.backup_include_token`.

## 5. Daftar "JANGAN PERNAH" (kerusakan nyata dari cabang Gemini; sudah terbukti lewat diff)
- `more.js`: baris import rusak `...bottom-sheet.js'; from '../components/list-row.js';` (parse error).
- `library.js`: memakai `loadSeq`/`renderedIds` tanpa mendeklarasikannya (Pustaka jadi kosong).
- `style.css`: mengganti seluruh `.stats-card` dan `.stats-card-label`/`.stats-container` dengan satu baris (gaya kartu Statistik hilang).
- `penyimpanan.js`: `window.__TAURI__.invoke(...)` (tidak ada di Tauri v2), `window.__TAURI__.fs.readTextFile` (plugin fs tidak ada), tombol Pulihkan dimatikan, `setPref`/`render` tidak ter-import.
- `jni_bridge.rs`: `run_in_jni` tak ada, `crate::APP_HANDLE` tak ada, `app.emit_all` (API v1), tipe kembalian `nativeRegisterEndpoint` salah ubah ke `jstring`.
- `ShiniBridge.kt`: pemanggilan pada `DocumentFile?` tanpa penanganan null (gagal kompilasi).
- `store.rs`: `is_incognito` memakai kunci `privacy.incognito` (tanpa `pref.`), test dibuat dengan kunci salah agar lulus; `normalize_category_name` ditulis tapi tidak dipakai `create_category`/`rename_category`.
- `commands.rs`: menghapus tanda kutip dari query pencarian, `sleep(500ms)` + semaphore 2 di `library_update`/`refresh_all` (memperlambat update pustaka), `diagnose_network` kosong.
- `MainActivity.kt`: callback tombol kembali yang memanggil JS, `webView.reload()` setelah 5 menit di latar belakang.
- `lib.rs`/`backend.rs`: pembersih cache gambar otomatis saat startup (tidak diminta).
- `reader.js`/`reader-paged.js`: pembungkus gambar + tombol retry, navigasi swipe baru, zona tap tepi 30px (tidak diminta).
- `download.rs`: `sanitize_folder_name` memakai `String::truncate(80)` pada byte (panic untuk judul non-ASCII) dan test-nya gagal.
- `diagnose_network`, DoH resolver (`DohResolver`): TIDAK PERNAH benar-benar ada di cabang itu walau dilaporkan selesai.

## 6. Format laporan setiap selesai satu item
`Item | status (SELESAI / TIDAK BISA / PERLU UJI DI HP) | file diubah | ringkasan verify.ps1 (tempel baris PASS/FAIL) | catatan`
Temuan di luar tugas: catat satu baris, JANGAN dikerjakan.

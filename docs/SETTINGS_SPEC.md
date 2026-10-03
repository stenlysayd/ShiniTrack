# SETTINGS SPEC

Prefs are saved with `setPref(key, value)` (values are strings: "1"/"0", enum name, number).
Key format: `section.name`. Defaults are in the tables. Mark "needs backend" = new Rust/Kotlin work.
Build the renderer once (ROADMAP 3.1), then each screen is only a schema array.

## 0. Settings main list (route `#/more/settings`)
Exact order, title + subtitle (Indonesian):
1. Tampilan - "Tema, format tanggal & waktu"
2. Pustaka - "Kategori, pembaruan global"
3. Pembaca - "Mode membaca, tampilan, navigasi"
4. Unduhan - "Unduh otomatis, hapus setelah dibaca"
5. Sinkronisasi - "Server, notifikasi push"
6. Jelajahi - "Sumber, kualitas gambar"
7. Data dan penyimpanan - "Pencadangan, ruang penyimpanan"
8. Keamanan dan privasi - "Kunci aplikasi, amankan layar"
9. Lanjutan - "Log kerusakan, pengoptimalan baterai"
10. Tentang - "ShiniTrack <version>"
Top right: search icon (filters settings by title; do last).

## 1. Tampilan
| Key | Type | Default | Notes |
|---|---|---|---|
| ui.theme_mode | select: Sistem / Terang / Gelap | dark | set `data-theme` on `<html>`; needs light CSS tokens |
| ui.amoled | switch "Mode gelap AMOLED" | 0 | `--bg:#000` |
| ui.accent | select: Crimson / Biru / Hijau / Ungu | crimson | changes `--accent` vars only |
| ui.relative_time | switch "Waktu relatif" | 1 | |
| ui.date_format | select: Default / dd/MM/yyyy / MM/dd/yyyy / yyyy-MM-dd | default | |
| ui.animations | switch "Animasi" | 1 | also respect OS reduced-motion |

## 2. Pustaka
| Key | Type | Default | Notes |
|---|---|---|---|
| lib.categories | button -> `#/more/categories` | | |
| lib.default_category | select (list of categories + "Selalu tanya") | ask | used when adding to library |
| lib.update_interval | select: Manual / 1 jam / 3 jam / 6 jam / 12 jam / Harian | 6h | WorkManager period; needs Kotlin change (now fixed 15 min) |
| lib.update_only_notify | switch "Hanya perbarui entri dengan notifikasi aktif" | 0 | |
| lib.update_wifi_only | switch "Hanya saat Wi-Fi" | 0 | WorkManager constraint |
| lib.mark_dup_read | switch "Tandai bab duplikat sebagai dibaca" | 0 | |
| lib.badge_unread / badge_download / badge_notify / show_count | switches | 1/1/1/1 | same keys as Library bottom sheet |

## 3. Pembaca
| Key | Type | Default | Notes |
|---|---|---|---|
| reader.mode | select: Webtoon / Paged L-R / Manga R-L | webtoon | per-manga override stored in `manga_meta` later |
| reader.keep_awake | switch "Biarkan layar menyala" | 1 | Android `FLAG_KEEP_SCREEN_ON`, needs Kotlin bridge |
| reader.fullscreen | switch "Layar penuh" | 1 | |
| reader.page_number | switch "Tampilkan nomor halaman" | 1 | |
| reader.bg | select: Hitam / Abu-abu / Putih | black | |
| reader.tap_invert | switch "Balik zona ketuk" | 0 | |
| reader.tap_zone | select: Default / Kindle / L / Tepi / Nonaktif | default | |
| reader.preload | select: 2 / 4 / 6 halaman | 4 | |
| reader.auto_next | switch "Otomatis lanjut bab berikutnya" | 1 | |
| reader.mark_read_at_end | switch "Tandai dibaca di halaman terakhir" | 1 | |

## 4. Unduhan
| Key | Type | Default | Notes |
|---|---|---|---|
| dl.wifi_only | switch | 1 | needs network-type check (Kotlin) |
| dl.delete_after_read | switch | 0 | |
| dl.auto_download_new | switch "Unduh otomatis bab baru" | 0 | only for favorites with notify on |
| dl.parallel | select: 2 / 4 / 6 | 4 | now a const in download.rs |
| dl.low_quality | switch "Kualitas rendah" | 0 | REUSE existing `low_quality` kv setting. Do not duplicate |

## 5. Sinkronisasi (server + push)
Reuse existing `settings_get` / `settings_set` (server_url, server_token). Do not change them.
Items: Server URL (text), Token (password text), button "Uji koneksi" (calls health), info "Status UnifiedPush" (registered or not), switch "Pemeriksaan langsung (tanpa server)" default 1.

## 6. Jelajahi
Items: select "Bahasa/negara asal" filter (all/KR/CN/JP), switch "Sembunyikan entri yang sudah di pustaka" (default 0), select "Urutan default" (Terbaru/Populer/A-Z), switch "Kualitas rendah di jelajahi" (optional).

## 7. Data dan penyimpanan
Header "Lokasi penyimpanan" (info text of app data dir). Header "Pencadangan dan pemulihan": two buttons side by side "Buat cadangan" / "Pulihkan cadangan". select "Frekuensi pencadangan otomatis" (Mati / 6 jam / 12 jam / Harian / Mingguan), info "Terakhir dicadangkan: ...". Header "Penggunaan penyimpanan": progress bar (free/total), button "Hapus cache bab" (shows size), switch "Bersihkan cache bab saat aplikasi dibuka", button "Hapus cache sampul". Header "Ekspor": button "Daftar pustaka" (CSV/JSON).
Needs backend: `storage_info`, `clear_cache`, `backup_create`, `backup_restore`, Kotlin auto-backup worker.

## 8. Keamanan dan privasi
| Key | Type | Default | Notes |
|---|---|---|---|
| sec.app_lock | switch "Kunci aplikasi" | 0 | Kotlin BiometricPrompt; needs `androidx.biometric` dependency (ask first) |
| sec.lock_delay | select: Segera / 1 / 5 / 10 menit | 0 | |
| sec.secure_screen | select: Mati / Selalu / Saat penyamaran | off | Android `FLAG_SECURE` |
| privacy.incognito | switch "Mode penyamaran" | 0 | same key as More screen; stops saving history/progress |

## 9. Lanjutan
Buttons: "Buat log kerusakan" (copy logs to clipboard), "Pengoptimalan baterai" (opens Android ignore-battery-optimization settings, Kotlin), "Uji notifikasi" (existing `test_notification`), "Hapus riwayat baca", "Reset pengaturan" (confirm), "Bersihkan basis data" (confirm, deletes cache tables only, never favorites), info "Info debug" (copy version, device, db version).

## 10. Tentang
Rows: Versi (version + build date), Periksa pembaruan (reuse `check_app_update`), Apa yang baru (GitHub releases link), Lisensi terbuka (static list: Tauri, GSAP, Rust crates), Kebijakan privasi (short static page: local-first, no tracking). Icons row: website, GitHub.
Also keep: switch "Periksa pembaruan otomatis" + field "Repo GitHub" (existing github_repo, auto_check_update).

## Renderer item shapes (use exactly these)
```js
{ type: 'header', title: 'Pencadangan' }
{ type: 'switch', key: 'dl.wifi_only', title: '...', subtitle: '...', default: '1' }
{ type: 'select', key: 'reader.mode', title: '...', options: [{value:'webtoon', label:'Webtoon'}], default: 'webtoon' }
{ type: 'text', key: '...', title: '...', password: false }
{ type: 'button', title: '...', subtitle: '...', onClick: () => {} }
{ type: 'info', text: '...' }
```

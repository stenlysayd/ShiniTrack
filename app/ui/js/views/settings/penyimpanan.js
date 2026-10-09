import { renderSettings } from './render.js';
import * as api from '../../api.js';
import * as utils from '../../utils.js';
import { getPref } from '../../state.js';

let activeContainer = null;

function invoke(cmd, args) {
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    return window.__TAURI__.core.invoke(cmd, args);
  }
  return Promise.reject(new Error('Tauri API tidak tersedia'));
}

let safListenerAttached = false;
function ensureSafListener() {
  if (safListenerAttached) return;
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen('saf-result', (event) => {
      const { kind, ok, message, uri } = event.payload || {};
      if (kind === 'pick_tree') {
        if (ok && uri) {
          api.pref_set({ key: 'storage.backup_tree_uri', value: uri }).then(() => {
            utils.showToast(`Folder cadangan otomatis: ${message}`);
            refreshStorageInfo();
          });
        } else {
          utils.showToast(`Pilih folder: ${message}`);
        }
      } else if (kind === 'restore') {
        if (ok && message) {
          utils.showToast('Memulihkan data cadangan...');
          invoke('backup_restore', { file_path: message, filePath: message }).then((res) => {
            utils.showToast(res.message || 'Cadangan berhasil dipulihkan!');
            refreshStorageInfo();
          }).catch(err => utils.showToast(`Gagal memulihkan: ${err}`));
        } else {
          utils.showToast(`Batal pulihkan: ${message}`);
        }
      } else if (kind === 'save_backup') {
        utils.showToast(ok ? 'Cadangan berhasil disimpan' : `Batal/Gagal simpan: ${message}`);
      } else if (kind === 'share_backup') {
        if (!ok) utils.showToast(`Gagal membagikan: ${message}`);
      } else if (kind === 'pick_export_tree') {
        if (ok && uri) {
          api.pref_set({ key: 'dl.export_tree_uri', value: uri }).then(() => {
            utils.showToast(`Folder ekspor unduhan: ${message}`);
            refreshStorageInfo();
          });
        } else {
          utils.showToast(`Pilih folder: ${message}`);
        }
      } else if (kind === 'export_downloads') {
        utils.showToast(message || (ok ? 'Unduhan berhasil disalin' : 'Gagal menyalin unduhan'));
        refreshStorageInfo();
      }
    });

    window.__TAURI__.event.listen('export-progress', (event) => {
      const { done, total } = event.payload || {};
      if (total > 0) {
        utils.showToast(`Menyalin unduhan: ${done}/${total} berkas`);
      }
    });

    safListenerAttached = true;
  }
}

function showBackupSheet(filePath) {
  const existing = document.getElementById('backup-sheet-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'backup-sheet-overlay';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:flex-end; justify-content:center;';

  const sheet = document.createElement('div');
  sheet.className = 'modal-dialog';
  sheet.style.cssText = 'background:var(--surface, #1e1e1e); width:100%; max-width:480px; border-radius:16px 16px 0 0; padding:20px; box-shadow:0 -4px 16px rgba(0,0,0,0.4); display:flex; flex-direction:column; gap:12px;';

  sheet.innerHTML = `
    <div style="font-weight:600; font-size:16px; margin-bottom:4px; color:var(--text-primary);">Berkas Cadangan Dibuat</div>
    <div style="font-size:13px; color:var(--text-secondary); margin-bottom:8px;">Pilih tindakan untuk berkas cadangan ini:</div>
    <button id="btn-backup-save" class="btn btn-primary" style="padding:12px; border-radius:8px; cursor:pointer;">Simpan ke…</button>
    <button id="btn-backup-share" class="btn" style="padding:12px; border-radius:8px; background:var(--surface-elevated, #2a2a2a); color:var(--text-primary); cursor:pointer;">Bagikan</button>
    <button id="btn-backup-cancel" class="btn" style="padding:10px; margin-top:4px; background:transparent; color:var(--text-muted); cursor:pointer;">Tutup</button>
  `;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  sheet.querySelector('#btn-backup-cancel').onclick = close;
  sheet.querySelector('#btn-backup-save').onclick = async () => {
    close();
    try {
      await invoke('backup_create', { action: 'save_saf' });
    } catch (e) {
      utils.showToast(`Gagal membuka dialog simpan: ${e}`);
    }
  };
  sheet.querySelector('#btn-backup-share').onclick = async () => {
    close();
    try {
      await invoke('backup_create', { action: 'share' });
    } catch (e) {
      utils.showToast(`Gagal membagikan: ${e}`);
    }
  };
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

async function refreshStorageInfo() {
  if (!activeContainer) return;
  try {
    const info = await api.storage_info();
    if (!info) return;

    // Update location text
    const infoEls = activeContainer.querySelectorAll('.settings-info-text');
    if (infoEls[0]) {
      const dlBytesStr = formatBytes(info.downloads_bytes || 0);
      infoEls[0].innerHTML = `<b>Data Aplikasi:</b> ${info.data_dir}<br/>` +
        `<b>Jalur Unduhan Internal:</b> ${info.data_dir}/downloads (${dlBytesStr})<br/>` +
        `<span style="color:var(--text-faint); font-size:11.5px; display:inline-block; margin-top:4px;">` +
        `Unduhan disimpan di dalam aplikasi agar cepat dibaca. Gunakan 'Salin unduhan ke folder ini' untuk mengambil berkasnya.` +
        `</span>`;
    }

    // Auto backup warning text
    if (infoEls[1]) {
      const parentCard = infoEls[1].closest('.settings-info-card');
      if (parentCard) {
        parentCard.style.display = info.backup_tree_folder ? 'none' : 'flex';
      }
    }

    // Update last backup text
    if (infoEls[2]) {
      infoEls[2].textContent = info.last_backup
        ? `Terakhir dicadangkan: ${utils.formatRelativeTime(new Date(info.last_backup))}`
        : 'Terakhir dicadangkan: Belum ada data cadangan';
    }

    // Update storage card
    const statText = activeContainer.querySelector('#storage-stat-text');
    if (statText) statText.textContent = `Digunakan: ${formatBytes(info.total_used_bytes)}`;
    const fill = activeContainer.querySelector('#storage-progress-fill');
    if (fill) fill.style.width = info.total_used_bytes > 0 ? '15%' : '2%';

    // Update button subtitles
    activeContainer.querySelectorAll('.settings-button-row').forEach(btn => {
      const titleEl = btn.querySelector('.t');
      const subEl = btn.querySelector('.s');
      if (!titleEl || !subEl) return;
      if (titleEl.textContent === 'Hapus cache bab') {
        const sz = info.chapter_cache_bytes != null ? info.chapter_cache_bytes : info.cache_bytes;
        subEl.textContent = `Kosongkan cache halaman bab di memori dan disk (${formatBytes(sz)})`;
      } else if (titleEl.textContent === 'Hapus cache sampul') {
        const sz = info.cover_cache_bytes != null ? info.cover_cache_bytes : 0;
        subEl.textContent = `Kosongkan cache gambar sampul manga (${formatBytes(sz)})`;
      } else if (titleEl.textContent === 'Folder cadangan otomatis') {
        subEl.textContent = info.backup_tree_folder || 'Belum dipilih';
      } else if (titleEl.textContent === 'Folder ekspor unduhan') {
        subEl.textContent = info.export_tree_folder || 'Belum dipilih';
      }
    });
  } catch (err) {
    console.warn('Failed to refresh storage info:', err);
  }
}

export const penyimpananSchema = [
  {
    type: 'header',
    title: 'Lokasi Penyimpanan'
  },
  {
    type: 'info',
    text: 'Lokasi data: Memuat...'
  },
  {
    type: 'header',
    title: 'Pencadangan dan Pemulihan'
  },
  {
    type: 'switch',
    key: 'storage.backup_include_token',
    title: 'Sertakan token server',
    subtitle: 'Sertakan token autentikasi server dalam berkas cadangan',
    default: '0'
  },
  {
    type: 'button',
    title: 'Buat cadangan',
    subtitle: 'Cadangkan pustaka, riwayat, dan preferensi aplikasi ke berkas JSON',
    icon: window.Icons && window.Icons.download ? window.Icons.download() : '',
    onClick: async () => {
      utils.showToast('Membuat cadangan...');
      try {
        const includeToken = getPref('storage.backup_include_token', '0') === '1';
        const res = await invoke('backup_create', { includeToken, action: 'create' });
        showBackupSheet(res.file_path);
      } catch (err) {
        utils.showToast(`Gagal membuat cadangan: ${err}`);
      }
    }
  },
  {
    type: 'button',
    title: 'Folder cadangan otomatis',
    subtitle: 'Belum dipilih',
    icon: window.Icons && window.Icons.folder ? window.Icons.folder() : '',
    onClick: async () => {
      try {
        await invoke('backup_create', { action: 'pick_tree' });
      } catch (err) {
        utils.showToast(`Gagal memilih folder: ${err}`);
      }
    }
  },
  {
    type: 'info',
    text: 'Cadangan otomatis tersimpan di dalam aplikasi dan akan hilang jika aplikasi dihapus. Pilih folder agar aman.'
  },
  {
    type: 'select',
    key: 'storage.auto_backup_freq',
    title: 'Frekuensi pencadangan otomatis',
    options: [
      { value: 'off', label: 'Mati' },
      { value: '6h', label: '6 jam' },
      { value: '12h', label: '12 jam' },
      { value: '24h', label: 'Harian' },
      { value: 'weekly', label: 'Mingguan' }
    ],
    default: 'off'
  },
  {
    type: 'info',
    text: 'Terakhir dicadangkan: Memuat...'
  },
  {
    type: 'button',
    title: 'Pulihkan dari berkas…',
    subtitle: 'Pulihkan pustaka dan preferensi dari berkas cadangan JSON',
    icon: window.Icons && window.Icons.sync ? window.Icons.sync() : '',
    onClick: async () => {
      try {
        await invoke('backup_restore', { action: 'open_saf' });
      } catch (e) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.style.display = 'none';
        fileInput.onchange = (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          utils.showToast('Membaca berkas cadangan...');
          const reader = new FileReader();
          reader.onload = async (evt) => {
            try {
              const json = evt.target.result;
              const res = await invoke('backup_restore', { json });
              utils.showToast(res.message || 'Cadangan berhasil dipulihkan!');
              refreshStorageInfo();
            } catch (err) {
              utils.showToast(`Gagal memulihkan: ${err}`);
            }
          };
          reader.readAsText(file);
        };
        document.body.appendChild(fileInput);
        fileInput.click();
        setTimeout(() => fileInput.remove(), 1000);
      }
    }
  },
  {
    type: 'header',
    title: 'Penggunaan Penyimpanan'
  },
  {
    type: 'button',
    title: 'Hapus cache bab',
    subtitle: 'Kosongkan cache halaman bab di memori dan disk',
    icon: window.Icons && window.Icons.trash ? window.Icons.trash() : '',
    onClick: async () => {
      utils.showToast('Membersihkan cache bab...');
      try {
        const freed = await api.clear_cache({ target: 'chapters' });
        utils.showToast(`Cache bab dibersihkan (${formatBytes(freed)})`);
        refreshStorageInfo();
      } catch (err) {
        utils.showToast(`Gagal membersihkan cache: ${err}`);
      }
    }
  },
  {
    type: 'switch',
    key: 'storage.clear_cache_on_open',
    title: 'Bersihkan cache bab saat aplikasi dibuka',
    subtitle: 'Otomatis menghapus cache bab setiap kali aplikasi dimulai',
    default: '0'
  },
  {
    type: 'button',
    title: 'Hapus cache sampul',
    subtitle: 'Kosongkan cache gambar sampul manga (0 MB)',
    icon: window.Icons && window.Icons.trash ? window.Icons.trash() : '',
    onClick: async () => {
      utils.showToast('Membersihkan cache sampul...');
      try {
        const freed = await api.clear_cache({ target: 'covers' });
        utils.showToast(`Cache sampul dibersihkan (${formatBytes(freed)})`);
        refreshStorageInfo();
      } catch (err) {
        utils.showToast(`Gagal membersihkan sampul: ${err}`);
      }
    }
  },
  {
    type: 'header',
    title: 'Ekspor'
  },
  {
    type: 'button',
    title: 'Folder ekspor unduhan',
    subtitle: 'Belum dipilih',
    icon: window.Icons && window.Icons.folder ? window.Icons.folder() : '',
    onClick: async () => {
      try {
        await invoke('backup_create', { action: 'pick_export_tree' });
      } catch (e) {
        utils.showToast(`Gagal memilih folder: ${e}`);
      }
    }
  },
  {
    type: 'button',
    title: 'Salin unduhan ke folder ini',
    subtitle: 'Salin berkas komik yang sudah diunduh ke folder ekspor terpilih',
    icon: window.Icons && window.Icons.download ? window.Icons.download() : '',
    onClick: async () => {
      try {
        const info = await api.storage_info();
        if (!info || !info.export_tree_uri) {
          utils.showToast('Pilih folder ekspor unduhan terlebih dahulu');
          return;
        }
        utils.showToast('Menyalin unduhan ke folder ekspor...');
        await invoke('backup_create', { action: 'export_downloads' });
      } catch (e) {
        utils.showToast(`Gagal menyalin unduhan: ${e}`);
      }
    }
  },
  {
    type: 'button',
    title: 'Daftar pustaka',
    subtitle: 'Ekspor daftar koleksi pustaka ke berkas CSV atau JSON',
    icon: window.Icons && window.Icons.download ? window.Icons.download() : '',
    onClick: async () => {
      utils.showToast('Mengekspor pustaka...');
      try {
        const favs = await api.list_favorites();
        if (!Array.isArray(favs) || favs.len === 0) {
          utils.showToast('Pustaka kosong.');
          return;
        }
        const rows = ['"id","title","added_at"', ...favs.map(f => `"${f.manga_id}","${(f.title || '').replace(/"/g, '""')}","${f.added_at || ''}"`)];
        const link = document.createElement('a');
        link.href = encodeURI('data:text/csv;charset=utf-8,' + rows.join('\n'));
        link.download = 'shinitrack_library.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        utils.showToast('Pustaka berhasil diekspor (CSV)');
      } catch (err) {
        utils.showToast(`Gagal ekspor: ${err}`);
      }
    }
  }
];

function createStorageUsageCard() {
  const card = document.createElement('div');
  card.className = 'card settings-storage-card';
  card.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;padding:16px;margin-bottom:8px;width:100%;';

  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:var(--font-sm);width:100%;';

  const titleSpan = document.createElement('span');
  titleSpan.textContent = 'Penyimpanan aplikasi';
  titleSpan.style.color = 'var(--text-secondary)';

  const valSpan = document.createElement('span');
  valSpan.id = 'storage-stat-text';
  valSpan.textContent = 'Menghitung...';
  valSpan.style.cssText = 'color:var(--text-primary);font-weight:500;margin-left:auto;';

  labelRow.appendChild(titleSpan);
  labelRow.appendChild(valSpan);
  card.appendChild(labelRow);

  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  bar.style.cssText = 'width:100%;height:6px;background:var(--surface-elevated);border-radius:var(--radius-full);overflow:hidden;';
  const fill = document.createElement('div');
  fill.id = 'storage-progress-fill';
  fill.className = 'progress-fill';
  fill.style.width = '0%';
  bar.appendChild(fill);
  card.appendChild(bar);

  return card;
}

export function renderPenyimpanan() {
  ensureSafListener();
  utils.setHeaderTitles('Data dan penyimpanan', 'Pencadangan, ruang penyimpanan');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'settings-container';
  activeContainer = container;

  renderSettings(container, penyimpananSchema);

  // Synchronize an input[type="checkbox"] into the token switch row
  container.querySelectorAll('.settings-switch-row').forEach(row => {
    const title = row.querySelector('.t');
    if (title && title.textContent.includes('Sertakan token server')) {
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = 'backup-include-token-check';
      chk.style.cssText = 'position:absolute;opacity:0;pointer-events:none;';
      chk.checked = getPref('storage.backup_include_token', '0') === '1';
      row.appendChild(chk);
      row.addEventListener('click', () => {
        chk.checked = getPref('storage.backup_include_token', '0') === '1';
      });
    }
  });

  // Insert storage usage progress card directly under 'Penggunaan Penyimpanan' header
  const headers = container.querySelectorAll('.settings-header');
  headers.forEach(h => {
    if (h.textContent.includes('Penggunaan Penyimpanan')) {
      h.after(createStorageUsageCard());
    }
  });

  viewEl.appendChild(container);

  refreshStorageInfo();
}

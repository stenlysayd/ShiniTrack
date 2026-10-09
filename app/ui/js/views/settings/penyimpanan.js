import { renderSettings } from './render.js';
import * as api from '../../api.js';
import * as utils from '../../utils.js';
import { getPref } from '../../state.js';
import { createBottomSheet } from '../../components/bottom-sheet.js';

let activeContainer = null;
let focusListenerAttached = false;

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fileNameFromPath(filePath) {
  const clean = String(filePath || '').replace(/\\/g, '/');
  return clean.split('/').filter(Boolean).pop() || 'shinitrack_backup.json';
}

function updateButtonSubtitle(title, subtitle) {
  if (!activeContainer) return;
  activeContainer.querySelectorAll('.settings-button-row').forEach(btn => {
    const titleEl = btn.querySelector('.t');
    const subEl = btn.querySelector('.s');
    if (titleEl && subEl && titleEl.textContent === title) {
      subEl.textContent = subtitle;
    }
  });
}

async function refreshSafState() {
  if (!activeContainer) return;
  try {
    const raw = await api.saf_state();
    const state = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    updateButtonSubtitle(
      'Folder cadangan otomatis',
      state.backup_tree
        ? `Folder: ${state.backup_tree}`
        : 'Belum dipilih; cadangan otomatis tetap tersimpan di aplikasi'
    );
    updateButtonSubtitle(
      'Folder ekspor unduhan',
      state.export_tree
        ? `Folder: ${state.export_tree}`
        : 'Belum dipilih'
    );
  } catch (err) {
    console.warn('Failed to refresh SAF state:', err);
  }
}

function showBackupActions(result) {
  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = '10px';

  const title = document.createElement('div');
  title.className = 't';
  title.textContent = 'Cadangan dibuat';
  content.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 's';
  subtitle.textContent = `${result.favorites_count} komik, ${result.categories_count} kategori`;
  content.appendChild(subtitle);

  let closeSheet = () => {};
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.type = 'button';
  saveBtn.textContent = 'Simpan ke…';
  saveBtn.addEventListener('click', async () => {
    try {
      const ok = await api.saf_create_document({
        sourcePath: result.file_path,
        defaultName: fileNameFromPath(result.file_path)
      });
      if (!ok) utils.showToast('Simpan ke berkas tersedia di Android.');
      closeSheet();
    } catch (err) {
      utils.showToast(`Gagal menyimpan: ${err}`);
    }
  });
  content.appendChild(saveBtn);

  const shareBtn = document.createElement('button');
  shareBtn.className = 'btn';
  shareBtn.type = 'button';
  shareBtn.textContent = 'Bagikan';
  shareBtn.addEventListener('click', async () => {
    try {
      const ok = await api.saf_share_document({ sourcePath: result.file_path });
      if (!ok) utils.showToast('Bagikan berkas tersedia di Android.');
      closeSheet();
    } catch (err) {
      utils.showToast(`Gagal membagikan: ${err}`);
    }
  });
  content.appendChild(shareBtn);

  closeSheet = createBottomSheet({ content });
}

async function refreshStorageInfo() {
  if (!activeContainer) return;
  try {
    const info = await api.storage_info();
    if (!info) return;

    // Update location text
    const infoEls = activeContainer.querySelectorAll('.settings-info-text');
    if (infoEls[0]) {
      const sep = String(info.data_dir || '').endsWith('/') ? '' : '/';
      const downloadsPath = `${info.data_dir || ''}${sep}downloads`;
      infoEls[0].innerHTML = `<b>Data Aplikasi:</b> ${escapeHtml(info.data_dir)}<br/><b>Unduhan internal:</b> ${escapeHtml(downloadsPath)} (${formatBytes(info.downloads_bytes)})<br/><span style="color:var(--text-faint); font-size:11.5px; display:inline-block; margin-top:4px;">Unduhan disimpan di dalam aplikasi; gunakan 'Salin unduhan ke folder ini' untuk mengambil berkasnya.<br/>&bull; Folder Cadangan: backups/</span>`;
    }

    // Update last backup text
    if (infoEls[1]) {
      infoEls[1].textContent = info.last_backup
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
        subEl.textContent = `Kosongkan database bab & memori sementara (${formatBytes(info.cache_bytes)})`;
      } else if (titleEl.textContent === 'Hapus cache sampul') {
        subEl.textContent = `Kosongkan cache gambar sampul manga (Database: ${formatBytes(info.database_bytes)})`;
      }
    });
  } catch (err) {
    console.warn('Failed to refresh storage info:', err);
  }
  refreshSafState();
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
        const res = await api.backup_create({ includeToken });
        utils.showToast(`Cadangan dibuat (${res.favorites_count} komik, ${res.categories_count} kategori)`);
        showBackupActions(res);
        refreshStorageInfo();
      } catch (err) {
        utils.showToast(`Gagal membuat cadangan: ${err}`);
      }
    }
  },
  {
    type: 'button',
    title: 'Pulihkan cadangan',
    subtitle: 'Pulihkan pustaka dan preferensi dari berkas cadangan JSON',
    icon: window.Icons && window.Icons.sync ? window.Icons.sync() : '',
    onClick: () => {
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
            const res = await api.backup_restore({ json });
            utils.showToast(res.message || 'Cadangan berhasil dipulihkan!');
            refreshStorageInfo();
          } catch (err) {
            utils.showToast(`Gagal memulihkan: ${err}`);
          }
        };
        reader.onerror = () => utils.showToast('Gagal membaca berkas cadangan');
        reader.readAsText(file);
      };
      document.body.appendChild(fileInput);
      fileInput.click();
      setTimeout(() => fileInput.remove(), 1000);
    }
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
    type: 'button',
    title: 'Folder cadangan otomatis',
    subtitle: 'Belum dipilih; cadangan otomatis tetap tersimpan di aplikasi',
    icon: window.Icons && window.Icons.folder ? window.Icons.folder() : '',
    onClick: async () => {
      try {
        const ok = await api.saf_open_tree({ kind: 'backup' });
        if (!ok) utils.showToast('Pemilih folder tersedia di Android.');
      } catch (err) {
        utils.showToast(`Gagal memilih folder: ${err}`);
      }
    }
  },
  {
    type: 'button',
    title: 'Folder ekspor unduhan',
    subtitle: 'Belum dipilih',
    icon: window.Icons && window.Icons.folder ? window.Icons.folder() : '',
    onClick: async () => {
      try {
        const ok = await api.saf_open_tree({ kind: 'export' });
        if (!ok) utils.showToast('Pemilih folder tersedia di Android.');
      } catch (err) {
        utils.showToast(`Gagal memilih folder: ${err}`);
      }
    }
  },
  {
    type: 'button',
    title: 'Salin unduhan ke folder ini',
    subtitle: 'Salin isi downloads/<Judul>/Chapter N ke folder ekspor unduhan',
    icon: window.Icons && window.Icons.download ? window.Icons.download() : '',
    onClick: async () => {
      try {
        const ok = await api.saf_export_downloads();
        if (!ok) utils.showToast('Pilih folder ekspor unduhan di Android.');
      } catch (err) {
        utils.showToast(`Gagal menyalin unduhan: ${err}`);
      }
    }
  },
  {
    type: 'info',
    text: 'Terakhir dicadangkan: Memuat...'
  },
  {
    type: 'header',
    title: 'Penggunaan Penyimpanan'
  },
  {
    type: 'button',
    title: 'Hapus cache bab',
    subtitle: 'Kosongkan database bab & memori sementara',
    icon: window.Icons && window.Icons.trash ? window.Icons.trash() : '',
    onClick: async () => {
      utils.showToast('Membersihkan cache bab...');
      try {
        const freed = await api.clear_cache({ target: 'chapters' });
        const freedMsg = freed > 0 ? ` (${formatBytes(freed)})` : '';
        utils.showToast(`Cache bab berhasil dibersihkan${freedMsg}`);
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

  if (!focusListenerAttached) {
    window.addEventListener('focus', () => {
      refreshStorageInfo();
    });
    focusListenerAttached = true;
  }

  refreshStorageInfo();
}

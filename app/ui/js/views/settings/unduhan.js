import { renderSettings } from './render.js';
import { state } from '../../state.js';
import * as api from '../../api.js';
import * as utils from '../../utils.js';

export const unduhanSchema = [
  {
    type: 'header',
    title: 'Koneksi & Penyimpanan'
  },
  {
    type: 'switch',
    key: 'dl.wifi_only',
    title: 'Hanya unduh lewat Wi-Fi',
    subtitle: 'Batasi pengunduhan bab hanya ketika terhubung ke jaringan Wi-Fi',
    default: '0'
  },
  {
    type: 'switch',
    key: 'dl.delete_after_read',
    title: 'Hapus bab setelah dibaca',
    subtitle: 'Secara otomatis menghapus bab yang telah selesai dibaca dari perangkat',
    default: '0'
  },
  {
    type: 'switch',
    key: 'dl.low_quality',
    title: 'Kualitas rendah',
    subtitle: 'Gunakan gambar resolusi rendah untuk menghemat kuota dan ruang penyimpanan',
    default: '0',
    onChange: async (val) => {
      try {
        const s = await api.settings_get();
        s.low_quality = val === '1';
        await api.settings_set({ settings: s });
      } catch (e) {
        console.warn('Failed to update low_quality setting:', e);
      }
    }
  },
  {
    type: 'header',
    title: 'Pengunduhan Otomatis & Kecepatan'
  },
  {
    type: 'switch',
    key: 'dl.auto_download_new',
    title: 'Unduh otomatis bab baru',
    subtitle: 'Otomatis unduh bab baru untuk manga favorit dengan notifikasi aktif',
    default: '0'
  },
  {
    type: 'select',
    key: 'dl.parallel',
    title: 'Unduhan paralel',
    options: [
      { value: '2', label: '2 unduhan' },
      { value: '4', label: '4 unduhan' },
      { value: '6', label: '6 unduhan' }
    ],
    default: '4'
  }
];

export async function renderUnduhan() {
  utils.setHeaderTitles('Unduhan', 'Unduh otomatis, hapus setelah dibaca');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  // Synchronize existing low_quality setting from backend into state.prefs
  try {
    const currentSettings = await api.settings_get();
    if (currentSettings && typeof currentSettings.low_quality === 'boolean') {
      const valStr = currentSettings.low_quality ? '1' : '0';
      state.prefs.set('dl.low_quality', valStr);
    }
  } catch (e) {
    console.warn('Failed to load current low_quality setting:', e);
  }

  const container = document.createElement('div');
  container.className = 'settings-container';

  renderSettings(container, unduhanSchema);
  viewEl.appendChild(container);
}

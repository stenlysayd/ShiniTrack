import { renderSettings } from './render.js';
import { state } from '../../state.js';
import * as api from '../../api.js';
import * as utils from '../../utils.js';

let activeContainer = null;

function updatePushStatus(res) {
  if (!activeContainer) return;
  const infoTextEl = activeContainer.querySelector('.settings-info-text');
  if (!infoTextEl) return;

  if (!res) {
    const sUrl = state.prefs.get('sync.server_url');
    if (!sUrl) {
      infoTextEl.textContent = 'Status UnifiedPush: Server belum dikonfigurasi. Masukkan URL server dan ketuk "Uji koneksi" untuk mendaftarkan push.';
    } else {
      infoTextEl.textContent = 'Status UnifiedPush: Server telah dikonfigurasi. Ketuk "Uji koneksi" untuk memeriksa status push.';
    }
    return;
  }

  if (res.server_ok === true) {
    if (res.message && res.message.includes('push endpoint synced')) {
      infoTextEl.textContent = 'Status UnifiedPush: Terdaftar dan tersinkronisasi dengan server.';
    } else {
      infoTextEl.textContent = 'Status UnifiedPush: Server terhubung, namun endpoint UnifiedPush belum terdaftar di perangkat (apakah aplikasi distributor seperti ntfy terpasang?).';
    }
  } else if (res.server_ok === false) {
    infoTextEl.textContent = `Status UnifiedPush: Server tidak dapat dijangkau (${res.message}).`;
  } else {
    infoTextEl.textContent = 'Status UnifiedPush: Server belum dikonfigurasi.';
  }
}

async function saveSyncSettings(field, value) {
  try {
    const s = await api.settings_get();
    if (field === 'server_url') {
      s.server_url = value ? value.trim() : null;
    } else if (field === 'server_token') {
      s.server_token = value ? value.trim() : null;
    }
    const res = await api.settings_set({ settings: s });
    if (res) updatePushStatus(res);
  } catch (err) {
    console.warn(`Failed to update ${field}:`, err);
  }
}

export const sinkronisasiSchema = [
  {
    type: 'header',
    title: 'Server Poller'
  },
  {
    type: 'text',
    key: 'sync.server_url',
    title: 'URL Server',
    subtitle: 'Endpoint server poller mandiri (opsional)',
    placeholder: 'http://192.168.1.15:8787',
    password: false,
    onChange: (val) => saveSyncSettings('server_url', val)
  },
  {
    type: 'text',
    key: 'sync.server_token',
    title: 'Token Rahasia Server',
    subtitle: 'Bearer token untuk otentikasi sinkronisasi',
    placeholder: 'Token rahasia server',
    password: true,
    onChange: (val) => saveSyncSettings('server_token', val)
  },
  {
    type: 'button',
    title: 'Uji koneksi',
    subtitle: 'Periksa status server dan uji pendaftaran push',
    icon: window.Icons && window.Icons.sync ? window.Icons.sync() : '',
    onClick: async () => {
      const urlInput = activeContainer ? activeContainer.querySelector('input[type="text"]') : null;
      const tokenInput = activeContainer ? activeContainer.querySelector('input[type="password"]') : null;
      const sUrl = urlInput ? urlInput.value.trim() : (state.prefs.get('sync.server_url') || '').trim();
      const sToken = tokenInput ? tokenInput.value.trim() : (state.prefs.get('sync.server_token') || '').trim();

      utils.showToast('Menguji koneksi server...');
      try {
        const s = await api.settings_get();
        s.server_url = sUrl || null;
        s.server_token = sToken || null;
        const res = await api.test_connection(s);

        if (res.server_ok === true) {
          utils.showToast(res.message || 'Koneksi server berhasil!');
        } else if (res.server_ok === false) {
          utils.showToast(`Gagal: ${res.message}`);
        } else {
          utils.showToast(res.message || 'Server belum dikonfigurasi.');
        }
        updatePushStatus(res);
      } catch (err) {
        utils.showToast(`Kesalahan: ${err}`);
      }
    }
  },
  {
    type: 'header',
    title: 'Pemberitahuan & Push'
  },
  {
    type: 'info',
    text: 'Status UnifiedPush: Memeriksa...'
  },
  {
    type: 'switch',
    key: 'sync.direct_check',
    title: 'Pemeriksaan langsung (tanpa server)',
    subtitle: 'Cek pembaruan bab langsung ke Shinigami tanpa melalui server poller',
    default: '1'
  }
];

export async function renderSinkronisasi() {
  utils.setHeaderTitles('Sinkronisasi', 'Server, notifikasi push');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  // Override getter by loading current server settings into state.prefs
  try {
    const s = await api.settings_get();
    state.prefs.set('sync.server_url', s.server_url || '');
    state.prefs.set('sync.server_token', s.server_token || '');
  } catch (e) {
    console.warn('Failed to load server settings:', e);
  }

  const container = document.createElement('div');
  container.className = 'settings-container';
  activeContainer = container;

  renderSettings(container, sinkronisasiSchema);
  viewEl.appendChild(container);

  updatePushStatus(null);
}

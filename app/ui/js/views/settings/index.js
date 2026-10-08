import { navigate } from '../../router.js';
import * as utils from '../../utils.js';
import * as api from '../../api.js';
import { createListRow } from '../../components/list-row.js';
import { renderSettings as renderSettingsRenderer } from './render.js';

export const SETTINGS_CATEGORIES = [
  { id: 'tampilan', title: 'Tampilan', subtitle: 'Tema, format tanggal & waktu', icon: () => window.Icons.star ? window.Icons.star() : window.Icons.settings() },
  { id: 'pustaka', title: 'Pustaka', subtitle: 'Kategori, pembaruan global', icon: () => window.Icons.book ? window.Icons.book() : window.Icons.favorites() },
  { id: 'pembaca', title: 'Pembaca', subtitle: 'Mode membaca, tampilan, navigasi', icon: () => window.Icons.scroll ? window.Icons.scroll() : window.Icons.book() },
  { id: 'unduhan', title: 'Unduhan', subtitle: 'Unduh otomatis, hapus setelah dibaca', icon: () => window.Icons.download() },
  { id: 'sinkronisasi', title: 'Sinkronisasi', subtitle: 'Server, notifikasi push', icon: () => window.Icons.sync() },
  { id: 'jelajahi', title: 'Jelajahi', subtitle: 'Sumber, kualitas gambar', icon: () => window.Icons.search() },
  { id: 'penyimpanan', title: 'Data dan penyimpanan', subtitle: 'Pencadangan, ruang penyimpanan', icon: () => window.Icons.database ? window.Icons.database() : window.Icons.settings() },
  { id: 'keamanan', title: 'Keamanan dan privasi', subtitle: 'Kunci aplikasi, amankan layar', icon: () => window.Icons.incognito ? window.Icons.incognito() : window.Icons.bellOff() },
  { id: 'lanjutan', title: 'Lanjutan', subtitle: 'Log kerusakan, pengoptimalan baterai', icon: () => window.Icons.alertTriangle ? window.Icons.alertTriangle() : window.Icons.settings() },
  { id: 'tentang', title: 'Tentang', subtitle: 'ShiniTrack', icon: () => window.Icons.info ? window.Icons.info() : window.Icons.book() }
];

/**
 * Renders the main settings screen listing 10 categories (Section 0)
 */
export async function renderSettings() {
  utils.setHeaderTitles('Pengaturan', 'Preferensi & Pembaruan');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  let appVersion = 'v1.0.1';
  try {
    const appInfo = await api.get_app_info();
    if (appInfo && appInfo.version) {
      appVersion = appInfo.version.startsWith('v') ? appInfo.version : `v${appInfo.version}`;
    }
  } catch (e) {
    // fallback
  }

  const container = document.createElement('div');
  container.className = 'settings-container';

  SETTINGS_CATEGORIES.forEach(cat => {
    const subtitle = cat.id === 'tentang' ? `ShiniTrack ${appVersion}` : cat.subtitle;
    const row = createListRow({
      icon: cat.icon ? cat.icon() : null,
      title: cat.title,
      subtitle: subtitle,
      actionIcon: window.Icons && window.Icons.chevronRight ? window.Icons.chevronRight() : null,
      onClick: () => navigate('#/more/settings/' + cat.id)
    });
    container.appendChild(row);
  });

  viewEl.appendChild(container);
}

/**
 * Placeholder subpage renderer for settings categories until individual schemas are built
 * Uses declarative renderSettings to bind a dummy switch to preferences
 */
export async function renderSettingsSubpage(subId) {
  const cat = SETTINGS_CATEGORIES.find(c => c.id === subId);
  const title = cat ? cat.title : 'Pengaturan';
  const subtitle = cat ? cat.subtitle : '';
  utils.setHeaderTitles(title, subtitle);

  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'settings-container';

  const schema = [
    { type: 'header', title: 'Preferensi ' + title },
    {
      type: 'switch',
      key: `test.${subId}_dummy_switch`,
      title: 'Uji Coba Pengaturan',
      subtitle: `Sakelar uji untuk verifikasi preferensi ${title}`,
      default: '0'
    },
    {
      type: 'select',
      key: `test.${subId}_dummy_select`,
      title: 'Pilihan Pengujian',
      options: [
        { value: 'opt1', label: 'Opsi Standar' },
        { value: 'opt2', label: 'Opsi Alternatif' }
      ],
      default: 'opt1'
    },
    {
      type: 'info',
      text: `Pengaturan modul ${title} akan diimplementasikan secara penuh pada modul berikutnya.`
    }
  ];

  renderSettingsRenderer(container, schema);
  viewEl.appendChild(container);
}

import { renderSettings } from './render.js';
import { navigate } from '../../router.js';
import * as api from '../../api.js';
import * as utils from '../../utils.js';

export async function renderPustaka() {
  utils.setHeaderTitles('Pustaka', 'Kategori, pembaruan global');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'settings-container';

  // Load categories for lib.default_category options
  const catOptions = [{ value: 'ask', label: 'Selalu tanya' }];
  try {
    const categories = await api.category_list();
    if (Array.isArray(categories)) {
      categories.forEach(cat => {
        catOptions.push({ value: String(cat.id), label: cat.name });
      });
    }
  } catch (e) {
    console.warn('Failed to load categories for default category setting:', e);
  }

  const pustakaSchema = [
    {
      type: 'header',
      title: 'Kategori Pustaka'
    },
    {
      type: 'button',
      title: 'Ubah kategori',
      subtitle: 'Atur dan susun kategori untuk koleksi manga Anda',
      icon: window.Icons && window.Icons.tag ? window.Icons.tag() : (window.Icons ? window.Icons.grid() : ''),
      onClick: () => navigate('#/more/categories')
    },
    {
      type: 'select',
      key: 'lib.default_category',
      title: 'Kategori bawaan',
      options: catOptions,
      default: 'ask'
    },
    {
      type: 'header',
      title: 'Pembaruan Global'
    },
    {
      type: 'select',
      key: 'lib.update_interval',
      title: 'Frekuensi pembaruan',
      options: [
        { value: 'manual', label: 'Manual' },
        { value: '1h', label: '1 jam' },
        { value: '3h', label: '3 jam' },
        { value: '6h', label: '6 jam' },
        { value: '12h', label: '12 jam' },
        { value: '24h', label: 'Harian' }
      ],
      default: '6h',
      onChange: async (val) => {
        try {
          await api.update_worker_interval({ interval: String(val) });
        } catch (e) {
          console.warn('Failed to update worker interval:', e);
        }
      }
    },
    {
      type: 'switch',
      key: 'lib.update_only_notify',
      title: 'Hanya perbarui entri dengan notifikasi aktif',
      subtitle: 'Batasi pengecekan bab baru hanya untuk judul yang mengaktifkan lonceng',
      default: '0'
    },
    {
      type: 'switch',
      key: 'lib.update_wifi_only',
      title: 'Hanya saat Wi-Fi',
      subtitle: 'Batasi pembaruan otomatis di latar belakang saat menggunakan jaringan Wi-Fi',
      default: '0'
    },
    {
      type: 'header',
      title: 'Bab & Riwayat'
    },
    {
      type: 'switch',
      key: 'lib.mark_dup_read',
      title: 'Tandai bab duplikat sebagai dibaca',
      subtitle: 'Secara otomatis menandai nomor bab yang sama sebagai sudah dibaca',
      default: '0'
    },
    {
      type: 'header',
      title: 'Lencana & Jumlah Item'
    },
    {
      type: 'switch',
      key: 'lib.badge_unread',
      title: 'Lencana belum dibaca',
      subtitle: 'Tampilkan jumlah bab yang belum dibaca pada sampul komik',
      default: '1'
    },
    {
      type: 'switch',
      key: 'lib.badge_download',
      title: 'Lencana unduhan',
      subtitle: 'Tampilkan indikator status unduhan pada kartu pustaka',
      default: '1'
    },
    {
      type: 'switch',
      key: 'lib.badge_notify',
      title: 'Lencana notifikasi',
      subtitle: 'Tampilkan indikator lonceng pada judul yang berlangganan notifikasi',
      default: '1'
    },
    {
      type: 'switch',
      key: 'lib.show_count',
      title: 'Jumlah item di tab kategori',
      subtitle: 'Tampilkan angka total komik di sebelah label tab kategori pustaka',
      default: '1'
    }
  ];

  renderSettings(container, pustakaSchema);
  viewEl.appendChild(container);
}

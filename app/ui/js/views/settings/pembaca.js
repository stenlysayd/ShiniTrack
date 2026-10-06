import { renderSettings } from './render.js';
import * as api from '../../api.js';
import * as utils from '../../utils.js';
import { state, normalizeReaderMode } from '../../state.js';

export const pembacaSchema = [
  {
    type: 'header',
    title: 'Mode & Tampilan'
  },
  {
    type: 'select',
    key: 'reader.mode',
    title: 'Mode membaca bawaan',
    options: [
      { value: 'webtoon', label: 'Webtoon' },
      { value: 'paged_lr', label: 'Paged L-R' },
      { value: 'manga_rl', label: 'Manga R-L' }
    ],
    default: 'webtoon',
    onChange: (val) => {
      state.readerMode = normalizeReaderMode(val);
      localStorage.setItem('shinitrack_reader_mode', state.readerMode);
    }
  },
  {
    type: 'select',
    key: 'reader.bg',
    title: 'Warna latar belakang',
    options: [
      { value: 'black', label: 'Hitam' },
      { value: 'gray', label: 'Abu-abu' },
      { value: 'white', label: 'Putih' }
    ],
    default: 'black'
  },
  {
    type: 'switch',
    key: 'reader.fullscreen',
    title: 'Layar penuh',
    subtitle: 'Sembunyikan bilah status sistem saat membaca',
    default: '1'
  },
  {
    type: 'switch',
    key: 'reader.page_number',
    title: 'Tampilkan nomor halaman',
    subtitle: 'Tampilkan overlay nomor halaman saat membaca',
    default: '1'
  },
  {
    type: 'switch',
    key: 'reader.keep_awake',
    title: 'Biarkan layar menyala',
    subtitle: 'Cegah layar mati otomatis saat membaca bab',
    default: '1',
    onChange: async (val) => {
      try {
        await api.set_keep_awake({ keep: val === '1' });
      } catch (e) {
        console.warn('Failed to set keep awake:', e);
      }
    }
  },
  {
    type: 'header',
    title: 'Navigasi'
  },
  {
    type: 'select',
    key: 'reader.tap_zone',
    title: 'Zona ketuk navigasi',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'kindle', label: 'Kindle' },
      { value: 'l', label: 'L' },
      { value: 'edge', label: 'Tepi' },
      { value: 'disabled', label: 'Nonaktif' }
    ],
    default: 'default'
  },
  {
    type: 'switch',
    key: 'reader.tap_invert',
    title: 'Balik zona ketuk',
    subtitle: 'Balik fungsi area ketukan maju dan mundur',
    default: '0'
  },
  {
    type: 'header',
    title: 'Membaca & Bab'
  },
  {
    type: 'select',
    key: 'reader.preload',
    title: 'Prapemuat halaman',
    options: [
      { value: '2', label: '2 halaman' },
      { value: '4', label: '4 halaman' },
      { value: '6', label: '6 halaman' }
    ],
    default: '4'
  },
  {
    type: 'switch',
    key: 'reader.auto_next',
    title: 'Otomatis lanjut bab berikutnya',
    subtitle: 'Pindah ke bab selanjutnya secara otomatis ketika bab selesai',
    default: '1'
  },
  {
    type: 'switch',
    key: 'reader.mark_read_at_end',
    title: 'Tandai dibaca di halaman terakhir',
    subtitle: 'Tandai bab sebagai sudah dibaca ketika mencapai akhir',
    default: '1'
  }
];

export function renderPembaca() {
  utils.setHeaderTitles('Pembaca', 'Mode membaca, tampilan, navigasi');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'settings-container';

  renderSettings(container, pembacaSchema);
  viewEl.appendChild(container);
}

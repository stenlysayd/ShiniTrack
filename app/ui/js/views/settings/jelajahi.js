import { renderSettings } from './render.js';
import * as utils from '../../utils.js';

export const jelajahiSchema = [
  {
    type: 'header',
    title: 'Filter & Konten'
  },
  {
    type: 'select',
    key: 'explore.lang',
    title: 'Bahasa / negara asal',
    options: [
      { value: 'all', label: 'Semua Negara' },
      { value: 'kr', label: 'Korea (Manhwa)' },
      { value: 'cn', label: 'China (Manhua)' },
      { value: 'jp', label: 'Jepang (Manga)' }
    ],
    default: 'all'
  },
  {
    type: 'switch',
    key: 'explore.hide_library',
    title: 'Sembunyikan entri di pustaka',
    subtitle: 'Jangan tampilkan judul yang sudah ditambahkan ke dalam pustaka',
    default: '0'
  },
  {
    type: 'switch',
    key: 'explore.low_quality',
    title: 'Kualitas rendah di jelajahi',
    subtitle: 'Gunakan gambar resolusi terkompresi di katalog jelajahi untuk menghemat kuota',
    default: '0'
  },
  {
    type: 'header',
    title: 'Urutan Katalog'
  },
  {
    type: 'select',
    key: 'explore.default_sort',
    title: 'Urutan default',
    options: [
      { value: 'latest', label: 'Terbaru' },
      { value: 'popular', label: 'Populer' },
      { value: 'alphabetical', label: 'A - Z' }
    ],
    default: 'latest'
  }
];

export function renderJelajahi() {
  utils.setHeaderTitles('Jelajahi', 'Sumber, kualitas gambar');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'settings-container';

  renderSettings(container, jelajahiSchema);
  viewEl.appendChild(container);
}

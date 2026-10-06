import { renderSettings } from './render.js';
import { applyThemeSettings } from '../../main.js';
import * as utils from '../../utils.js';

export const tampilanSchema = [
  {
    type: 'header',
    title: 'Tema & Tampilan'
  },
  {
    type: 'select',
    key: 'ui.theme_mode',
    title: 'Tema aplikasi',
    options: [
      { value: 'dark', label: 'Gelap' },
      { value: 'light', label: 'Terang' },
      { value: 'system', label: 'Sistem' }
    ],
    default: 'dark',
    onChange: () => applyThemeSettings()
  },
  {
    type: 'switch',
    key: 'ui.amoled',
    title: 'Mode gelap AMOLED',
    subtitle: 'Warna latar belakang hitam murni untuk menghemat daya layar OLED',
    default: '0',
    onChange: () => applyThemeSettings()
  },
  {
    type: 'select',
    key: 'ui.accent',
    title: 'Warna aksen',
    options: [
      { value: 'crimson', label: 'Crimson' },
      { value: 'blue', label: 'Biru' },
      { value: 'green', label: 'Hijau' },
      { value: 'purple', label: 'Ungu' }
    ],
    default: 'crimson',
    onChange: () => applyThemeSettings()
  },
  {
    type: 'header',
    title: 'Format Tanggal & Waktu'
  },
  {
    type: 'switch',
    key: 'ui.relative_time',
    title: 'Waktu relatif',
    subtitle: 'Tampilkan waktu relatif (contoh: "2 jam yang lalu")',
    default: '1'
  },
  {
    type: 'select',
    key: 'ui.date_format',
    title: 'Format tanggal',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'dd/MM/yyyy', label: 'dd/MM/yyyy' },
      { value: 'MM/dd/yyyy', label: 'MM/dd/yyyy' },
      { value: 'yyyy-MM-dd', label: 'yyyy-MM-dd' }
    ],
    default: 'default'
  },
  {
    type: 'header',
    title: 'Antarmuka & Gerakan'
  },
  {
    type: 'switch',
    key: 'ui.animations',
    title: 'Animasi',
    subtitle: 'Aktifkan animasi antarmuka',
    default: '1',
    onChange: () => applyThemeSettings()
  }
];

export function renderTampilan() {
  utils.setHeaderTitles('Tampilan', 'Tema, format tanggal & waktu');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'settings-container';

  renderSettings(container, tampilanSchema);
  viewEl.appendChild(container);
}

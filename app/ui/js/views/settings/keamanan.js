import { renderSettings } from './render.js';
import * as utils from '../../utils.js';
import * as api from '../../api.js';
import { getPref } from '../../state.js';

export const keamananSchema = [
  {
    type: 'header',
    title: 'Kunci Aplikasi'
  },
  {
    type: 'switch',
    key: 'sec.app_lock',
    title: 'Kunci aplikasi',
    subtitle: 'Kunci akses aplikasi dengan biometrik atau kredensial perangkat',
    default: '0'
  },
  {
    type: 'select',
    key: 'sec.lock_delay',
    title: 'Kunci setelah',
    options: [
      { value: '0', label: 'Segera' },
      { value: '1', label: '1 menit' },
      { value: '5', label: '5 menit' },
      { value: '10', label: '10 menit' }
    ],
    default: '0'
  },
  {
    type: 'header',
    title: 'Keamanan Layar'
  },
  {
    type: 'select',
    key: 'sec.secure_screen',
    title: 'Amankan layar',
    subtitle: 'Sembunyikan pratinjau aplikasi dan blokir tangkapan layar',
    options: [
      { value: 'off', label: 'Mati' },
      { value: 'always', label: 'Selalu' },
      { value: 'incognito', label: 'Saat penyamaran' }
    ],
    default: 'off',
    onChange: async (val) => {
      try {
        const incognito = getPref('privacy.incognito', '0') === '1';
        const secure = val === 'always' || (val === 'incognito' && incognito);
        await api.set_secure_screen({ secure });
      } catch (e) {
        console.warn('Gagal mengatur keamanan layar:', e);
      }
    }
  },
  {
    type: 'header',
    title: 'Privasi'
  },
  {
    type: 'switch',
    key: 'privacy.incognito',
    title: 'Mode penyamaran',
    subtitle: 'Jeda penyimpanan riwayat membaca dan progres pembacaan',
    default: '0',
    onChange: async (val) => {
      try {
        const secureSetting = getPref('sec.secure_screen', 'off');
        if (secureSetting === 'incognito') {
          await api.set_secure_screen({ secure: val === '1' });
        }
      } catch (e) {
        console.warn('Gagal memperbarui keamanan layar:', e);
      }
    }
  }
];

export function renderKeamanan() {
  utils.setHeaderTitles('Keamanan dan privasi', 'Kunci aplikasi, amankan layar');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'settings-container';

  renderSettings(container, keamananSchema);
  viewEl.appendChild(container);
}

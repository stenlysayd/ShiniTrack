import { renderSettings } from './render.js';
import { state, getPref } from '../../state.js';
import * as api from '../../api.js';
import * as utils from '../../utils.js';
import { checkForUpdates } from '../../main.js';

let activeContainer = null;

function showInfoModal(title, htmlContent) {
  const overlay = document.createElement('div');
  overlay.className = 'cat-dialog-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '1000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '16px';

  const dialog = document.createElement('div');
  dialog.className = 'card';
  dialog.style.background = 'var(--surface)';
  dialog.style.borderRadius = 'var(--radius-md)';
  dialog.style.width = '100%';
  dialog.style.maxWidth = '360px';
  dialog.style.maxHeight = '80vh';
  dialog.style.display = 'flex';
  dialog.style.flexDirection = 'column';
  dialog.style.padding = '20px';
  dialog.style.border = '1px solid var(--border)';
  dialog.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';

  const h = document.createElement('h3');
  h.textContent = title;
  h.style.margin = '0 0 12px';
  h.style.fontSize = '18px';
  dialog.appendChild(h);

  const body = document.createElement('div');
  body.style.overflowY = 'auto';
  body.style.fontSize = '13px';
  body.style.lineHeight = '1.6';
  body.style.color = 'var(--text-secondary)';
  body.style.marginBottom = '16px';
  body.innerHTML = htmlContent;
  dialog.appendChild(body);

  const btnClose = document.createElement('button');
  btnClose.className = 'btn primary block';
  btnClose.textContent = 'Tutup';
  btnClose.onclick = () => overlay.remove();
  dialog.appendChild(btnClose);

  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

async function saveAboutSettings(field, value) {
  try {
    const s = await api.settings_get();
    if (field === 'github_repo') {
      s.github_repo = value ? value.trim() : 'stenlysayd/ShiniTrack';
    } else if (field === 'auto_check_update') {
      s.auto_check_update = value === '1' || value === true;
    }
    await api.settings_set({ settings: s });
  } catch (err) {
    console.warn(`Failed to update ${field}:`, err);
  }
}

export const tentangSchema = [
  {
    type: 'header',
    title: 'Pembaruan'
  },
  {
    type: 'button',
    title: 'Periksa pembaruan',
    subtitle: 'Cari versi rilis terbaru dari repositori GitHub',
    onClick: async () => {
      utils.showToast('Memeriksa pembaruan...');
      try {
        const repo = getPref('about.github_repo', 'stenlysayd/ShiniTrack');
        await checkForUpdates(false, repo);
      } catch (err) {
        utils.showToast(`Gagal memeriksa pembaruan: ${err}`);
      }
    }
  },
  {
    type: 'switch',
    key: 'about.auto_check_update',
    title: 'Periksa pembaruan otomatis',
    subtitle: 'Periksa versi baru saat aplikasi dibuka di latar belakang',
    default: '1',
    onChange: (val) => saveAboutSettings('auto_check_update', val)
  },
  {
    type: 'text',
    key: 'about.github_repo',
    title: 'Repo GitHub',
    subtitle: 'Target repositori rilis resmi (owner/repo)',
    placeholder: 'stenlysayd/ShiniTrack',
    default: 'stenlysayd/ShiniTrack',
    onChange: (val) => saveAboutSettings('github_repo', val)
  },
  {
    type: 'button',
    title: 'Apa yang baru',
    subtitle: 'Lihat catatan rilis pembaruan di GitHub',
    onClick: () => {
      const repo = getPref('about.github_repo', 'stenlysayd/ShiniTrack');
      window.open(`https://github.com/${repo}/releases`, '_blank');
    }
  },
  {
    type: 'header',
    title: 'Informasi Hukum & Privasi'
  },
  {
    type: 'button',
    title: 'Lisensi terbuka',
    subtitle: 'Lisensi perangkat lunak sumber terbuka pihak ketiga',
    onClick: () => {
      const content = `
        <p style="margin-bottom:8px;">ShiniTrack dilisensikan di bawah lisensi terbuka MIT. Aplikasi ini memanfaatkan berbagai pustaka sumber terbuka:</p>
        <ul style="padding-left:18px; margin: 8px 0;">
          <li><strong>Tauri v2:</strong> Apache-2.0 / MIT</li>
          <li><strong>GSAP 3:</strong> GreenSock Standard License</li>
          <li><strong>rusqlite & SQLite:</strong> MIT / Public Domain</li>
          <li><strong>reqwest & tokio:</strong> MIT / Apache-2.0</li>
          <li><strong>chrono & serde:</strong> MIT / Apache-2.0</li>
        </ul>
        <p style="margin-top:10px; font-size:12px; color:var(--text-muted);">
          Terima kasih kepada seluruh komunitas open-source global atas kontribusinya.
        </p>
      `;
      showInfoModal('Lisensi Terbuka', content);
    }
  },
  {
    type: 'button',
    title: 'Kebijakan privasi',
    subtitle: 'Komitmen transparansi privasi dan keamanan data pengguna',
    onClick: () => {
      const content = `
        <p style="margin-bottom:8px;"><strong>Privasi dan transparansi adalah prinsip utama ShiniTrack:</strong></p>
        <ul style="padding-left:18px; margin: 8px 0;">
          <li><strong>Lokal & Offline-First:</strong> Data koleksi komik, riwayat bacaan, dan pengaturan tersimpan sepenuhnya di perangkat lokal Anda.</li>
          <li><strong>Bebas Pelacak:</strong> Aplikasi tidak menyematkan analitik pelacak, iklan komersial, maupun telemetri perilaku pengguna.</li>
          <li><strong>Jaringan Terbuka:</strong> Permintaan jaringan hanya berlangsung secara langsung ke API publik Shinigami serta repositori rilis GitHub.</li>
        </ul>
      `;
      showInfoModal('Kebijakan Privasi', content);
    }
  }
];

export async function renderTentang() {
  utils.setHeaderTitles('Tentang', 'Informasi Aplikasi & Pembaruan');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  let appInfo = { name: 'ShiniTrack', version: '1.0.1', build_code: 2004, platform: 'android' };
  try {
    const fetched = await api.get_app_info();
    if (fetched) appInfo = fetched;
  } catch (e) {
    console.warn('Failed to get app info:', e);
  }

  // Prepopulate state.prefs for repo and auto_check
  try {
    const s = await api.settings_get();
    state.prefs.set('about.github_repo', s.github_repo || 'stenlysayd/ShiniTrack');
    state.prefs.set('about.auto_check_update', s.auto_check_update !== false ? '1' : '0');
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }

  const container = document.createElement('div');
  container.className = 'settings-container';
  activeContainer = container;

  // App Header Branding Card
  const headerCard = document.createElement('div');
  headerCard.className = 'card';
  headerCard.style.padding = '24px 16px';
  headerCard.style.marginBottom = '12px';
  headerCard.style.display = 'flex';
  headerCard.style.flexDirection = 'column';
  headerCard.style.alignItems = 'center';
  headerCard.style.textAlign = 'center';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'svg-icon';
  iconWrap.style.color = 'var(--accent)';
  iconWrap.style.transform = 'scale(1.8)';
  iconWrap.style.marginBottom = '14px';
  iconWrap.innerHTML = window.Icons && window.Icons.book ? window.Icons.book() : '';
  headerCard.appendChild(iconWrap);

  const titleEl = document.createElement('div');
  titleEl.style.fontSize = '20px';
  titleEl.style.fontWeight = '700';
  titleEl.style.color = 'var(--text-primary)';
  titleEl.textContent = appInfo.name || 'ShiniTrack';
  headerCard.appendChild(titleEl);

  const verEl = document.createElement('div');
  verEl.style.fontSize = '13px';
  verEl.style.color = 'var(--text-muted)';
  verEl.style.marginTop = '4px';
  const verStr = appInfo.version && appInfo.version.startsWith('v') ? appInfo.version : `v${appInfo.version}`;
  verEl.textContent = `${verStr} • Build ${appInfo.build_code || 1} (${appInfo.platform || 'Android'})`;
  headerCard.appendChild(verEl);

  // Social / Community Links Row
  const socialRow = document.createElement('div');
  socialRow.style.display = 'flex';
  socialRow.style.gap = '10px';
  socialRow.style.marginTop = '16px';

  const btnWeb = document.createElement('button');
  btnWeb.className = 'btn';
  btnWeb.style.display = 'inline-flex';
  btnWeb.style.alignItems = 'center';
  btnWeb.style.gap = '6px';
  btnWeb.style.fontSize = '12px';
  btnWeb.style.padding = '6px 12px';
  btnWeb.innerHTML = `${window.Icons.globe ? window.Icons.globe() : ''} <span>Situs Web</span>`;
  btnWeb.onclick = () => window.open('https://github.com/stenlysayd/ShiniTrack', '_blank');
  socialRow.appendChild(btnWeb);

  const btnGh = document.createElement('button');
  btnGh.className = 'btn';
  btnGh.style.display = 'inline-flex';
  btnGh.style.alignItems = 'center';
  btnGh.style.gap = '6px';
  btnGh.style.fontSize = '12px';
  btnGh.style.padding = '6px 12px';
  btnGh.innerHTML = `${window.Icons.github ? window.Icons.github() : ''} <span>GitHub</span>`;
  btnGh.onclick = () => {
    const repo = getPref('about.github_repo', 'stenlysayd/ShiniTrack');
    window.open(`https://github.com/${repo}`, '_blank');
  };
  socialRow.appendChild(btnGh);

  headerCard.appendChild(socialRow);
  container.appendChild(headerCard);

  renderSettings(container, tentangSchema);
  viewEl.appendChild(container);
}

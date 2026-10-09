import { navigate } from '../router.js';
import { getPref, setPref } from '../state.js';
import * as utils from '../utils.js';
import * as api from '../api.js';
import { createSwitchRow } from '../components/switch-row.js';
import { createListRow } from '../components/list-row.js';

const { setHeaderTitles, escapeHtml } = utils;

// ================================================================= VIEW: MORE (LAINNYA)
export async function renderMore() {
  setHeaderTitles('Lainnya', 'Menu & Pengaturan');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;

  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'more-container';

  // 1. App logo header
  let appVersion = 'v1.0.1';
  try {
    const appInfo = await api.get_app_info();
    if (appInfo && appInfo.version) {
      appVersion = `v${appInfo.version}`;
    }
  } catch (e) {
    // fallback to default version
  }

  const header = document.createElement('div');
  header.className = 'more-header';
  header.innerHTML = `
    <img src="logo.png" alt="ShiniTrack Logo" class="more-logo" />
    <div class="more-brand">
      <div class="more-title">ShiniTrack</div>
      <div class="more-version">${escapeHtml(appVersion)}</div>
    </div>
  `;
  container.appendChild(header);

  // 2. Switch: "Hanya yang sudah diunduh" - subtitle "Saring semua entri di pustaka Anda"
  const downloadedOnly = getPref('app.downloaded_only', getPref('downloaded_only', '0')) === '1';
  const switchDownloaded = createSwitchRow({
    icon: window.Icons.cloudOff ? window.Icons.cloudOff() : window.Icons.download(),
    title: 'Hanya yang sudah diunduh',
    subtitle: 'Saring semua entri di pustaka Anda',
    checked: downloadedOnly,
    onChange: async (checked) => {
      const val = checked ? '1' : '0';
      await setPref('app.downloaded_only', val);
      await setPref('downloaded_only', val);
    }
  });
  container.appendChild(switchDownloaded);

  // 3. Switch: "Mode penyamaran" - subtitle "Jeda riwayat membaca"
  const incognito = getPref('privacy.incognito', '0') === '1';
  const switchIncognito = createSwitchRow({
    icon: window.Icons.incognito ? window.Icons.incognito() : window.Icons.bellOff(),
    title: 'Mode penyamaran',
    subtitle: 'Jeda riwayat membaca',
    checked: incognito,
    onChange: async (checked) => {
      const val = checked ? '1' : '0';
      await setPref('privacy.incognito', val);
    }
  });
  container.appendChild(switchIncognito);

  // 4. Divider
  const div1 = document.createElement('div');
  div1.className = 'more-divider';
  container.appendChild(div1);

  // 5. Rows: Antrean unduhan (subtitle shows queue state), Kategori, Statistik, Data dan penyimpanan.
  let queueSubtitle = 'Tidak ada unduhan berjalan';
  try {
    const qList = await api.queue_list();
    if (qList && qList.length > 0) {
      queueSubtitle = `${qList.length} item dalam antrean`;
    }
  } catch (e) {}

  container.appendChild(createListRow({
    icon: window.Icons.download(),
    title: 'Antrean unduhan',
    subtitle: queueSubtitle,
    actionIcon: window.Icons.chevronRight(),
    onClick: () => navigate('#/more/downloads')
  }));

  container.appendChild(createListRow({
    icon: window.Icons.tag ? window.Icons.tag() : window.Icons.grid(),
    title: 'Kategori',
    subtitle: 'Kelola kategori pustaka',
    actionIcon: window.Icons.chevronRight(),
    onClick: () => navigate('#/more/categories')
  }));

  container.appendChild(createListRow({
    icon: window.Icons.barChart ? window.Icons.barChart() : window.Icons.clock(),
    title: 'Statistik',
    subtitle: 'Ringkasan & waktu membaca',
    actionIcon: window.Icons.chevronRight(),
    onClick: () => navigate('#/more/stats')
  }));

  container.appendChild(createListRow({
    icon: window.Icons.database ? window.Icons.database() : window.Icons.settings(),
    title: 'Data dan penyimpanan',
    subtitle: 'Pencadangan & ruang penyimpanan',
    actionIcon: window.Icons.chevronRight(),
    onClick: () => navigate('#/more/storage')
  }));

  // 6. Divider
  const div2 = document.createElement('div');
  div2.className = 'more-divider';
  container.appendChild(div2);

  // 7. Rows: Pengaturan, Dukung Kami (hide for now), Tentang, Bantuan (opens GitHub issues link).
  container.appendChild(createListRow({
    icon: window.Icons.settings(),
    title: 'Pengaturan',
    subtitle: 'Preferensi & pembaruan',
    actionIcon: window.Icons.chevronRight(),
    onClick: () => navigate('#/more/settings')
  }));

  // Dukung Kami is hidden for now as per ROADMAP 1.2

  container.appendChild(createListRow({
    icon: window.Icons.info ? window.Icons.info() : window.Icons.book(),
    title: 'Tentang',
    subtitle: `ShiniTrack ${appVersion}`,
    actionIcon: window.Icons.chevronRight(),
    onClick: () => navigate('#/more/about')
  }));

  container.appendChild(createListRow({
    icon: window.Icons.helpCircle ? window.Icons.helpCircle() : window.Icons.alertTriangle(),
    title: 'Bantuan',
    subtitle: 'Laporkan masalah di GitHub',
    actionIcon: window.Icons.externalLink ? window.Icons.externalLink() : window.Icons.chevronRight(),
    onClick: () => {
      window.open('https://github.com/stenlysayd/ShiniTrack/issues', '_blank');
      navigate('#/more/help');
    }
  }));

  // T3: DNS-over-HTTPS (DoH) preference row
  const currentDoh = getPref('net.doh', 'auto');
  const dohSubtitle = {
    auto: 'Otomatis (Sistem lalu DoH Cloudflare/Google)',
    off: 'Nonaktif (Hanya DNS sistem)',
    cloudflare: 'Cloudflare (1.1.1.1)',
    google: 'Google (8.8.8.8)',
  }[currentDoh] || 'Otomatis';

  container.appendChild(createListRow({
    icon: window.Icons.globe ? window.Icons.globe() : window.Icons.settings(),
    title: 'DNS-over-HTTPS (DoH)',
    subtitle: dohSubtitle,
    actionIcon: window.Icons.chevronRight(),
    onClick: () => {
      const opts = ['auto', 'off', 'cloudflare', 'google'];
      const labels = ['Otomatis', 'Nonaktif', 'Cloudflare', 'Google'];
      const curIdx = opts.indexOf(getPref('net.doh', 'auto'));
      const nextIdx = (curIdx + 1) % opts.length;
      const nextVal = opts[nextIdx];
      setPref('net.doh', nextVal).then(() => {
        showToast(`DoH diatur: ${labels[nextIdx]}`);
        renderMore();
      });
    }
  }));

  // T3: Diagnosa koneksi entry
  container.appendChild(createListRow({
    icon: window.Icons.activity ? window.Icons.activity() : window.Icons.sync(),
    title: 'Diagnosa koneksi',
    subtitle: 'Uji DNS, DoH, TCP, dan HTTPS',
    actionIcon: window.Icons.chevronRight(),
    onClick: () => {
      navigate('#/explore');
      showToast('Buka katalog lalu tekan tombol Diagnosa Koneksi jika gagal');
    }
  }));

  viewEl.appendChild(container);
}

// ================================================================= VIEW: PLACEHOLDER SUBPAGES
export function renderMorePlaceholder(title, subtitle, description, iconSvg, isHelp = false) {
  setHeaderTitles(title, subtitle);
  const viewEl = document.getElementById('view');
  if (!viewEl) return;

  const repo = 'stenlysayd/ShiniTrack';
  const helpButton = isHelp
    ? `<button id="btn-open-issues" class="btn primary" style="margin-top:16px;">
        ${window.Icons.externalLink ? window.Icons.externalLink() : ''} Buka GitHub Issues
       </button>`
    : '';

  viewEl.innerHTML = `
    <div class="placeholder-container" style="padding: 20px 16px 80px 16px; max-width: 600px; margin: 0 auto;">
      <div style="margin-bottom: 20px;">
        <button id="btn-placeholder-back" class="btn" style="display:inline-flex; align-items:center; gap:8px; padding:8px 14px; background:var(--surface-elevated); border:1px solid var(--border);" aria-label="Kembali">
          ${window.Icons.back()} <span style="font-size:13px; font-weight:600;">Kembali</span>
        </button>
      </div>
      <div class="empty" style="padding: 40px 16px;">
        <div class="svg-icon" style="color:var(--accent); transform: scale(1.5); margin-bottom: 12px;">
          ${iconSvg || (window.Icons.info ? window.Icons.info() : window.Icons.alertTriangle())}
        </div>
        <h3 style="margin-top:12px; font-size:18px;">${escapeHtml(title)}</h3>
        <p style="margin-top:8px; color:var(--text-muted); font-size:13px; max-width:340px; line-height:1.5;">
          ${escapeHtml(description)}
        </p>
        ${helpButton}
      </div>
    </div>
  `;

  const backBtn = document.getElementById('btn-placeholder-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        navigate('#/more');
      }
    });
  }

  if (isHelp) {
    const issuesBtn = document.getElementById('btn-open-issues');
    if (issuesBtn) {
      issuesBtn.addEventListener('click', () => {
        window.open(`https://github.com/${repo}/issues`, '_blank');
      });
    }
  }
}

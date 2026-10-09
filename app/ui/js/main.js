export { renderSettings } from './views/settings/index.js';
export { renderReader } from './views/reader.js';
export { renderSearch } from './views/explore.js';
export { renderMangaDetail } from './views/detail.js';
export { renderHistory } from './views/history.js';
export { renderUpdates } from './views/updates.js';
export { renderFavorites } from './views/library.js';
export { renderDevComponents } from './views/dev-components.js';
export { renderMore, renderMorePlaceholder } from './views/more.js';
export { renderCategories } from './views/categories.js';
import { state, initPrefs, getPref } from './state.js';
import { setupRouter, handleRoute, navigate } from './router.js';
import { motion } from './motion.js';
import * as utils from './utils.js';
import * as api from './api.js';

export function applyThemeSettings() {
  const themeMode = getPref('ui.theme_mode', 'dark');
  const isAmoled = getPref('ui.amoled', '0') === '1';
  const accent = getPref('ui.accent', 'crimson');
  const animations = getPref('ui.animations', '1') !== '0';

  let effectiveTheme = themeMode;
  if (themeMode === 'system') {
    effectiveTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme);

  if (isAmoled && effectiveTheme === 'dark') {
    document.documentElement.classList.add('amoled');
  } else {
    document.documentElement.classList.remove('amoled');
  }

  document.documentElement.setAttribute('data-accent', accent);

  if (!animations) {
    document.documentElement.classList.add('no-animations');
  } else {
    document.documentElement.classList.remove('no-animations');
  }
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getPref('ui.theme_mode', 'dark') === 'system') {
      applyThemeSettings();
    }
  });
}

const { setHeaderTitles, showToast, assetUrl, coverUrl, pageUrl, formatWeekday, formatRelativeTime, formatPrediction, escapeHtml, sanitizeRepo } = utils;

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');
const backBtn = document.getElementById('back');
const syncBtn = document.getElementById('sync');
const toastEl = document.getElementById('toast');
const badgeEl = document.getElementById('badge');
function setupPressEffects() {
  let activePressEl = null;

  document.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.btn.primary, .btn-primary, .cat-dialog-btn--primary, .grid-card, .card');
    if (!target) return;
    activePressEl = target;
    motion.press(target, true);
  });

  const handlePointerRelease = () => {
    if (activePressEl) {
      motion.press(activePressEl, false);
      activePressEl = null;
    }
  };

  document.addEventListener('pointerup', handlePointerRelease);
  document.addEventListener('pointercancel', handlePointerRelease);
}

export function updateIncognitoUI() {
  const isIncognito = getPref('privacy.incognito', '0') === '1';
  const incognitoBadge = document.getElementById('incognito-badge');
  if (incognitoBadge) {
    if (isIncognito) {
      incognitoBadge.classList.remove('hidden');
    } else {
      incognitoBadge.classList.add('hidden');
    }
  }
  const readerIncognitoBadge = document.getElementById('reader-incognito-badge');
  if (readerIncognitoBadge) {
    if (isIncognito) {
      readerIncognitoBadge.classList.remove('hidden');
    } else {
      readerIncognitoBadge.classList.add('hidden');
    }
  }
}
window.updateIncognitoUI = updateIncognitoUI;

window.addEventListener('DOMContentLoaded', async () => {
  if (typeof setupGlobalEvents === 'function') setupGlobalEvents();
  setupUpdateModal();
  setupPressEffects();
  setupRouter();

  await initPrefs();
  applyThemeSettings();
  updateIncognitoUI();

  if (getPref('storage.clear_cache_on_open', '0') === '1') {
    api.clear_cache({ target: 'chapters' }).catch(e => console.warn('Clear cache on open error:', e));
  }

  if (!window.location.hash) {
    navigate('#/favorites');
  } else {
    handleRoute();
  }
  refreshBadge();

  try {
    const s = await api.settings_get();
    if (s.auto_check_update !== false) {
      checkForUpdates(true, s.github_repo);
    }
  } catch (e) {
    console.warn('Initial update check error:', e);
  }
});

backBtn.addEventListener('click', () => {
  window.history.back();
});

syncBtn.addEventListener('click', async () => {
  syncBtn.classList.add('spin');
  try {
    const count = await api.sync_now();
    showToast(count > 0 ? `Sinkronisasi selesai: ${count} update baru!` : 'Semua komik up-to-date.');
    handleRoute();
    refreshBadge();
  } catch (e) {
    showToast(`Gagal sinkron: ${e}`);
  } finally {
    syncBtn.classList.remove('spin');
  }
});

export async function refreshBadge() {
  try {
    const events = await api.recent_events();
    const unread = events.filter(e => !e.seen).length;
    if (unread > 0) {
      badgeEl.textContent = unread > 99 ? '99+' : unread;
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  } catch (e) {}
}

// ================================================================= IN-APP UPDATER
function setupUpdateModal() {
  const modal = document.getElementById('update-modal');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const installBtn = document.getElementById('modal-install-btn');
  const dlBox = document.getElementById('modal-dl-progress');
  const dlBar = document.getElementById('dl-bar');
  const dlPct = document.getElementById('dl-pct');
  const dlText = document.getElementById('dl-text');

  cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  installBtn.addEventListener('click', async () => {
    if (!state.updateModalData) return;

    // If APK is already downloaded on device, directly trigger package installer:
    if (state.downloadedApkPath) {
      installBtn.disabled = true;
      installBtn.textContent = 'Membuka Installer...';
      try {
        const res = await api.install_downloaded_apk({ filePath: state.downloadedApkPath });
        if (res.needsPermission) {
          showToast(res.message, 6000);
          dlText.innerHTML = `<span style="color:#f59e0b;font-weight:600;">Izin Diperlukan:</span> Silakan izinkan "Install unknown apps" untuk ShiniTrack di setelan Android yang terbuka, lalu ketuk tombol <b>Pasang Pembaruan</b> di bawah.`;
          installBtn.disabled = false;
          installBtn.textContent = 'Pasang Pembaruan';
          await api.request_install_permission();
        } else if (res.success) {
          showToast(res.message, 5000);
          modal.classList.add('hidden');
        } else {
          showToast(res.message, 5000);
          installBtn.disabled = false;
          installBtn.textContent = 'Coba Pasang Lagi';
        }
      } catch (err) {
        showToast(`Gagal memasang APK: ${err}`, 5000);
        installBtn.disabled = false;
        installBtn.textContent = 'Coba Pasang Lagi';
      }
      return;
    }

    if (!state.updateModalData.download_url) {
      if (state.updateModalData.html_url) {
        window.open(state.updateModalData.html_url, '_blank');
      } else {
        showToast('Link file APK tidak ditemukan.');
      }
      return;
    }

    installBtn.disabled = true;
    installBtn.textContent = 'Mengunduh...';
    cancelBtn.disabled = true;
    dlBox.classList.remove('hidden');
    dlBar.style.width = '0%';
    dlPct.textContent = '0%';
    dlText.textContent = 'Menghubungkan ke GitHub...';

    try {
      const res = await api.download_and_install_update( {
        downloadUrl: state.updateModalData.download_url
      });
      state.downloadedApkPath = res.file_path;

      if (res.needsPermission) {
        dlBar.style.width = '100%';
        dlPct.textContent = '100%';
        dlText.innerHTML = `<span style="color:#f59e0b;font-weight:600;">Izin Diperlukan:</span> Aktifkan "Izinkan dari sumber ini" di setelan Android yang baru terbuka, lalu ketuk <b>Pasang Pembaruan</b> di bawah.`;
        showToast(res.message, 6000);
        installBtn.disabled = false;
        installBtn.textContent = 'Pasang Pembaruan';
        cancelBtn.disabled = false;
      } else if (res.success) {
        showToast(res.message, 5000);
        dlText.textContent = 'Penginstal paket Android telah dibuka.';
        installBtn.disabled = false;
        installBtn.textContent = 'Pasang Ulang';
        cancelBtn.disabled = false;
      } else {
        showToast(res.message, 5000);
        installBtn.disabled = false;
        installBtn.textContent = 'Pasang Pembaruan';
        cancelBtn.disabled = false;
      }
    } catch (err) {
      showToast(`Gagal mengunduh update: ${err}`, 5000);
      installBtn.disabled = false;
      installBtn.textContent = 'Coba Lagi';
      cancelBtn.disabled = false;
      dlText.textContent = 'Gagal mengunduh';
    }
  });

  const ubBtn = document.getElementById('ub-btn');
  if (ubBtn) {
    ubBtn.addEventListener('click', () => {
      if (state.availableUpdate) {
        showUpdateModal(state.availableUpdate);
      }
    });
  }
  const ubDismiss = document.getElementById('ub-dismiss');
  if (ubDismiss) {
    ubDismiss.addEventListener('click', () => {
      document.getElementById('update-banner').classList.add('hidden');
    });
  }
}

export function showUpdateModal(info) {
  state.updateModalData = info;
  state.downloadedApkPath = null;
  const modal = document.getElementById('update-modal');
  document.getElementById('modal-update-title').textContent = `${info.release_name || 'ShiniTrack ' + info.latest_version}`;
  document.getElementById('modal-update-date').textContent = info.published_at
    ? `Rilis: ${new Date(info.published_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Rilis: Baru';
  const rawNotes = info.release_notes || 'Peningkatan performa dan perbaikan bug.';
  document.getElementById('modal-changelog').innerHTML = rawNotes
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*$)/gim, '<h3 style="margin-top:10px;margin-bottom:4px;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="margin-top:10px;margin-bottom:4px;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="margin-top:10px;margin-bottom:4px;">$1</h1>')
    .replace(/^- (.*$)/gim, '<ul style="margin:4px 0;padding-left:20px;"><li>$1</li></ul>')
    .replace(/<\/ul>\n<ul.*?>/g, '')
    .replace(/\n/g, '<br/>');
  
  const dlBox = document.getElementById('modal-dl-progress');
  dlBox.classList.add('hidden');
  const installBtn = document.getElementById('modal-install-btn');
  installBtn.disabled = false;
  installBtn.textContent = info.download_url ? 'Unduh & Pasang' : 'Buka GitHub';
  document.getElementById('modal-cancel-btn').disabled = false;

  modal.classList.remove('hidden');
  const card = modal.querySelector('.modal-card');
  if (card) {
    motion.dialogOpen(card, modal);
  }
}

export async function checkForUpdates(silent = false, customRepo = null) {
  try {
    const cleanRepo = customRepo ? sanitizeRepo(customRepo) : null;
    const info = await api.check_app_update({ repo: cleanRepo });
    if (info.update_available) {
      state.availableUpdate = info;
      const banner = document.getElementById('update-banner');
      if (banner) {
        document.getElementById('ub-version').textContent = `${info.latest_version} Tersedia`;
        banner.classList.remove('hidden');
      }
      if (!silent) {
        showUpdateModal(info);
      }
    } else {
      if (!silent) {
        showToast(`Aplikasi sudah versi terbaru (${info.current_version})`);
      }
    }
  } catch (err) {
    if (!silent) {
      showToast(`Gagal cek update: ${err}`);
    } else {
      console.warn('Silent update check:', err);
    }
  }
}

// ================================================================= VIEW: SCHEDULE
export async function renderSchedule() {
  setHeaderTitles('Jadwal Rilis', 'Prediksi Rilis Mingguan');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Menghitung kalkulasi jadwal rilis...</p>
    </div>`;

  try {
    const sched = await api.schedule_week();
    let html = '';

    const todayStr = new Date().toISOString().split('T')[0];

    sched.days.forEach(day => {
      const isToday = day.date === todayStr;
      const dObj = new Date(day.date + 'T00:00:00');
      const dayName = dObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
      
      html += `
        <div class="day ${isToday ? 'today' : ''}">
          <h3>
            <span>${dayName}</span>
            ${isToday ? '<span class="pill high">HARI INI</span>' : `<span class="pill low">${day.items.length} komik</span>`}
          </h3>
      `;

      if (day.items.length === 0) {
        html += `<div class="s" style="padding: 6px 0; color: var(--text-faint);">Tidak ada jadwal rilis hari ini.</div>`;
      } else {
        day.items.forEach(item => {
          const timeStr = new Date(item.prediction.next_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
          html += `
            <div class="item" data-id="${item.manga_id}">
              <img src="${coverUrl(item.cover)}" loading="lazy" alt="${utils.escapeHtml(item.title)}" />
              <div class="body">
                <div class="t">${utils.escapeHtml(item.title)}</div>
                <div class="s">± ${item.prediction.window_hours} jam &bull; Akurasi ${Math.round(item.prediction.confidence * 100)}%</div>
              </div>
              <div class="time">${Icons.clock()} ~${timeStr}</div>
            </div>
          `;
        });
      }
      html += `</div>`;
    });

    if (sched.overdue && sched.overdue.length > 0) {
      html += `<div class="section-title">Terlambat / Kemungkinan Hiatus (${sched.overdue.length})</div>`;
      sched.overdue.forEach(item => {
        html += `
          <div class="card click" data-id="${item.manga_id}">
            <img class="cover" src="${coverUrl(item.cover)}" loading="lazy" alt="${utils.escapeHtml(item.title)}" />
            <div class="body">
              <div class="t">${utils.escapeHtml(item.title)}</div>
              <div class="s" style="color:var(--bad);">${Icons.alertTriangle()} ${item.prediction.likely_hiatus ? 'Kemungkinan Hiatus (sudah lewat 2.5x siklus)' : 'Jadwal terlewat'}</div>
            </div>
          </div>
        `;
      });
    }

    viewEl.innerHTML = html;

    viewEl.querySelectorAll('.item, .card').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.id) navigate(`#/manga/${el.dataset.id}`);
      });
    });

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Jadwal</h3>
        <p>${err}</p>
      </div>`;
  }
}

function setupGlobalEvents() {
  if (api.eventApi && api.eventApi.listen) {
    // Listen to APK download progress
    api.eventApi.listen('update-download-progress', (e) => {
      const p = e.payload;
      const dlBar = document.getElementById('dl-bar');
      const dlPct = document.getElementById('dl-pct');
      const dlText = document.getElementById('dl-text');
      if (dlBar && dlPct && p) {
        dlBar.style.width = `${p.progress}%`;
        dlPct.textContent = `${p.progress}%`;
        if (p.total_bytes > 0) {
          const mbDone = (p.downloaded_bytes / (1024 * 1024)).toFixed(1);
          const mbTotal = (p.total_bytes / (1024 * 1024)).toFixed(1);
          dlText.textContent = `Mengunduh (${mbDone} MB / ${mbTotal} MB)...`;
        }
      }
    });

    // Listen to chapter download progress
    api.eventApi.listen('download-progress', (e) => {
      console.log('Chapter download progress:', e.payload);
    });
  }
}



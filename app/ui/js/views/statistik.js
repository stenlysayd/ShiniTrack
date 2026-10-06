import * as api from '../api.js';
import * as utils from '../utils.js';

const { setHeaderTitles, escapeHtml } = utils;

/**
 * Format elapsed seconds into readable Indonesian string, e.g.:
 * "5 hari 2 jam 10 menit", "3 jam 25 menit", "15 menit", or "40 detik".
 */
export function formatReadDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  if (sec === 0) return '0 menit';
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} hari`);
  if (hours > 0) parts.push(`${hours} jam`);
  if (minutes > 0) parts.push(`${minutes} menit`);
  if (parts.length === 0) {
    if (seconds > 0) parts.push(`${seconds} detik`);
    else parts.push('0 menit');
  }
  return parts.join(' ');
}

/**
 * Render the Statistik view displaying Ringkasan, Entri, and Bab sections.
 */
export async function renderStatistik() {
  setHeaderTitles('Statistik', 'Ringkasan & Waktu Membaca');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;

  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${window.Icons.sync()}</div>
      <p style="margin-top:12px;">Memuat statistik...</p>
    </div>
  `;

  try {
    const stats = await api.get_statistics();
    const durationStr = formatReadDuration(stats.read_duration);

    viewEl.innerHTML = `
      <div class="stats-container">
        <!-- Section: Ringkasan -->
        <div class="stats-section-header">Ringkasan</div>
        <div class="stats-hero-card">
          <div class="stats-hero-icon">${window.Icons.clock()}</div>
          <div class="stats-hero-content">
            <div class="stats-hero-label">Total Waktu Membaca</div>
            <div class="stats-hero-val">${escapeHtml(durationStr)}</div>
            <div class="stats-hero-sub">Waktu aktif membaca di ShiniTrack</div>
          </div>
        </div>

        <!-- Section: Entri -->
        <div class="stats-section-header">Entri</div>
        <div class="stats-grid">
          <div class="stats-card">
            <div class="stats-card-icon crimson">${window.Icons.favorites()}</div>
            <div class="stats-card-data">
              <div class="stats-card-val">${stats.total_favorites}</div>
              <div class="stats-card-label">Komik di Pustaka</div>
            </div>
          </div>
          <div class="stats-card">
            <div class="stats-card-icon emerald">${window.Icons.check()}</div>
            <div class="stats-card-data">
              <div class="stats-card-val">${stats.manga_finished}</div>
              <div class="stats-card-label">Komik Tamat / Selesai</div>
            </div>
          </div>
        </div>

        <!-- Section: Bab -->
        <div class="stats-section-header">Bab</div>
        <div class="stats-grid">
          <div class="stats-card">
            <div class="stats-card-icon cyan">${window.Icons.book()}</div>
            <div class="stats-card-data">
              <div class="stats-card-val">${stats.total_read_chapters}</div>
              <div class="stats-card-label">Bab Dibaca</div>
            </div>
          </div>
          <div class="stats-card">
            <div class="stats-card-icon amber">${window.Icons.download()}</div>
            <div class="stats-card-data">
              <div class="stats-card-val">${stats.total_downloads}</div>
              <div class="stats-card-label">Bab Terunduh</div>
            </div>
          </div>
          <div class="stats-card full-width">
            <div class="stats-card-icon purple">${window.Icons.grid()}</div>
            <div class="stats-card-data">
              <div class="stats-card-val">${stats.total_chapters}</div>
              <div class="stats-card-label">Total Bab di Basis Data</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        <div class="svg-icon">${window.Icons.alertTriangle()}</div>
        <h3>Gagal Memuat Statistik</h3>
        <p>${escapeHtml(String(err))}</p>
        <button class="btn primary small" onclick="window.history.back()">Kembali</button>
      </div>
    `;
  }
}

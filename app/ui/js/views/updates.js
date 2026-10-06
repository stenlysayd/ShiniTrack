import { navigate } from '../router.js';
import * as utils from '../utils.js';
import * as api from '../api.js';
import { openFilterSheet, filterEvents } from './updates-filter.js';
import { refreshBadge } from '../main.js';
import { motion } from '../motion.js';

const { setHeaderTitles, coverUrl, escapeHtml, formatRelativeTime, showToast } = utils;
const viewEl = document.getElementById('view');

let progressUnlisten = null;
let updateProgressState = null;

function getDayKey(date) {
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (isToday) return 'Hari Ini';

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return 'Kemarin';

  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ================================================================= VIEW: UPDATES
export async function renderUpdates(opts = {}) {
  setHeaderTitles('Pembaruan', 'Pembaruan Chapter Baru');

  if (api.eventApi && !progressUnlisten) {
    try {
      progressUnlisten = await api.eventApi.listen('library-update-progress', (e) => {
        const payload = e.payload;
        updateProgressState = payload;
        const progressEl = document.getElementById('updates-progress-bar');
        const progressContainer = document.getElementById('updates-progress-container');
        const progressText = document.getElementById('updates-progress-text');
        if (progressContainer && progressText && progressEl) {
          progressContainer.style.display = 'block';
          const pct = Math.round((payload.current / Math.max(1, payload.total)) * 100);
          progressEl.style.width = `${pct}%`;
          progressText.textContent = `Memperbarui pustaka... (${payload.current}/${payload.total})`;
        }
        if (payload.current >= payload.total) {
          setTimeout(() => {
            updateProgressState = null;
            renderUpdates({ isRefresh: true });
          }, 800);
        }
      });
    } catch (err) {
      console.warn('Failed to listen to library-update-progress:', err);
    }
  }

  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Memuat notifikasi update...</p>
    </div>`;

  try {
    const [events, lastUpdateTs, libRows] = await Promise.all([
      api.recent_events(),
      api.get_last_library_update().catch(() => null),
      api.library_list({
        category: 0,
        sort: 'alpha',
        sortDesc: false,
        filterDownloaded: 0,
        filterUnread: 0,
        filterStarted: 0,
        filterCompleted: 0,
        limit: 5000,
        offset: 0
      }).catch(() => [])
    ]);

    const { filtered: filteredEvents, hasFilter: hasActiveFilter } = await filterEvents(events, libRows);

    let lastUpdateText = 'Pustaka belum pernah diperbarui';
    if (lastUpdateTs) {
      const updateDate = new Date(lastUpdateTs);
      lastUpdateText = `Pustaka terakhir diperbarui: ${formatRelativeTime(updateDate)}`;
    }

    const hasProgress = updateProgressState && updateProgressState.current < updateProgressState.total;
    const progressPct = hasProgress
      ? Math.round((updateProgressState.current / Math.max(1, updateProgressState.total)) * 100)
      : 0;
    const progressLabel = hasProgress
      ? `Memperbarui pustaka... (${updateProgressState.current}/${updateProgressState.total})`
      : '';

    const toolbarHtml = `
      <div class="updates-toolbar">
        <div class="updates-toolbar-info">
          <span class="updates-last-sync">${escapeHtml(lastUpdateText)}</span>
        </div>
        <div class="updates-toolbar-actions">
          <button id="btn-updates-refresh" class="btn icon-btn small" title="Perbarui Pustaka" aria-label="Perbarui">
            ${Icons.sync()}
          </button>
          <button id="btn-updates-calendar" class="btn icon-btn small" title="Jadwal Rilis" aria-label="Jadwal">
            ${Icons.schedule()}
          </button>
          <button id="btn-updates-filter" class="btn icon-btn small ${hasActiveFilter ? 'active' : ''}" style="${hasActiveFilter ? 'color:var(--accent);' : ''}" title="Filter" aria-label="Filter">
            ${Icons.filter()}
          </button>
        </div>
      </div>
      <div id="updates-progress-container" class="updates-progress" style="display: ${hasProgress ? 'block' : 'none'};">
        <div class="updates-progress-header">
          <span id="updates-progress-text" class="updates-progress-title">${escapeHtml(progressLabel)}</span>
        </div>
        <div class="updates-progress-track">
          <div id="updates-progress-bar" class="updates-progress-fill" style="width: ${progressPct}%;"></div>
        </div>
      </div>
    `;

    if (!filteredEvents || filteredEvents.length === 0) {
      const emptyMsg = hasActiveFilter
        ? 'Tidak ada pembaruan yang cocok dengan filter yang dipilih.'
        : 'Update chapter baru dari komik favorit pilihanmu akan otomatis muncul di sini.';
      viewEl.innerHTML = `
        ${toolbarHtml}
        <div class="empty">
          ${Icons.emptyUpdates()}
          <h3>${hasActiveFilter ? 'Tidak Ada Hasil Filter' : 'Belum Ada Update Baru'}</h3>
          <p>${emptyMsg}</p>
        </div>`;
      attachToolbarEvents();
      return;
    }

    const groups = new Map();
    for (const e of filteredEvents) {
      const d = new Date(e.created_at || e.released_at);
      const key = getDayKey(d);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    let listHtml = `<div class="updates-list">`;
    for (const [day, dayEvents] of groups.entries()) {
      listHtml += `<div class="updates-day-header">${escapeHtml(day)}</div>`;
      for (const e of dayEvents) {
        const relTime = e.released_at ? formatRelativeTime(new Date(e.released_at)) : '';
        listHtml += `
          <div class="updates-row click" data-ch-id="${escapeHtml(e.chapter_id)}" data-manga-id="${escapeHtml(e.manga_id)}">
            <img class="updates-cover" src="${coverUrl(e.cover)}" loading="lazy" alt="${escapeHtml(e.title)}" />
            <div class="updates-info">
              <div class="updates-title">${escapeHtml(e.title)}</div>
              <div class="updates-meta">
                <span class="updates-chapter">Bab ${e.chapter_number}</span>
                ${relTime ? `&bull; <span class="updates-time">${escapeHtml(relTime)}</span>` : ''}
                ${!e.seen ? '<span class="pill new">BARU</span>' : ''}
              </div>
            </div>
            <button class="btn icon-btn small updates-dl-btn" data-manga-id="${escapeHtml(e.manga_id)}" data-ch-id="${escapeHtml(e.chapter_id)}" data-title="${escapeHtml(e.title)}" data-ch-num="${e.chapter_number}" title="Unduh Bab" aria-label="Unduh">
              ${Icons.download()}
            </button>
          </div>
        `;
      }
    }
    listHtml += `</div>`;

    viewEl.innerHTML = toolbarHtml + listHtml;

    if (!opts.isFilter && !opts.isRefresh) {
      const rows = viewEl.querySelectorAll('.updates-row');
      motion.stagger(rows, { max: 24 });
    }

    attachToolbarEvents();

    viewEl.querySelectorAll('.updates-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.updates-dl-btn')) return;
        navigate(`#/read/${row.dataset.chId}`);
      });
    });

    viewEl.querySelectorAll('.updates-dl-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api.queue_add({
            manga_id: btn.dataset.mangaId,
            chapter_id: btn.dataset.chId,
            title: btn.dataset.title,
            chapter_number: parseFloat(btn.dataset.chNum) || 0
          });
          showToast('Chapter ditambahkan ke antrean unduhan');
        } catch (err) {
          showToast(`Gagal menambahkan unduhan: ${err}`);
        }
      });
    });

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Update</h3>
        <p>${escapeHtml(String(err))}</p>
      </div>`;
  }
}

function attachToolbarEvents() {
  const refreshBtn = document.getElementById('btn-updates-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spin');
      const progressContainer = document.getElementById('updates-progress-container');
      const progressText = document.getElementById('updates-progress-text');
      if (progressContainer && progressText) {
        progressContainer.style.display = 'block';
        progressText.textContent = 'Memulai pembaruan pustaka...';
      }
      try {
        await api.library_update();
        refreshBadge();
      } catch (err) {
        showToast(`Pembaruan gagal: ${err}`);
      } finally {
        refreshBtn.classList.remove('spin');
        renderUpdates({ isRefresh: true });
      }
    });
  }

  const calBtn = document.getElementById('btn-updates-calendar');
  if (calBtn) {
    calBtn.addEventListener('click', () => {
      navigate('#/schedule');
    });
  }

  const filterBtn = document.getElementById('btn-updates-filter');
  if (filterBtn) {
    filterBtn.addEventListener('click', () => {
      openFilterSheet(() => {
        renderUpdates({ isFilter: true });
      });
    });
  }
}

import { navigate } from '../router.js';
import * as utils from '../utils.js';
import * as api from '../api.js';
import { motion } from '../motion.js';

const { setHeaderTitles, coverUrl, escapeHtml, showToast } = utils;
const viewEl = document.getElementById('view');

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

function renderEmptyState() {
  viewEl.innerHTML = `
    <div class="empty">
      ${Icons.emptyHistory()}
      <h3>Belum Ada Riwayat</h3>
      <p>Komik yang kamu baca akan otomatis dicatat rapi di sini agar kamu bisa langsung melanjutkan membaca.</p>
      <a class="btn primary small" href="#/favorites">
        ${Icons.favorites()} Buka Library
      </a>
    </div>`;
}

// ================================================================= VIEW: RIWAYAT (HISTORY)
export async function renderHistory() {
  setHeaderTitles('Riwayat', 'Catatan Bacaan Terakhir');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Memuat riwayat membaca...</p>
    </div>`;

  try {
    const items = await api.get_reading_history({ limit: 200 });
    if (!items || items.length === 0) {
      renderEmptyState();
      return;
    }

    renderMainView(items);
  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Riwayat</h3>
        <p>${escapeHtml(String(err))}</p>
      </div>`;
  }
}

function renderMainView(initialItems) {
  viewEl.innerHTML = `
    <div class="history-toolbar">
      <div class="history-toolbar-info">
        <span id="history-total-count" class="history-total-count">${initialItems.length} riwayat bacaan</span>
      </div>
      <div class="history-toolbar-actions">
        <button id="btn-history-search-toggle" class="btn icon-btn small" title="Cari Riwayat" aria-label="Cari">
          ${Icons.search()}
        </button>
        <button id="btn-history-clear" class="btn icon-btn small" title="Hapus Semua Riwayat" aria-label="Hapus Semua">
          ${Icons.trash()}
        </button>
      </div>
    </div>
    <div id="history-search-container" class="history-search-container" style="display: none;">
      <input type="text" id="history-search-input" class="history-search-input" placeholder="Cari judul komik di riwayat..." />
    </div>
    <div id="history-content"></div>
  `;

  const contentEl = viewEl.querySelector('#history-content');
  const btnSearchToggle = viewEl.querySelector('#btn-history-search-toggle');
  const searchContainer = viewEl.querySelector('#history-search-container');
  const searchInput = viewEl.querySelector('#history-search-input');
  const btnClear = viewEl.querySelector('#btn-history-clear');

  function updateCount(countOverride, isSearch = false) {
    const countEl = viewEl.querySelector('#history-total-count');
    if (!countEl) return;
    const count = typeof countOverride === 'number'
      ? countOverride
      : contentEl.querySelectorAll('.history-row').length;
    countEl.textContent = isSearch
      ? `${count} riwayat ditemukan`
      : `${count} riwayat bacaan`;
  }

  function renderList(items, isSearching = false, query = '', isInitial = false) {
    if (!items || items.length === 0) {
      if (isSearching) {
        contentEl.innerHTML = `
          <div class="empty" style="padding: 32px 16px;">
            ${Icons.emptySearch()}
            <h3>Tidak Ada Hasil</h3>
            <p>Tidak ditemukan komik "${escapeHtml(query)}" dalam riwayat membaca.</p>
          </div>`;
      } else {
        renderEmptyState();
      }
      return;
    }

    const groups = new Map();
    for (const item of items) {
      const dt = item.updated_at ? new Date(item.updated_at) : new Date();
      const dayKey = getDayKey(dt);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey).push({ item, dt });
    }

    let listHtml = `<div class="history-list">`;
    for (const [day, dayItems] of groups.entries()) {
      listHtml += `
        <div class="history-day-section">
          <div class="history-day-header">${escapeHtml(day)}</div>
          <div class="history-day-items">`;
      for (const { item, dt } of dayItems) {
        const hh = String(dt.getHours()).padStart(2, '0');
        const mm = String(dt.getMinutes()).padStart(2, '0');
        const chapterTime = `Bab ${item.chapter_number} — ${hh}:${mm}`;

        listHtml += `
          <div class="history-row click" data-manga-id="${escapeHtml(item.manga_id)}" data-ch-id="${escapeHtml(item.chapter_id)}">
            <img class="history-cover" src="${coverUrl(item.cover)}" loading="lazy" alt="${escapeHtml(item.title)}" />
            <div class="history-info">
              <div class="history-title">${escapeHtml(item.title)}</div>
              <div class="history-chapter">${escapeHtml(chapterTime)}</div>
            </div>
            <button class="history-row-delete" data-manga-id="${escapeHtml(item.manga_id)}" data-ch-id="${escapeHtml(item.chapter_id)}" title="Hapus dari Riwayat" aria-label="Hapus">
              ${Icons.trash()}
            </button>
          </div>`;
      }
      listHtml += `
          </div>
        </div>`;
    }
    listHtml += `</div>`;
    contentEl.innerHTML = listHtml;

    if (isInitial && !isSearching) {
      const rows = contentEl.querySelectorAll('.history-row');
      motion.stagger(rows, { max: 24 });
    }

    contentEl.querySelectorAll('.history-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.history-row-delete')) return;
        navigate(`#/manga/${row.dataset.mangaId}`);
      });
    });

    contentEl.querySelectorAll('.history-row-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mangaId = btn.dataset.mangaId;
        const chapterId = btn.dataset.chId;
        const row = btn.closest('.history-row');
        if (!row) return;

        try {
          await api.delete_history_item({
            manga_id: mangaId,
            chapter_id: chapterId,
            mangaId: mangaId,
            chapterId: chapterId,
          });

          const daySection = row.closest('.history-day-section');
          row.remove();
          if (daySection && !daySection.querySelector('.history-row')) {
            daySection.remove();
          }

          updateCount();

          if (!contentEl.querySelector('.history-row')) {
            if (searchInput && searchInput.value.trim()) {
              renderList([], true, searchInput.value.trim());
            } else {
              renderEmptyState();
            }
          }
        } catch (err) {
          showToast(`Gagal menghapus riwayat: ${err}`);
        }
      });
    });
  }

  // Initial list render
  renderList(initialItems, false, '', true);

  // Clear all button handler
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      if (!confirm('Hapus semua riwayat membaca?')) return;
      try {
        await api.clear_reading_history();
        renderEmptyState();
        showToast('Riwayat membaca telah dibersihkan');
      } catch (err) {
        showToast(`Gagal membersihkan riwayat: ${err}`);
      }
    });
  }

  // Search toggle handler
  if (btnSearchToggle && searchContainer && searchInput) {
    btnSearchToggle.addEventListener('click', () => {
      const isHidden = searchContainer.style.display === 'none';
      if (isHidden) {
        searchContainer.style.display = 'block';
        btnSearchToggle.classList.add('active');
        searchInput.focus();
      } else {
        searchContainer.style.display = 'none';
        btnSearchToggle.classList.remove('active');
        if (searchInput.value) {
          searchInput.value = '';
          api.get_reading_history({ limit: 200 })
            .then(items => {
              renderList(items || []);
              updateCount(items ? items.length : 0);
            })
            .catch(console.warn);
        }
      }
    });
  }

  // Search input handler (debounce 300ms)
  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const query = e.target.value.trim();
      searchTimer = setTimeout(async () => {
        try {
          if (!query) {
            const items = await api.get_reading_history({ limit: 200 });
            renderList(items || []);
            updateCount(items ? items.length : 0);
          } else {
            const items = await api.search_history({ query, limit: 200 });
            renderList(items || [], true, query);
            updateCount(items ? items.length : 0, true);
          }
        } catch (err) {
          console.warn('Search history error:', err);
        }
      }, 300);
    });
  }
}

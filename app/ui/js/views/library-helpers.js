import * as api from '../api.js';
import * as utils from '../utils.js';
import { state, getPref } from '../state.js';

const { coverUrl, formatPrediction, escapeHtml, showToast } = utils;

/**
 * Shows a dialog to assign selected manga to categories.
 * @param {string[]} mangaIds
 * @param {Array} categories - from category_list
 * @param {Object} mangaCatMap - mangaId -> [catId...]
 * @param {Function} onDone - called after save
 */
export function showCategoryAssignDialog(mangaIds, categories, mangaCatMap, onDone) {
  if (!categories.length) { showToast('Belum ada kategori. Buat dulu di Lainnya > Kategori.'); return; }

  // Pre-check categories shared by ALL selected manga
  const sharedCats = new Set(categories.map(c => c.id));
  mangaIds.forEach(id => {
    const cats = new Set(mangaCatMap[id] || []);
    for (const cid of [...sharedCats]) { if (!cats.has(cid)) sharedCats.delete(cid); }
  });
  const checked = new Set(sharedCats);

  const overlay = document.createElement('div');
  overlay.className = 'cat-dialog-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'cat-dialog';

  const h = document.createElement('h3');
  h.textContent = 'Ubah kategori';
  dialog.appendChild(h);

  categories.forEach(c => {
    const row = document.createElement('label');
    row.className = 'cat-assign-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(c.id);
    cb.addEventListener('change', () => {
      if (cb.checked) checked.add(c.id); else checked.delete(c.id);
    });
    const span = document.createElement('span');
    span.textContent = c.name;
    row.appendChild(cb);
    row.appendChild(span);
    dialog.appendChild(row);
  });

  const actions = document.createElement('div');
  actions.className = 'cat-dialog-actions';
  const cancelBtn = document.createElement('div');
  cancelBtn.textContent = 'Batal';
  cancelBtn.className = 'cat-dialog-btn';
  cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));
  const okBtn = document.createElement('div');
  okBtn.textContent = 'Simpan';
  okBtn.className = 'cat-dialog-btn cat-dialog-btn--primary';
  okBtn.addEventListener('click', async () => {
    document.body.removeChild(overlay);
    const ids = [...checked];
    try {
      await Promise.all(mangaIds.map(mid => api.set_manga_categories({ mangaId: mid, categoryIds: ids })));
      showToast('Kategori disimpan');
      if (onDone) onDone();
    } catch (e) { showToast('Gagal: ' + e); }
  });
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

/**
 * Renders manga cards (grid or list).
 */
export function renderCards(filtered, readingMap, unreadMangaSet, selectMode, selectedIds) {
  const showUnread = parseInt(getPref('lib_show_unread_badge', '1'), 10) === 1;
  const showDownloaded = parseInt(getPref('lib_show_downloaded_badge', '1'), 10) === 1;
  const showNotify = parseInt(getPref('lib_show_notify_badge', '1'), 10) === 1;

  let html = '';
  if (state.libraryViewMode === 'comfortable' || state.libraryViewMode === 'compact') {
    const gridClass = state.libraryViewMode === 'compact' ? 'manga-grid compact' : 'manga-grid';
    html += `<div class="${gridClass}">`;
    filtered.forEach(fav => {
      const prog = readingMap[fav.manga_id];
      const isUnread = unreadMangaSet.has(fav.manga_id);
      const isSel = selectMode && selectedIds.has(fav.manga_id);
      const progText = prog ? `Lanjut Ch. ${prog.chapter_number}` : (fav.last_ch_num ? `Ch. ${fav.last_ch_num}` : 'Belum dibaca');
      
      let badges = '';
      if (showUnread && isUnread) badges += `<span class="grid-badge">BARU</span>`;
      if (showNotify && !fav.notify) badges += `<span class="grid-badge notify-off">${Icons.bellOff()}</span>`;
      if (showDownloaded && fav.downloaded_count > 0) badges += `<span class="grid-badge dl-badge" style="background:var(--cyan);color:#000;">${Icons.download()}</span>`;

      html += `
        <div class="grid-card click ${isSel ? 'grid-card--selected' : ''}" data-id="${fav.manga_id}">
          <img class="grid-cover" src="${coverUrl(fav.cover)}" loading="lazy" alt="${escapeHtml(fav.title)}" />
          ${badges}
          ${isSel ? `<div class="grid-sel-check">${Icons.checkSquare()}</div>` : ''}
          <div class="grid-overlay">
            <div class="grid-title">${escapeHtml(fav.title)}</div>
            <div class="grid-progress">
              <span>${progText}</span>
              ${showNotify && fav.notify ? `<span style="color:var(--accent);">${Icons.bell()}</span>` : ''}
            </div>
          </div>
        </div>`;
    });
    html += `</div>`;
  } else {
    filtered.forEach(fav => {
      const pred = fav.prediction;
      const prog = readingMap[fav.manga_id];
      const lastCh = fav.last_ch_num ? `Ch. ${fav.last_ch_num}` : 'Belum ada chapter';
      const progText = prog ? ` &bull; <b style="color:var(--cyan)">Lanjut Ch. ${prog.chapter_number}</b>` : '';
      const notifyIcon = fav.notify ? Icons.bell() : Icons.bellOff();
      const notifyClass = fav.notify ? '' : 'off';
      html += `
        <div class="card click" data-id="${fav.manga_id}">
          <img class="cover" src="${coverUrl(fav.cover)}" loading="lazy" alt="${escapeHtml(fav.title)}" />
          <div class="body">
            <div class="t">${escapeHtml(fav.title)}</div>
            <div class="s">Terbaru: ${lastCh}${progText}</div>
            ${formatPrediction(pred)}
          </div>
          ${showNotify ? `<button class="icon-btn ${notifyClass}" data-notify-id="${fav.manga_id}" title="Toggle Notifikasi" style="color: ${fav.notify ? 'var(--accent)' : 'var(--text-faint)'};">
            ${notifyIcon}
          </button>` : ''}
        </div>`;
    });
  }
  return html;
}

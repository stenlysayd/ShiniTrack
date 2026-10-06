import { navigate } from '../router.js';
import * as utils from '../utils.js';
import * as api from '../api.js';

const { setHeaderTitles, coverUrl, escapeHtml, showToast } = utils;
let isWorkerPaused = false;
let isEventListenerAttached = false;

const STATUS_CFG = {
  downloading: { icon: () => window.Icons.sync('spin'), label: 'Sedang mengunduh...' },
  paused: { icon: () => window.Icons.pause(), label: 'Dijeda' },
  error: { icon: () => window.Icons.alertTriangle(), label: 'Gagal mengunduh' },
  pending: { icon: () => window.Icons.clock(), label: 'Menunggu' },
};

function setupQueueListener() {
  if (isEventListenerAttached || !api.eventApi?.listen) return;
  isEventListenerAttached = true;

  api.eventApi.listen('queue-changed', () => {
    const hash = window.location.hash;
    if (hash.startsWith('#/more/downloads') || hash.startsWith('#/more/download-queue')) {
      renderDownloadQueue(false);
    }
  });

  api.eventApi.listen('download-progress', (e) => {
    const hash = window.location.hash;
    if (!hash.startsWith('#/more/downloads') && !hash.startsWith('#/more/download-queue')) return;
    const p = e.payload;
    if (!p?.chapter_id) return;

    const row = document.querySelector(`.queue-chapter-item[data-ch-id="${p.chapter_id}"]`);
    if (!row) return;

    const total = p.total || 0;
    const done = p.done || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const fill = row.querySelector('.queue-progress-fill');
    if (fill) fill.style.width = `${pct}%`;

    const statusText = row.querySelector('.queue-status-text');
    if (statusText) statusText.textContent = `${done}/${total} halaman`;

    if (total > 0 && done === total) {
      setTimeout(() => renderDownloadQueue(false), 500);
    }
  });
}

export async function renderDownloadQueue(showLoading = true) {
  setupQueueListener();
  setHeaderTitles('Antrean Unduhan', 'Unduhan Berjalan');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;

  if (showLoading) {
    viewEl.innerHTML = `<div class="empty"><div class="svg-icon spin">${window.Icons.sync()}</div><p style="margin-top:12px;">Memuat antrean unduhan...</p></div>`;
  }

  try {
    const [items, favs] = await Promise.all([
      api.queue_list().catch(() => []),
      api.list_favorites().catch(() => []),
    ]);

    if (!items || items.length === 0) {
      viewEl.innerHTML = `
        <div class="empty">
          <div class="svg-icon" style="color:var(--text-faint); margin-bottom:12px; transform:scale(1.5);">${window.Icons.download()}</div>
          <h3 style="margin-top:8px;">Antrean Kosong</h3>
          <p style="color:var(--text-muted); font-size:13px; max-width:320px;">Tidak ada bab komik dalam antrean unduhan saat ini.</p>
        </div>`;
      return;
    }

    const favMap = new Map();
    favs.forEach(f => favMap.set(f.manga_id, f));

    const groups = [];
    const groupMap = new Map();
    for (const item of items) {
      if (!groupMap.has(item.manga_id)) {
        const grp = { manga_id: item.manga_id, items: [] };
        groupMap.set(item.manga_id, grp);
        groups.push(grp);
      }
      groupMap.get(item.manga_id).items.push(item);
    }

    const anyDownloading = items.some(it => it.status === 'downloading');
    const allPaused = items.every(it => it.status === 'paused');
    if (allPaused) isWorkerPaused = true;
    else if (anyDownloading) isWorkerPaused = false;

    let html = `<div class="queue-container">`;

    for (const grp of groups) {
      const fav = favMap.get(grp.manga_id);
      const mangaTitle = fav?.title || grp.items[0]?.title || grp.manga_id;
      const mangaCover = fav?.cover ? coverUrl(fav.cover) : '';

      html += `
        <div class="queue-manga-group" data-manga-id="${grp.manga_id}">
          <div class="queue-manga-header" data-manga-id="${grp.manga_id}">
            ${mangaCover ? `<img class="queue-manga-cover" src="${mangaCover}" loading="lazy" alt="${escapeHtml(mangaTitle)}" />` : ''}
            <div class="queue-manga-meta">
              <div class="queue-manga-title">${escapeHtml(mangaTitle)}</div>
              <div class="queue-manga-count">${grp.items.length} bab dalam antrean</div>
            </div>
          </div>
          <div class="queue-chapter-list">
      `;

      for (const item of grp.items) {
        const st = STATUS_CFG[item.status] || STATUS_CFG.pending;
        html += `
          <div class="queue-chapter-item" data-ch-id="${item.chapter_id}" data-manga-id="${item.manga_id}">
            <div class="queue-drag-handle" aria-label="Geser urutan" title="Tahan dan geser untuk ubah urutan">${window.Icons.gripVertical()}</div>
            <div class="queue-status-icon queue-status-${item.status}">${st.icon()}</div>
            <div class="queue-chapter-info">
              <div class="queue-chapter-title">Bab ${item.chapter_number}</div>
              <div class="queue-status-text">${st.label}</div>
              <div class="queue-progress-bar">
                <div class="queue-progress-fill" style="width: ${item.status === 'downloading' ? '10%' : '0%'}"></div>
              </div>
            </div>
            <div class="queue-actions">
              <button class="icon-btn queue-menu-btn" data-ch-id="${item.chapter_id}" aria-label="Menu" title="Menu Opsi">${window.Icons.moreVertical()}</button>
              <div class="queue-dropdown-menu hidden" data-dropdown-id="${item.chapter_id}">
                <button class="queue-menu-item queue-btn-retry" data-ch-id="${item.chapter_id}">${window.Icons.refresh()} Coba lagi</button>
                <button class="queue-menu-item queue-btn-remove" data-ch-id="${item.chapter_id}">${window.Icons.trash()} Hapus</button>
              </div>
            </div>
          </div>
        `;
      }

      html += `</div></div>`;
    }

    html += `
      <button id="queue-fab-btn" class="queue-fab btn primary" aria-label="${isWorkerPaused ? 'Lanjut' : 'Jeda'}">
        <span class="queue-fab-icon">${isWorkerPaused ? window.Icons.play() : window.Icons.pause()}</span>
        <span class="queue-fab-label">${isWorkerPaused ? 'Lanjut' : 'Jeda'}</span>
      </button>
    </div>`;

    viewEl.innerHTML = html;

    viewEl.querySelectorAll('.queue-manga-header').forEach(header => {
      header.addEventListener('click', () => {
        if (header.dataset.mangaId) navigate(`#/manga/${header.dataset.mangaId}`);
      });
    });

    viewEl.querySelectorAll('.queue-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = viewEl.querySelector(`[data-dropdown-id="${btn.dataset.chId}"]`);
        const isClosed = dropdown?.classList.contains('hidden');
        viewEl.querySelectorAll('.queue-dropdown-menu').forEach(m => m.classList.add('hidden'));
        if (isClosed) dropdown?.classList.remove('hidden');
      });
    });

    viewEl.querySelectorAll('.queue-btn-retry').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api.queue_retry({ chapterId: btn.dataset.chId });
          showToast('Mengulang unduhan bab...');
          renderDownloadQueue(false);
        } catch (err) {
          showToast('Gagal mengulang unduhan: ' + err);
        }
      });
    });

    viewEl.querySelectorAll('.queue-btn-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api.queue_remove({ chapterId: btn.dataset.chId });
          showToast('Bab dihapus dari antrean');
          renderDownloadQueue(false);
        } catch (err) {
          showToast('Gagal menghapus dari antrean: ' + err);
        }
      });
    });

    const fabBtn = document.getElementById('queue-fab-btn');
    if (fabBtn) {
      fabBtn.addEventListener('click', async () => {
        fabBtn.disabled = true;
        try {
          if (isWorkerPaused) {
            await api.queue_resume({ chapterId: 'all' });
            isWorkerPaused = false;
            showToast('Antrean unduhan dilanjutkan');
          } else {
            await api.queue_pause({ chapterId: 'all' });
            isWorkerPaused = true;
            showToast('Antrean unduhan dijeda');
          }
          renderDownloadQueue(false);
        } catch (err) {
          showToast('Gagal mengubah status antrean: ' + err);
          fabBtn.disabled = false;
        }
      });
    }

    setupDragReorder(viewEl);

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        <div class="svg-icon" style="color:var(--bad); margin-bottom:12px; transform:scale(1.5);">${window.Icons.alertTriangle()}</div>
        <h3>Gagal Memuat Antrean</h3>
        <p style="color:var(--text-muted); font-size:13px;">${escapeHtml(String(err))}</p>
      </div>`;
  }
}

function setupDragReorder(viewEl) {
  let draggingItem = null;

  viewEl.querySelectorAll('.queue-drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const itemEl = handle.closest('.queue-chapter-item');
      if (!itemEl) return;

      draggingItem = itemEl;
      itemEl.classList.add('is-dragging');
      handle.setPointerCapture(e.pointerId);

      const onPointerMove = (moveEvent) => {
        if (!draggingItem) return;
        const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.queue-chapter-item');
        if (target && target !== draggingItem) {
          const rect = target.getBoundingClientRect();
          const isAfter = (moveEvent.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
          target.parentNode.insertBefore(draggingItem, isAfter ? target.nextSibling : target);
        }
      };

      const onPointerUp = async (upEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerUp);

        if (draggingItem) {
          draggingItem.classList.remove('is-dragging');
          draggingItem = null;

          const chapterIds = Array.from(viewEl.querySelectorAll('.queue-chapter-item')).map(el => el.dataset.chId);
          try {
            await api.queue_reorder({ chapterIds });
          } catch (err) {
            console.error('Failed to save queue reorder:', err);
            showToast('Gagal menyimpan urutan antrean');
          }
        }
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    });
  });
}

document.addEventListener('click', () => {
  document.querySelectorAll('.queue-dropdown-menu').forEach(m => m.classList.add('hidden'));
});

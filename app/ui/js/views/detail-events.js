import { navigate } from '../router.js';
import * as utils from '../utils.js';
import * as api from '../api.js';
import { mangaDetailState, updateDetailState, renderMangaDetail } from './detail.js';
import { showCategoryAssignDialog } from './library-helpers.js';

const { showToast } = utils;
const viewEl = document.getElementById('view');

function shinigamiSiteUrl(mangaId) {
  // Manga has no canonical site URL field; this mirrors Shinigami's public series route by id.
  return `https://shinigami.id/series/${encodeURIComponent(mangaId)}`;
}

export function attachDetailEvents(mangaId, detail, chapters, progress, chRes = { items: [] }, readSet = new Set(), downloadedSet = new Set()) {
    const descBox = document.getElementById('desc-box');
    if (descBox) descBox.addEventListener('click', () => descBox.classList.toggle('open'));

    // Toolbar download menu dropdown
    const dlMenuBtn = document.getElementById('ch-dl-menu-btn');
    const dlDropdown = document.getElementById('ch-dl-dropdown');
    if (dlMenuBtn && dlDropdown) {
      dlMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dlDropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', () => dlDropdown.classList.add('hidden'));

      dlDropdown.querySelectorAll('.queue-menu-item').forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          dlDropdown.classList.add('hidden');
          const countType = item.dataset.dlCount;

          const unreadCandidates = [...chRes.items]
            .filter(c => !readSet.has(c.chapter_id) && !downloadedSet.has(c.chapter_id))
            .sort((a, b) => a.chapter_number - b.chapter_number);

          const targetChapters = countType === 'all'
            ? unreadCandidates
            : unreadCandidates.slice(0, parseInt(countType, 10) || 1);

          if (targetChapters.length === 0) {
            showToast('Tidak ada chapter belum dibaca untuk diunduh');
            return;
          }

          let added = 0;
          for (const ch of targetChapters) {
            try {
              await api.queue_add({ mangaId, chapterId: ch.chapter_id, title: ch.chapter_title || '', chapterNumber: ch.chapter_number });
              added++;
            } catch (err) {
              console.warn('Queue add err:', err);
            }
          }
          showToast(`${added} chapter ditambahkan ke antrean`);
        });
      });
    }

    // Favorite toggle
    const favBtn = document.getElementById('det-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', async () => {
        try {
          if (detail.favorite) {
            await api.remove_favorite({ mangaId });
            showToast('Dihapus dari pustaka');
            renderMangaDetail(mangaId);
          } else {
            await api.add_favorite({ mangaId });
            showToast('Ditambahkan ke pustaka');
            const cats = await api.category_list().catch(() => []);
            if (cats.length) {
              const mangaCats = await api.get_manga_categories({ mangaId }).catch(() => []);
              showCategoryAssignDialog([mangaId], cats, { [mangaId]: mangaCats }, () => {
                showToast('Kategori disimpan');
                renderMangaDetail(mangaId);
              });
            } else {
              renderMangaDetail(mangaId);
            }
          }
        } catch (e) {
          showToast(`Error: ${e}`);
        }
      });
    }

    // Category assign button (when favorited)
    const catBtn = document.getElementById('det-cat-btn');
    if (catBtn) {
      catBtn.addEventListener('click', async () => {
        try {
          const cats = await api.category_list().catch(() => []);
          if (!cats.length) {
            showToast('Belum ada kategori kustom. Buat di menu Lainnya > Kategori');
            return;
          }
          const mangaCats = await api.get_manga_categories({ mangaId }).catch(() => []);
          showCategoryAssignDialog([mangaId], cats, { [mangaId]: mangaCats }, () => {
            showToast('Kategori disimpan');
            renderMangaDetail(mangaId);
          });
        } catch (e) {
          showToast(`Error: ${e}`);
        }
      });
    }

    const openSiteBtn = document.getElementById('det-open-site-btn');
    if (openSiteBtn) {
      openSiteBtn.addEventListener('click', () => window.open(shinigamiSiteUrl(detail.manga.manga_id), '_blank'));
    }

    // Sticky "Lanjut" / "Mulai" button
    const stickyResumeBtn = document.getElementById('sticky-resume-btn');
    if (stickyResumeBtn && stickyResumeBtn.dataset.chId) {
      stickyResumeBtn.addEventListener('click', () => navigate(`#/read/${stickyResumeBtn.dataset.chId}`));
    }

    // Sort button
    const sortBtn = document.getElementById('ch-sort-btn');
    if (sortBtn) {
      sortBtn.addEventListener('click', () => {
        updateDetailState({ sortAsc: !mangaDetailState.sortAsc });
        renderMangaDetail(mangaId);
      });
    }

    // Filter button: all -> unread -> downloaded -> all
    const filterBtn = document.getElementById('ch-filter-btn');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        let newFilter = 'all';
        if (mangaDetailState.filter === 'all') newFilter = 'unread';
        else if (mangaDetailState.filter === 'unread') newFilter = 'downloaded';
        updateDetailState({ filter: newFilter });
        renderMangaDetail(mangaId);
      });
    }

    // Batch mode toggle button
    const batchBtn = document.getElementById('ch-batch-btn');
    if (batchBtn) {
      batchBtn.addEventListener('click', () => {
        updateDetailState({ batchMode: !mangaDetailState.batchMode, selectedChapters: new Set() });
        renderMangaDetail(mangaId);
      });
    }

    // Chapter row clicks
    viewEl.querySelectorAll('.chapter').forEach(row => {
      const chId = row.dataset.chId;

      if (mangaDetailState.batchMode) {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.dl-btn') || e.target.closest('.chapter-bookmark-btn')) return;
          const newSelected = new Set(mangaDetailState.selectedChapters);
          if (newSelected.has(chId)) newSelected.delete(chId);
          else newSelected.add(chId);
          updateDetailState({ selectedChapters: newSelected });
          
          const box = row.querySelector('.chapter-select-box');
          const isSelected = newSelected.has(chId);
          if (box) {
            box.classList.toggle('selected', isSelected);
            box.innerHTML = isSelected ? Icons.checkSquare() : Icons.square();
          }
          const countEl = document.getElementById('batch-count-text');
          if (countEl) countEl.textContent = `${newSelected.size} dipilih`;
        });
      } else {
        // Normal mode: click text opens chapter
        const nEl = row.querySelector('.n');
        if (nEl) nEl.addEventListener('click', () => navigate(`#/read/${chId}`));
      }
    });

    // Single-click fast read toggle button
    viewEl.querySelectorAll('.ch-read-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chId = btn.dataset.chId;
        const chNum = parseFloat(btn.dataset.chNum);
        const isRead = btn.classList.contains('is-read');
        const nextState = !isRead;

        try {
          await api.mark_chapter_read({ mangaId, chapterId: chId, chapterNumber: chNum, read: nextState });
          btn.classList.toggle('is-read', nextState);
          btn.innerHTML = nextState ? Icons.check() : Icons.square();
          btn.closest('.chapter').classList.toggle('read', nextState);
          const readDot = btn.closest('.chapter-read-dot');
          if (readDot) readDot.classList.toggle('is-read', nextState);
          showToast(nextState ? `Chapter ${chNum} ditandai dibaca` : `Chapter ${chNum} ditandai belum dibaca`);
        } catch (err) {
          showToast(`Error: ${err}`);
        }
      });
    });

    // Single-click chapter bookmark toggle button
    viewEl.querySelectorAll('.chapter-bookmark-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chId = btn.dataset.chId;
        const chNum = parseFloat(btn.dataset.chNum);
        const isActive = btn.classList.contains('active');
        const nextState = !isActive;

        try {
          await api.set_chapter_bookmark({ mangaId, chapterId: chId, chapterNumber: chNum, bookmarked: nextState });
          btn.classList.toggle('active', nextState);
          btn.innerHTML = Icons.bookmark('', nextState);
          btn.title = nextState ? 'Hapus Bookmark' : 'Bookmark';
          showToast(nextState ? `Chapter ${chNum} ditandai bookmark` : `Bookmark Chapter ${chNum} dihapus`);
        } catch (err) {
          showToast(`Error: ${err}`);
        }
      });
    });

    // Batch actions
    if (mangaDetailState.batchMode) {
      document.getElementById('batch-all-btn').addEventListener('click', () => {
        const allSelected = mangaDetailState.selectedChapters.size === chapters.length;
        const newSelected = new Set();
        if (!allSelected) chapters.forEach(c => newSelected.add(c.chapter_id));
        updateDetailState({ selectedChapters: newSelected });
        renderMangaDetail(mangaId);
      });

      const applyBatchRead = async (read) => {
        if (mangaDetailState.selectedChapters.size === 0) {
          showToast('Pilih minimal satu chapter');
          return;
        }
        const toMark = chapters.filter(c => mangaDetailState.selectedChapters.has(c.chapter_id)).map(c => [c.chapter_id, c.chapter_number]);
        try {
          await api.mark_chapters_batch({ mangaId, chapters: toMark, read });
          showToast(`${toMark.length} chapter ditandai ${read ? 'dibaca' : 'belum dibaca'}`);
          updateDetailState({ batchMode: false, selectedChapters: new Set() });
          renderMangaDetail(mangaId);
        } catch (err) {
          showToast(`Error: ${err}`);
        }
      };

      document.getElementById('batch-mark-read').addEventListener('click', () => applyBatchRead(true));
      document.getElementById('batch-mark-unread').addEventListener('click', () => applyBatchRead(false));

      const batchDlBtn = document.getElementById('batch-download-btn');
      if (batchDlBtn) {
        batchDlBtn.addEventListener('click', async () => {
          if (mangaDetailState.selectedChapters.size === 0) {
            showToast('Pilih minimal satu chapter');
            return;
          }
          const toQueue = chapters.filter(c => mangaDetailState.selectedChapters.has(c.chapter_id));
          let count = 0;
          for (const ch of toQueue) {
            try {
              await api.queue_add({ mangaId, chapterId: ch.chapter_id, title: ch.chapter_title || '', chapterNumber: ch.chapter_number });
              count++;
            } catch (e) {
              console.warn('Queue add batch err:', e);
            }
          }
          showToast(`${count} chapter ditambahkan ke antrean`);
          updateDetailState({ batchMode: false, selectedChapters: new Set() });
          renderMangaDetail(mangaId);
        });
      }
    }

    // Download button handler (adds to download queue)
    viewEl.querySelectorAll('.dl-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chId = btn.dataset.chId;

        if (btn.innerHTML.includes('Hapus')) {
          try {
            await api.delete_download({ chapterId: chId });
            btn.innerHTML = `${Icons.download()} Unduh`;
            const dlStateEl = btn.closest('.chapter')?.querySelector('.chapter-download-state');
            if (dlStateEl) dlStateEl.remove();
            showToast('Download chapter dihapus');
          } catch (err) {
            showToast(`Gagal hapus: ${err}`);
          }
        } else {
          const chObj = chapters.find(c => c.chapter_id === chId);
          const chNum = chObj ? chObj.chapter_number : 0;
          const chTitle = chObj?.chapter_title || '';
          try {
            await api.queue_add({ mangaId, chapterId: chId, title: chTitle, chapterNumber: chNum });
            showToast('Ditambahkan ke antrean');
          } catch (err) {
            showToast(`Gagal menambahkan ke antrean: ${err}`);
          }
        }
      });
    });
}

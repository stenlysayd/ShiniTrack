import { state, getPref, setPref, normalizeReaderMode } from '../state.js';
import { navigate } from '../router.js';
import * as api from '../api.js';
import * as utils from '../utils.js';
import { renderPagedMode, renderTransitionHtml, attachTransitionEvents } from './reader-paged.js';
import { motion } from '../motion.js';

const { setHeaderTitles, showToast, pageUrl } = utils;
const viewEl = document.getElementById('view');
let activeReaderCleanup = null;

function getModeLabel() {
  if (state.readerMode === 'paged-ltr') return 'Paged L-R';
  if (state.readerMode === 'paged-rtl') return 'Manga R-L';
  return 'Webtoon';
}

export async function renderReader(chapterId) {
  if (activeReaderCleanup) { activeReaderCleanup(); activeReaderCleanup = null; }
  setHeaderTitles('Membaca', 'Memuat Chapter...');
  viewEl.innerHTML = `<div class="empty"><div class="svg-icon spin">${Icons.sync()}</div><p style="margin-top:12px;">Menyiapkan halaman...</p></div>`;

  try {
    const data = await api.open_chapter({ chapterId });
    if (getPref('reader.keep_awake', '1') === '1') api.set_keep_awake({ keep: true }).catch(() => {});
    setHeaderTitles(`Ch. ${data.chapter_number}`, data.offline ? 'Mode Offline' : 'Mode Online');

    const pos = { idx: 0 }, totalPages = data.pages.length;
    let pagedCtx = null;
    const mangaDetail = await api.manga_detail({ mangaId: data.manga_id }).catch(() => null);
    const mangaTitle = mangaDetail?.manga?.title || '';
    const bookmarkedIds = await api.list_bookmarked_chapters({ mangaId: data.manga_id }).catch(() => new Set());
    let isBookmarked = new Set(bookmarkedIds || []).has(data.chapter_id);

    // Resolve per-manga reading mode (Task 6.9)
    state.readerMode = normalizeReaderMode(getPref(`reader.mode.${data.manga_id}`) || getPref('reader.mode') || localStorage.getItem('shinitrack_reader_mode') || 'webtoon');

    let curOrientation = getPref('reader.orientation', 'free'), curRotation = getPref('reader.rotation', '0'), curCrop = getPref('reader.crop_borders', '0');
    const showPageNumber = getPref('reader.page_number', '1') !== '0', autoNext = getPref('reader.auto_next', '1') !== '0';
    const preloadPref = parseInt(getPref('reader.preload', '4'), 10), preloadCount = isNaN(preloadPref) ? 4 : preloadPref;
    const orientLabels = { free: 'Bebas', portrait: 'Potret', landscape: 'Lansekap' };

    // Next-chapter preload in background (Task 6.8)
    if (preloadCount > 0 && data.next_chapter_id) {
      api.open_chapter({ chapterId: data.next_chapter_id }).then(n => {
        n?.pages?.slice(0, preloadCount).forEach(f => { const img = new Image(); img.src = pageUrl(n.chapter_id, f); });
      }).catch(() => {});
    }

    const prevProg = await api.get_reading_progress({ mangaId: data.manga_id }).catch(() => null);
    const baseDuration = (prevProg && prevProg.chapter_id === data.chapter_id) ? (prevProg.read_duration || 0) : 0;
    let curPage = (prevProg && prevProg.chapter_id === data.chapter_id && prevProg.last_page > 0) ? prevProg.last_page : 0;
    if (curPage >= totalPages - 1) {
      curPage = 0;
    }
    let activeMs = 0, lastTick = Date.now(), isTabVisible = !document.hidden;

    const isIncognito = () => getPref('privacy.incognito', '0') === '1';

    function getElapsedSec() {
      if (isTabVisible) { const now = Date.now(); activeMs += (now - lastTick); lastTick = now; }
      return baseDuration + Math.floor(activeMs / 1000);
    }
    function saveProgress(pageIdx) {
      if (typeof pageIdx === 'number') curPage = pageIdx;
      if (isIncognito()) return;
      api.save_reading_progress({
        mangaId: data.manga_id,
        chapterId: data.chapter_id,
        chapterNumber: data.chapter_number,
        lastPage: curPage,
        readDuration: getElapsedSec(),
      }).catch(() => {});
    }

    const onVisChange = () => {
      if (document.hidden) {
        if (isTabVisible) activeMs += (Date.now() - lastTick);
        isTabVisible = false;
        saveProgress();
      } else { lastTick = Date.now(); isTabVisible = true; }
    };
    document.addEventListener('visibilitychange', onVisChange);
    const saveTimer = setInterval(() => saveProgress(), 5000);

    activeReaderCleanup = () => {
      clearInterval(saveTimer);
      document.removeEventListener('visibilitychange', onVisChange);
      saveProgress();
    };
    saveProgress(curPage);

    viewEl.innerHTML = `
      <div class="reader-wrapper" data-rotation="${curRotation}">
        <div id="reader-hud-top" class="reader-hud-top">
          <button id="reader-back" class="icon-btn" aria-label="Kembali" title="Kembali">${Icons.back()}</button>
          <div style="flex:1; min-width:0; overflow:hidden;">
            <div style="font-weight:700; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#fff;">${utils.escapeHtml(mangaTitle || `Chapter ${data.chapter_number}`)}</div>
            <div style="font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Chapter ${data.chapter_number} &bull; ${totalPages} Halaman ${data.offline ? '&bull; Offline' : ''} <span id="reader-incognito-badge" class="incog-pill ${isIncognito() ? '' : 'hidden'}">Penyamaran</span></div>
          </div>
          <button id="reader-bookmark-btn" class="icon-btn reader-bookmark-btn ${isBookmarked ? 'active' : ''}" aria-label="Bookmark" title="${isBookmarked ? 'Hapus Bookmark' : 'Bookmark'}">${Icons.bookmark('', isBookmarked)}</button>
          <button id="reader-menu-btn" class="icon-btn" aria-label="Menu" title="Menu">${Icons.moreVertical()}</button>
          <div id="reader-menu-dropdown" class="reader-dropdown-menu hidden">
            <button id="reader-menu-detail" class="reader-dropdown-item">${Icons.info()} Info Komik</button>
            <button id="reader-menu-settings" class="reader-dropdown-item">${Icons.settings()} Pengaturan Pembaca</button>
          </div>
        </div>
        <div id="reader-content"></div>
        <div id="reader-scrubber" class="reader-vertical-scrubber">
          <div class="scrubber-track" id="scrubber-track"><div class="scrubber-thumb" id="scrubber-thumb"><span class="scrubber-bubble" id="scrubber-bubble">1</span></div></div>
        </div>
        <div id="reader-page-overlay" class="reader-page-overlay ${showPageNumber ? '' : 'hidden'}">1 / ${totalPages}</div>
        <div id="reader-hud-bottom" class="reader-hud-bottom">
          <div class="hud-nav-row">
            <button id="reader-prev-ch" class="icon-btn" ${!data.prev_chapter_id ? 'disabled' : ''} title="Chapter Sebelumnya">${Icons.back()}</button>
            <div class="hud-slider-pill">
              <span id="hud-page-pill" class="hud-page-pill">${curPage + 1} / ${totalPages}</span>
              <input type="range" id="hud-page-slider" class="hud-page-slider" min="1" max="${totalPages}" value="${curPage + 1}" />
            </div>
            <button id="reader-next-ch" class="icon-btn" ${!data.next_chapter_id ? 'disabled' : ''} title="Chapter Selanjutnya">${Icons.chevronRight()}</button>
          </div>
          <div class="hud-controls-toolbar">
            <button id="reader-orientation-btn" class="hud-tool-btn" title="Orientasi">${Icons.orientation()}<span id="orient-label">${orientLabels[curOrientation] || 'Bebas'}</span></button>
            <button id="reader-rotate-btn" class="hud-tool-btn" title="Putar">${Icons.rotate()}<span id="rotate-label">${curRotation === '0' ? 'Putar' : curRotation + '°'}</span></button>
            <button id="reader-crop-btn" class="hud-tool-btn ${curCrop === '1' ? 'active' : ''}" title="Potong Tepi">${Icons.crop()}<span>Potong</span></button>
            <button id="reader-mode-btn" class="hud-tool-btn" title="Mode Membaca">${state.readerMode === 'webtoon' ? Icons.scroll() : Icons.book()}<span id="mode-label">${getModeLabel()}</span></button>
            <button id="reader-settings-btn" class="hud-tool-btn" title="Pengaturan">${Icons.settings()}<span>Atur</span></button>
          </div>
        </div>
      </div>
    `;

    const wrapper = viewEl.querySelector('.reader-wrapper'), contentEl = document.getElementById('reader-content');
    const hudTop = document.getElementById('reader-hud-top'), hudBottom = document.getElementById('reader-hud-bottom');
    const scrubberEl = document.getElementById('reader-scrubber'), scrubberTrack = document.getElementById('scrubber-track');
    const scrubberThumb = document.getElementById('scrubber-thumb'), scrubberBubble = document.getElementById('scrubber-bubble');
    const pagePill = document.getElementById('hud-page-pill'), pageOverlay = document.getElementById('reader-page-overlay');
    const pageSlider = document.getElementById('hud-page-slider');

    function applyReaderStyles() {
      if (!wrapper) return;
      wrapper.dataset.rotation = curRotation;
      wrapper.classList.toggle('crop-borders', curCrop === '1');
      wrapper.classList.toggle('orientation-landscape', curOrientation === 'landscape');
    }
    applyReaderStyles();

    function updateScrubber(p) {
      const page = Math.max(1, Math.min(p, totalPages));
      curPage = page - 1;
      const percent = totalPages > 1 ? ((page - 1) / (totalPages - 1)) * 100 : 0;
      if (scrubberThumb) scrubberThumb.style.top = `${percent}%`;
      if (scrubberBubble) scrubberBubble.textContent = `${page}`;
      if (pagePill) pagePill.textContent = `${page} / ${totalPages}`;
      if (pageSlider && parseInt(pageSlider.value, 10) !== page) pageSlider.value = page;
      if (pageOverlay) pageOverlay.textContent = `${page} / ${totalPages}`;
    }

    if (pageSlider) {
      pageSlider.addEventListener('input', (e) => {
        jumpToPage(parseInt(e.target.value, 10));
      });
    }

    function jumpToPage(p) {
      const page = Math.max(1, Math.min(p, totalPages));
      if (state.readerMode === 'webtoon') {
        contentEl.querySelector(`img[data-page="${page}"]`)?.scrollIntoView();
      } else if (pagedCtx && typeof pagedCtx.jumpToPage === 'function') {
        pagedCtx.jumpToPage(page);
      }
      updateScrubber(page);
      saveProgress(page - 1);
    }

    let hudVisible = true;
    function setHudVisibility(visible) {
      hudVisible = visible;
      motion.hud(hudTop, visible, true);
      motion.hud(hudBottom, visible, false);
      scrubberEl?.classList.toggle('hud-hidden', !visible);
    }

    function markChapterCompleted() {
      if (isIncognito()) return;
      api.mark_chapter_read({ mangaId: data.manga_id, chapterId: data.chapter_id, chapterNumber: data.chapter_number, read: true }).catch(() => {});
    }

    function renderModeView() {
      if (state.readerMode === 'webtoon') {
        let scrollHtml = `<div class="reader-scroll">` + data.pages.map((file, idx) => `
          <img src="${pageUrl(data.chapter_id, file)}" ${idx < 3 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} class="reader-page-img" onload="this.classList.add('loaded')" data-page="${idx + 1}" alt="Page ${idx + 1}" />
        `).join('') + renderTransitionHtml({ data, autoNext, isPaged: false }) + `</div>`;
        contentEl.innerHTML = scrollHtml;
        attachTransitionEvents(contentEl, {
          data,
          onReplay: () => { window.scrollTo({ top: 0, behavior: 'smooth' }); updateScrubber(1); }
        });
        contentEl.querySelectorAll('.reader-scroll img').forEach(img => {
          img.addEventListener('click', () => setHudVisibility(!hudVisible));
        });
        window.onscroll = () => {
          const imgs = contentEl.querySelectorAll('img[data-page]');
          let cur = 1;
          for (let img of imgs) {
            const rect = img.getBoundingClientRect();
            if (rect.top <= window.innerHeight * 0.5 && rect.bottom >= 0) cur = parseInt(img.dataset.page, 10);
          }
          updateScrubber(cur);
          if (cur >= totalPages && window.scrollY > 200) markChapterCompleted();
          saveProgress(cur - 1);
        };
        if (curPage > 0) {
          setTimeout(() => jumpToPage(curPage + 1), 60);
        } else {
          window.scrollTo(0, 0);
        }
      } else {
        pagedCtx = { data, totalPages, contentEl, updateScrubber: (p) => { updateScrubber(p); saveProgress(p - 1); }, pos, markChapterCompleted, toggleHud: () => setHudVisibility(!hudVisible), autoNext };
        renderPagedMode(pagedCtx);
      }
      updateScrubber(curPage + 1);
    }
    renderModeView();

    // Vertical Scrubber dragging & jumping
    if (scrubberEl && scrubberTrack) {
      let isDragging = false;
      const onMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const rect = scrubberTrack.getBoundingClientRect();
        if (rect.height <= 0) return;
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        const ratio = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
        jumpToPage(Math.max(1, Math.min(totalPages, Math.round(ratio * (totalPages - 1)) + 1)));
      };
      const onEnd = () => { isDragging = false; scrubberEl.classList.remove('active'); };
      scrubberEl.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); isDragging = true; scrubberEl.classList.add('active');
        scrubberEl.setPointerCapture?.(e.pointerId); onMove(e);
      });
      scrubberEl.addEventListener('pointermove', onMove);
      ['pointerup', 'pointercancel'].forEach(ev => scrubberEl.addEventListener(ev, onEnd));
    }

    document.getElementById('reader-back').addEventListener('click', () => window.history.back());
    document.getElementById('reader-bookmark-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const nextState = !isBookmarked;
      try {
        await api.set_chapter_bookmark({ mangaId: data.manga_id, chapterId: data.chapter_id, chapterNumber: data.chapter_number, bookmarked: nextState });
        isBookmarked = nextState;
        const bBtn = document.getElementById('reader-bookmark-btn');
        bBtn?.classList.toggle('active', nextState);
        if (bBtn) { bBtn.innerHTML = Icons.bookmark('', nextState); bBtn.title = nextState ? 'Hapus Bookmark' : 'Bookmark'; }
        showToast(nextState ? `Chapter ${data.chapter_number} ditandai bookmark` : `Bookmark Chapter ${data.chapter_number} dihapus`);
      } catch (err) { showToast(`Error: ${err}`); }
    });

    const menuBtn = document.getElementById('reader-menu-btn'), menuDropdown = document.getElementById('reader-menu-dropdown');
    if (menuBtn && menuDropdown) {
      menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menuDropdown.classList.toggle('hidden'); });
      document.addEventListener('click', () => menuDropdown.classList.add('hidden'));
      document.getElementById('reader-menu-detail')?.addEventListener('click', () => navigate(`#/manga/${data.manga_id}`));
      document.getElementById('reader-menu-settings')?.addEventListener('click', () => navigate('#/more/settings/pembaca'));
    }

    document.getElementById('reader-prev-ch')?.addEventListener('click', () => { if (data.prev_chapter_id) navigate(`#/read/${data.prev_chapter_id}`); });
    document.getElementById('reader-next-ch')?.addEventListener('click', () => { if (data.next_chapter_id) navigate(`#/read/${data.next_chapter_id}`); });

    document.getElementById('reader-orientation-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      curOrientation = ['free', 'portrait', 'landscape'][(['free', 'portrait', 'landscape'].indexOf(curOrientation) + 1) % 3];
      await setPref('reader.orientation', curOrientation);
      document.getElementById('orient-label').textContent = orientLabels[curOrientation];
      showToast(`Orientasi: ${orientLabels[curOrientation]}`);
      applyReaderStyles();
    });
    document.getElementById('reader-rotate-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      curRotation = ['0', '90', '180', '270'][(['0', '90', '180', '270'].indexOf(curRotation) + 1) % 4];
      await setPref('reader.rotation', curRotation);
      document.getElementById('rotate-label').textContent = curRotation === '0' ? 'Putar' : `${curRotation}°`;
      showToast(`Rotasi: ${curRotation}°`);
      applyReaderStyles();
    });
    document.getElementById('reader-crop-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      curCrop = curCrop === '1' ? '0' : '1';
      await setPref('reader.crop_borders', curCrop);
      document.getElementById('reader-crop-btn')?.classList.toggle('active', curCrop === '1');
      showToast(`Potong tepi: ${curCrop === '1' ? 'Aktif' : 'Nonaktif'}`);
      applyReaderStyles();
    });

    document.getElementById('reader-mode-btn')?.addEventListener('click', async () => {
      state.readerMode = state.readerMode === 'webtoon' ? 'paged-ltr' : (state.readerMode === 'paged-ltr' ? 'paged-rtl' : 'webtoon');
      await setPref(`reader.mode.${data.manga_id}`, state.readerMode);
      localStorage.setItem('shinitrack_reader_mode', state.readerMode);
      const modeBtn = document.getElementById('reader-mode-btn');
      if (modeBtn) modeBtn.innerHTML = `${state.readerMode === 'webtoon' ? Icons.scroll() : Icons.book()}<span id="mode-label">${getModeLabel()}</span>`;
      showToast(`Mode: ${getModeLabel()}`);
      renderModeView();
    });

    document.getElementById('reader-settings-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate('#/more/settings/pembaca');
    });

    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">${Icons.alertTriangle()}<h3>Gagal Memuat Chapter</h3><p>${err}</p><button class="btn primary small" onclick="window.history.back()">Kembali</button></div>`;
  }
}

export function cleanupReader() {
  if (activeReaderCleanup) { activeReaderCleanup(); activeReaderCleanup = null; }
  window.onscroll = null;
  api.set_keep_awake({ keep: false }).catch(() => {});
  document.body.classList.remove('reader-active');
}

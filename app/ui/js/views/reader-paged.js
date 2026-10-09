import { state } from '../state.js';
import { navigate } from '../router.js';
import * as api from '../api.js';
import * as utils from '../utils.js';

const { showToast, pageUrl } = utils;

export function renderTransitionHtml({ data, autoNext = true, isPaged = false }) {
  const nextBtnClass = autoNext ? 'btn primary transition-btn-next' : 'btn transition-btn-next';
  const hasNext = Boolean(data.next_chapter_id);
  const hasPrev = Boolean(data.prev_chapter_id);

  return `
    <div class="reader-transition-page ${isPaged ? 'is-paged' : ''}">
      <div class="transition-card">
        <div class="transition-icon-wrap">
          ${Icons.check()}
        </div>
        <div class="transition-title">Chapter ${data.chapter_number} Selesai</div>
        <div class="transition-subtitle">
          ${hasNext ? 'Lanjut ke chapter berikutnya?' : 'Kamu telah mencapai chapter terbaru.'}
        </div>
        <div class="transition-actions">
          ${hasNext ? `<button class="${nextBtnClass}" id="trans-next-btn">${Icons.play()} Lanjut Chapter Selanjutnya</button>` : ''}
          <div class="transition-secondary-actions">
            <button class="btn small" id="trans-replay-btn">${Icons.sync()} Baca Ulang</button>
            ${hasPrev ? `<button class="btn small" id="trans-prev-btn">${Icons.back()} Chapter Sebelumnya</button>` : ''}
            <button class="btn small" id="trans-detail-btn">${Icons.info()} Info Komik</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function attachTransitionEvents(container, { data, onReplay }) {
  container.querySelector('#trans-next-btn')?.addEventListener('click', () => {
    if (data.next_chapter_id) navigate(`#/read/${data.next_chapter_id}`);
  });
  container.querySelector('#trans-prev-btn')?.addEventListener('click', () => {
    if (data.prev_chapter_id) navigate(`#/read/${data.prev_chapter_id}`);
  });
  container.querySelector('#trans-detail-btn')?.addEventListener('click', () => {
    navigate(`#/manga/${data.manga_id}`);
  });
  container.querySelector('#trans-replay-btn')?.addEventListener('click', () => {
    if (typeof onReplay === 'function') onReplay();
  });
}

// ctx: { data, totalPages, contentEl, updateScrubber, pos, markChapterCompleted, toggleHud, autoNext }
// pos.idx is shared with the scrubber in reader.js.
export function renderPagedMode(ctx) {
  const { data, totalPages, contentEl, updateScrubber, pos, markChapterCompleted, toggleHud, autoNext = true } = ctx;

  window.onscroll = null;
  function showPagedImage(idx) {
    if (idx >= totalPages) {
      // Show End of Chapter Screen
      markChapterCompleted();
      contentEl.innerHTML = renderTransitionHtml({ data, autoNext, isPaged: true });
      attachTransitionEvents(contentEl, {
        data,
        onReplay: () => showPagedImage(0)
      });
      return;
    }

    pos.idx = Math.max(0, Math.min(idx, totalPages - 1));
    if (updateScrubber) updateScrubber(pos.idx + 1);

    if (pos.idx === totalPages - 1) {
      markChapterCompleted();
    }

    const file = data.pages[pos.idx];
    contentEl.innerHTML = `
      <div class="reader-paged">
        <div class="reader-tap-left" id="tap-left"></div>
        <div class="reader-tap-center" id="tap-center"></div>
        <div class="reader-tap-right" id="tap-right"></div>
        <img src="${pageUrl(data.chapter_id, file)}" alt="Page ${pos.idx + 1}" />
      </div>
    `;

    const isRTL = state.readerMode === 'paged-rtl';

    document.getElementById('tap-left').addEventListener('click', () => {
      if (Date.now() - lastSwipeTime < 300) return;
      if (isRTL) {
        // RTL: left tap = NEXT page
        showPagedImage(pos.idx + 1);
      } else {
        // LTR: left tap = PREV page
        if (pos.idx > 0) showPagedImage(pos.idx - 1);
        else if (data.prev_chapter_id) navigate(`#/read/${data.prev_chapter_id}`);
        else showToast('Halaman pertama');
      }
    });

    document.getElementById('tap-center').addEventListener('click', () => {
      if (Date.now() - lastSwipeTime < 300) return;
      toggleHud();
    });

    document.getElementById('tap-right').addEventListener('click', () => {
      if (Date.now() - lastSwipeTime < 300) return;
      if (isRTL) {
        // RTL: right tap = PREV page
        if (pos.idx > 0) showPagedImage(pos.idx - 1);
        else if (data.prev_chapter_id) navigate(`#/read/${data.prev_chapter_id}`);
        else showToast('Halaman pertama');
      } else {
        // LTR: right tap = NEXT page
        showPagedImage(pos.idx + 1);
      }
    });

    // Save reading progress
    api.save_reading_progress({ mangaId: data.manga_id, chapterId: data.chapter_id, chapterNumber: data.chapter_number, lastPage: pos.idx }).catch(() => {});
  }

  // T11: Swipe handling with Android edge gesture exclusion
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwipeIgnored = false;
  let lastSwipeTime = 0;

  const onTouchStart = (e) => {
    const touch = e.touches ? e.touches[0] : e;
    const clientX = touch.clientX;
    const clientY = touch.clientY;

    // Abaikan jika clientX < 24 atau clientX > window.innerWidth - 24
    if (clientX < 24 || clientX > window.innerWidth - 24) {
      isSwipeIgnored = true;
      return;
    }

    isSwipeIgnored = false;
    touchStartX = clientX;
    touchStartY = clientY;
  };

  const onTouchEnd = (e) => {
    if (isSwipeIgnored) return;
    const touch = e.changedTouches ? e.changedTouches[0] : e;
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      lastSwipeTime = Date.now();
      const isRTL = state.readerMode === 'paged-rtl';
      if (deltaX < 0) {
        // Swipe left -> Next in LTR, Prev in RTL
        if (isRTL) {
          if (pos.idx > 0) showPagedImage(pos.idx - 1);
          else if (data.prev_chapter_id) navigate(`#/read/${data.prev_chapter_id}`);
        } else {
          showPagedImage(pos.idx + 1);
        }
      } else {
        // Swipe right -> Prev in LTR, Next in RTL
        if (isRTL) {
          showPagedImage(pos.idx + 1);
        } else {
          if (pos.idx > 0) showPagedImage(pos.idx - 1);
          else if (data.prev_chapter_id) navigate(`#/read/${data.prev_chapter_id}`);
        }
      }
    }
  };

  contentEl.addEventListener('touchstart', onTouchStart, { passive: true });
  contentEl.addEventListener('touchend', onTouchEnd, { passive: true });

  ctx.jumpToPage = (p) => showPagedImage(p - 1);
  showPagedImage(0);
}

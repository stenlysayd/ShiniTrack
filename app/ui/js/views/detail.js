import { navigate } from '../router.js';
import { getPref } from '../state.js';
import * as utils from '../utils.js';
import * as api from '../api.js';
import { attachDetailEvents } from './detail-events.js';

const { setHeaderTitles, coverUrl, formatPrediction } = utils;
const viewEl = document.getElementById('view');

function mangaStatusText(status) {
  if (status === null || status === undefined || status === '') return null;
  return `Status ${utils.escapeHtml(status)}`;
}

export let mangaDetailState = {
  mangaId: null,
  sortAsc: false,
  filter: 'all', // 'all' | 'unread' | 'downloaded'
  batchMode: false,
  selectedChapters: new Set(),
};

export function updateDetailState(newState) {
  Object.assign(mangaDetailState, newState);
}

export async function renderMangaDetail(mangaId) {
  if (mangaDetailState.mangaId !== mangaId) {
    mangaDetailState = {
      mangaId,
      sortAsc: false,
      filter: 'all',
      batchMode: false,
      selectedChapters: new Set(),
    };
  }

  setHeaderTitles('Detail Komik', 'Informasi & Chapter');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Memuat informasi komik...</p>
    </div>`;

  try {
    const detail = await api.manga_detail({ mangaId });
    const chRes = await api.chapters({ mangaId });
    const readIds = await api.list_read_chapters({ mangaId }).catch(() => new Set());
    const bookmarkedIds = await api.list_bookmarked_chapters({ mangaId }).catch(() => new Set());
    const progress = await api.get_reading_progress({ mangaId }).catch(() => null);
    
    const m = detail.manga;
    const isFav = !!detail.favorite;
    const downloadedSet = new Set(chRes.downloaded || []);
    const readSet = new Set(readIds || []);
    const bookmarkedSet = new Set(bookmarkedIds || []);

    // Save manga meta for history display
    api.save_manga_meta( {
      mangaId,
      title: m.title,
      cover: m.cover_portrait_url || m.cover_image_url || null,
      countryId: m.country_id || null,
    }).catch(e => console.warn('Save meta err:', e));

    // Sort chapters
    let chapters = [...chRes.items];
    if (mangaDetailState.sortAsc) {
      chapters.sort((a, b) => a.chapter_number - b.chapter_number);
    } else {
      chapters.sort((a, b) => b.chapter_number - a.chapter_number);
    }

    // Filter chapters
    if (getPref('app.downloaded_only', getPref('downloaded_only', '0')) === '1') {
      chapters = chapters.filter(c => downloadedSet.has(c.chapter_id));
    } else if (mangaDetailState.filter === 'unread') {
      chapters = chapters.filter(c => !readSet.has(c.chapter_id));
    } else if (mangaDetailState.filter === 'downloaded') {
      chapters = chapters.filter(c => downloadedSet.has(c.chapter_id));
    }

    const totalChapters = chRes.items.length;
    const unreadCount = chRes.items.filter(c => !readSet.has(c.chapter_id)).length;
    const downloadedCount = downloadedSet.size;
    const genreTerms = Array.isArray(m.taxonomy?.Genre) ? m.taxonomy.Genre : [];
    const genreChips = genreTerms
      .filter(g => g && g.name)
      .map(g => `<span class="detail-genre-chip">${utils.escapeHtml(g.name)}</span>`)
      .join('');
    const statusText = mangaStatusText(m.status);

    const coverSrc = coverUrl(m.cover_portrait_url || m.cover_image_url);

    let html = `
      <div class="detail-wrapper">
        <div class="detail-backdrop" style="background-image: url('${coverSrc}');"></div>
        <div class="detail-hero-content">
          <img class="detail-cover" src="${coverSrc}" alt="${utils.escapeHtml(m.title)}" />
          <div class="detail-info">
            <h2>${utils.escapeHtml(m.title)}</h2>
            <div class="alt-title">${utils.escapeHtml(m.alternative_title || '')}</div>
            <div class="detail-action-row">
              <button id="det-fav-btn" class="detail-action-btn ${isFav ? 'is-saved' : 'primary'}">
                <span class="detail-action-icon">${isFav ? Icons.star('', true) : Icons.plus()}</span>
                <span class="detail-action-text">${isFav ? 'Di pustaka' : 'Tambah'}</span>
              </button>
              <div class="detail-action-btn detail-prediction-action" aria-label="Prediksi rilis berikutnya">
                <span class="detail-action-icon">${Icons.clock()}</span>
                <span class="detail-action-text">Segera</span>
                <div class="detail-action-prediction">${formatPrediction(detail.prediction)}</div>
              </div>
              <button id="det-open-site-btn" class="detail-action-btn">
                <span class="detail-action-icon">${Icons.chevronRight()}</span>
                <span class="detail-action-text">Buka situs</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-meta">
        <span><b>${totalChapters}</b> Chapter</span>
        <span><b>${unreadCount}</b> Belum</span>
        <span><b>${downloadedCount}</b> Diunduh</span>
        ${statusText ? `<span>${statusText}</span>` : ''}
      </div>

      ${genreChips ? `<div class="detail-genre-chips">${genreChips}</div>` : ''}

      <div id="desc-box" class="desc-card" role="button" aria-label="Buka tutup deskripsi">
        <div class="desc-title">Deskripsi</div>
        <div class="desc-body">${utils.escapeHtml(m.description || 'Tidak ada deskripsi tersedia.')}</div>
      </div>

      <!-- Chapter Toolbar (Mihon-Grade) -->
      <div class="chapter-toolbar">
        <div>
          <b>${totalChapters} Chapter</b> &bull; <span style="color:var(--cyan); font-weight:600;">${unreadCount} Belum</span> &bull; <span style="color:var(--text-faint);">${downloadedCount} Diunduh</span>
        </div>
        <div class="chapter-toolbar-actions">
          <div style="position:relative; display:inline-block;">
            <button id="ch-dl-menu-btn" class="ch-sort-btn" title="Unduh Chapter">
              ${Icons.download()} Unduh
            </button>
            <div id="ch-dl-dropdown" class="queue-dropdown-menu hidden" style="min-width: 190px;">
              <button class="queue-menu-item" data-dl-count="1">Unduh 1 berikutnya</button>
              <button class="queue-menu-item" data-dl-count="5">Unduh 5 berikutnya</button>
              <button class="queue-menu-item" data-dl-count="10">Unduh 10 berikutnya</button>
              <button class="queue-menu-item" data-dl-count="all">Unduh semua belum dibaca</button>
            </div>
          </div>
          <button id="ch-sort-btn" class="ch-sort-btn" title="Urutkan Chapter">
            ${Icons.sort()} ${mangaDetailState.sortAsc ? 'Awal' : 'Terkini'}
          </button>
          <button id="ch-filter-btn" class="ch-filter-btn" title="Filter Chapter">
            ${Icons.filter()} ${mangaDetailState.filter === 'all' ? 'Semua' : (mangaDetailState.filter === 'unread' ? 'Belum' : 'Diunduh')}
          </button>
          <button id="ch-batch-btn" class="ch-batch-btn ${mangaDetailState.batchMode ? 'active' : ''}" title="Pilih Banyak">
            ${Icons.checkSquare()} ${mangaDetailState.batchMode ? 'Selesai' : 'Pilih'}
          </button>
        </div>
      </div>

      <div id="chapters-list">
    `;

    chapters.forEach(ch => {
      const isDl = downloadedSet.has(ch.chapter_id);
      const isRead = readSet.has(ch.chapter_id);
      const isBookmarked = bookmarkedSet.has(ch.chapter_id);
      const isSelected = mangaDetailState.selectedChapters.has(ch.chapter_id);
      const relDate = ch.release_date ? new Date(ch.release_date).toLocaleDateString('id-ID') : '';

      // Download state label
      let dlStateHtml = '';
      if (isDl) {
        dlStateHtml = `<span class="chapter-download-state downloaded">${Icons.check()} Diunduh</span>`;
      }

      html += `
        <div class="chapter ${isRead ? 'read' : ''}" data-ch-id="${ch.chapter_id}" data-ch-num="${ch.chapter_number}">
          ${mangaDetailState.batchMode ? `
            <div class="chapter-select-box ${isSelected ? 'selected' : ''}" data-ch-id="${ch.chapter_id}">
              ${isSelected ? Icons.checkSquare() : Icons.square()}
            </div>
          ` : `
            <div class="chapter-read-dot ${isRead ? 'is-read' : ''}">
              <button class="ch-read-toggle-btn ${isRead ? 'is-read' : ''}" data-ch-id="${ch.chapter_id}" data-ch-num="${ch.chapter_number}" title="${isRead ? 'Tandai Belum Dibaca' : 'Tandai Sudah Dibaca'}">
                ${isRead ? Icons.check() : Icons.square()}
              </button>
            </div>
          `}
          <div class="n click">
            <b>Chapter ${ch.chapter_number}</b> ${ch.chapter_title ? `- ${utils.escapeHtml(ch.chapter_title)}` : ''}
            <div class="d">${relDate}${dlStateHtml ? ` ${dlStateHtml}` : ''}</div>
          </div>
          <button class="chapter-bookmark-btn ${isBookmarked ? 'active' : ''}" data-ch-id="${ch.chapter_id}" data-ch-num="${ch.chapter_number}" title="${isBookmarked ? 'Hapus Bookmark' : 'Bookmark'}">
            ${Icons.bookmark('', isBookmarked)}
          </button>
          <button class="btn small dl-btn" data-ch-id="${ch.chapter_id}">
            ${isDl ? Icons.trash() + ' Hapus' : Icons.download() + ' Unduh'}
          </button>
        </div>
      `;
    });

    html += `</div>`;

    if (mangaDetailState.batchMode) {
      html += `
        <div class="batch-bar">
          <div class="batch-count" id="batch-count-text">${mangaDetailState.selectedChapters.size} dipilih</div>
          <div class="batch-actions">
            <button id="batch-all-btn" class="btn small">Semua</button>
            <button id="batch-download-btn" class="btn small">${Icons.download()} Unduh</button>
            <button id="batch-mark-read" class="btn small primary">${Icons.check()} Dibaca</button>
            <button id="batch-mark-unread" class="btn small">Belum</button>
          </div>
        </div>
      `;
    }

    // Sticky "Lanjut" button: opens progress chapter or oldest chapter
    // Hidden in batch mode or when no chapters remain after filtering
    if (chapters.length > 0 && !mangaDetailState.batchMode) {
      const resumeChapterId = progress ? progress.chapter_id : null;
      // Oldest chapter = lowest chapter_number in the full (pre-filter) set
      const oldest = [...chRes.items].sort((a, b) => a.chapter_number - b.chapter_number)[0];
      const targetId = resumeChapterId || (oldest ? oldest.chapter_id : null);
      const resumeLabel = progress ? 'Lanjut' : 'Mulai';
      const resumeChNum = progress
        ? (chapters.find(c => c.chapter_id === progress.chapter_id)?.chapter_number || '')
        : (oldest ? oldest.chapter_number : '');

      if (targetId) {
        html += `
          <div class="detail-sticky-resume" id="detail-sticky-resume">
            <button id="sticky-resume-btn" class="btn primary detail-sticky-btn" data-ch-id="${targetId}">
              ${Icons.play()} ${utils.escapeHtml(resumeLabel)}${resumeChNum ? ` Ch. ${resumeChNum}` : ''}
            </button>
          </div>
        `;
      }
    }

    viewEl.innerHTML = html;

    attachDetailEvents(mangaId, detail, chapters, progress, chRes, readSet, downloadedSet);

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Detail Komik</h3>
        <p>${err}</p>
        <button class="btn primary small" onclick="window.history.back()">Kembali</button>
      </div>`;
  }
}

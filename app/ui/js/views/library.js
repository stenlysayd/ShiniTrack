import { state, getPref } from '../state.js';
import { navigate } from '../router.js';
import * as utils from '../utils.js';
import * as api from '../api.js';
import { showCategoryAssignDialog, renderCards } from './library-helpers.js';
import { showLibrarySettings } from './library-settings.js';
import { motion } from '../motion.js';

const { setHeaderTitles, showToast, escapeHtml } = utils;

const viewEl = document.getElementById('view');
let selectMode = false;
let selectedIds = new Set();

const PAGE_SIZE = 30;

// Re-export for detail-events usage
export { showCategoryAssignDialog } from './library-helpers.js';

// ================================================================= VIEW: LIBRARY

export async function renderFavorites(opts = {}) {
  setHeaderTitles('Pustaka', 'Koleksi Komik Favorit');
  viewEl.innerHTML = `<div class="empty"><div class="svg-icon spin">${Icons.sync()}</div><p style="margin-top:12px;">Memuat library favorit...</p></div>`;

  try {
    const [categories, totalList] = await Promise.all([
      api.category_list().catch(() => []),
      api.list_favorites(),
    ]);

    if (totalList.length === 0) {
      viewEl.innerHTML = `<div class="empty">${Icons.emptyLibrary()}<h3>Library Masih Kosong</h3><p>Tambahkan manhwa favoritmu untuk memantau jadwal update dan notifikasi secara realtime.</p><a class="btn primary small" href="#/search">${Icons.search()} Jelajahi Komik</a></div>`;
      return;
    }

    // Fetch manga->category mappings for tab counts
    const mangaCatMap = {};
    await Promise.all(totalList.map(async f => {
      try { mangaCatMap[f.manga_id] = await api.get_manga_categories({ mangaId: f.manga_id }); }
      catch { mangaCatMap[f.manga_id] = []; }
    }));

    const activeTab = state.activeCategory || 0;
    let viewModeLabel = state.libraryViewMode === 'compact' ? 'Padat' : state.libraryViewMode === 'list' ? 'Daftar' : 'Nyaman';
    let tabsHtml = buildCategoryTabs(categories, activeTab, totalList, mangaCatMap);

    let html = `
      <div class="lib-toolbar">
        <div class="lib-header" style="display: flex; gap: 8px;">
          <div class="search-bar-wrap" style="flex: 1;">
            <span class="search-icon">${Icons.search()}</span>
            <input id="lib-search" class="search-input" type="search" placeholder="Cari di Pustaka (${totalList.length})..." value="${state.librarySearchQuery}" />
          </div>
          <button id="lib-filter-btn" class="icon-btn" title="Filter & Urutkan">
            ${Icons.filter()}
          </button>
        </div>
        ${tabsHtml}
      </div>
      <div id="lib-grid-wrap" class="${state.libraryViewMode === 'compact' ? 'manga-grid compact' : state.libraryViewMode === 'list' ? '' : 'manga-grid'}"></div>
      <div id="lib-sentinel" style="height:1px;"></div>`;

    if (selectMode) {
      html += `<div class="lib-select-bar"><span id="lib-sel-count">${selectedIds.size} dipilih</span><button id="lib-sel-cat" class="btn small primary">${Icons.tag()} Ubah kategori</button><button id="lib-sel-cancel" class="btn small">Batal</button></div>`;
    }

    viewEl.innerHTML = html;

    // Set indicator position instantly on first render (no tween, step 3)
    const tabsContainer = document.getElementById('lib-cat-tabs');
    const indicator = document.getElementById('lib-cat-indicator');
    const activeTabEl = tabsContainer?.querySelector('.lib-cat-tab.active');
    if (indicator && activeTabEl) {
      motion.tabIndicator(indicator, activeTabEl, true);
      activeTabEl.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    }

    // Infinite scroll state
    let currentOffset = 0;
    let loading = false;
    let allLoaded = false;
    const gridWrap = document.getElementById('lib-grid-wrap');

    async function loadPage(isCatChange = false) {
      if (loading || allLoaded) return;
      loading = true;
      try {
        const isDownloadedOnly = getPref('app.downloaded_only', getPref('downloaded_only', '0')) === '1';
        const rows = await api.library_list({
          category: state.activeCategory || 0,
          sort: state.librarySort || 'recent',
          sortDesc: parseInt(getPref('library_sort_desc', '1'), 10) === 1,
          filterDownloaded: isDownloadedOnly ? 1 : parseInt(getPref('library_filter_downloaded', '0'), 10),
          filterUnread: parseInt(getPref('library_filter_unread', '0'), 10),
          filterStarted: parseInt(getPref('library_filter_started', '0'), 10),
          filterCompleted: parseInt(getPref('library_filter_completed', '0'), 10),
          search: state.librarySearchQuery.trim() || null,
          limit: PAGE_SIZE,
          offset: currentOffset,
        });
        if (rows.length < PAGE_SIZE) allLoaded = true;
        if (rows.length === 0 && currentOffset === 0) {
          gridWrap.innerHTML = `<div class="empty">${Icons.emptySearch()}<h3>Tidak Ada Hasil</h3><p>Tidak ada komik yang cocok.</p></div>`;
        } else {
          appendCards(rows, gridWrap);
          if (currentOffset === 0 && (isCatChange || (!opts.isSearch && !opts.isFilter && !opts.isSelectMode && !state.librarySearchQuery.trim()))) {
            const cards = gridWrap.querySelectorAll('.grid-card, .card');
            motion.stagger(cards, { max: 24 });
          }
        }
        currentOffset += rows.length;
      } catch (e) {
        if (currentOffset === 0) gridWrap.innerHTML = `<div class="empty"><p style="color:var(--text-muted)">Gagal memuat: ${e}</p></div>`;
      }
      loading = false;
    }

    // IntersectionObserver for infinite scroll
    const sentinel = document.getElementById('lib-sentinel');
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && !allLoaded) {
        loadPage();
      }
    }, { rootMargin: '200px' });

    function resetAndLoad() {
      if (sentinel) observer.unobserve(sentinel);
      currentOffset = 0;
      allLoaded = false;
      loading = false;
      gridWrap.innerHTML = '';
      loadPage(true).finally(() => {
        if (sentinel && !allLoaded) observer.observe(sentinel);
      });
    }

    await loadPage();
    if (sentinel && !allLoaded) observer.observe(sentinel);
    attachEvents(totalList, categories, mangaCatMap, gridWrap, resetAndLoad);
  } catch (err) {
    viewEl.innerHTML = `<div class="empty">${Icons.alertTriangle()}<h3>Gagal Memuat Library</h3><p>${err}</p></div>`;
  }
}

function appendCards(rows, container) {
  // Deduplicate against already rendered items to prevent clone cards
  const existingIds = new Set();
  container.querySelectorAll('[data-id]').forEach(el => {
    if (el.dataset.id) existingIds.add(el.dataset.id);
  });
  const filteredRows = rows.filter(r => !existingIds.has(r.manga_id));
  if (!filteredRows.length) return;

  // Convert LibraryRow to a shape renderCards expects
  const fakeReadingMap = {};
  const fakeUnreadSet = new Set();
  filteredRows.forEach(r => {
    if (r.last_read_at) fakeReadingMap[r.manga_id] = { chapter_number: 0, updated_at: r.last_read_at };
    if (r.unread_count > 0) fakeUnreadSet.add(r.manga_id);
  });
  const adapted = filteredRows.map(r => ({
    manga_id: r.manga_id,
    title: r.title,
    cover: r.cover,
    notify: r.notify,
    last_ch_num: r.last_ch_num,
    added_at: r.added_at,
    prediction: null,
    unread_count: r.unread_count,
    downloaded_count: r.downloaded_count,
  }));
  const html = renderCards(adapted, fakeReadingMap, fakeUnreadSet, selectMode, selectedIds);
  const temp = document.createElement('div');
  temp.innerHTML = html;
  // renderCards wraps grid items in .manga-grid; unwrap and append children
  const source = temp.querySelector('.manga-grid') || temp;
  while (source.firstChild) container.appendChild(source.firstChild);
}

function buildCategoryTabs(categories, activeTab, list, mangaCatMap) {
  if (!categories.length) return '';
  const bawaan = list.filter(f => !(mangaCatMap[f.manga_id] || []).length).length;
  const showCount = parseInt(getPref('lib_show_tabs_count', '1'), 10) === 1;
  const pill = (cnt) => showCount ? ` <span class="lib-cat-pill">${cnt}</span>` : '';
  
  let t = `<div class="lib-cat-tabs" id="lib-cat-tabs">`;
  t += `<div class="lib-cat-tab ${activeTab===0?'active':''}" data-tab-id="0">Semua${pill(list.length)}</div>`;
  t += `<div class="lib-cat-tab ${activeTab===-1?'active':''}" data-tab-id="-1">Bawaan${pill(bawaan)}</div>`;
  categories.forEach(c => {
    t += `<div class="lib-cat-tab ${activeTab===c.id?'active':''}" data-tab-id="${c.id}">${escapeHtml(c.name)}${pill(c.manga_count)}</div>`;
  });
  t += `<div class="lib-cat-indicator" id="lib-cat-indicator"></div>`;
  return t + `</div>`;
}

function attachEvents(list, categories, mangaCatMap, gridWrap, resetAndLoad) {
  const searchInput = document.getElementById('lib-search');
  let searchTimer = null;
  if (searchInput) searchInput.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.librarySearchQuery = e.target.value; renderFavorites({ isSearch: true }); }, 300);
  });

  const filterBtn = document.getElementById('lib-filter-btn');
  if (filterBtn) filterBtn.addEventListener('click', () => {
    showLibrarySettings(() => { renderFavorites({ isFilter: true }); });
  });

  document.querySelectorAll('.lib-cat-tab').forEach(tab => tab.addEventListener('click', () => {
    const newCatId = Number(tab.dataset.tabId);
    if (state.activeCategory === newCatId) return;
    state.activeCategory = newCatId;
    localStorage.setItem('shinitrack_active_cat', state.activeCategory);

    document.querySelectorAll('.lib-cat-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const ind = document.getElementById('lib-cat-indicator');
    if (ind) {
      motion.tabIndicator(ind, tab);
    }
    tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

    if (resetAndLoad) resetAndLoad();
    else renderFavorites();
  }));

  const onResize = () => {
    const curActive = document.querySelector('.lib-cat-tab.active');
    const ind = document.getElementById('lib-cat-indicator');
    if (ind && curActive) {
      motion.tabIndicator(ind, curActive, true);
    }
  };
  window.addEventListener('resize', onResize, { passive: true });

  // Card interactions via event delegation on gridWrap
  gridWrap.addEventListener('click', e => {
    const card = e.target.closest('.grid-card, .card');
    if (!card) return;
    if (e.target.closest('[data-notify-id]')) return;
    if (selectMode) {
      const id = card.dataset.id;
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      if (!selectedIds.size) selectMode = false;
      renderFavorites({ isSelectMode: true });
      return;
    }
    navigate(`#/manga/${card.dataset.id}`);
  });

  // Long-press for multi-select
  let pt = null;
  gridWrap.addEventListener('pointerdown', e => {
    const card = e.target.closest('.grid-card, .card');
    if (!card) return;
    pt = setTimeout(() => { pt = null; if (!selectMode) { selectMode = true; selectedIds.clear(); } selectedIds.add(card.dataset.id); renderFavorites({ isSelectMode: true }); }, 500);
  });
  gridWrap.addEventListener('pointerup', () => { if (pt) clearTimeout(pt); pt = null; });
  gridWrap.addEventListener('pointerleave', () => { if (pt) clearTimeout(pt); pt = null; });

  const catBtn = document.getElementById('lib-sel-cat');
  if (catBtn) catBtn.addEventListener('click', () => showCategoryAssignDialog([...selectedIds], categories, mangaCatMap, () => { selectMode = false; selectedIds.clear(); renderFavorites({ isSelectMode: true }); }));
  const cancelBtn = document.getElementById('lib-sel-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { selectMode = false; selectedIds.clear(); renderFavorites({ isSelectMode: true }); });
}

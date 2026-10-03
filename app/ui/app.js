// ShiniTrack Mobile UI logic - v0.2.0 (Mihon Edition)
// Modern Manga Archive & Release Radar
const { invoke } = window.__TAURI__ ? window.__TAURI__.core : {
  invoke: async (cmd, args) => { console.warn('Mock invoke:', cmd, args); return []; }
};
const eventApi = window.__TAURI__ ? window.__TAURI__.event : null;

// Routing & State
let currentRoute = '';
let currentParams = {};
const viewEl = document.getElementById('view');
const titleEl = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');
const backBtn = document.getElementById('back');
const syncBtn = document.getElementById('sync');
const toastEl = document.getElementById('toast');
const badgeEl = document.getElementById('badge');

// Mihon-style persistent state
let libraryViewMode = localStorage.getItem('shinitrack_view_mode') || 'comfortable'; // 'comfortable' | 'compact' | 'list'
let libraryCategory = localStorage.getItem('shinitrack_library_cat') || 'all'; // 'all' | 'reading' | 'unread' | 'completed' | 'downloaded'
let librarySort = localStorage.getItem('shinitrack_library_sort') || 'recent'; // 'recent' | 'alpha' | 'unread' | 'updated'
let librarySearchQuery = '';
let exploreTab = 'catalog'; // 'catalog' | 'schedule'
let readerMode = localStorage.getItem('shinitrack_reader_mode') || 'webtoon'; // 'webtoon' | 'paged-ltr' | 'paged-rtl'
let availableUpdate = null;
let updateModalData = null;

function setHeaderTitles(title, subtitle = 'Manga Tracker') {
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

function showToast(msg, duration = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function assetUrl(path) {
  return `http://shimg.localhost/${path}`;
}

function coverUrl(url) {
  if (!url) return '';
  return assetUrl(`u/${encodeURIComponent(url)}`);
}

function pageUrl(chapterId, file) {
  return assetUrl(`p/${encodeURIComponent(chapterId)}/${encodeURIComponent(file)}`);
}

function formatWeekday(wdIndex) {
  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  return days[wdIndex % 7] || '';
}

function formatRelativeTime(date) {
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now - date) / 1000));
  if (diffSec < 60) return 'Baru saja';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} menit lalu`;
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    return `${hours} jam lalu`;
  }
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return `Kemarin, ${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
  if (days < 7) return `${days} hari lalu`;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function formatPrediction(p) {
  if (!p) return '<span class="pill low">Belum ada pola</span>';
  if (p.likely_hiatus) {
    return `<span class="pill hiatus">${Icons.alertTriangle()} Kemungkinan Hiatus</span>`;
  }
  
  let patternText = '';
  if (p.pattern && p.pattern.kind === 'weekly') {
    const day = formatWeekday(p.pattern.weekday);
    const hour = String(p.pattern.hour).padStart(2, '0') + ':00';
    patternText = `Tiap ${day} ~${hour}`;
  } else if (p.pattern && p.pattern.days) {
    patternText = `Tiap ~${p.pattern.days} hari`;
  }

  const labelClass = (p.label || 'low').toLowerCase();
  const nextDate = new Date(p.next_at);
  const nextStr = nextDate.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
  const overdueStr = p.overdue ? ' (Terlambat)' : '';

  return `<div class="p">
    <b>${patternText}</b> &bull; Estimasi: ${nextStr}${overdueStr}
    <span class="pill ${labelClass}">${p.label} (${Math.round(p.confidence * 100)}%)</span>
  </div>`;
}

// Navigation
function navigate(hash) {
  window.location.hash = hash;
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', async () => {
  setupGlobalEvents();
  setupUpdateModal();

  if (!window.location.hash) {
    navigate('#/favorites');
  } else {
    handleRoute();
  }
  refreshBadge();

  // Background check for updates if enabled
  try {
    const s = await invoke('settings_get');
    if (s.auto_check_update !== false) {
      checkForUpdates(true, s.github_repo);
    }
  } catch (e) {
    console.warn('Initial update check error:', e);
  }
});

function handleRoute() {
  const hash = window.location.hash.slice(1) || '/favorites';
  const [path, queryString] = hash.split('?');
  currentRoute = path;
  
  // Highlight active tab
  document.querySelectorAll('.tabbar a').forEach(a => {
    const tab = a.getAttribute('data-tab');
    if (path.startsWith(`/${tab}`) || (tab === 'search' && path === '/schedule')) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });

  // Handle subpages & back button
  if (path.startsWith('/manga/') || path.startsWith('/read/')) {
    backBtn.classList.remove('hidden');
  } else {
    backBtn.classList.add('hidden');
  }

  if (path === '/favorites') renderFavorites();
  else if (path === '/updates') renderUpdates();
  else if (path === '/history') renderHistory();
  else if (path === '/search') {
    exploreTab = 'catalog';
    renderSearch();
  }
  else if (path === '/schedule') {
    exploreTab = 'schedule';
    renderSearch();
  }
  else if (path === '/settings') renderSettings();
  else if (path.startsWith('/manga/')) {
    const mangaId = path.split('/')[2];
    renderMangaDetail(mangaId);
  } else if (path.startsWith('/read/')) {
    const chapterId = path.split('/')[2];
    renderReader(chapterId);
  }
}

backBtn.addEventListener('click', () => {
  window.history.back();
});

syncBtn.addEventListener('click', async () => {
  syncBtn.classList.add('spin');
  try {
    const count = await invoke('sync_now');
    showToast(count > 0 ? `Sinkronisasi selesai: ${count} update baru!` : 'Semua komik up-to-date.');
    handleRoute();
    refreshBadge();
  } catch (e) {
    showToast(`Gagal sinkron: ${e}`);
  } finally {
    syncBtn.classList.remove('spin');
  }
});

async function refreshBadge() {
  try {
    const events = await invoke('recent_events');
    const unread = events.filter(e => !e.seen).length;
    if (unread > 0) {
      badgeEl.textContent = unread > 99 ? '99+' : unread;
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  } catch (e) {}
}

// ================================================================= IN-APP UPDATER
function setupUpdateModal() {
  const modal = document.getElementById('update-modal');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const installBtn = document.getElementById('modal-install-btn');
  const dlBox = document.getElementById('modal-dl-progress');
  const dlBar = document.getElementById('dl-bar');
  const dlPct = document.getElementById('dl-pct');
  const dlText = document.getElementById('dl-text');

  cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  installBtn.addEventListener('click', async () => {
    if (!updateModalData) return;

    if (!updateModalData.download_url) {
      if (updateModalData.html_url) {
        window.open(updateModalData.html_url, '_blank');
      } else {
        showToast('Link file APK tidak ditemukan.');
      }
      return;
    }

    installBtn.disabled = true;
    installBtn.textContent = 'Mengunduh...';
    cancelBtn.disabled = true;
    dlBox.classList.remove('hidden');
    dlBar.style.width = '0%';
    dlPct.textContent = '0%';
    dlText.textContent = 'Menghubungkan ke GitHub...';

    try {
      const res = await invoke('download_and_install_update', {
        downloadUrl: updateModalData.download_url
      });
      showToast(res.message, 5000);
      modal.classList.add('hidden');
    } catch (err) {
      showToast(`Gagal memasang update: ${err}`, 5000);
      installBtn.disabled = false;
      installBtn.textContent = 'Coba Lagi';
      cancelBtn.disabled = false;
      dlText.textContent = 'Gagal mengunduh';
    }
  });

  const ubBtn = document.getElementById('ub-btn');
  if (ubBtn) {
    ubBtn.addEventListener('click', () => {
      if (availableUpdate) {
        showUpdateModal(availableUpdate);
      }
    });
  }
}

function showUpdateModal(info) {
  updateModalData = info;
  const modal = document.getElementById('update-modal');
  document.getElementById('modal-update-title').textContent = `${info.release_name || 'ShiniTrack ' + info.latest_version}`;
  document.getElementById('modal-update-date').textContent = info.published_at
    ? `Rilis: ${new Date(info.published_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Rilis: Baru';
  document.getElementById('modal-changelog').textContent = info.release_notes || 'Peningkatan performa dan perbaikan bug.';
  
  const dlBox = document.getElementById('modal-dl-progress');
  dlBox.classList.add('hidden');
  const installBtn = document.getElementById('modal-install-btn');
  installBtn.disabled = false;
  installBtn.textContent = info.download_url ? 'Unduh & Pasang' : 'Buka GitHub';
  document.getElementById('modal-cancel-btn').disabled = false;

  modal.classList.remove('hidden');
}

async function checkForUpdates(silent = false, customRepo = null) {
  try {
    const info = await invoke('check_app_update', { repo: customRepo });
    if (info.update_available) {
      availableUpdate = info;
      const banner = document.getElementById('update-banner');
      if (banner) {
        document.getElementById('ub-version').textContent = `${info.latest_version} Tersedia`;
        banner.classList.remove('hidden');
      }
      if (!silent) {
        showUpdateModal(info);
      }
    } else {
      if (!silent) {
        showToast(`Aplikasi sudah versi terbaru (${info.current_version})`);
      }
    }
  } catch (err) {
    if (!silent) {
      showToast(`Gagal cek update: ${err}`);
    } else {
      console.warn('Silent update check:', err);
    }
  }
}

// ================================================================= VIEW: FAVORITES (MIHON LIBRARY)
async function renderFavorites() {
  setHeaderTitles('Library', 'Koleksi Komik Favorit');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Memuat library favorit...</p>
    </div>`;

  try {
    const list = await invoke('list_favorites');
    const readingMap = await invoke('list_all_reading_progress').catch(() => ({}));
    const events = await invoke('recent_events').catch(() => []);
    const unreadMangaSet = new Set(events.filter(e => !e.seen).map(e => e.manga_id));

    if (list.length === 0) {
      viewEl.innerHTML = `
        <div class="empty">
          ${Icons.emptyLibrary()}
          <h3>Library Masih Kosong</h3>
          <p>Tambahkan manhwa favoritmu untuk memantau jadwal update dan notifikasi secara realtime.</p>
          <a class="btn primary small" href="#/search">
            ${Icons.search()} Jelajahi Komik
          </a>
        </div>`;
      return;
    }

    // Category counts
    const readingCount = list.filter(item => {
      const prog = readingMap[item.manga_id];
      return prog && (!item.last_ch_num || prog.chapter_number < item.last_ch_num);
    }).length;
    const unreadCount = list.filter(item => unreadMangaSet.has(item.manga_id) || !readingMap[item.manga_id]).length;
    const completedCount = list.filter(item => {
      const prog = readingMap[item.manga_id];
      return prog && item.last_ch_num && prog.chapter_number >= item.last_ch_num;
    }).length;

    // Filter items
    let filtered = list;
    if (librarySearchQuery.trim()) {
      const q = librarySearchQuery.toLowerCase().trim();
      filtered = filtered.filter(item => item.title.toLowerCase().includes(q));
    }
    if (libraryCategory === 'reading') {
      filtered = filtered.filter(item => {
        const prog = readingMap[item.manga_id];
        return prog && (!item.last_ch_num || prog.chapter_number < item.last_ch_num);
      });
    } else if (libraryCategory === 'unread') {
      filtered = filtered.filter(item => unreadMangaSet.has(item.manga_id) || !readingMap[item.manga_id]);
    } else if (libraryCategory === 'completed') {
      filtered = filtered.filter(item => {
        const prog = readingMap[item.manga_id];
        return prog && item.last_ch_num && prog.chapter_number >= item.last_ch_num;
      });
    }

    // Sort items
    filtered.sort((a, b) => {
      if (librarySort === 'alpha') {
        return a.title.localeCompare(b.title);
      } else if (librarySort === 'unread') {
        const aUnread = unreadMangaSet.has(a.manga_id) ? 1 : 0;
        const bUnread = unreadMangaSet.has(b.manga_id) ? 1 : 0;
        return bUnread - aUnread;
      } else if (librarySort === 'updated') {
        return (b.last_ch_num || 0) - (a.last_ch_num || 0);
      } else {
        // 'recent' reading
        const aProg = readingMap[a.manga_id];
        const bProg = readingMap[b.manga_id];
        if (aProg && bProg) {
          return new Date(bProg.updated_at) - new Date(aProg.updated_at);
        }
        if (aProg) return -1;
        if (bProg) return 1;
        return new Date(b.added_at) - new Date(a.added_at);
      }
    });

    let viewModeLabel = 'Nyaman';
    if (libraryViewMode === 'compact') viewModeLabel = 'Padat';
    if (libraryViewMode === 'list') viewModeLabel = 'Daftar';

    let html = `
      <div class="lib-toolbar">
        <div class="lib-header">
          <div class="search-bar-wrap">
            <span class="search-icon">${Icons.search()}</span>
            <input id="lib-search" class="search-input" type="search" placeholder="Cari di Library (${list.length})..." value="${librarySearchQuery}" />
          </div>
          <button id="view-mode-btn" class="view-toggle-btn" title="Ganti Tampilan">
            ${libraryViewMode === 'list' ? Icons.list() : Icons.grid()} ${viewModeLabel}
          </button>
        </div>

        <div class="lib-controls-row">
          <div class="filter-chips">
            <div class="chip ${libraryCategory === 'all' ? 'active' : ''}" data-cat="all">Semua (${list.length})</div>
            <div class="chip ${libraryCategory === 'reading' ? 'active' : ''}" data-cat="reading">Sedang Dibaca (${readingCount})</div>
            <div class="chip ${libraryCategory === 'unread' ? 'active' : ''}" data-cat="unread">Belum Dibaca (${unreadCount})</div>
            <div class="chip ${libraryCategory === 'completed' ? 'active' : ''}" data-cat="completed">Selesai (${completedCount})</div>
          </div>
          <div style="flex-shrink:0;">
            <select id="lib-sort" class="lib-sort-select">
              <option value="recent" ${librarySort === 'recent' ? 'selected' : ''}>Terakhir Dibaca</option>
              <option value="alpha" ${librarySort === 'alpha' ? 'selected' : ''}>Nama (A-Z)</option>
              <option value="unread" ${librarySort === 'unread' ? 'selected' : ''}>Belum Dibaca</option>
              <option value="updated" ${librarySort === 'updated' ? 'selected' : ''}>Rilis Terbaru</option>
            </select>
          </div>
        </div>
      </div>
    `;

    if (filtered.length === 0) {
      html += `
        <div class="empty">
          ${Icons.emptySearch()}
          <h3>Tidak Ada Hasil</h3>
          <p>Tidak ada komik yang cocok dengan kategori atau pencarian Anda.</p>
        </div>`;
      viewEl.innerHTML = html;
      attachLibraryEvents(list);
      return;
    }

    if (libraryViewMode === 'comfortable' || libraryViewMode === 'compact') {
      const gridClass = libraryViewMode === 'compact' ? 'manga-grid compact' : 'manga-grid';
      html += `<div class="${gridClass}">`;
      filtered.forEach(fav => {
        const prog = readingMap[fav.manga_id];
        const isUnread = unreadMangaSet.has(fav.manga_id);
        const progText = prog ? `Lanjut Ch. ${prog.chapter_number}` : (fav.last_ch_num ? `Ch. ${fav.last_ch_num}` : 'Belum dibaca');
        
        html += `
          <div class="grid-card click" data-id="${fav.manga_id}">
            <img class="grid-cover" src="${coverUrl(fav.cover)}" loading="lazy" alt="${fav.title}" />
            ${isUnread ? `<span class="grid-badge">BARU</span>` : (!fav.notify ? `<span class="grid-badge notify-off">${Icons.bellOff()}</span>` : '')}
            <div class="grid-overlay">
              <div class="grid-title">${fav.title}</div>
              <div class="grid-progress">
                <span>${progText}</span>
                ${fav.notify ? `<span style="color:var(--accent);">${Icons.bell()}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    } else {
      // List Mode
      filtered.forEach(fav => {
        const pred = fav.prediction;
        const prog = readingMap[fav.manga_id];
        const lastCh = fav.last_ch_num ? `Ch. ${fav.last_ch_num}` : 'Belum ada chapter';
        const progText = prog ? ` &bull; <b style="color:var(--cyan)">Lanjut Ch. ${prog.chapter_number}</b>` : '';
        const notifyIcon = fav.notify ? Icons.bell() : Icons.bellOff();
        const notifyClass = fav.notify ? '' : 'off';

        html += `
          <div class="card click" data-id="${fav.manga_id}">
            <img class="cover" src="${coverUrl(fav.cover)}" loading="lazy" alt="${fav.title}" />
            <div class="body">
              <div class="t">${fav.title}</div>
              <div class="s">Terbaru: ${lastCh}${progText}</div>
              ${formatPrediction(pred)}
            </div>
            <button class="icon-btn ${notifyClass}" data-notify-id="${fav.manga_id}" title="Toggle Notifikasi" style="color: ${fav.notify ? 'var(--accent)' : 'var(--text-faint)'};">
              ${notifyIcon}
            </button>
          </div>
        `;
      });
    }

    viewEl.innerHTML = html;
    attachLibraryEvents(list);

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Library</h3>
        <p>${err}</p>
      </div>`;
  }
}

function attachLibraryEvents(list) {
  // Search
  const searchInput = document.getElementById('lib-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      librarySearchQuery = e.target.value;
      renderFavorites();
    });
  }

  // View mode cycle: comfortable -> compact -> list -> comfortable
  const toggleBtn = document.getElementById('view-mode-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (libraryViewMode === 'comfortable') libraryViewMode = 'compact';
      else if (libraryViewMode === 'compact') libraryViewMode = 'list';
      else libraryViewMode = 'comfortable';
      localStorage.setItem('shinitrack_view_mode', libraryViewMode);
      renderFavorites();
    });
  }

  // Sort select
  const sortSelect = document.getElementById('lib-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      librarySort = e.target.value;
      localStorage.setItem('shinitrack_library_sort', librarySort);
      renderFavorites();
    });
  }

  // Category filter chips
  document.querySelectorAll('.filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      libraryCategory = chip.dataset.cat;
      localStorage.setItem('shinitrack_library_cat', libraryCategory);
      renderFavorites();
    });
  });

  // Card click -> detail
  viewEl.querySelectorAll('.grid-card, .card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-notify-id]')) return;
      navigate(`#/manga/${card.dataset.id}`);
    });
  });

  // Toggle notification
  viewEl.querySelectorAll('[data-notify-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.notifyId;
      const currentActive = !btn.classList.contains('off');
      const nextState = !currentActive;
      try {
        await invoke('set_notify', { mangaId: id, notify: nextState });
        btn.classList.toggle('off', !nextState);
        btn.innerHTML = nextState ? Icons.bell() : Icons.bellOff();
        btn.style.color = nextState ? 'var(--accent)' : 'var(--text-faint)';
        showToast(nextState ? 'Notifikasi komik diaktifkan' : 'Notifikasi komik dinonaktifkan');
      } catch (err) {
        showToast(`Error: ${err}`);
      }
    });
  });
}

// ================================================================= VIEW: RIWAYAT (HISTORY)
async function renderHistory() {
  setHeaderTitles('Riwayat', 'Catatan Bacaan Terakhir');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Memuat riwayat membaca...</p>
    </div>`;

  try {
    const items = await invoke('get_reading_history', { limit: 60 });
    if (!items || items.length === 0) {
      viewEl.innerHTML = `
        <div class="empty">
          ${Icons.emptyHistory()}
          <h3>Belum Ada Riwayat</h3>
          <p>Komik yang kamu baca akan otomatis dicatat rapi di sini agar kamu bisa langsung melanjutkan membaca.</p>
          <a class="btn primary small" href="#/favorites">
            ${Icons.favorites()} Buka Library
          </a>
        </div>`;
      return;
    }

    let html = `
      <div class="history-list">
        <div style="font-size:12px; color:var(--text-faint); margin-bottom:4px; padding:0 2px;">
          ${items.length} riwayat bacaan terakhir
        </div>
    `;

    items.forEach(item => {
      const dt = new Date(item.updated_at);
      const timeStr = formatRelativeTime(dt);
      const pageInfo = item.last_page > 0 ? ` &bull; Hal. ${item.last_page + 1}` : '';

      html += `
        <div class="history-card click" data-ch-id="${item.chapter_id}" data-manga-id="${item.manga_id}">
          <img class="history-cover" src="${coverUrl(item.cover)}" loading="lazy" alt="${item.title}" />
          <div class="history-info">
            <div class="history-title">${item.title}</div>
            <div class="history-chapter">Chapter ${item.chapter_number}${pageInfo}</div>
            <div class="history-time">${Icons.clock()} ${timeStr}</div>
          </div>
          <button class="btn small primary resume-btn" data-ch-id="${item.chapter_id}" title="Lanjut Baca">
            ${Icons.play()} Lanjut
          </button>
        </div>
      `;
    });

    html += `</div>`;
    viewEl.innerHTML = html;

    viewEl.querySelectorAll('.history-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.resume-btn')) return;
        navigate(`#/manga/${card.dataset.mangaId}`);
      });
    });

    viewEl.querySelectorAll('.resume-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(`#/read/${btn.dataset.chId}`);
      });
    });

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Riwayat</h3>
        <p>${err}</p>
      </div>`;
  }
}

// ================================================================= VIEW: SCHEDULE
async function renderSchedule() {
  setHeaderTitles('Jadwal Rilis', 'Prediksi Rilis Mingguan');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Menghitung kalkulasi jadwal rilis...</p>
    </div>`;

  try {
    const sched = await invoke('schedule_week');
    let html = '';

    const todayStr = new Date().toISOString().split('T')[0];

    sched.days.forEach(day => {
      const isToday = day.date === todayStr;
      const dObj = new Date(day.date + 'T00:00:00');
      const dayName = dObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
      
      html += `
        <div class="day ${isToday ? 'today' : ''}">
          <h3>
            <span>${dayName}</span>
            ${isToday ? '<span class="pill high">HARI INI</span>' : `<span class="pill low">${day.items.length} komik</span>`}
          </h3>
      `;

      if (day.items.length === 0) {
        html += `<div class="s" style="padding: 6px 0; color: var(--text-faint);">Tidak ada jadwal rilis hari ini.</div>`;
      } else {
        day.items.forEach(item => {
          const timeStr = new Date(item.prediction.next_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
          html += `
            <div class="item" data-id="${item.manga_id}">
              <img src="${coverUrl(item.cover)}" loading="lazy" alt="${item.title}" />
              <div class="body">
                <div class="t">${item.title}</div>
                <div class="s">± ${item.prediction.window_hours} jam &bull; Akurasi ${Math.round(item.prediction.confidence * 100)}%</div>
              </div>
              <div class="time">${Icons.clock()} ~${timeStr}</div>
            </div>
          `;
        });
      }
      html += `</div>`;
    });

    if (sched.overdue && sched.overdue.length > 0) {
      html += `<div class="section-title">Terlambat / Kemungkinan Hiatus (${sched.overdue.length})</div>`;
      sched.overdue.forEach(item => {
        html += `
          <div class="card click" data-id="${item.manga_id}">
            <img class="cover" src="${coverUrl(item.cover)}" loading="lazy" alt="${item.title}" />
            <div class="body">
              <div class="t">${item.title}</div>
              <div class="s" style="color:var(--bad);">${Icons.alertTriangle()} ${item.prediction.likely_hiatus ? 'Kemungkinan Hiatus (sudah lewat 2.5x siklus)' : 'Jadwal terlewat'}</div>
            </div>
          </div>
        `;
      });
    }

    viewEl.innerHTML = html;

    viewEl.querySelectorAll('.item, .card').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.id) navigate(`#/manga/${el.dataset.id}`);
      });
    });

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Jadwal</h3>
        <p>${err}</p>
      </div>`;
  }
}

// ================================================================= VIEW: SEARCH / EXPLORE
async function renderSearch(tabOverride) {
  if (tabOverride) exploreTab = tabOverride;
  setHeaderTitles('Eksplorasi', exploreTab === 'catalog' ? 'Katalog Shinigami' : 'Jadwal Rilis Mingguan');

  viewEl.innerHTML = `
    <div class="explore-tabs">
      <div id="tab-catalog" class="explore-tab-btn ${exploreTab === 'catalog' ? 'active' : ''}">
        ${Icons.search()} Katalog Komik
      </div>
      <div id="tab-schedule" class="explore-tab-btn ${exploreTab === 'schedule' ? 'active' : ''}">
        ${Icons.schedule()} Jadwal Rilis
      </div>
    </div>
    <div id="explore-content"></div>
  `;

  document.getElementById('tab-catalog').addEventListener('click', () => {
    exploreTab = 'catalog';
    renderSearch();
  });
  document.getElementById('tab-schedule').addEventListener('click', () => {
    exploreTab = 'schedule';
    renderSearch();
  });

  const contentEl = document.getElementById('explore-content');
  if (exploreTab === 'schedule') {
    renderScheduleInto(contentEl);
  } else {
    renderCatalogInto(contentEl);
  }
}

async function renderCatalogInto(container) {
  container.innerHTML = `
    <div class="lib-toolbar" style="margin-bottom:12px;">
      <div class="lib-header">
        <div class="search-bar-wrap">
          <span class="search-icon">${Icons.search()}</span>
          <input id="q" class="search-input" type="search" placeholder="Cari judul komik, manhwa, manga..." autofocus />
        </div>
        <button id="q-btn" class="btn primary small">${Icons.search()} Cari</button>
      </div>
    </div>
    <div id="results">
      <div class="empty">
        <div class="svg-icon spin">${Icons.sync()}</div>
        <p style="margin-top:12px;">Memuat rilis terbaru dari Shinigami...</p>
      </div>
    </div>
  `;

  const qInput = document.getElementById('q');
  const qBtn = document.getElementById('q-btn');
  const resEl = document.getElementById('results');

  async function doSearch(query) {
    resEl.innerHTML = `
      <div class="empty">
        <div class="svg-icon spin">${Icons.sync()}</div>
        <p style="margin-top:12px;">Mencari komik di Shinigami...</p>
      </div>`;
    try {
      let items = [];
      if (!query || query.trim() === '') {
        items = await invoke('latest');
      } else {
        const res = await invoke('search', { query: query.trim() });
        items = res.items;
      }
      renderCards(items);
    } catch (e) {
      resEl.innerHTML = `
        <div class="empty">
          ${Icons.alertTriangle()}
          <h3>Gagal Melakukan Pencarian</h3>
          <p>${e}</p>
        </div>`;
    }
  }

  function renderCards(items) {
    if (!items || items.length === 0) {
      resEl.innerHTML = `
        <div class="empty">
          ${Icons.emptySearch()}
          <h3>Tidak Ditemukan</h3>
          <p>Coba gunakan kata kunci judul komik lainnya.</p>
        </div>`;
      return;
    }
    let html = '';
    items.forEach(card => {
      const m = card.manga || card;
      const isFav = card.is_favorite;
      const lastCh = m.latest_chapter_number ? `Ch. ${m.latest_chapter_number}` : 'N/A';
      html += `
        <div class="card click" data-id="${m.manga_id}">
          <img class="cover" src="${coverUrl(m.cover_portrait_url || m.cover_image_url)}" loading="lazy" alt="${m.title}" />
          <div class="body">
            <div class="t">${m.title}</div>
            <div class="s">Terbaru: ${lastCh}</div>
          </div>
          <button class="btn small ${isFav ? '' : 'primary'} fav-btn" data-id="${m.manga_id}" data-fav="${isFav ? '1' : '0'}">
            ${isFav ? Icons.star('', true) + ' Tersimpan' : Icons.plus() + ' Tambah'}
          </button>
        </div>
      `;
    });
    resEl.innerHTML = html;

    resEl.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fav-btn')) return;
        navigate(`#/manga/${card.dataset.id}`);
      });
    });

    resEl.querySelectorAll('.fav-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const isFav = btn.dataset.fav === '1';
        try {
          if (isFav) {
            await invoke('remove_favorite', { mangaId: id });
            btn.dataset.fav = '0';
            btn.innerHTML = `${Icons.plus()} Tambah`;
            btn.classList.add('primary');
            showToast('Dihapus dari favorit');
          } else {
            await invoke('add_favorite', { mangaId: id });
            btn.dataset.fav = '1';
            btn.innerHTML = `${Icons.star('', true)} Tersimpan`;
            btn.classList.remove('primary');
            showToast('Ditambahkan ke favorit!');
          }
        } catch (err) {
          showToast(`Error: ${err}`);
        }
      });
    });
  }

  qBtn.addEventListener('click', () => doSearch(qInput.value));
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch(qInput.value);
  });

  doSearch('');
}

async function renderScheduleInto(container) {
  container.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Menghitung kalkulasi jadwal rilis...</p>
    </div>`;

  try {
    const sched = await invoke('schedule_week');
    let html = '';
    const todayStr = new Date().toISOString().split('T')[0];

    sched.days.forEach(day => {
      const isToday = day.date === todayStr;
      const dObj = new Date(day.date + 'T00:00:00');
      const dayName = dObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
      
      html += `
        <div class="day ${isToday ? 'today' : ''}">
          <h3>
            <span>${dayName}</span>
            ${isToday ? '<span class="pill high">HARI INI</span>' : `<span class="pill low">${day.items.length} komik</span>`}
          </h3>
      `;

      if (day.items.length === 0) {
        html += `<div class="s" style="padding: 6px 0; color: var(--text-faint);">Tidak ada jadwal rilis hari ini.</div>`;
      } else {
        day.items.forEach(item => {
          const timeStr = new Date(item.prediction.next_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
          html += `
            <div class="item" data-id="${item.manga_id}">
              <img src="${coverUrl(item.cover)}" loading="lazy" alt="${item.title}" />
              <div class="body">
                <div class="t">${item.title}</div>
                <div class="s">± ${item.prediction.window_hours} jam &bull; Akurasi ${Math.round(item.prediction.confidence * 100)}%</div>
              </div>
              <div class="time">${Icons.clock()} ~${timeStr}</div>
            </div>
          `;
        });
      }
      html += `</div>`;
    });

    if (sched.overdue && sched.overdue.length > 0) {
      html += `<div class="section-title">Terlambat / Kemungkinan Hiatus (${sched.overdue.length})</div>`;
      sched.overdue.forEach(item => {
        html += `
          <div class="card click" data-id="${item.manga_id}">
            <img class="cover" src="${coverUrl(item.cover)}" loading="lazy" alt="${item.title}" />
            <div class="body">
              <div class="t">${item.title}</div>
              <div class="s" style="color:var(--bad);">${Icons.alertTriangle()} ${item.prediction.likely_hiatus ? 'Kemungkinan Hiatus (sudah lewat 2.5x siklus)' : 'Jadwal terlewat'}</div>
            </div>
          </div>
        `;
      });
    }

    container.innerHTML = html;

    container.querySelectorAll('.item, .card').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.id) navigate(`#/manga/${el.dataset.id}`);
      });
    });

  } catch (err) {
    container.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Jadwal</h3>
        <p>${err}</p>
      </div>`;
  }
}

// ================================================================= VIEW: MANGA DETAIL (MIHON GRADE)
let mangaDetailState = {
  mangaId: null,
  sortAsc: false,
  filter: 'all', // 'all' | 'unread' | 'downloaded'
  batchMode: false,
  selectedChapters: new Set(),
};

async function renderMangaDetail(mangaId) {
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
    const detail = await invoke('manga_detail', { mangaId });
    const chRes = await invoke('chapters', { mangaId });
    const readIds = await invoke('list_read_chapters', { mangaId }).catch(() => new Set());
    const progress = await invoke('get_reading_progress', { mangaId }).catch(() => null);
    
    const m = detail.manga;
    const isFav = !!detail.favorite;
    const downloadedSet = new Set(chRes.downloaded || []);
    const readSet = new Set(readIds || []);

    // Save manga meta for history display
    invoke('save_manga_meta', {
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
    if (mangaDetailState.filter === 'unread') {
      chapters = chapters.filter(c => !readSet.has(c.chapter_id));
    } else if (mangaDetailState.filter === 'downloaded') {
      chapters = chapters.filter(c => downloadedSet.has(c.chapter_id));
    }

    const totalChapters = chRes.items.length;
    const unreadCount = chRes.items.filter(c => !readSet.has(c.chapter_id)).length;
    const downloadedCount = downloadedSet.size;

    let resumeBtnHtml = '';
    if (progress) {
      resumeBtnHtml = `
        <button id="resume-reading-btn" class="btn primary small">
          ${Icons.play()} Lanjut Ch. ${progress.chapter_number}
        </button>
      `;
    } else if (chRes.items.length > 0) {
      const firstCh = chRes.items[chRes.items.length - 1]; // oldest chapter
      resumeBtnHtml = `
        <button id="start-reading-btn" class="btn primary small" data-ch-id="${firstCh.chapter_id}">
          ${Icons.play()} Mulai Ch. ${firstCh.chapter_number}
        </button>
      `;
    }

    const coverSrc = coverUrl(m.cover_portrait_url || m.cover_image_url);

    let html = `
      <div class="detail-wrapper">
        <div class="detail-backdrop" style="background-image: url('${coverSrc}');"></div>
        <div class="detail-hero-content">
          <img class="detail-cover" src="${coverSrc}" alt="${m.title}" />
          <div class="detail-info">
            <h2>${m.title}</h2>
            <div class="alt-title">${m.alternative_title || ''}</div>
            ${formatPrediction(detail.prediction)}
            <div class="detail-actions">
              <button id="det-fav-btn" class="btn small ${isFav ? '' : 'primary'}">
                ${isFav ? Icons.star('', true) + ' Tersimpan' : Icons.plus() + ' Tambah Favorit'}
              </button>
              ${resumeBtnHtml}
            </div>
          </div>
        </div>
      </div>

      <div id="desc-box" class="desc-card">${m.description || 'Tidak ada deskripsi tersedia.'}</div>

      <!-- Chapter Toolbar (Mihon-Grade) -->
      <div class="chapter-toolbar">
        <div>
          <b>${totalChapters} Chapter</b> &bull; <span style="color:var(--cyan); font-weight:600;">${unreadCount} Belum</span> &bull; <span style="color:var(--text-faint);">${downloadedCount} Diunduh</span>
        </div>
        <div class="chapter-toolbar-actions">
          <button id="ch-sort-btn" class="ch-sort-btn" title="Urutkan Chapter">
            ${Icons.sort()} ${mangaDetailState.sortAsc ? 'Awal ⬆' : 'Terkini ⬇'}
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
      const isSelected = mangaDetailState.selectedChapters.has(ch.chapter_id);
      const relDate = ch.release_date ? new Date(ch.release_date).toLocaleDateString('id-ID') : '';
      
      html += `
        <div class="chapter ${isRead ? 'read' : ''}" data-ch-id="${ch.chapter_id}" data-ch-num="${ch.chapter_number}">
          ${mangaDetailState.batchMode ? `
            <div class="chapter-select-box ${isSelected ? 'selected' : ''}" data-ch-id="${ch.chapter_id}">
              ${isSelected ? Icons.checkSquare() : Icons.square()}
            </div>
          ` : `
            <button class="ch-read-toggle-btn ${isRead ? 'is-read' : ''}" data-ch-id="${ch.chapter_id}" data-ch-num="${ch.chapter_number}" title="${isRead ? 'Tandai Belum Dibaca' : 'Tandai Sudah Dibaca'}">
              ${isRead ? Icons.check() : Icons.square()}
            </button>
          `}
          <div class="n click">
            <b>Chapter ${ch.chapter_number}</b> ${ch.chapter_title ? `- ${ch.chapter_title}` : ''}
            ${isRead ? `<span class="pill high" style="margin-left:6px;">${Icons.check()} Dibaca</span>` : ''}
            <div class="d">${relDate}</div>
          </div>
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
            <button id="batch-mark-read" class="btn small primary">${Icons.check()} Dibaca</button>
            <button id="batch-mark-unread" class="btn small">Belum</button>
          </div>
        </div>
      `;
    }

    viewEl.innerHTML = html;

    const descBox = document.getElementById('desc-box');
    descBox.addEventListener('click', () => descBox.classList.toggle('open'));

    // Favorite toggle
    const favBtn = document.getElementById('det-fav-btn');
    favBtn.addEventListener('click', async () => {
      try {
        if (detail.favorite) {
          await invoke('remove_favorite', { mangaId });
          showToast('Dihapus dari favorit');
        } else {
          await invoke('add_favorite', { mangaId });
          showToast('Ditambahkan ke favorit');
        }
        renderMangaDetail(mangaId);
      } catch (e) {
        showToast(`Error: ${e}`);
      }
    });

    // Start / Resume buttons
    const resumeBtn = document.getElementById('resume-reading-btn');
    if (resumeBtn && progress) {
      resumeBtn.addEventListener('click', () => navigate(`#/read/${progress.chapter_id}`));
    }
    const startBtn = document.getElementById('start-reading-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => navigate(`#/read/${startBtn.dataset.chId}`));
    }

    // Sort button
    document.getElementById('ch-sort-btn').addEventListener('click', () => {
      mangaDetailState.sortAsc = !mangaDetailState.sortAsc;
      renderMangaDetail(mangaId);
    });

    // Filter button: all -> unread -> downloaded -> all
    document.getElementById('ch-filter-btn').addEventListener('click', () => {
      if (mangaDetailState.filter === 'all') mangaDetailState.filter = 'unread';
      else if (mangaDetailState.filter === 'unread') mangaDetailState.filter = 'downloaded';
      else mangaDetailState.filter = 'all';
      renderMangaDetail(mangaId);
    });

    // Batch mode toggle button
    document.getElementById('ch-batch-btn').addEventListener('click', () => {
      mangaDetailState.batchMode = !mangaDetailState.batchMode;
      mangaDetailState.selectedChapters.clear();
      renderMangaDetail(mangaId);
    });

    // Chapter row clicks
    viewEl.querySelectorAll('.chapter').forEach(row => {
      const chId = row.dataset.chId;
      const chNum = parseFloat(row.dataset.chNum);

      if (mangaDetailState.batchMode) {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.dl-btn')) return;
          if (mangaDetailState.selectedChapters.has(chId)) {
            mangaDetailState.selectedChapters.delete(chId);
          } else {
            mangaDetailState.selectedChapters.add(chId);
          }
          const box = row.querySelector('.chapter-select-box');
          const isSelected = mangaDetailState.selectedChapters.has(chId);
          if (box) {
            box.classList.toggle('selected', isSelected);
            box.innerHTML = isSelected ? Icons.checkSquare() : Icons.square();
          }
          const countEl = document.getElementById('batch-count-text');
          if (countEl) countEl.textContent = `${mangaDetailState.selectedChapters.size} dipilih`;
        });
      } else {
        // Normal mode: click text opens chapter
        const nEl = row.querySelector('.n');
        if (nEl) {
          nEl.addEventListener('click', () => navigate(`#/read/${chId}`));
        }
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
          await invoke('mark_chapter_read', {
            mangaId,
            chapterId: chId,
            chapterNumber: chNum,
            read: nextState,
          });
          btn.classList.toggle('is-read', nextState);
          btn.innerHTML = nextState ? Icons.check() : Icons.square();
          btn.closest('.chapter').classList.toggle('read', nextState);
          showToast(nextState ? `Chapter ${chNum} ditandai dibaca` : `Chapter ${chNum} ditandai belum dibaca`);
        } catch (err) {
          showToast(`Error: ${err}`);
        }
      });
    });

    // Batch actions
    if (mangaDetailState.batchMode) {
      document.getElementById('batch-all-btn').addEventListener('click', () => {
        const allSelected = mangaDetailState.selectedChapters.size === chapters.length;
        if (allSelected) {
          mangaDetailState.selectedChapters.clear();
        } else {
          chapters.forEach(c => mangaDetailState.selectedChapters.add(c.chapter_id));
        }
        renderMangaDetail(mangaId);
      });

      document.getElementById('batch-mark-read').addEventListener('click', async () => {
        if (mangaDetailState.selectedChapters.size === 0) {
          showToast('Pilih minimal satu chapter');
          return;
        }
        const toMark = chapters
          .filter(c => mangaDetailState.selectedChapters.has(c.chapter_id))
          .map(c => [c.chapter_id, c.chapter_number]);
        try {
          await invoke('mark_chapters_batch', {
            mangaId,
            chapters: toMark,
            read: true,
          });
          showToast(`${toMark.length} chapter ditandai dibaca`);
          mangaDetailState.batchMode = false;
          mangaDetailState.selectedChapters.clear();
          renderMangaDetail(mangaId);
        } catch (err) {
          showToast(`Error: ${err}`);
        }
      });

      document.getElementById('batch-mark-unread').addEventListener('click', async () => {
        if (mangaDetailState.selectedChapters.size === 0) {
          showToast('Pilih minimal satu chapter');
          return;
        }
        const toMark = chapters
          .filter(c => mangaDetailState.selectedChapters.has(c.chapter_id))
          .map(c => [c.chapter_id, c.chapter_number]);
        try {
          await invoke('mark_chapters_batch', {
            mangaId,
            chapters: toMark,
            read: false,
          });
          showToast(`${toMark.length} chapter ditandai belum dibaca`);
          mangaDetailState.batchMode = false;
          mangaDetailState.selectedChapters.clear();
          renderMangaDetail(mangaId);
        } catch (err) {
          showToast(`Error: ${err}`);
        }
      });
    }

    // Download button handler
    viewEl.querySelectorAll('.dl-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chId = btn.dataset.chId;

        if (btn.innerHTML.includes('Hapus')) {
          try {
            await invoke('delete_download', { chapterId: chId });
            btn.innerHTML = `${Icons.download()} Unduh`;
            showToast('Download chapter dihapus');
          } catch (err) {
            showToast(`Gagal hapus: ${err}`);
          }
        } else {
          btn.disabled = true;
          btn.textContent = 'Mengunduh...';
          try {
            const pages = await invoke('download_chapter', { chapterId: chId });
            btn.innerHTML = `${Icons.trash()} Hapus`;
            showToast(`Berhasil diunduh (${pages} halaman, siap dibaca offline)`);
          } catch (err) {
            showToast(`Gagal unduh: ${err}`);
            btn.innerHTML = `${Icons.download()} Unduh`;
          } finally {
            btn.disabled = false;
          }
        }
      });
    });

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

// ================================================================= VIEW: MIHON READER
async function renderReader(chapterId) {
  setHeaderTitles('Membaca', 'Memuat Chapter...');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Menyiapkan halaman...</p>
    </div>`;

  try {
    const data = await invoke('open_chapter', { chapterId });
    setHeaderTitles(`Ch. ${data.chapter_number}`, data.offline ? 'Mode Offline' : 'Mode Online');

    let currentPageIdx = 0;
    const totalPages = data.pages.length;

    // Save initial reading progress
    invoke('save_reading_progress', {
      mangaId: data.manga_id,
      chapterId: data.chapter_id,
      chapterNumber: data.chapter_number,
      lastPage: 0
    }).catch(e => console.warn('Save progress error:', e));

    let modeLabel = 'Webtoon';
    if (readerMode === 'paged-ltr') modeLabel = 'Paged L-R';
    if (readerMode === 'paged-rtl') modeLabel = 'Manga R-L';

    let html = `
      <div class="reader-wrapper">
        <!-- Floating HUD Top -->
        <div id="reader-hud-top" class="reader-hud-top">
          <button id="reader-back" class="icon-btn" aria-label="Kembali">${Icons.back()}</button>
          <div style="flex:1; overflow:hidden;">
            <div style="font-weight:700; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#fff;">Chapter ${data.chapter_number}</div>
            <div style="font-size:11px; color:var(--text-muted);">${totalPages} Halaman ${data.offline ? '&bull; Offline' : ''}</div>
          </div>
          <button id="reader-mode-btn" class="btn small" style="background:var(--surface-elevated);" title="Ganti Mode Baca">
            ${readerMode === 'webtoon' ? Icons.scroll() : Icons.book()} ${modeLabel}
          </button>
        </div>

        <!-- Reader Main Content -->
        <div id="reader-content"></div>

        <!-- Floating HUD Bottom -->
        <div id="reader-hud-bottom" class="reader-hud-bottom">
          <div class="hud-scrubber-row">
            <span id="hud-page-pill" class="hud-page-pill">1 / ${totalPages}</span>
            <input id="hud-slider" type="range" min="1" max="${totalPages}" value="1" />
          </div>
          <div class="hud-nav-row">
            <button id="reader-prev-ch" class="btn small" ${!data.prev_chapter_id ? 'disabled' : ''}>
              ${Icons.back()} Sebelumnya
            </button>
            <button id="reader-next-ch" class="btn small primary" ${!data.next_chapter_id ? 'disabled' : ''}>
              Lanjut ${Icons.chevronRight()}
            </button>
          </div>
        </div>
      </div>
    `;

    viewEl.innerHTML = html;

    const contentEl = document.getElementById('reader-content');
    const hudTop = document.getElementById('reader-hud-top');
    const hudBottom = document.getElementById('reader-hud-bottom');
    const pagePill = document.getElementById('hud-page-pill');
    const slider = document.getElementById('hud-slider');
    const modeBtn = document.getElementById('reader-mode-btn');

    let hudVisible = true;
    function setHudVisibility(visible) {
      hudVisible = visible;
      hudTop.classList.toggle('reader-hud-hidden', !visible);
      hudBottom.classList.toggle('reader-hud-hidden', !visible);
    }

    function markChapterCompleted() {
      invoke('mark_chapter_read', {
        mangaId: data.manga_id,
        chapterId: data.chapter_id,
        chapterNumber: data.chapter_number,
        read: true,
      }).catch(e => console.warn('Auto mark read err:', e));
    }

    function renderModeView() {
      if (readerMode === 'webtoon') {
        // Continuous Scroll (Webtoon)
        let scrollHtml = `<div class="reader-scroll">`;
        data.pages.forEach((file, idx) => {
          scrollHtml += `<img src="${pageUrl(data.chapter_id, file)}" loading="lazy" data-page="${idx + 1}" alt="Page ${idx + 1}" />`;
        });

        // Chapter End Card
        scrollHtml += `
          <div class="chapter-end-card">
            <div class="chapter-end-title">🎉 Chapter Selesai!</div>
            <div class="chapter-end-desc">Kamu telah menyelesaikan Chapter ${data.chapter_number}.</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:center; width:100%; max-width:400px; margin-top:8px;">
              ${data.next_chapter_id ? `<button class="btn primary block" id="scroll-next-btn">${Icons.play()} Lanjut ke Chapter Selanjutnya</button>` : ''}
              ${data.prev_chapter_id ? `<button class="btn small" id="scroll-prev-btn">${Icons.back()} Chapter Sebelumnya</button>` : ''}
              <button class="btn small" id="scroll-detail-btn">Kembali ke Info Komik</button>
            </div>
          </div>
        </div>`;

        contentEl.innerHTML = scrollHtml;

        const spBtn = document.getElementById('scroll-prev-btn');
        if (spBtn) spBtn.addEventListener('click', () => navigate(`#/read/${data.prev_chapter_id}`));
        const snBtn = document.getElementById('scroll-next-btn');
        if (snBtn) snBtn.addEventListener('click', () => navigate(`#/read/${data.next_chapter_id}`));
        const sdBtn = document.getElementById('scroll-detail-btn');
        if (sdBtn) sdBtn.addEventListener('click', () => navigate(`#/manga/${data.manga_id}`));

        // Click to toggle HUD
        contentEl.querySelectorAll('.reader-scroll img').forEach(img => {
          img.addEventListener('click', () => setHudVisibility(!hudVisible));
        });

        // Track scroll position for scrubber
        window.onscroll = () => {
          const imgs = contentEl.querySelectorAll('img[data-page]');
          let cur = 1;
          for (let img of imgs) {
            const rect = img.getBoundingClientRect();
            if (rect.top <= window.innerHeight * 0.5 && rect.bottom >= 0) {
              cur = parseInt(img.dataset.page, 10);
            }
          }
          pagePill.textContent = `${cur} / ${totalPages}`;
          slider.value = cur;

          // If reached last page, auto mark read
          if (cur >= totalPages) {
            markChapterCompleted();
          }

          // Save progress
          invoke('save_reading_progress', {
            mangaId: data.manga_id,
            chapterId: data.chapter_id,
            chapterNumber: data.chapter_number,
            lastPage: cur - 1
          }).catch(() => {});
        };

      } else {
        // Paged Mode (LTR or RTL)
        window.onscroll = null;
        function showPagedImage(idx) {
          if (idx >= totalPages) {
            // Show End of Chapter Screen
            markChapterCompleted();
            contentEl.innerHTML = `
              <div class="reader-paged" style="padding: 40px 14px;">
                <div class="chapter-end-card" style="width:100%; max-width:440px;">
                  <div class="chapter-end-title">🎉 Chapter ${data.chapter_number} Selesai!</div>
                  <div class="chapter-end-desc">Semua halaman telah dibaca.</div>
                  <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin-top:8px;">
                    ${data.next_chapter_id ? `<button class="btn primary" id="paged-next-ch-btn">${Icons.play()} Lanjut ke Chapter Selanjutnya</button>` : ''}
                    <button class="btn" id="paged-replay-btn">${Icons.sync()} Baca Ulang Chapter Ini</button>
                    <button class="btn small" id="paged-detail-btn">Kembali ke Komik</button>
                  </div>
                </div>
              </div>
            `;
            const pnBtn = document.getElementById('paged-next-ch-btn');
            if (pnBtn) pnBtn.addEventListener('click', () => navigate(`#/read/${data.next_chapter_id}`));
            document.getElementById('paged-replay-btn').addEventListener('click', () => showPagedImage(0));
            document.getElementById('paged-detail-btn').addEventListener('click', () => navigate(`#/manga/${data.manga_id}`));
            return;
          }

          currentPageIdx = Math.max(0, Math.min(idx, totalPages - 1));
          pagePill.textContent = `${currentPageIdx + 1} / ${totalPages}`;
          slider.value = currentPageIdx + 1;

          if (currentPageIdx === totalPages - 1) {
            markChapterCompleted();
          }

          const file = data.pages[currentPageIdx];
          contentEl.innerHTML = `
            <div class="reader-paged">
              <div class="reader-tap-left" id="tap-left"></div>
              <div class="reader-tap-center" id="tap-center"></div>
              <div class="reader-tap-right" id="tap-right"></div>
              <img src="${pageUrl(data.chapter_id, file)}" alt="Page ${currentPageIdx + 1}" />
            </div>
          `;

          const isRTL = readerMode === 'paged-rtl';

          document.getElementById('tap-left').addEventListener('click', () => {
            if (isRTL) {
              // RTL: left tap = NEXT page
              showPagedImage(currentPageIdx + 1);
            } else {
              // LTR: left tap = PREV page
              if (currentPageIdx > 0) showPagedImage(currentPageIdx - 1);
              else if (data.prev_chapter_id) navigate(`#/read/${data.prev_chapter_id}`);
              else showToast('Halaman pertama');
            }
          });

          document.getElementById('tap-center').addEventListener('click', () => {
            setHudVisibility(!hudVisible);
          });

          document.getElementById('tap-right').addEventListener('click', () => {
            if (isRTL) {
              // RTL: right tap = PREV page
              if (currentPageIdx > 0) showPagedImage(currentPageIdx - 1);
              else if (data.prev_chapter_id) navigate(`#/read/${data.prev_chapter_id}`);
              else showToast('Halaman pertama');
            } else {
              // LTR: right tap = NEXT page
              showPagedImage(currentPageIdx + 1);
            }
          });

          // Save reading progress
          invoke('save_reading_progress', {
            mangaId: data.manga_id,
            chapterId: data.chapter_id,
            chapterNumber: data.chapter_number,
            lastPage: currentPageIdx
          }).catch(() => {});
        }

        showPagedImage(0);
      }
    }

    renderModeView();

    // Mode toggle button: webtoon -> paged-ltr -> paged-rtl -> webtoon
    modeBtn.addEventListener('click', () => {
      if (readerMode === 'webtoon') readerMode = 'paged-ltr';
      else if (readerMode === 'paged-ltr') readerMode = 'paged-rtl';
      else readerMode = 'webtoon';

      localStorage.setItem('shinitrack_reader_mode', readerMode);
      
      let nextLabel = 'Webtoon';
      if (readerMode === 'paged-ltr') nextLabel = 'Paged L-R';
      if (readerMode === 'paged-rtl') nextLabel = 'Manga R-L';

      modeBtn.innerHTML = `${readerMode === 'webtoon' ? Icons.scroll() : Icons.book()} ${nextLabel}`;
      showToast(`Mode Baca: ${nextLabel}`);
      renderModeView();
    });

    // Scrubber slider
    slider.addEventListener('input', (e) => {
      const page = parseInt(e.target.value, 10);
      pagePill.textContent = `${page} / ${totalPages}`;
      if (readerMode === 'webtoon') {
        const targetImg = contentEl.querySelector(`img[data-page="${page}"]`);
        if (targetImg) targetImg.scrollIntoView({ behavior: 'smooth' });
      } else {
        currentPageIdx = page - 1;
        const file = data.pages[currentPageIdx];
        const img = contentEl.querySelector('.reader-paged img');
        if (img) img.src = pageUrl(data.chapter_id, file);
      }
    });

    // Top HUD Back
    document.getElementById('reader-back').addEventListener('click', () => {
      window.history.back();
    });

    // Bottom HUD Navigation
    const prevChBtn = document.getElementById('reader-prev-ch');
    if (prevChBtn && data.prev_chapter_id) {
      prevChBtn.addEventListener('click', () => navigate(`#/read/${data.prev_chapter_id}`));
    }
    const nextChBtn = document.getElementById('reader-next-ch');
    if (nextChBtn && data.next_chapter_id) {
      nextChBtn.addEventListener('click', () => navigate(`#/read/${data.next_chapter_id}`));
    }

    window.scrollTo({ top: 0, behavior: 'instant' });

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Chapter</h3>
        <p>${err}</p>
        <button class="btn primary small" onclick="window.history.back()">Kembali</button>
      </div>`;
  }
}

// ================================================================= VIEW: UPDATES
async function renderUpdates() {
  setHeaderTitles('Update', 'Notifikasi Chapter Baru');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Memuat notifikasi update...</p>
    </div>`;

  try {
    const events = await invoke('recent_events');
    if (events.length === 0) {
      viewEl.innerHTML = `
        <div class="empty">
          ${Icons.emptyUpdates()}
          <h3>Belum Ada Update Baru</h3>
          <p>Update chapter baru dari komik favorit pilihanmu akan otomatis muncul di sini.</p>
        </div>`;
      return;
    }

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span class="s" style="color:var(--text-faint);">Total ${events.length} notifikasi</span>
        <button id="mark-seen" class="btn small">${Icons.check()} Tandai Dibaca</button>
      </div>
    `;

    events.forEach(e => {
      const relTime = e.released_at ? new Date(e.released_at).toLocaleString('id-ID') : '';
      html += `
        <div class="card click" data-ch-id="${e.chapter_id}" data-manga-id="${e.manga_id}">
          <img class="cover" src="${coverUrl(e.cover)}" loading="lazy" alt="${e.title}" />
          <div class="body">
            <div class="t">${e.title}</div>
            <div class="s"><b>Chapter ${e.chapter_number}</b> &bull; ${relTime}</div>
          </div>
          ${!e.seen ? '<span class="pill new">BARU</span>' : ''}
        </div>
      `;
    });

    viewEl.innerHTML = html;

    document.getElementById('mark-seen').addEventListener('click', async () => {
      await invoke('mark_events_seen');
      refreshBadge();
      renderUpdates();
    });

    viewEl.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', () => {
        navigate(`#/read/${card.dataset.chId}`);
      });
    });

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Update</h3>
        <p>${err}</p>
      </div>`;
  }
}

// ================================================================= VIEW: SETTINGS (MIHON STYLE)
async function renderSettings() {
  setHeaderTitles('Pengaturan', 'Preferensi & Pembaruan');
  viewEl.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Memuat konfigurasi...</p>
    </div>`;

  try {
    const s = await invoke('settings_get');
    const appInfo = await invoke('get_app_info').catch(() => ({
      name: 'ShiniTrack',
      version: '0.2.0',
      build_code: 2000,
      platform: 'android'
    }));

    viewEl.innerHTML = `
      <!-- Version & Status Card -->
      <div class="version-card">
        <div class="vc-info">
          <div class="vc-name">${appInfo.name} v${appInfo.version}</div>
          <div class="vc-meta">Build ${appInfo.build_code} &bull; ${appInfo.platform.toUpperCase()}</div>
          <div id="vc-status" class="vc-status up-to-date">${Icons.check()} Versi Terpasang Siap</div>
        </div>
        <button id="check-update-btn" class="btn small primary">${Icons.sync()} Cek Update</button>
      </div>

      <div class="section-title">Pembaruan OTA (GitHub Releases)</div>
      <div class="settings-group">
        <div class="field">
          <label>GitHub Repository Target</label>
          <input id="cfg-repo" type="text" placeholder="shinitrack/shinitrack" value="${s.github_repo || 'shinitrack/shinitrack'}" />
        </div>

        <div class="switch-row">
          <div>
            <div class="switch-label">Cek Otomatis Saat Membuka Aplikasi</div>
            <div class="switch-sub">Periksa rilis APK terbaru secara senyap saat startup</div>
          </div>
          <label class="switch">
            <input id="cfg-autoupdate" type="checkbox" ${s.auto_check_update !== false ? 'checked' : ''} />
            <span class="slider-switch"></span>
          </label>
        </div>

        <div style="margin-top: 14px;">
          <button id="sim-update-btn" class="btn small block">${Icons.rocket()} Uji Simulasi Dialog Pembaruan</button>
        </div>
      </div>

      <div class="section-title">Server Poller & Notifikasi Mandiri</div>
      <div class="settings-group">
        <div class="field">
          <label>Server Endpoint URL (Opsional)</label>
          <input id="cfg-url" type="url" placeholder="http://192.168.1.15:8787" value="${s.server_url || ''}" />
        </div>

        <div class="field">
          <label>Server Bearer Token</label>
          <input id="cfg-token" type="password" placeholder="Token rahasia server" value="${s.server_token || ''}" />
        </div>

        <div class="switch-row">
          <div>
            <div class="switch-label">Kompresi Gambar WebP</div>
            <div class="switch-sub">Menghemat kuota mobile & mempercepat pemuatan gambar</div>
          </div>
          <label class="switch">
            <input id="cfg-low" type="checkbox" ${s.low_quality ? 'checked' : ''} />
            <span class="slider-switch"></span>
          </label>
        </div>

        <button id="save-cfg" class="btn primary block" style="margin-top:14px;">${Icons.check()} Simpan Pengaturan</button>
      </div>

      <div class="note">
        <b>Arsitektur Notifikasi Realtime:</b><br/>
        1. <b>Filter Ketat:</b> Hanya komik favorit yang ditandai aktif yang dapat memicu notifikasi.<br/>
        2. <b>Mode Siaga:</b> Saat HP offline/mati, server mengantrekan update dan langsung mengirimkannya begitu koneksi pulih.<br/>
        3. <b>Offline Reader:</b> Unduh chapter agar bisa dibaca tanpa internet sama sekali.
      </div>

      <div class="section-title">Diagnostik Sistem</div>
      <button id="test-notif-btn" class="btn block">${Icons.bell()} Tes Notifikasi Lokal Android</button>
    `;

    // Check update button
    const checkBtn = document.getElementById('check-update-btn');
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      checkBtn.innerHTML = `${Icons.sync('spin')} Mengecek...`;
      const repoInput = document.getElementById('cfg-repo').value.trim();
      await checkForUpdates(false, repoInput || null);
      checkBtn.disabled = false;
      checkBtn.innerHTML = `${Icons.sync()} Cek Update`;
    });

    // Simulate update button
    const simBtn = document.getElementById('sim-update-btn');
    simBtn.addEventListener('click', async () => {
      try {
        const mock = await invoke('simulate_update_check');
        showUpdateModal(mock);
      } catch (err) {
        showToast(`Simulasi gagal: ${err}`);
      }
    });

    // Save config
    document.getElementById('save-cfg').addEventListener('click', async () => {
      const newSettings = {
        server_url: document.getElementById('cfg-url').value.trim() || null,
        server_token: document.getElementById('cfg-token').value.trim() || null,
        low_quality: document.getElementById('cfg-low').checked,
        github_repo: document.getElementById('cfg-repo').value.trim() || 'shinitrack/shinitrack',
        auto_check_update: document.getElementById('cfg-autoupdate').checked
      };

      try {
        const res = await invoke('settings_set', { settings: newSettings });
        showToast(res.message);
      } catch (err) {
        showToast(`Gagal menyimpan: ${err}`);
      }
    });

    // Local notification test
    document.getElementById('test-notif-btn').addEventListener('click', async () => {
      try {
        await invoke('test_notification');
        showToast('Notifikasi tes berhasil dikirim!');
      } catch (e) {
        showToast(`Gagal kirim notif: ${e}`);
      }
    });

  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty">
        ${Icons.alertTriangle()}
        <h3>Gagal Memuat Pengaturan</h3>
        <p>${err}</p>
      </div>`;
  }
}

function setupGlobalEvents() {
  if (eventApi && eventApi.listen) {
    // Listen to APK download progress
    eventApi.listen('update-download-progress', (e) => {
      const p = e.payload;
      const dlBar = document.getElementById('dl-bar');
      const dlPct = document.getElementById('dl-pct');
      const dlText = document.getElementById('dl-text');
      if (dlBar && dlPct && p) {
        dlBar.style.width = `${p.progress}%`;
        dlPct.textContent = `${p.progress}%`;
        if (p.total_bytes > 0) {
          const mbDone = (p.downloaded_bytes / (1024 * 1024)).toFixed(1);
          const mbTotal = (p.total_bytes / (1024 * 1024)).toFixed(1);
          dlText.textContent = `Mengunduh (${mbDone} MB / ${mbTotal} MB)...`;
        }
      }
    });

    // Listen to chapter download progress
    eventApi.listen('download-progress', (e) => {
      console.log('Chapter download progress:', e.payload);
    });
  }
}

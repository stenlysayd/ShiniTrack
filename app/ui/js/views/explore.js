import { state } from '../state.js';
import { navigate } from '../router.js';
import * as utils from '../utils.js';
import * as api from '../api.js';

const { setHeaderTitles, coverUrl, showToast } = utils;
const viewEl = document.getElementById('view');

// ================================================================= VIEW: SEARCH / EXPLORE
export async function renderSearch(tabOverride) {
  if (tabOverride) state.exploreTab = tabOverride;
  setHeaderTitles('Eksplorasi', state.exploreTab === 'catalog' ? 'Katalog Shinigami' : 'Jadwal Rilis Mingguan');

  viewEl.innerHTML = `
    <div class="explore-tabs">
      <div id="tab-catalog" class="explore-tab-btn ${state.exploreTab === 'catalog' ? 'active' : ''}">
        ${Icons.search()} Katalog Komik
      </div>
      <div id="tab-schedule" class="explore-tab-btn ${state.exploreTab === 'schedule' ? 'active' : ''}">
        ${Icons.schedule()} Jadwal Rilis
      </div>
    </div>
    <div id="explore-content"></div>
  `;

  document.getElementById('tab-catalog').addEventListener('click', () => {
    state.exploreTab = 'catalog';
    renderSearch();
  });
  document.getElementById('tab-schedule').addEventListener('click', () => {
    state.exploreTab = 'schedule';
    renderSearch();
  });

  const contentEl = document.getElementById('explore-content');
  if (state.exploreTab === 'schedule') {
    renderScheduleInto(contentEl);
  } else {
    renderCatalogInto(contentEl);
  }
}

export async function renderCatalogInto(container) {
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
        items = await api.latest();
      } else {
        const res = await api.search({ query: query.trim() });
        items = res.items;
      }
      renderCards(items);
    } catch (e) {
      const errStr = String(e?.message || e || 'Terjadi kesalahan jaringan.');
      resEl.innerHTML = `
        <div class="empty">
          ${Icons.alertTriangle()}
          <h3>Gagal Memuat Katalog</h3>
          <p style="margin-bottom:14px; max-width:340px; word-break:break-word;">${utils.escapeHtml(errStr)}</p>
          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            <button id="retry-search-btn" class="btn primary small">${Icons.sync()} Coba Lagi</button>
            <button id="diag-network-btn" class="btn small">${Icons.settings ? Icons.settings() : Icons.sync()} Diagnosa Koneksi</button>
          </div>
        </div>`;
      document.getElementById('retry-search-btn')?.addEventListener('click', () => doSearch(query));
      document.getElementById('diag-network-btn')?.addEventListener('click', () => showNetworkDiagnosisSheet());
    }
  }

  async function showNetworkDiagnosisSheet() {
    const overlay = document.createElement('div');
    overlay.className = 'net-diag-backdrop';
    overlay.innerHTML = `
      <div class="net-diag-sheet">
        <div class="net-diag-header">
          <h3 class="net-diag-title">Diagnosa Koneksi</h3>
          <button class="net-diag-close">&times;</button>
        </div>
        <div id="net-diag-body">
          <div style="text-align:center; padding:20px 0;">
            <div class="svg-icon spin">${Icons.sync()}</div>
            <p style="margin-top:10px; font-size:0.9rem;">Memeriksa koneksi jaringan...</p>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.net-diag-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) overlay.remove();
    });

    try {
      const invoker = window.__TAURI__ ? window.__TAURI__.core.invoke : null;
      if (!invoker) {
        document.getElementById('net-diag-body').innerHTML = '<p class="net-status-err">Tidak dapat menjalankan diagnosa di luar aplikasi Tauri.</p>';
        return;
      }
      const diag = await invoker('diagnose_network');
      const checks = diag?.checks || [];

      // Analyze conclusion
      const gstatic = checks.find(c => c.host === 'www.gstatic.com');
      const shinigamiHosts = checks.filter(c => c.host !== 'www.gstatic.com');

      let conclusion = 'Semua jalur koneksi berfungsi normal.';
      const gstaticOk = gstatic && (gstatic.https_status === 204 || (gstatic.system_dns_ips && gstatic.system_dns_ips.length > 0));
      const shiniDnsFailed = shinigamiHosts.some(c => (!c.system_dns_ips || c.system_dns_ips.length === 0) && c.doh_ips && c.doh_ips.length > 0);

      if (gstaticOk && shiniDnsFailed) {
        conclusion = 'DNS operator memblokir domain. Aktifkan DoH di Pengaturan > Jaringan.';
      } else if (shinigamiHosts.some(c => c.error || (c.https_status && c.https_status >= 400))) {
        conclusion = 'Server target mengalami kendala atau menolak sambungan.';
      } else if (!gstaticOk) {
        conclusion = 'Tidak ada sambungan internet yang terdeteksi.';
      }

      let rowsHtml = '';
      for (const c of checks) {
        const sysDns = c.system_dns_ms != null ? `<span class="net-status-ok">${c.system_dns_ms}ms</span>` : '<span class="net-status-err">Gagal</span>';
        const doh = c.doh_ms != null ? `<span class="net-status-ok">${c.doh_ms}ms</span>` : '<span class="net-status-err">Gagal</span>';
        const tcp = c.tcp443_ms != null ? `<span class="net-status-ok">${c.tcp443_ms}ms</span>` : '<span class="net-status-err">Gagal</span>';
        const https = c.https_status != null ? `<span class="net-status-ok">${c.https_status}</span>` : `<span class="net-status-err">${utils.escapeHtml(c.error || 'Error')}</span>`;

        rowsHtml += `
          <tr>
            <td><strong>${utils.escapeHtml(c.host)}</strong></td>
            <td>${sysDns}</td>
            <td>${doh}</td>
            <td>${tcp}</td>
            <td>${https}</td>
          </tr>
        `;
      }

      document.getElementById('net-diag-body').innerHTML = `
        <div class="net-diag-conclusion">${utils.escapeHtml(conclusion)}</div>
        <table class="net-diag-table">
          <thead>
            <tr>
              <th>Host</th>
              <th>DNS Sys</th>
              <th>DoH</th>
              <th>TCP</th>
              <th>HTTPS</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      `;
    } catch (err) {
      document.getElementById('net-diag-body').innerHTML = `
        <p class="net-status-err">Gagal menjalankan diagnosa: ${utils.escapeHtml(String(err))}</p>
      `;
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
          <img class="cover" src="${coverUrl(m.cover_portrait_url || m.cover_image_url)}" loading="lazy" alt="${utils.escapeHtml(m.title)}" />
          <div class="body">
            <div class="t">${utils.escapeHtml(m.title)}</div>
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
            await api.remove_favorite({ mangaId: id });
            btn.dataset.fav = '0';
            btn.innerHTML = `${Icons.plus()} Tambah`;
            btn.classList.add('primary');
            showToast('Dihapus dari favorit');
          } else {
            await api.add_favorite({ mangaId: id });
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

export async function renderScheduleInto(container) {
  container.innerHTML = `
    <div class="empty">
      <div class="svg-icon spin">${Icons.sync()}</div>
      <p style="margin-top:12px;">Menghitung kalkulasi jadwal rilis...</p>
    </div>`;

  try {
    const sched = await api.schedule_week();
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
              <img src="${coverUrl(item.cover)}" loading="lazy" alt="${utils.escapeHtml(item.title)}" />
              <div class="body">
                <div class="t">${utils.escapeHtml(item.title)}</div>
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
            <img class="cover" src="${coverUrl(item.cover)}" loading="lazy" alt="${utils.escapeHtml(item.title)}" />
            <div class="body">
              <div class="t">${utils.escapeHtml(item.title)}</div>
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


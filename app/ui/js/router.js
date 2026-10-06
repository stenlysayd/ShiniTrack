import { state } from './state.js';
import { renderFavorites, renderUpdates, renderHistory, renderSearch, renderSettings, renderMangaDetail, renderReader, renderDevComponents, renderMore, renderMorePlaceholder, renderCategories } from './main.js';
import { renderSettingsSubpage } from './views/settings/index.js';
import { renderTampilan } from './views/settings/tampilan.js';
import { renderPustaka } from './views/settings/pustaka.js';
import { renderPembaca } from './views/settings/pembaca.js';
import { renderUnduhan } from './views/settings/unduhan.js';
import { renderSinkronisasi } from './views/settings/sinkronisasi.js';
import { renderJelajahi } from './views/settings/jelajahi.js';
import { renderPenyimpanan } from './views/settings/penyimpanan.js';
import { renderKeamanan } from './views/settings/keamanan.js';
import { renderLanjutan } from './views/settings/lanjutan.js';
import { renderTentang } from './views/settings/tentang.js';
import { renderDownloadQueue } from './views/download-queue.js';
import { renderStatistik } from './views/statistik.js';
import { cleanupReader } from './views/reader.js';
import { motion } from './motion.js';
import * as utils from './utils.js';

const TOP_TABS = ['/library', '/updates', '/history', '/explore', '/schedule', '/more'];

function isTopTab(route) {
  return TOP_TABS.includes(route);
}

function isPushScreen(route) {
  return route.startsWith('/manga/') ||
         (route.startsWith('/more/') && route !== '/more') ||
         route === '/dev/components';
}

function getRouteDepth(route) {
  if (!route) return 0;
  if (route.startsWith('/read/')) return 3;
  if (route.startsWith('/more/settings/')) return 2;
  if (isPushScreen(route)) return 1;
  return 0;
}

let historyStack = [];
let isTabClick = false;
let isBackClick = false;

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest) {
      if (e.target.closest('.tabbar a')) {
        isTabClick = true;
      } else if (e.target.closest('#back') || e.target.closest('#reader-back')) {
        isBackClick = true;
      }
    }
  }, true);
}

export function navigate(hash) {
  window.location.hash = hash;
}

export function handleRoute() {
  const hash = window.location.hash.slice(1) || '/library';
  const [path, queryString] = hash.split('?');
  const query = queryString ? `?${queryString}` : '';

  // Redirects for backward compatibility (Roadmap Task 1.1)
  if (path === '/favorites') {
    navigate('#/library' + query);
    return;
  }
  if (path === '/search') {
    navigate('#/explore' + query);
    return;
  }
  if (path === '/settings') {
    navigate('#/more/settings' + query);
    return;
  }

  const prevRoute = state.currentRoute;
  state.currentRoute = path;

  const wasTabClick = isTabClick;
  const wasBackClick = isBackClick;
  isTabClick = false;
  isBackClick = false;

  let isBack = false;
  if (wasTabClick) {
    isBack = false;
    historyStack = [path];
  } else if (wasBackClick) {
    isBack = true;
    if (historyStack.length > 1) historyStack.pop();
  } else if (historyStack.length > 1 && historyStack[historyStack.length - 2] === path) {
    isBack = true;
    historyStack.pop();
  } else if (prevRoute && getRouteDepth(prevRoute) > getRouteDepth(path) && !isTopTab(path)) {
    isBack = true;
    if (historyStack.length > 1) historyStack.pop();
  } else {
    isBack = false;
    if (historyStack[historyStack.length - 1] !== path) {
      historyStack.push(path);
    }
  }

  // Highlight active tab
  document.querySelectorAll('.tabbar a').forEach(a => {
    const tab = a.getAttribute('data-tab');
    const isMatch = (
      (tab === 'library' && path.startsWith('/library')) ||
      (tab === 'updates' && path.startsWith('/updates')) ||
      (tab === 'history' && path.startsWith('/history')) ||
      (tab === 'explore' && (path.startsWith('/explore') || path === '/schedule')) ||
      (tab === 'more' && path.startsWith('/more'))
    );
    const wasActive = a.classList.contains('active');

    if (isMatch) {
      a.classList.add('active');
      if (!wasActive && prevRoute) {
        const pill = a.querySelector('.tab-icon');
        if (pill) {
          motion.navPill(pill);
        }
      }
    } else {
      a.classList.remove('active');
    }
  });

  // Fullscreen reader mode & cleanup (Task 6.10)
  if (path.startsWith('/read/')) {
    document.body.classList.add('reader-active');
  } else {
    cleanupReader();
  }

  // Handle subpages & back button
  const backBtn = document.getElementById('back');
  if (backBtn) {
    if (path.startsWith('/manga/') || path.startsWith('/read/') || path.startsWith('/more/')) {
      backBtn.classList.remove('hidden');
    } else {
      backBtn.classList.add('hidden');
    }
  }

  // 3. Before a view is replaced, kill running tweens on the old container
  const container = document.getElementById('view');
  if (container) {
    motion.kill(container);
  }

  if (path === '/library') renderFavorites();
  else if (path === '/updates') renderUpdates();
  else if (path === '/history') renderHistory();
  else if (path === '/explore') {
    state.exploreTab = 'catalog';
    renderSearch();
  }
  else if (path === '/schedule') {
    state.exploreTab = 'schedule';
    renderSearch();
  }
  else if (path === '/more') renderMore();
  else if (path === '/more/settings') renderSettings();
  else if (path === '/more/settings/tampilan') renderTampilan();
  else if (path === '/more/settings/pustaka') renderPustaka();
  else if (path === '/more/settings/pembaca') renderPembaca();
  else if (path === '/more/settings/unduhan') renderUnduhan();
  else if (path === '/more/settings/sinkronisasi') renderSinkronisasi();
  else if (path === '/more/settings/jelajahi') renderJelajahi();
  else if (path === '/more/settings/penyimpanan') renderPenyimpanan();
  else if (path === '/more/settings/keamanan') renderKeamanan();
  else if (path === '/more/settings/lanjutan') renderLanjutan();
  else if (path === '/more/settings/tentang') renderTentang();
  else if (path.startsWith('/more/settings/')) {
    const subId = path.slice('/more/settings/'.length);
    renderSettingsSubpage(subId);
  }
  else if (path === '/more/downloads' || path === '/more/download-queue') {
    renderDownloadQueue();
  }
  else if (path === '/more/categories') renderCategories();
  else if (path === '/more/stats') {
    renderStatistik();
  }
  else if (path === '/more/storage') renderPenyimpanan();
  else if (path === '/more/about') renderTentang();
  else if (path === '/more/help') {
    renderMorePlaceholder('Bantuan', 'Pusat Bantuan & Laporan', 'Laporkan kendala atau saran perbaikan melalui repositori GitHub ShiniTrack.', window.Icons.helpCircle ? window.Icons.helpCircle() : window.Icons.alertTriangle(), true);
  }
  else if (path === '/dev/components') renderDevComponents();
  else if (path.startsWith('/manga/')) {
    const mangaId = path.split('/')[2];
    renderMangaDetail(mangaId);
  } else if (path.startsWith('/read/')) {
    const chapterId = path.split('/')[2];
    renderReader(chapterId);
  }

  // 1. After view is rendered, call motion.pageEnter(container)
  // 2. Top-level tabs: fade + y 12 -> 0. Push screens: x 24 -> 0.
  // 4. Going back = no exit animation (instant).
  // 5. Do NOT animate reader view.
  if (container && !path.startsWith('/read/')) {
    if (!isBack) {
      const isPush = isPushScreen(path);
      motion.pageEnter(container, isPush ? 'push' : 'tab');
    }
  }
}

export function setupRouter() {
  window.addEventListener('hashchange', handleRoute);
}

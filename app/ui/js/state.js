import * as api from './api.js';

export const state = {
  currentRoute: '',
  currentParams: {},
  libraryViewMode: localStorage.getItem('shinitrack_view_mode') || 'comfortable', // 'comfortable' | 'compact' | 'list'
  libraryCategory: localStorage.getItem('shinitrack_library_cat') || 'all', // 'all' | 'reading' | 'unread' | 'completed' | 'downloaded'
  librarySort: localStorage.getItem('shinitrack_library_sort') || 'recent', // 'recent' | 'alpha' | 'unread' | 'updated'
  activeCategory: Number(localStorage.getItem('shinitrack_active_cat') || 0), // 0=all, -1=bawaan, >0=category id
  librarySearchQuery: '',
  exploreTab: 'catalog', // 'catalog' | 'schedule'
  readerMode: localStorage.getItem('shinitrack_reader_mode') || 'webtoon', // 'webtoon' | 'paged-ltr' | 'paged-rtl'
  availableUpdate: null,
  updateModalData: null,
  downloadedApkPath: null,
  prefs: new Map()
};

// Expose a way to update state
export function updateState(key, value) {
  state[key] = value;
}

// Normalize settings values ('paged_lr', 'manga_rl') to runtime values ('paged-ltr', 'paged-rtl')
export function normalizeReaderMode(val) {
  if (!val) return 'webtoon';
  const v = String(val).toLowerCase();
  if (v === 'paged_lr' || v === 'paged-ltr') return 'paged-ltr';
  if (v === 'manga_rl' || v === 'paged-rtl') return 'paged-rtl';
  return 'webtoon';
}

export async function initPrefs() {
  try {
    const prefsObj = await api.pref_get_all();
    for (const [k, v] of Object.entries(prefsObj)) {
      state.prefs.set(k, v);
    }
    const globalMode = state.prefs.get('reader.mode');
    if (globalMode) {
      state.readerMode = normalizeReaderMode(globalMode);
    }
  } catch (e) {
    console.warn('Failed to load prefs:', e);
  }
}

export function getPref(key, defaultValue) {
  if (state.prefs.has(key)) {
    return state.prefs.get(key);
  }
  return defaultValue;
}

export async function setPref(key, value) {
  const strVal = String(value);
  state.prefs.set(key, strVal);
  try {
    await api.pref_set({ key, value: strVal });
  } catch (e) {
    console.warn('Failed to save pref:', key, e);
  }
}

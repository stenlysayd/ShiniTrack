import * as api from '../api.js';
import { getPref, setPref } from '../state.js';
import { createBottomSheet } from '../components/bottom-sheet.js';
import { escapeHtml } from '../utils.js';

export function createTriStateRow(title, prefKey, onChange) {
  let val = parseInt(getPref(prefKey, '0'), 10);
  const row = document.createElement('div');
  row.className = 'updates-tristate';
  const label = document.createElement('span');
  label.className = 'updates-tristate-label';
  label.textContent = title;
  const icon = document.createElement('div');
  icon.className = 'updates-tristate-icon svg-icon';

  const update = () => {
    if (val === 1) {
      icon.innerHTML = Icons.checkSquare();
      icon.style.color = 'var(--accent)';
    } else if (val === 2) {
      icon.innerHTML = Icons.xSquare();
      icon.style.color = 'var(--danger, #f43f5e)';
    } else {
      icon.innerHTML = Icons.square();
      icon.style.color = 'var(--text-muted)';
    }
  };
  update();
  row.appendChild(label);
  row.appendChild(icon);
  row.addEventListener('click', async () => {
    val = (val + 1) % 3;
    update();
    await setPref(prefKey, String(val));
    if (onChange) onChange();
  });
  return row;
}

export async function openFilterSheet(onFilterChange) {
  const filterPanel = document.createElement('div');
  filterPanel.className = 'updates-filter-sheet';
  filterPanel.appendChild(createTriStateRow('Terunduh', 'updates.filter_downloaded', onFilterChange));
  filterPanel.appendChild(createTriStateRow('Belum dibaca', 'updates.filter_unread', onFilterChange));
  filterPanel.appendChild(createTriStateRow('Dimulai', 'updates.filter_started', onFilterChange));
  filterPanel.appendChild(createTriStateRow('Ditandai', 'updates.filter_bookmarked', onFilterChange));

  const catPanel = document.createElement('div');
  catPanel.className = 'updates-filter-sheet';
  try {
    const categories = await api.category_list();
    const rawSelected = getPref('updates.filter_categories', '');
    const selected = new Set(rawSelected ? rawSelected.split(',').filter(Boolean) : []);

    if (categories.length === 0) {
      catPanel.innerHTML = '<div style="padding:16px; color:var(--text-muted); text-align:center;">Belum ada kategori</div>';
    } else {
      categories.forEach(c => {
        const row = document.createElement('div');
        row.className = 'updates-tristate';
        const label = document.createElement('span');
        label.className = 'updates-tristate-label';
        label.textContent = c.name;
        const icon = document.createElement('div');
        icon.className = 'updates-tristate-icon svg-icon';
        const strId = String(c.id);

        const update = () => {
          const active = selected.has(strId);
          icon.innerHTML = active ? Icons.checkSquare() : Icons.square();
          icon.style.color = active ? 'var(--accent)' : 'var(--text-muted)';
        };
        update();
        row.appendChild(label);
        row.appendChild(icon);
        row.addEventListener('click', async () => {
          if (selected.has(strId)) selected.delete(strId);
          else selected.add(strId);
          update();
          await setPref('updates.filter_categories', Array.from(selected).join(','));
          if (onFilterChange) onFilterChange();
        });
        catPanel.appendChild(row);
      });
    }
  } catch (err) {
    catPanel.innerHTML = `<div style="padding:16px; color:var(--text-muted);">${escapeHtml(String(err))}</div>`;
  }

  createBottomSheet({
    tabs: [
      { id: 'filter', label: 'Filter', content: filterPanel },
      { id: 'category', label: 'Kategori', content: catPanel }
    ]
  });

  const overlay = document.body.lastElementChild;
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && onFilterChange) onFilterChange();
    });
  }
}

export async function filterEvents(events, libRows) {
  const fDl = parseInt(getPref('updates.filter_downloaded', '0'), 10);
  const fUnread = parseInt(getPref('updates.filter_unread', '0'), 10);
  const fStarted = parseInt(getPref('updates.filter_started', '0'), 10);
  const fBookmarked = parseInt(getPref('updates.filter_bookmarked', '0'), 10);
  const rawCats = getPref('updates.filter_categories', '');
  const filterCatIds = new Set(rawCats ? rawCats.split(',').filter(Boolean) : []);

  const hasFilter = fDl !== 0 || fUnread !== 0 || fStarted !== 0 || fBookmarked !== 0 || filterCatIds.size > 0;
  if (!hasFilter) return { filtered: events, hasFilter: false };

  const libMap = new Map();
  for (const r of libRows) libMap.set(r.manga_id, r);

  const uniqueMangaIds = Array.from(new Set(events.map(e => e.manga_id)));
  const [readSets, mangaCatSets] = await Promise.all([
    fUnread !== 0
      ? Promise.all(uniqueMangaIds.map(id => api.list_read_chapters({ mangaId: id }).catch(() => [])))
      : [],
    filterCatIds.size > 0
      ? Promise.all(uniqueMangaIds.map(id => api.get_manga_categories({ mangaId: id }).catch(() => [])))
      : []
  ]);

  const readMap = new Map();
  uniqueMangaIds.forEach((id, idx) => {
    if (readSets[idx]) readMap.set(id, new Set(readSets[idx]));
  });

  const catMap = new Map();
  uniqueMangaIds.forEach((id, idx) => {
    if (mangaCatSets[idx]) catMap.set(id, (mangaCatSets[idx] || []).map(String));
  });

  const filtered = events.filter(e => {
    const lib = libMap.get(e.manga_id);

    if (fDl === 1 && (!lib || lib.downloaded_count <= 0)) return false;
    if (fDl === 2 && lib && lib.downloaded_count > 0) return false;

    if (fUnread !== 0) {
      const readSet = readMap.get(e.manga_id);
      const isRead = readSet ? readSet.has(e.chapter_id) : e.seen;
      if (fUnread === 1 && isRead) return false;
      if (fUnread === 2 && !isRead) return false;
    }

    if (fStarted === 1 && (!lib || !lib.last_read_at)) return false;
    if (fStarted === 2 && lib && lib.last_read_at) return false;

    if (fBookmarked === 1 && !lib) return false;
    if (fBookmarked === 2 && lib) return false;

    if (filterCatIds.size > 0) {
      const cats = catMap.get(e.manga_id) || [];
      if (!cats.some(c => filterCatIds.has(c))) return false;
    }

    return true;
  });

  return { filtered, hasFilter: true };
}

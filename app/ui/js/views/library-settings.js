import { getPref, setPref, state } from '../state.js';
import { createBottomSheet } from '../components/bottom-sheet.js';
import { createSwitchRow } from '../components/switch-row.js';
import { createListRow } from '../components/list-row.js';

function createTriStateRow(title, prefKey, onChange) {
  let val = parseInt(getPref(prefKey, '0'), 10);
  const el = createListRow({ title });
  const rightIcon = document.createElement('div');
  rightIcon.className = 'svg-icon';
  const updateIcon = () => {
    if (val === 1) rightIcon.innerHTML = Icons.checkSquare();
    else if (val === 2) rightIcon.innerHTML = Icons.xSquare();
    else rightIcon.innerHTML = Icons.square(); 
    rightIcon.style.color = val === 0 ? 'var(--text-muted)' : 'var(--accent)';
  };
  updateIcon();
  el.appendChild(rightIcon);
  el.addEventListener('click', () => {
    val = (val + 1) % 3;
    updateIcon();
    setPref(prefKey, val.toString());
    if (onChange) onChange();
  });
  return el;
}

function createSortRow(title, sortKey, currentSort, currentDesc, onChange) {
  const el = createListRow({ title });
  const isSelected = currentSort === sortKey;
  if (isSelected) {
    const rightIcon = document.createElement('div');
    rightIcon.className = 'svg-icon';
    rightIcon.innerHTML = currentDesc ? Icons.arrowDown() : Icons.arrowUp();
    rightIcon.style.color = 'var(--accent)';
    el.appendChild(rightIcon);
    el.style.color = 'var(--accent)';
    el.style.fontWeight = 'bold';
  }
  el.addEventListener('click', () => {
    let newDesc = currentDesc;
    if (isSelected) {
      newDesc = !currentDesc;
    } else {
      newDesc = (sortKey === 'recent' || sortKey === 'updated' || sortKey === 'unread' || sortKey === 'added');
    }
    setPref('library_sort', sortKey);
    setPref('library_sort_desc', newDesc ? '1' : '0');
    if (onChange) onChange();
  });
  return el;
}

export function showLibrarySettings(onSettingsChanged) {
  const filterTab = document.createElement('div');
  filterTab.appendChild(createTriStateRow('Terunduh', 'library_filter_downloaded', onSettingsChanged));
  filterTab.appendChild(createTriStateRow('Belum dibaca', 'library_filter_unread', onSettingsChanged));
  filterTab.appendChild(createTriStateRow('Dimulai', 'library_filter_started', onSettingsChanged));
  filterTab.appendChild(createTriStateRow('Selesai', 'library_filter_completed', onSettingsChanged));

  const sortTab = document.createElement('div');
  const rebuildSort = () => {
    sortTab.innerHTML = '';
    const currentSort = getPref('library_sort', 'recent');
    const currentDesc = getPref('library_sort_desc', '1') === '1';
    
    const onChangeSort = () => {
      rebuildSort();
      if (onSettingsChanged) onSettingsChanged();
    };

    sortTab.appendChild(createSortRow('Alfabet', 'alpha', currentSort, currentDesc, onChangeSort));
    sortTab.appendChild(createSortRow('Terakhir dibaca', 'recent', currentSort, currentDesc, onChangeSort));
    sortTab.appendChild(createSortRow('Terakhir diperbarui', 'updated', currentSort, currentDesc, onChangeSort));
    sortTab.appendChild(createSortRow('Jumlah belum dibaca', 'unread', currentSort, currentDesc, onChangeSort));
    sortTab.appendChild(createSortRow('Terakhir ditambahkan', 'added', currentSort, currentDesc, onChangeSort));
    sortTab.appendChild(createSortRow('Acak', 'random', currentSort, currentDesc, onChangeSort));
  };
  rebuildSort();

  const viewTab = document.createElement('div');
  const vMode = getPref('library_view_mode', 'comfortable');
  const modes = [
    { k: 'compact', l: 'Compact grid', i: Icons.grid() },
    { k: 'comfortable', l: 'Comfortable grid', i: Icons.grid() },
    { k: 'list', l: 'List', i: Icons.list() }
  ];
  const modeWrap = document.createElement('div');
  modeWrap.style.display = 'flex';
  modeWrap.style.gap = '8px';
  modeWrap.style.marginBottom = '16px';
  modes.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'btn' + (vMode === m.k ? ' primary' : '');
    btn.style.flex = '1';
    btn.innerHTML = m.i + '<br><span style="font-size:10px">' + m.l + '</span>';
    btn.addEventListener('click', () => {
      setPref('library_view_mode', m.k);
      state.libraryViewMode = m.k;
      if (onSettingsChanged) onSettingsChanged();
    });
    modeWrap.appendChild(btn);
  });
  viewTab.appendChild(modeWrap);

  const wrapSwitch = (prefKey, label, defVal) => {
    return createSwitchRow({
      title: label,
      checked: getPref(prefKey, defVal) === '1',
      onChange: (v) => {
        setPref(prefKey, v ? '1' : '0');
        if (onSettingsChanged) onSettingsChanged();
      }
    });
  };

  viewTab.appendChild(wrapSwitch('lib_show_unread_badge', 'Badge belum dibaca', '1'));
  viewTab.appendChild(wrapSwitch('lib_show_downloaded_badge', 'Badge terunduh', '1'));
  viewTab.appendChild(wrapSwitch('lib_show_notify_badge', 'Badge notifikasi', '1'));
  viewTab.appendChild(wrapSwitch('lib_show_tabs_count', 'Jumlah item di tab', '1'));

  createBottomSheet({
    tabs: [
      { label: 'Filter', content: filterTab },
      { label: 'Urutkan', content: sortTab },
      { label: 'Tampilan', content: viewTab }
    ]
  });
}

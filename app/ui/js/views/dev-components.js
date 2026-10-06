import { createSwitchRow } from '../components/switch-row.js';
import { createListRow } from '../components/list-row.js';
import { createSectionHeader } from '../components/section-header.js';
import { createSelectDialog } from '../components/select-dialog.js';
import { createBottomSheet } from '../components/bottom-sheet.js';
import { createConfirmDialog } from '../components/confirm-dialog.js';
import { createTopBar } from '../components/top-bar.js';

export function renderDevComponents() {
  const viewEl = document.getElementById('view');
  viewEl.innerHTML = ''; // clear

  const container = document.createElement('div');
  container.style.padding = '16px';
  container.style.paddingBottom = '100px';

  // 1. Top Bar
  container.appendChild(createTopBar({
    title: 'Dev Components',
    actions: [
      {
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
        onClick: () => console.log('Action clicked')
      }
    ]
  }));

  // 2. Section Header
  container.appendChild(createSectionHeader({
    title: 'Rows & Toggles',
    actionText: 'Lihat Semua',
    onAction: () => console.log('Action header clicked')
  }));

  // 3. Switch Row
  container.appendChild(createSwitchRow({
    title: 'Hanya yang sudah diunduh',
    subtitle: 'Saring semua entri di pustaka Anda',
    checked: true,
    onChange: (val) => console.log('Switch toggled:', val)
  }));

  // 4. List Row
  container.appendChild(createListRow({
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    title: 'Antrean unduhan',
    subtitle: 'Tidak ada unduhan berjalan',
    actionIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
    onClick: () => console.log('List row clicked')
  }));

  container.appendChild(createSectionHeader({
    title: 'Dialogs & Overlays'
  }));

  // 5. Select Dialog Trigger
  const selectBtn = document.createElement('div');
  selectBtn.className = 'btn primary block';
  selectBtn.style.marginBottom = '12px';
  selectBtn.textContent = 'Buka Select Dialog';
  selectBtn.onclick = () => {
    createSelectDialog({
      title: 'Pilih Mode',
      options: [
        { value: 'light', label: 'Terang' },
        { value: 'dark', label: 'Gelap' },
        { value: 'auto', label: 'Otomatis' }
      ],
      selectedValue: 'dark',
      onSelect: (val) => console.log('Selected:', val)
    });
  };
  container.appendChild(selectBtn);

  // 6. Confirm Dialog Trigger
  const confirmBtn = document.createElement('div');
  confirmBtn.className = 'btn block';
  confirmBtn.style.marginBottom = '12px';
  confirmBtn.textContent = 'Buka Confirm Dialog';
  confirmBtn.onclick = () => {
    createConfirmDialog({
      title: 'Hapus Kategori?',
      message: 'Kategori ini akan dihapus. Manga di dalamnya tidak akan dihapus.',
      confirmText: 'Hapus',
      onConfirm: () => console.log('Confirmed')
    });
  };
  container.appendChild(confirmBtn);

  // 7. Bottom Sheet Trigger
  const sheetBtn = document.createElement('div');
  sheetBtn.className = 'btn block';
  sheetBtn.textContent = 'Buka Bottom Sheet';
  sheetBtn.onclick = () => {
    const content1 = document.createElement('div');
    content1.textContent = 'Isi tab filter...';
    
    const content2 = document.createElement('div');
    content2.textContent = 'Isi tab urutkan...';
    
    createBottomSheet({
      tabs: [
        { id: 'filter', label: 'Filter', content: content1 },
        { id: 'sort', label: 'Urutkan', content: content2 }
      ]
    });
  };
  container.appendChild(sheetBtn);

  viewEl.appendChild(container);
}

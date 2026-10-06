// Category management screen — Route: #/more/categories
import { navigate } from '../router.js';
import * as api from '../api.js';
import * as utils from '../utils.js';
import { createConfirmDialog } from '../components/confirm-dialog.js';

const { setHeaderTitles, showToast, escapeHtml } = utils;

// ------------------------------------------------------------------ helpers

/** Prompt-style dialog for text input (add / rename). */
function showInputDialog({ title, placeholder, value = '', onSubmit }) {
  const overlay = document.createElement('div');
  overlay.className = 'cat-dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'cat-dialog';

  const h = document.createElement('h3');
  h.textContent = title;
  dialog.appendChild(h);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cat-dialog-input';
  input.placeholder = placeholder;
  input.value = value;
  input.maxLength = 60;
  dialog.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'cat-dialog-actions';

  const cancelBtn = document.createElement('div');
  cancelBtn.textContent = 'Batal';
  cancelBtn.className = 'cat-dialog-btn';
  cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));

  const okBtn = document.createElement('div');
  okBtn.textContent = 'Simpan';
  okBtn.className = 'cat-dialog-btn cat-dialog-btn--primary';
  okBtn.addEventListener('click', () => {
    const v = input.value.trim();
    if (!v) return;
    document.body.removeChild(overlay);
    onSubmit(v);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  setTimeout(() => input.focus(), 50);
}

// ---------------------------------------------------- drag reorder (pointer)

function setupDragReorder(listEl, onReorder) {
  let dragItem = null;
  let placeholder = null;
  let startY = 0;
  let offsetY = 0;

  function getCardFromTarget(t) {
    return t.closest('.cat-card');
  }

  function handlePointerDown(e) {
    const handle = e.target.closest('.cat-drag-handle');
    if (!handle) return;
    dragItem = getCardFromTarget(handle);
    if (!dragItem) return;
    e.preventDefault();
    dragItem.setPointerCapture(e.pointerId);
    const rect = dragItem.getBoundingClientRect();
    startY = rect.top;
    offsetY = e.clientY - rect.top;
    placeholder = document.createElement('div');
    placeholder.className = 'cat-card-placeholder';
    placeholder.style.height = rect.height + 'px';
    dragItem.classList.add('cat-card--dragging');
    dragItem.style.width = rect.width + 'px';
    dragItem.parentNode.insertBefore(placeholder, dragItem);
    dragItem.style.position = 'fixed';
    dragItem.style.top = rect.top + 'px';
    dragItem.style.left = rect.left + 'px';
    dragItem.style.zIndex = '100';
  }

  function handlePointerMove(e) {
    if (!dragItem) return;
    e.preventDefault();
    const y = e.clientY - offsetY;
    dragItem.style.top = y + 'px';

    const cards = [...listEl.querySelectorAll('.cat-card:not(.cat-card--dragging)')];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (e.clientY < mid) {
        listEl.insertBefore(placeholder, c);
        return;
      }
    }
    listEl.appendChild(placeholder);
  }

  function handlePointerUp(e) {
    if (!dragItem) return;
    dragItem.classList.remove('cat-card--dragging');
    dragItem.style.position = '';
    dragItem.style.top = '';
    dragItem.style.left = '';
    dragItem.style.width = '';
    dragItem.style.zIndex = '';
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(dragItem, placeholder);
      placeholder.remove();
    }
    dragItem = null;
    placeholder = null;
    onReorder();
  }

  listEl.addEventListener('pointerdown', handlePointerDown);
  listEl.addEventListener('pointermove', handlePointerMove);
  listEl.addEventListener('pointerup', handlePointerUp);
  listEl.addEventListener('pointercancel', handlePointerUp);
}

// -------------------------------------------------------------------- render

export async function renderCategories() {
  setHeaderTitles('Kategori', 'Kelola kategori pustaka');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'cat-page';

  // Top bar with back button
  const bar = document.createElement('div');
  bar.className = 'cat-topbar';
  const backBtn = document.createElement('button');
  backBtn.className = 'icon-btn';
  backBtn.innerHTML = window.Icons.back();
  backBtn.setAttribute('aria-label', 'Kembali');
  backBtn.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else navigate('#/more');
  });
  const barTitle = document.createElement('span');
  barTitle.className = 'cat-topbar-title';
  barTitle.textContent = 'Ubah kategori';
  bar.appendChild(backBtn);
  bar.appendChild(barTitle);
  wrap.appendChild(bar);

  // Card list container
  const listEl = document.createElement('div');
  listEl.className = 'cat-list';
  wrap.appendChild(listEl);

  // FAB
  const fab = document.createElement('button');
  fab.className = 'cat-fab';
  fab.innerHTML = `${window.Icons.plus()} <span>Tambah</span>`;
  fab.addEventListener('click', () => {
    showInputDialog({
      title: 'Tambah kategori',
      placeholder: 'Nama kategori',
      onSubmit: async (name) => {
        try {
          await api.category_create({ name });
          showToast('Kategori ditambahkan');
          await loadList();
        } catch (e) { showToast('Gagal: ' + e); }
      }
    });
  });
  wrap.appendChild(fab);

  viewEl.appendChild(wrap);

  // ---- data loading ----
  async function loadList() {
    try {
      const cats = await api.category_list();
      renderList(cats);
    } catch (e) {
      listEl.innerHTML = `<div class="empty"><p style="color:var(--text-muted)">Gagal memuat kategori</p></div>`;
    }
  }

  function renderList(cats) {
    listEl.innerHTML = '';
    if (!cats.length) {
      listEl.innerHTML = `
        <div class="empty" style="padding:48px 16px">
          <div style="color:var(--text-faint)">${window.Icons.tag()}</div>
          <p style="margin-top:12px; color:var(--text-muted); font-size:14px">Belum ada kategori</p>
          <p style="color:var(--text-faint); font-size:12px">Ketuk "Tambah" untuk membuat kategori baru</p>
        </div>`;
      return;
    }
    cats.forEach(c => {
      const card = document.createElement('div');
      card.className = 'cat-card';
      card.dataset.id = c.id;

      // Drag handle
      const handle = document.createElement('div');
      handle.className = 'cat-drag-handle';
      handle.innerHTML = window.Icons.gripVertical();
      handle.style.touchAction = 'none';

      // Info
      const info = document.createElement('div');
      info.className = 'cat-card-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'cat-card-name';
      nameEl.textContent = c.name;
      const countEl = document.createElement('span');
      countEl.className = 'cat-card-count';
      countEl.textContent = c.manga_count + ' manga';
      info.appendChild(nameEl);
      info.appendChild(countEl);

      // Actions
      const acts = document.createElement('div');
      acts.className = 'cat-card-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.innerHTML = window.Icons.edit();
      editBtn.setAttribute('aria-label', 'Ubah nama');
      editBtn.addEventListener('click', () => {
        showInputDialog({
          title: 'Ubah nama kategori',
          placeholder: 'Nama baru',
          value: c.name,
          onSubmit: async (name) => {
            try {
              await api.category_rename({ id: c.id, name });
              showToast('Kategori diubah');
              await loadList();
            } catch (e) { showToast('Gagal: ' + e); }
          }
        });
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.innerHTML = window.Icons.trash();
      delBtn.setAttribute('aria-label', 'Hapus');
      delBtn.addEventListener('click', () => {
        createConfirmDialog({
          title: 'Hapus kategori',
          message: `Hapus kategori "${escapeHtml(c.name)}"? Manga di dalamnya tidak akan dihapus.`,
          confirmText: 'Hapus',
          onConfirm: async () => {
            try {
              await api.category_delete({ id: c.id });
              showToast('Kategori dihapus');
              await loadList();
            } catch (e) { showToast('Gagal: ' + e); }
          }
        });
      });

      acts.appendChild(editBtn);
      acts.appendChild(delBtn);

      card.appendChild(handle);
      card.appendChild(info);
      card.appendChild(acts);
      listEl.appendChild(card);
    });

    // Enable drag reorder
    setupDragReorder(listEl, async () => {
      const ids = [...listEl.querySelectorAll('.cat-card')].map(c => Number(c.dataset.id));
      try {
        await api.category_reorder({ ids });
      } catch (e) { showToast('Gagal menyimpan urutan'); }
    });
  }

  await loadList();
}

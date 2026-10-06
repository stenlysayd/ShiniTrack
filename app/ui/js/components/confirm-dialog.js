import { motion } from '../motion.js';

/**
 * createConfirmDialog
 * Shows a confirmation dialog.
 * @param {Object} opts
 * @param {string} opts.title - Dialog title
 * @param {string} opts.message - Dialog message
 * @param {string} [opts.confirmText="OK"] - Confirm button text
 * @param {string} [opts.cancelText="Batal"] - Cancel button text
 * @param {Function} opts.onConfirm - Callback on confirm
 */
export function createConfirmDialog({ title, message, confirmText = 'OK', cancelText = 'Batal', onConfirm }) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '1000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';

  const dialog = document.createElement('div');
  dialog.style.background = 'var(--surface)';
  dialog.style.borderRadius = 'var(--radius-md)';
  dialog.style.width = '90%';
  dialog.style.maxWidth = '320px';
  dialog.style.padding = '20px';
  dialog.style.border = '1px solid var(--border)';
  dialog.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';

  const dismiss = () => {
    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });

  const h = document.createElement('h3');
  h.textContent = title;
  h.style.margin = '0 0 8px';
  h.style.fontSize = '18px';
  dialog.appendChild(h);

  const p = document.createElement('p');
  p.textContent = message;
  p.style.margin = '0 0 24px';
  p.style.color = 'var(--text-muted)';
  p.style.fontSize = '14px';
  dialog.appendChild(p);
  
  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '16px';
  
  const cancelBtn = document.createElement('div');
  cancelBtn.textContent = cancelText;
  cancelBtn.style.color = 'var(--text-muted)';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.style.fontWeight = '600';
  cancelBtn.addEventListener('click', () => {
    dismiss();
  });
  
  const confirmBtn = document.createElement('div');
  confirmBtn.textContent = confirmText;
  confirmBtn.style.color = 'var(--accent)';
  confirmBtn.style.cursor = 'pointer';
  confirmBtn.style.fontWeight = '600';
  confirmBtn.addEventListener('click', () => {
    dismiss();
    if (onConfirm) onConfirm();
  });
  
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  motion.dialogOpen(dialog, overlay);
}

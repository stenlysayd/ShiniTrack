import { motion } from '../motion.js';

/**
 * createSelectDialog
 * Creates and shows a modal dialog with a radio list of options.
 * @param {Object} opts
 * @param {string} opts.title - Dialog title
 * @param {Array<{value: string, label: string}>} opts.options - List of options
 * @param {string} opts.selectedValue - Initially selected value
 * @param {Function} opts.onSelect - Callback when an option is selected, receives (value)
 */
export function createSelectDialog({ title, options, selectedValue, onSelect }) {
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
  dialog.style.padding = '16px';
  dialog.style.border = '1px solid var(--border)';
  dialog.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';

  const h = document.createElement('h3');
  h.textContent = title;
  h.style.margin = '0 0 16px';
  h.style.fontSize = '16px';
  dialog.appendChild(h);

  const dismiss = () => {
    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });

  options.forEach(opt => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.padding = '12px 0';
    row.style.cursor = 'pointer';
    row.style.borderBottom = '1px solid var(--border-light)';
    
    const radio = document.createElement('div');
    radio.style.width = '18px';
    radio.style.height = '18px';
    radio.style.borderRadius = '9px';
    radio.style.border = '2px solid ' + (opt.value === selectedValue ? 'var(--accent)' : 'var(--text-muted)');
    radio.style.marginRight = '12px';
    radio.style.position = 'relative';
    
    if (opt.value === selectedValue) {
      const dot = document.createElement('div');
      dot.style.position = 'absolute';
      dot.style.inset = '3px';
      dot.style.background = 'var(--accent)';
      dot.style.borderRadius = '50%';
      radio.appendChild(dot);
    }
    
    const label = document.createElement('div');
    label.textContent = opt.label;
    label.style.flex = '1';
    
    row.appendChild(radio);
    row.appendChild(label);
    
    row.addEventListener('click', () => {
      dismiss();
      if (onSelect) onSelect(opt.value);
    });
    
    dialog.appendChild(row);
  });

  const cancelBtn = document.createElement('div');
  cancelBtn.textContent = 'Batal';
  cancelBtn.style.padding = '12px 0 0';
  cancelBtn.style.color = 'var(--text-muted)';
  cancelBtn.style.textAlign = 'right';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.style.fontWeight = '600';
  cancelBtn.addEventListener('click', () => {
    dismiss();
  });
  dialog.appendChild(cancelBtn);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  motion.dialogOpen(dialog, overlay);
}

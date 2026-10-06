/**
 * createSectionHeader
 * Creates a simple section header with a title and optional action text/button.
 * @param {Object} opts
 * @param {string} opts.title - Section title
 * @param {string} [opts.actionText] - Optional right side text
 * @param {Function} [opts.onAction] - Callback for right side text
 * @returns {HTMLElement} The section header element
 */
export function createSectionHeader({ title, actionText, onAction }) {
  const el = document.createElement('div');
  el.className = 'section-title';
  
  const t = document.createElement('span');
  t.textContent = title;
  el.appendChild(t);

  if (actionText) {
    const a = document.createElement('span');
    a.textContent = actionText;
    a.style.color = 'var(--accent)';
    a.style.cursor = 'pointer';
    a.style.textTransform = 'none';
    if (onAction) {
      a.addEventListener('click', onAction);
    }
    el.appendChild(a);
  }

  return el;
}

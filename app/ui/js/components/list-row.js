/**
 * createListRow
 * Creates a clickable row with an icon, title, optional subtitle, and an action icon (like an arrow).
 * @param {Object} opts
 * @param {string} [opts.icon] - SVG string for left icon
 * @param {string} opts.title - Main text
 * @param {string} [opts.subtitle] - Secondary text
 * @param {string} [opts.actionIcon] - SVG string for right icon
 * @param {Function} [opts.onClick] - Callback when clicked
 * @returns {HTMLElement} The row element
 */
export function createListRow({ icon, title, subtitle, actionIcon, onClick }) {
  const el = document.createElement('div');
  el.className = 'card click';
  el.style.display = 'flex';
  el.style.alignItems = 'center';

  if (icon) {
    const iconWrap = document.createElement('div');
    iconWrap.className = 'svg-icon';
    iconWrap.style.marginRight = '12px';
    iconWrap.style.color = 'var(--text-muted)';
    iconWrap.innerHTML = icon;
    el.appendChild(iconWrap);
  }

  const textWrap = document.createElement('div');
  textWrap.style.flex = '1';
  
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = title;
  textWrap.appendChild(t);
  
  if (subtitle) {
    const s = document.createElement('div');
    s.className = 's';
    s.textContent = subtitle;
    textWrap.appendChild(s);
  }
  
  el.appendChild(textWrap);

  if (actionIcon) {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'svg-icon';
    actionWrap.style.color = 'var(--text-muted)';
    actionWrap.innerHTML = actionIcon;
    el.appendChild(actionWrap);
  }

  if (onClick) {
    el.addEventListener('click', onClick);
  }

  return el;
}

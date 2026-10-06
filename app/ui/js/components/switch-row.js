/**
 * createSwitchRow
 * Creates a row with a text label, optional subtitle, and a toggle switch.
 * @param {Object} opts
 * @param {string} [opts.icon] - Optional SVG icon string
 * @param {string} opts.title - Main text
 * @param {string} [opts.subtitle] - Secondary text
 * @param {boolean} opts.checked - Initial state of the switch
 * @param {Function} [opts.onChange] - Callback when toggled, receives (newVal)
 * @returns {HTMLElement} The row element
 */
export function createSwitchRow({ icon, title, subtitle, checked = false, onChange }) {
  const el = document.createElement('div');
  el.className = 'card click';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'space-between';

  if (icon) {
    const iconWrap = document.createElement('div');
    iconWrap.className = 'svg-icon';
    iconWrap.style.marginRight = '12px';
    iconWrap.style.flexShrink = '0';
    iconWrap.style.color = 'var(--text-muted)';
    iconWrap.innerHTML = icon;
    el.appendChild(iconWrap);
  }

  const textWrap = document.createElement('div');
  textWrap.style.flex = '1';
  textWrap.style.marginRight = '12px';
  
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

  // Simple switch UI
  const toggle = document.createElement('div');
  toggle.className = 'settings-switch-track' + (checked ? ' active' : '');
  
  const knob = document.createElement('div');
  knob.className = 'settings-switch-thumb';
  toggle.appendChild(knob);

  let isChecked = checked;
  el.setAttribute('role', 'switch');
  el.setAttribute('aria-checked', String(isChecked));
  el.addEventListener('click', () => {
    isChecked = !isChecked;
    el.setAttribute('aria-checked', String(isChecked));
    if (isChecked) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
    if (onChange) onChange(isChecked);
  });

  el.appendChild(textWrap);
  el.appendChild(toggle);
  return el;
}

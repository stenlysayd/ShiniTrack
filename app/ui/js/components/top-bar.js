/**
 * createTopBar
 * Returns a top bar element with a back button, title, and optional action buttons.
 * @param {Object} opts
 * @param {string} opts.title - The title text
 * @param {Array<{icon: string, onClick: Function}>} [opts.actions] - Action buttons
 * @param {Function} [opts.onBack] - Custom back handler. Defaults to history.back()
 * @returns {HTMLElement} The top bar element
 */
export function createTopBar({ title, actions = [], onBack }) {
  const el = document.createElement('div');
  el.className = 'topbar';
  el.style.position = 'relative'; // Override fixed for component demo
  el.style.inset = 'auto';
  el.style.marginBottom = '16px';
  
  const backBtn = document.createElement('button');
  backBtn.className = 'icon-btn';
  backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';
  backBtn.addEventListener('click', () => {
    if (onBack) onBack();
    else window.history.back();
  });
  el.appendChild(backBtn);
  
  const titleWrap = document.createElement('div');
  titleWrap.className = 'brand-title';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  titleWrap.appendChild(h1);
  el.appendChild(titleWrap);
  
  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.innerHTML = action.icon;
    btn.addEventListener('click', action.onClick);
    el.appendChild(btn);
  });
  
  return el;
}

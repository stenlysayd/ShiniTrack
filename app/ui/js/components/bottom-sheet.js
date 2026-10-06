import { motion } from '../motion.js';

/**
 * createBottomSheet
 * Creates and shows a bottom sheet, optionally with tabs.
 * @param {Object} opts
 * @param {Array<{id: string, label: string, content: HTMLElement}>} [opts.tabs] - Tabs for the sheet
 * @param {HTMLElement} [opts.content] - Content if not using tabs
 * @returns {Function} A function to close the sheet
 */
export function createBottomSheet({ tabs, content }) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '1000';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.justifyContent = 'flex-end';

  const sheet = document.createElement('div');
  sheet.style.background = 'var(--surface)';
  sheet.style.borderTopLeftRadius = 'var(--radius-lg)';
  sheet.style.borderTopRightRadius = 'var(--radius-lg)';
  sheet.style.borderTop = '1px solid var(--border)';
  sheet.style.padding = '16px';
  sheet.style.paddingBottom = 'calc(16px + var(--safe-bottom))';
  sheet.style.boxShadow = '0 -4px 20px rgba(0,0,0,0.5)';
  sheet.style.transform = 'translateY(100%)';
  
  let isClosing = false;
  const close = () => {
    if (isClosing) return;
    isClosing = true;
    motion.sheetClose(sheet, overlay, () => {
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    });
  };
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const handle = document.createElement('div');
  handle.style.width = '40px';
  handle.style.height = '4px';
  handle.style.background = 'var(--border)';
  handle.style.borderRadius = '2px';
  handle.style.margin = '0 auto 16px';
  sheet.appendChild(handle);

  if (tabs && tabs.length > 0) {
    const tabbar = document.createElement('div');
    tabbar.style.display = 'flex';
    tabbar.style.borderBottom = '1px solid var(--border)';
    tabbar.style.marginBottom = '16px';
    
    const contentArea = document.createElement('div');
    
    tabs.forEach((tab, index) => {
      const btn = document.createElement('div');
      btn.textContent = tab.label;
      btn.style.flex = '1';
      btn.style.textAlign = 'center';
      btn.style.padding = '10px 0';
      btn.style.cursor = 'pointer';
      btn.style.fontWeight = '600';
      btn.style.color = index === 0 ? 'var(--accent)' : 'var(--text-muted)';
      btn.style.borderBottom = index === 0 ? '2px solid var(--accent)' : '2px solid transparent';
      
      const panel = document.createElement('div');
      panel.style.display = index === 0 ? 'block' : 'none';
      panel.appendChild(tab.content);
      contentArea.appendChild(panel);
      
      btn.addEventListener('click', () => {
        // Reset all tabs
        Array.from(tabbar.children).forEach(c => {
          c.style.color = 'var(--text-muted)';
          c.style.borderBottom = '2px solid transparent';
        });
        // Set active
        btn.style.color = 'var(--accent)';
        btn.style.borderBottom = '2px solid var(--accent)';
        
        // Hide all panels
        Array.from(contentArea.children).forEach(p => p.style.display = 'none');
        // Show active panel
        panel.style.display = 'block';
      });
      
      tabbar.appendChild(btn);
    });
    
    sheet.appendChild(tabbar);
    sheet.appendChild(contentArea);
  } else if (content) {
    sheet.appendChild(content);
  }

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  
  // Trigger animation
  motion.sheetOpen(sheet, overlay);
  
  return close;
}

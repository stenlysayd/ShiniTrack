// ShiniTrack Vector SVG Icon System
// Lucide/Feather style icons - zero external dependencies, 100% scalable

window.Icons = {
  // Navigation
  favorites: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
    </svg>`,

  schedule: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>`,

  search: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>`,

  updates: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    </svg>`,

  settings: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>`,

  // UI Actions
  back: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>`,

  sync: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
    </svg>`,

  grid: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7"></rect>
      <rect x="14" y="3" width="7" height="7"></rect>
      <rect x="14" y="14" width="7" height="7"></rect>
      <rect x="3" y="14" width="7" height="7"></rect>
    </svg>`,

  list: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"></line>
      <line x1="8" y1="12" x2="21" y2="12"></line>
      <line x1="8" y1="18" x2="21" y2="18"></line>
      <line x1="3" y1="6" x2="3.01" y2="6"></line>
      <line x1="3" y1="12" x2="3.01" y2="12"></line>
      <line x1="3" y1="18" x2="3.01" y2="18"></line>
    </svg>`,

  bell: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    </svg>`,

  bellOff: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path>
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path>
      <path d="M18 8a6 6 0 0 0-9.33-5"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>`,

  star: (cls = '', filled = false) => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
    </svg>`,

  check: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>`,

  download: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>`,

  trash: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`,

  play: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>`,

  book: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
    </svg>`,

  scroll: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"></path>
      <line x1="12" y1="6" x2="12" y2="18"></line>
      <polyline points="9 9 12 6 15 9"></polyline>
      <polyline points="9 15 12 18 15 15"></polyline>
    </svg>`,

  clock: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>`,

  alertTriangle: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>`,

  rocket: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
    </svg>`,

  chevronRight: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>`,

  plus: (cls = '') => `
    <svg class="svg-icon ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>`,

  // Rich Composed Empty State Illustrations
  emptyLibrary: () => `
    <div class="empty-illustration">
      <svg viewBox="0 0 120 120" width="88" height="88" fill="none">
        <rect x="24" y="32" width="72" height="68" rx="8" fill="#141824" stroke="#252b3d" stroke-width="2"/>
        <rect x="36" y="20" width="72" height="68" rx="8" fill="#181e2e" stroke="#2c344a" stroke-width="2"/>
        <rect x="48" y="10" width="60" height="74" rx="8" fill="#1d2538" stroke="#37425f" stroke-width="2"/>
        <path d="M64 26h28M64 36h20M64 46h24" stroke="#4a5578" stroke-width="2" stroke-linecap="round"/>
        <circle cx="92" cy="72" r="16" fill="#e11d48" opacity="0.9"/>
        <path d="M88 72l3 3 6-6" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>`,

  emptySearch: () => `
    <div class="empty-illustration">
      <svg viewBox="0 0 120 120" width="88" height="88" fill="none">
        <circle cx="54" cy="54" r="34" fill="#141824" stroke="#2c344a" stroke-width="2"/>
        <path d="M78 78l26 26" stroke="#e11d48" stroke-width="4" stroke-linecap="round"/>
        <circle cx="54" cy="54" r="22" stroke="#37425f" stroke-dasharray="4 4" stroke-width="1.8"/>
        <path d="M44 54h20M54 44v20" stroke="#4a5578" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>`,

  emptyUpdates: () => `
    <div class="empty-illustration">
      <svg viewBox="0 0 120 120" width="88" height="88" fill="none">
        <circle cx="60" cy="60" r="44" fill="#141824" stroke="#252b3d" stroke-width="2"/>
        <path d="M60 36a14 14 0 0 0-14 14c0 16-6 20-6 20h40s-6-4-6-20a14 14 0 0 0-14-14z" fill="#1a2030" stroke="#37425f" stroke-width="2"/>
        <circle cx="60" cy="76" r="3" fill="#64748b"/>
        <path d="M60 28v4" stroke="#e11d48" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="82" cy="42" r="3" fill="#e11d48"/>
      </svg>
    </div>`,

  emptySchedule: () => `
    <div class="empty-illustration">
      <svg viewBox="0 0 120 120" width="88" height="88" fill="none">
        <rect x="25" y="25" width="70" height="70" rx="12" fill="#141824" stroke="#252b3d" stroke-width="2"/>
        <line x1="25" y1="45" x2="95" y2="45" stroke="#2c344a" stroke-width="2"/>
        <circle cx="45" cy="35" r="3" fill="#e11d48"/>
        <circle cx="75" cy="35" r="3" fill="#e11d48"/>
        <rect x="36" y="56" width="12" height="12" rx="3" fill="#252b3d"/>
        <rect x="54" y="56" width="12" height="12" rx="3" fill="#252b3d"/>
        <rect x="72" y="56" width="12" height="12" rx="3" fill="#e11d48" opacity="0.8"/>
        <rect x="36" y="74" width="12" height="12" rx="3" fill="#252b3d"/>
        <rect x="54" y="74" width="12" height="12" rx="3" fill="#252b3d"/>
      </svg>
    </div>`
};

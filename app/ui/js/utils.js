export function sanitizeRepo(repo) {
  if (!repo) return 'stenlysayd/ShiniTrack';
  let r = String(repo).trim();
  if (r.toLowerCase() === 'shinitrack/shinitrack' || !r) return 'stenlysayd/ShiniTrack';
  r = r.replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  return r || 'stenlysayd/ShiniTrack';
}

export function setHeaderTitles(title, subtitle = 'Manga Tracker') {
  const titleEl = document.getElementById('title');
  const subtitleEl = document.getElementById('subtitle');
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

export { showToast } from './components/toast.js';

export function assetUrl(path) {
  return `http://shimg.localhost/${path}`;
}

export function coverUrl(url) {
  if (!url) return '';
  return assetUrl(`u/${encodeURIComponent(url)}`);
}

export function pageUrl(chapterId, file) {
  return assetUrl(`p/${encodeURIComponent(chapterId)}/${encodeURIComponent(file)}`);
}

export function formatWeekday(wdIndex) {
  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  return days[wdIndex % 7] || '';
}

export function formatRelativeTime(date) {
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now - date) / 1000));
  if (diffSec < 60) return 'Baru saja';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} menit lalu`;
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    return `${hours} jam lalu`;
  }
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return `Kemarin, ${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
  if (days < 7) return `${days} hari lalu`;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function formatPrediction(p) {
  if (!p) return '<span class="pill low">Belum ada pola</span>';
  if (p.likely_hiatus) {
    return `<span class="pill hiatus">${Icons.alertTriangle()} Kemungkinan Hiatus</span>`;
  }
  
  let patternText = '';
  if (p.pattern && p.pattern.kind === 'weekly') {
    const day = formatWeekday(p.pattern.weekday);
    const hour = String(p.pattern.hour).padStart(2, '0') + ':00';
    patternText = `Tiap ${day} ~${hour}`;
  } else if (p.pattern && p.pattern.days) {
    patternText = `Tiap ~${p.pattern.days} hari`;
  }

  const labelClass = (p.label || 'low').toLowerCase();
  const nextDate = new Date(p.next_at);
  const nextStr = nextDate.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
  const overdueStr = p.overdue ? ' (Terlambat)' : '';

  return `<div class="p">
    <b>${patternText}</b> &bull; Estimasi: ${nextStr}${overdueStr}
    <span class="pill ${labelClass}">${p.label} (${Math.round(p.confidence * 100)}%)</span>
  </div>`;
}

export function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

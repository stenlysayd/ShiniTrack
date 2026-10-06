import { motion } from '../motion.js';

/**
 * showToast
 * Shows a toast notification message with motion.toast.
 * @param {string} msg - Message to display
 * @param {number} [duration=3000] - Duration in ms before hiding
 */
export function showToast(msg, duration = 3000) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  motion.toast(toastEl);
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

export default { showToast };

import { motion } from '../motion.js';

/**
 * openModal
 * Shows a modal dialog with motion.dialogOpen.
 * @param {HTMLElement} dialogEl - Dialog / card element
 * @param {HTMLElement} [backdropEl] - Overlay / backdrop element
 */
export function openModal(dialogEl, backdropEl) {
  if (backdropEl) backdropEl.classList.remove('hidden');
  if (dialogEl) dialogEl.classList.remove('hidden');
  motion.dialogOpen(dialogEl, backdropEl);
}

export default { openModal };

import { renderSettings } from './render.js';
import * as utils from '../../utils.js';
import * as api from '../../api.js';
import { createConfirmDialog } from '../../components/confirm-dialog.js';

export const lanjutanSchema = [
  {
    type: 'header',
    title: 'Diagnostik & Notifikasi'
  },
  {
    type: 'button',
    title: 'Buat log kerusakan',
    subtitle: 'Salin rekaman log diagnostik dan kerusakan ke papan klip',
    onClick: async () => {
      try {
        const report = await api.generate_crash_log();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(report);
        }
        utils.showToast('Log kerusakan berhasil disalin ke papan klip');
      } catch (e) {
        console.error(e);
        utils.showToast('Gagal membuat log kerusakan');
      }
    }
  },
  {
    type: 'button',
    title: 'Uji notifikasi',
    subtitle: 'Kirim notifikasi lokal untuk menguji sistem rilis bab baru',
    onClick: async () => {
      try {
        await api.test_notification();
        utils.showToast('Notifikasi pengujian berhasil dikirim');
      } catch (e) {
        console.error(e);
        utils.showToast('Gagal mengirim notifikasi pengujian');
      }
    }
  },
  {
    type: 'button',
    title: 'Pengoptimalan baterai',
    subtitle: 'Buka pengaturan pengabaian optimasi baterai sistem latar belakang',
    onClick: () => {
      utils.showToast('Pengoptimalan baterai dapat diatur melalui pengaturan sistem Android');
    }
  },
  {
    type: 'header',
    title: 'Pemeliharaan Data'
  },
  {
    type: 'button',
    title: 'Hapus riwayat baca',
    subtitle: 'Hapus seluruh daftar riwayat pembacaan bab yang tersimpan',
    onClick: () => {
      createConfirmDialog({
        title: 'Hapus Riwayat Baca?',
        message: 'Seluruh riwayat pembacaan bab akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.',
        confirmText: 'Hapus',
        cancelText: 'Batal',
        onConfirm: async () => {
          try {
            await api.clear_reading_history();
            utils.showToast('Riwayat membaca berhasil dihapus');
          } catch (e) {
            console.error(e);
            utils.showToast('Gagal menghapus riwayat membaca');
          }
        }
      });
    }
  },
  {
    type: 'button',
    title: 'Bersihkan basis data',
    subtitle: 'Hapus tabel cache histori rilis dan metadata yang tidak difavoritkan',
    onClick: () => {
      createConfirmDialog({
        title: 'Bersihkan Basis Data?',
        message: 'Tabel cache events, histori rilis bab, dan metadata komik di luar favorit akan dibersihkan. Favorit dan unduhan Anda tetap aman.',
        confirmText: 'Bersihkan',
        cancelText: 'Batal',
        onConfirm: async () => {
          try {
            await api.cleanup_database();
            utils.showToast('Basis data berhasil dibersihkan dan dioptimalkan');
          } catch (e) {
            console.error(e);
            utils.showToast('Gagal membersihkan basis data');
          }
        }
      });
    }
  },
  {
    type: 'button',
    title: 'Reset pengaturan',
    subtitle: 'Kembalikan semua preferensi aplikasi ke setelan awal',
    onClick: () => {
      createConfirmDialog({
        title: 'Reset Pengaturan?',
        message: 'Semua preferensi akan dikembalikan ke setelan default. Komik favorit dan unduhan tidak akan dihapus.',
        confirmText: 'Reset',
        cancelText: 'Batal',
        onConfirm: async () => {
          try {
            await api.reset_settings();
            utils.showToast('Pengaturan berhasil direset ke bawaan');
            setTimeout(() => {
              renderLanjutan();
            }, 300);
          } catch (e) {
            console.error(e);
            utils.showToast('Gagal mereset pengaturan');
          }
        }
      });
    }
  },
  {
    type: 'header',
    title: 'Informasi Debug'
  },
  {
    type: 'button',
    title: 'Salin info debug',
    subtitle: 'Salin versi aplikasi, lingkungan platform, dan versi skema basis data',
    onClick: async () => {
      try {
        const info = await api.get_app_info();
        const debugText = `ShiniTrack ${info.version || 'v1.0.1'} (build ${info.build_code || 1}) | Platform: ${info.platform || 'unknown'} | Schema: v2`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(debugText);
        }
        utils.showToast('Info debug disalin ke papan klip');
      } catch (e) {
        console.error(e);
        utils.showToast('Gagal menyalin info debug');
      }
    }
  },
  {
    type: 'info',
    text: 'Info debug: ShiniTrack v1.0.1 • Rust backend (rusqlite v2) • Vanilla UI'
  }
];

export function renderLanjutan() {
  utils.setHeaderTitles('Lanjutan', 'Log kerusakan, pengoptimalan baterai');
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  viewEl.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'settings-container';

  renderSettings(container, lanjutanSchema);
  viewEl.appendChild(container);
}

//! ShiniTrack app entry point.

pub mod backend;
pub mod commands;
pub mod download;
mod reader;
pub mod updater;

#[cfg(target_os = "android")]
mod jni_bridge;

use tauri::Manager;

use crate::commands::AppCtx;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .register_asynchronous_uri_scheme_protocol("shimg", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(reader::handle(&app, request).await);
            });
        })
        .setup(|app| {
            let dir = match backend::data_dir_override() {
                Some(d) => d,
                None => app.path().app_data_dir()?,
            };
            log::info!("data dir: {}", dir.display());
            app.manage(AppCtx::new(dir)?);
            let worker = download::QueueWorker::new();
            worker.start(app.app_handle());
            app.manage(worker);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::search,
            commands::latest,
            commands::manga_detail,
            commands::chapters,
            commands::add_favorite,
            commands::remove_favorite,
            commands::set_notify,
            commands::list_favorites,
            commands::refresh_all,
            commands::library_update,
            commands::get_last_library_update,
            commands::schedule_week,
            commands::recent_events,
            commands::mark_events_seen,
            commands::sync_now,
            commands::settings_get,
            commands::settings_set,
            commands::pref_get_all,
            commands::pref_set,
            commands::diagnose_network,
            commands::update_worker_interval,
            commands::set_keep_awake,
            commands::set_secure_screen,
            commands::test_notification,
            commands::open_chapter,
            commands::download_chapter,
            commands::delete_download,
            commands::check_app_update,
            commands::download_and_install_update,
            commands::simulate_update_check,
            commands::get_app_info,
            commands::save_reading_progress,
            commands::get_reading_progress,
            commands::list_all_reading_progress,
            commands::list_read_chapters,
            commands::mark_chapter_read,
            commands::mark_chapters_batch,
            commands::list_bookmarked_chapters,
            commands::set_chapter_bookmark,
            commands::save_manga_meta,
            commands::get_reading_history,
            commands::delete_history_item,
            commands::search_history,
            commands::can_install_updates,
            commands::request_install_permission,
            commands::install_downloaded_apk,
            commands::category_list,
            commands::category_create,
            commands::category_rename,
            commands::category_delete,
            commands::category_reorder,
            commands::set_manga_categories,
            commands::get_manga_categories,
            commands::library_list,
            commands::storage_info,
            commands::clear_cache,
            commands::backup_create,
            commands::backup_restore,
            commands::saf_open_tree,
            commands::saf_create_document,
            commands::saf_share_document,
            commands::saf_export_downloads,
            commands::saf_state,
            commands::generate_crash_log,
            commands::clear_reading_history,
            commands::reset_settings,
            commands::cleanup_database,
            commands::get_statistics,
            commands::queue_add,
            commands::queue_list,
            commands::queue_remove,
            commands::queue_pause,
            commands::queue_resume,
            commands::queue_reorder,
            commands::queue_clear,
            commands::queue_retry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShiniTrack");
}

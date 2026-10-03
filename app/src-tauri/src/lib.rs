//! ShiniTrack app entry point.

pub mod backend;
pub mod commands;
mod download;
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
            commands::schedule_week,
            commands::recent_events,
            commands::mark_events_seen,
            commands::sync_now,
            commands::settings_get,
            commands::settings_set,
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
            commands::save_manga_meta,
            commands::get_reading_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShiniTrack");
}

const { invoke } = window.__TAURI__ ? window.__TAURI__.core : {
  invoke: async (cmd, args) => { console.warn('Mock invoke:', cmd, args); return []; }
};

export const eventApi = window.__TAURI__ ? window.__TAURI__.event : null;

export async function settings_get() { return invoke('settings_get'); }
export async function pref_get_all() { return invoke('pref_get_all'); }
export async function pref_set(args) { return invoke('pref_set', args); }
export async function sync_now() { return invoke('sync_now'); }
export async function recent_events() { return invoke('recent_events'); }
export async function install_downloaded_apk(args) { return invoke('install_downloaded_apk', args); }
export async function request_install_permission() { return invoke('request_install_permission'); }
export async function download_and_install_update(args) { return invoke('download_and_install_update', args); }
export async function check_app_update(args) { return invoke('check_app_update', args); }
export async function list_favorites() { return invoke('list_favorites'); }
export async function library_update() { return invoke('library_update'); }
export async function get_last_library_update() { return invoke('get_last_library_update'); }
export async function list_all_reading_progress() { return invoke('list_all_reading_progress'); }
export async function set_notify(args) { return invoke('set_notify', args); }
export async function get_reading_history(args) { return invoke('get_reading_history', args); }
export async function delete_history_item(args) { return invoke('delete_history_item', args); }
export async function search_history(args) { return invoke('search_history', args); }
export async function schedule_week() { return invoke('schedule_week'); }
export async function latest() { return invoke('latest'); }
export async function search(args) { return invoke('search', args); }
export async function remove_favorite(args) { return invoke('remove_favorite', args); }
export async function add_favorite(args) { return invoke('add_favorite', args); }
export async function manga_detail(args) { return invoke('manga_detail', args); }
export async function chapters(args) { return invoke('chapters', args); }
export async function list_read_chapters(args) { return invoke('list_read_chapters', args); }
export async function get_reading_progress(args) { return invoke('get_reading_progress', args); }
export async function save_manga_meta(args) { return invoke('save_manga_meta', args); }
export async function mark_chapter_read(args) { return invoke('mark_chapter_read', args); }
export async function mark_chapters_batch(args) { return invoke('mark_chapters_batch', args); }
export async function list_bookmarked_chapters(args) { return invoke('list_bookmarked_chapters', args); }
export async function set_chapter_bookmark(args) { return invoke('set_chapter_bookmark', args); }
export async function delete_download(args) { return invoke('delete_download', args); }
export async function download_chapter(args) { return invoke('download_chapter', args); }
export async function open_chapter(args) { return invoke('open_chapter', args); }
export async function save_reading_progress(args) {
  return invoke('save_reading_progress', {
    ...args,
    readDuration: args?.readDuration ?? 0,
  });
}
export async function mark_events_seen() { return invoke('mark_events_seen'); }
export async function get_app_info() { return invoke('get_app_info'); }
export async function simulate_update_check() { return invoke('simulate_update_check'); }
export async function settings_set(args) { return invoke('settings_set', args); }
export async function test_notification() { return invoke('test_notification'); }
export async function category_list() { return invoke('category_list'); }
export async function category_create(args) { return invoke('category_create', args); }
export async function category_rename(args) { return invoke('category_rename', args); }
export async function category_delete(args) { return invoke('category_delete', args); }
export async function category_reorder(args) { return invoke('category_reorder', args); }
export async function set_manga_categories(args) { return invoke('set_manga_categories', args); }
export async function get_manga_categories(args) { return invoke('get_manga_categories', args); }
export async function library_list(args) {
  return invoke('library_list', {
    category: args?.category ?? 0,
    sort: args?.sort ?? 'recent',
    sortDesc: Boolean(args?.sortDesc ?? args?.sort_desc),
    filterDownloaded: args?.filterDownloaded ?? args?.filter_downloaded ?? 0,
    filterUnread: args?.filterUnread ?? args?.filter_unread ?? 0,
    filterStarted: args?.filterStarted ?? args?.filter_started ?? 0,
    filterCompleted: args?.filterCompleted ?? args?.filter_completed ?? 0,
    search: args?.search ?? null,
    limit: args?.limit ?? 30,
    offset: args?.offset ?? 0,
  });
}
export async function update_worker_interval(args) { return invoke('update_worker_interval', args); }
export async function set_keep_awake(args) { return invoke('set_keep_awake', args); }
export async function set_secure_screen(args) { return invoke('set_secure_screen', args); }
export async function test_connection(settings) { return invoke('settings_set', { settings }); }
export async function storage_info() { return invoke('storage_info'); }
export async function clear_cache(args) { return invoke('clear_cache', args); }
export async function backup_create(args) {
  const includeToken = Boolean(args?.includeToken ?? args?.include_token ?? (args === true));
  return invoke('backup_create', { includeToken });
}
export async function backup_restore(args) { return invoke('backup_restore', args); }
export async function generate_crash_log() { return invoke('generate_crash_log'); }
export async function clear_reading_history() { return invoke('clear_reading_history'); }
export async function reset_settings() { return invoke('reset_settings'); }
export async function cleanup_database() { return invoke('cleanup_database'); }
export async function get_statistics() { return invoke('get_statistics'); }
export async function queue_add(args) { return invoke('queue_add', args); }
export async function queue_list() { return invoke('queue_list'); }
export async function queue_remove(args) { return invoke('queue_remove', args); }
export async function queue_pause(args) { return invoke('queue_pause', args); }
export async function queue_resume(args) { return invoke('queue_resume', args); }
export async function queue_reorder(args) { return invoke('queue_reorder', args); }
export async function queue_clear() { return invoke('queue_clear'); }
export async function queue_retry(args) { return invoke('queue_retry', args); }




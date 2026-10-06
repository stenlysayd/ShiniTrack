# UI Audit

## Routes
- `#/favorites` -> `renderFavorites()`
- `#/updates` -> `renderUpdates()`
- `#/history` -> `renderHistory()`
- `#/search` -> `renderSearch()`
- `#/schedule` -> `renderSearch()`
- `#/settings` -> `renderSettings()`
- `#/manga/:id` -> `renderMangaDetail(mangaId)`
- `#/read/:id` -> `renderReader(chapterId)`

## `invoke` Calls in `app.js`
- `add_favorite`
- `chapters`
- `check_app_update`
- `delete_download`
- `download_and_install_update`
- `download_chapter`
- `get_app_info`
- `get_reading_history`
- `get_reading_progress`
- `install_downloaded_apk`
- `latest`
- `list_all_reading_progress`
- `list_favorites`
- `list_read_chapters`
- `manga_detail`
- `mark_chapter_read`
- `mark_chapters_batch`
- `mark_events_seen`
- `open_chapter`
- `recent_events`
- `remove_favorite`
- `request_install_permission`
- `save_manga_meta`
- `save_reading_progress`
- `schedule_week`
- `search`
- `set_notify`
- `settings_get`
- `settings_set`
- `simulate_update_check`
- `sync_now`
- `test_notification`

## Commands in `generate_handler![]`
- `add_favorite`
- `can_install_updates`
- `chapters`
- `check_app_update`
- `delete_download`
- `download_and_install_update`
- `download_chapter`
- `get_app_info`
- `get_reading_history`
- `get_reading_progress`
- `install_downloaded_apk`
- `latest`
- `list_all_reading_progress`
- `list_favorites`
- `list_read_chapters`
- `manga_detail`
- `mark_chapter_read`
- `mark_chapters_batch`
- `mark_events_seen`
- `open_chapter`
- `recent_events`
- `refresh_all`
- `remove_favorite`
- `request_install_permission`
- `save_manga_meta`
- `save_reading_progress`
- `schedule_week`
- `search`
- `set_notify`
- `settings_get`
- `settings_set`
- `simulate_update_check`
- `sync_now`
- `test_notification`

## Comparison
- **Commands used but missing**: None
- **Commands defined but never used**: `refresh_all`, `can_install_updates`

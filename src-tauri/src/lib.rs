mod args;
mod commands;
mod error;
mod probe;
mod progress;
mod queue;
mod resolve;

use queue::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init_from_env(
        env_logger::Env::default().filter_or(env_logger::DEFAULT_FILTER_ENV, "info"),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::probe_video,
            commands::enqueue_download,
            commands::cancel_download,
            commands::list_jobs,
            commands::set_max_concurrency,
            commands::open_download_location,
            commands::dependency_info,
            commands::detect_proxy,
            commands::google_oauth_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

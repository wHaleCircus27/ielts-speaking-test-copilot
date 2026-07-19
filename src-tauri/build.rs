fn main() {
    const COMMANDS: &[&str] = &[
        "health_check",
        "get_app_config",
        "save_app_config",
        "clear_deepseek_key",
        "clear_zhipu_key",
        "clear_azure_key",
        "accept_cloud_disclosure",
        "validate_azure_config",
        "issue_azure_speech_token",
        "validate_deepseek_config",
        "grade_speaking",
        "create_teacher_case",
        "list_teacher_cases",
        "get_teacher_case",
        "update_teacher_case",
        "delete_teacher_case",
        "rebuild_teacher_case_embedding",
        "search_teacher_cases",
        "diagnose_teacher_case_search",
        "select_media_file",
        "get_media_metadata",
        "transcode_media",
        "cancel_media_transcode",
        "delete_generated_media_file",
        "reconcile_generated_media",
    ];

    let application_manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(application_manifest))
        .expect("failed to build Tauri application manifest");
}

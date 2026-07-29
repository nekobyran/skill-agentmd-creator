#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod skill_store;

use std::path::PathBuf;
use tauri::Manager;

use skill_store::{
    codex_model_status_at, create_skill_at, delete_skill_at, design_skill_at, ensure_manifest_at,
    import_codex_skills_at, legacy_root_from_data_dir, list_skills_at, read_skill_at,
    scan_codex_skills_at, set_codex_model_at, translate_rule_to_english_at, update_skill_at,
    CodexModelStatus, CodexSkillCatalog, CodexSkillImportRequest, CodexSkillImportResult,
    CreateResult, DesignSkillHistoryMessage, DesignSkillRequest, DesignSkillResult, SkillContent,
    SkillDraft, SkillSummary, TranslationResult,
};

const SIDEBAR_WINDOW_ARG: &str = "--sidebar";
const SIDEBAR_INITIAL_WIDTH: f64 = 360.0;
const SIDEBAR_INITIAL_HEIGHT: f64 = 720.0;
const SIDEBAR_MIN_WIDTH: f64 = 320.0;
const SIDEBAR_MIN_HEIGHT: f64 = 480.0;

#[tauri::command]
fn ensure_manifest(app: tauri::AppHandle) -> Result<CreateResult, String> {
    let root = workspace_root(&app)?;
    ensure_manifest_at(&root)
}

#[tauri::command]
fn list_skills(app: tauri::AppHandle) -> Result<Vec<SkillSummary>, String> {
    let root = workspace_root(&app)?;
    let legacy_root = legacy_workspace_root(&app)?;
    list_skills_at(&root, &legacy_root)
}

#[tauri::command]
fn read_skill(app: tauri::AppHandle, id: String) -> Result<SkillContent, String> {
    let root = workspace_root(&app)?;
    let legacy_root = legacy_workspace_root(&app)?;
    read_skill_at(&root, &legacy_root, &id)
}

#[tauri::command]
fn create_skill(app: tauri::AppHandle, draft: SkillDraft) -> Result<CreateResult, String> {
    let root = workspace_root(&app)?;
    create_skill_at(&root, draft)
}

#[tauri::command]
fn delete_skill(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = workspace_root(&app)?;
    let legacy_root = legacy_workspace_root(&app)?;
    delete_skill_at(&root, &legacy_root, &id)
}

#[tauri::command]
fn update_skill(
    app: tauri::AppHandle,
    id: String,
    draft: SkillDraft,
) -> Result<CreateResult, String> {
    let root = workspace_root(&app)?;
    let legacy_root = legacy_workspace_root(&app)?;
    update_skill_at(&root, &legacy_root, &id, draft)
}

#[tauri::command]
fn list_codex_skills(app: tauri::AppHandle) -> Result<CodexSkillCatalog, String> {
    scan_codex_skills_at(&workspace_root(&app)?)
}

#[tauri::command]
fn import_codex_skills(
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<CodexSkillImportResult, String> {
    import_codex_skills_at(&workspace_root(&app)?, CodexSkillImportRequest { ids })
}

#[tauri::command]
fn ping_backend() -> bool {
    true
}

#[tauri::command]
fn codex_status(app: tauri::AppHandle) -> Result<CodexModelStatus, String> {
    Ok(codex_model_status_at(&data_dir(&app)?))
}

#[tauri::command]
async fn translate_rule(app: tauri::AppHandle, text: String) -> Result<TranslationResult, String> {
    let root = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || translate_rule_to_english_at(&root, text))
        .await
        .map_err(|error| format!("Codex 翻译任务异常结束：{error}"))?
}

#[tauri::command]
async fn design_skill(
    app: tauri::AppHandle,
    mode: String,
    prompt: String,
    current_source: String,
    history: Vec<DesignSkillHistoryMessage>,
) -> Result<DesignSkillResult, String> {
    let data_dir = data_dir(&app)?;
    let request = DesignSkillRequest {
        mode,
        prompt,
        current_source,
        history,
    };
    tauri::async_runtime::spawn_blocking(move || design_skill_at(&data_dir, request))
        .await
        .map_err(|error| format!("Codex 技能设计任务异常结束：{error}"))?
}

#[tauri::command]
fn set_codex_model(
    app: tauri::AppHandle,
    model: String,
    reasoning_effort: String,
    fast_mode: bool,
) -> Result<CodexModelStatus, String> {
    set_codex_model_at(&data_dir(&app)?, model, reasoning_effort, fast_mode)
}

fn is_sidebar_mode() -> bool {
    std::env::args().any(|arg| arg == SIDEBAR_WINDOW_ARG)
}

fn apply_sidebar_window_geometry(app: &mut tauri::App) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在，无法设置侧边窗口模式".to_string())?;

    main.set_title("Skill Agentmd Creator（侧边）")
        .map_err(|error| error.to_string())?;
    main.set_decorations(true)
        .map_err(|error| error.to_string())?;
    main.set_resizable(true)
        .map_err(|error| error.to_string())?;
    main.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: SIDEBAR_MIN_WIDTH,
        height: SIDEBAR_MIN_HEIGHT,
    })))
    .map_err(|error| error.to_string())?;
    main.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: SIDEBAR_INITIAL_WIDTH,
        height: SIDEBAR_INITIAL_HEIGHT,
    }))
    .map_err(|error| error.to_string())?;
    main.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: 0,
        y: 80,
    }))
    .map_err(|error| error.to_string())?;
    main.set_always_on_top(false)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    skill_store::workspace_root_from_data_dir(&data_dir(app)?)
}

fn legacy_workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(legacy_root_from_data_dir(&data_dir(app)?))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            ensure_manifest,
            list_skills,
            read_skill,
            create_skill,
            delete_skill,
            update_skill,
            list_codex_skills,
            import_codex_skills,
            ping_backend,
            codex_status,
            set_codex_model,
            translate_rule,
            design_skill
        ])
        .setup(|app| {
            if is_sidebar_mode() {
                apply_sidebar_window_geometry(app)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running skill-agentmd-creator");
}

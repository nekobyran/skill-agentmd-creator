use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const SKILL_FILE_NAME: &str = "SKILL.md";
pub const ENTRY_FILE_NAME: &str = "skillcreator-entry.json";
const APP_DATA_DIR_NAME: &str = "local.skillcreator";
const LEGACY_APP_DATA_DIR_NAME: &str = "local.skill.agentmd.creator";
const FALLBACK_DATA_DIR_NAME: &str = ".skillcreator";
const LEGACY_FALLBACK_DATA_DIR_NAME: &str = ".skill-agentmd-creator";

#[allow(dead_code)]
pub const API_HOST: &str = "127.0.0.1";
#[allow(dead_code)]
pub const API_PORT: u16 = 1421;
#[allow(dead_code)]
pub const API_BODY_LIMIT: usize = 1024 * 1024;
const TRANSLATION_TEXT_LIMIT: usize = 4000;
const DESIGN_PROMPT_LIMIT: usize = 20_000;
const DESIGN_SOURCE_LIMIT: usize = 500_000;
const DESIGN_HISTORY_LIMIT: usize = 40;
const DESIGN_HISTORY_TEXT_LIMIT: usize = 120_000;
const CODEX_SKILL_SCAN_LIMIT: usize = 512;
const CODEX_SKILL_SCAN_DEPTH: usize = 12;
const CODEX_SKILL_FILE_LIMIT: usize = 4096;
const CODEX_SKILL_BYTES_LIMIT: u64 = 64 * 1024 * 1024;
const IMPORT_SOURCE_FILE_NAME: &str = ".skill-creator-source.json";
const CODEX_API_BASE: &str = "https://chatgpt.com/backend-api/codex";
const CODEX_MODELS_URL: &str =
    "https://chatgpt.com/backend-api/codex/models?client_version=0.144.0-alpha.4";
const DEFAULT_CODEX_MODEL: &str = "gpt-5.3-codex-spark";
const NORMATIVE_OUTPUT_CONTRACT: &str = concat!(
    "\n\nNormative output contract:\n",
    "- Treat the request as requirements regardless of whether it is written in Chinese or English.\n",
    "- Write canonical skill content in English, except literal examples that must remain in another language.\n",
    "- SKILL.md is a compact router only: YAML frontmatter, `## Top Rules` for universally mandatory rules, and `## Partition Index` for on-demand file routing. Do not duplicate partition details into the root.\n",
    "- Put detailed rules, workflows, validation, platform/domain guidance, and other non-universal content in separate files. If any rule is only needed for first project execution/bootstrap/migration, place it in `references/initialization.md` and route to it only for initialization triggers.\n",
    "- The `files` array may contain reusable UTF-8 source/templates/scripts/assets in addition to Markdown references; SKILL.md must index only what callers may need to load.\n",
    "- In every rule-bearing partition, use fixed visible ordered-list numbers (`1.`, `2.`, `3.` ...). Preserve existing rule numbers in modify mode; never renumber unrelated rules. CLI-created rules may additionally carry SkillCreator marker comments.\n",
        "- Treat rule text as free semantics under this normative governance contract. Preserve the requested intent, scope, modality, trigger boundaries, exclusions, ordering, and verification obligations when they exist, but do not force any particular sentence pattern or grammar.\n",
    "- Only encode a condition, step sequence, verification/evidence clause, or other explicit structure when that structure is actually present or necessary in the requested semantics. Do not invent structure merely to make rules look uniform.\n",
    "- Reject rule bloat: do not add rules for isolated low-probability incidents, generic prohibitions that merely restate normal assistant behavior, or defaults that need no skill-specific governance. Prefer deleting or merging such rules.\n",
    "- Before adding a rule, check the complete bundle for semantic duplicates/overlap. Before modifying a rule, preserve stronger existing constraints and coverage unless the user explicitly requests removal.\n",
    "- Preserve unrelated files and unknown content in modify mode. Use `deletedFiles` only for files the user explicitly asked to remove or that are provably obsolete because of the requested change.\n",
    "- Return the complete desired UTF-8 text-file bundle, not only changed fragments."
);
const NORMATIVE_DESIGN_INSTRUCTIONS: &str = concat!(
    "You are a senior Codex Skill designer. Produce a proposal only; never claim to write files, run tools, or apply changes. ",
    "Design the skill as a compact routed multi-file package. The root SKILL.md is only the universal top-rule layer plus the partition index; detailed guidance belongs in files. ",
        "Write every rule in the clearest free semantic form for its actual requirements. Do not prefer any sentence template; preserve explicit conditions, procedures, verification duties, scope, and modality only when the requested semantics require them, and never manufacture structure for stylistic uniformity. ",
    "For modify mode, preserve unrelated files and stronger existing requirements, and never silently weaken or renumber existing rules. ",
    "Every returned text file must be complete UTF-8 content. Reusable source/templates/scripts may be returned in files when they materially reduce repeated implementation work. ",
    "Return exactly one JSON object with fields: assistantMessage (concise Chinese explanation), markdown (complete root SKILL.md), files (array of objects with path and content), and deletedFiles (array of relative paths explicitly removed by this request). ",
    "Do not wrap the JSON in Markdown fences and do not add text outside the JSON."
);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillDraft {
    pub name: String,
    pub description: String,
    pub source_markdown: String,
    #[serde(default)]
    pub files: Vec<SkillFileDraft>,
    #[serde(default)]
    pub deleted_files: Vec<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileDraft {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub file_path: String,
    pub updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillContent {
    pub id: String,
    pub name: String,
    pub description: String,
    pub file_path: String,
    pub content: String,
    pub entry_file: String,
    pub index_mode: bool,
    pub files: Vec<SkillMarkdownFile>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillMarkdownFile {
    pub path: String,
    pub content: String,
    pub byte_size: u64,
    pub is_entry: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexSkillCatalogEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub relative_path: String,
    pub source_path: String,
    pub file_count: usize,
    pub byte_size: u64,
    pub imported: bool,
    pub imported_id: Option<String>,
    pub format_gaps: Vec<String>,
    pub loadable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSkillCatalog {
    pub entries: Vec<CodexSkillCatalogEntry>,
    pub roots: Vec<String>,
    pub scanned_at: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSkillImportRequest {
    #[serde(default)]
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSkillImportResult {
    pub discovered: usize,
    pub requested: usize,
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedSkillSource {
    catalog_id: String,
    source_path: String,
    imported_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub file_path: String,
    pub entry_path: String,
    pub content: String,
    pub written_files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryManifest {
    pub tool: String,
    pub version: String,
    pub description: String,
    pub entry_root: String,
    pub supported_files: Vec<String>,
    pub cli_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelStatus {
    pub auth_file_detected: bool,
    pub connected: bool,
    pub checked_at: u64,
    pub message: String,
    pub model: String,
    pub reasoning_effort: String,
    pub fast_mode: bool,
    pub available_models: Vec<CodexModelOption>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelOption {
    pub slug: String,
    pub display_name: String,
    pub reasoning_levels: Vec<String>,
    pub supports_fast: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexSettings {
    translation_model: String,
    #[serde(default = "default_reasoning_effort")]
    reasoning_effort: String,
    #[serde(default)]
    fast_mode: bool,
}

#[derive(Debug, Deserialize)]
struct CodexModelsResponse {
    models: Vec<CodexApiModel>,
}

#[derive(Debug, Deserialize)]
struct CodexApiModel {
    slug: String,
    display_name: String,
    visibility: String,
    #[serde(default)]
    supported_reasoning_levels: Vec<CodexReasoningLevel>,
    #[serde(default)]
    additional_speed_tiers: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CodexReasoningLevel {
    effort: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub translated_text: String,
    pub model: String,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignSkillHistoryMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignSkillRequest {
    pub mode: String,
    pub prompt: String,
    #[serde(default)]
    pub current_source: String,
    #[serde(default)]
    pub current_files: Vec<SkillFileDraft>,
    #[serde(default)]
    pub history: Vec<DesignSkillHistoryMessage>,
    #[serde(default)]
    pub normative: bool,
    #[serde(default)]
    pub include_chinese_sample: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignSkillResult {
    pub assistant_message: String,
    pub markdown: String,
    pub files: Vec<SkillFileDraft>,
    pub deleted_files: Vec<String>,
    pub sample_markdown: Option<String>,
    pub model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesignSkillProposal {
    assistant_message: String,
    markdown: String,
    #[serde(default)]
    files: Vec<SkillFileDraft>,
    #[serde(default)]
    deleted_files: Vec<String>,
}

#[derive(Debug)]
struct CodexTranslationConfig {
    api_base: String,
    api_key: String,
    account_id: Option<String>,
    model: String,
    effort: String,
    fast_mode: bool,
    timeout_seconds: u64,
    text_verbosity: String,
}

#[derive(Debug)]
enum CodexRequestError {
    Retryable(String),
    Fatal(String),
}

#[derive(Debug, Deserialize)]
struct CodexAuthFile {
    tokens: Option<CodexAuthTokens>,
}

#[derive(Debug, Deserialize)]
struct CodexAuthTokens {
    access_token: String,
    account_id: Option<String>,
}

fn absolute_data_path(path: &Path) -> Result<PathBuf, String> {
    std::path::absolute(path).map_err(|error| error.to_string())
}

fn migrate_legacy_app_data_dir(
    parent: &Path,
    canonical_name: &str,
    legacy_name: &str,
) -> Result<PathBuf, String> {
    let parent = absolute_data_path(parent)?;
    let canonical = parent.join(canonical_name);
    let legacy = parent.join(legacy_name);

    if canonical.exists() && legacy.exists() {
        return Err(format!(
            "检测到新旧 SkillCreator 数据目录同时存在，拒绝自动合并：{}；{}",
            canonical.to_string_lossy(),
            legacy.to_string_lossy()
        ));
    }
    if legacy.exists() {
        if !legacy.is_dir() {
            return Err(format!(
                "旧 SkillCreator 数据路径不是目录：{}",
                legacy.to_string_lossy()
            ));
        }
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        fs::rename(&legacy, &canonical).map_err(|error| {
            format!(
                "无法迁移 SkillCreator 数据目录 {} -> {}：{error}",
                legacy.to_string_lossy(),
                canonical.to_string_lossy()
            )
        })?;
    }
    Ok(canonical)
}

#[allow(dead_code)]
pub fn default_app_data_dir() -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("SKILL_CREATOR_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return absolute_data_path(Path::new(trimmed));
        }
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        return migrate_legacy_app_data_dir(
            Path::new(&app_data),
            APP_DATA_DIR_NAME,
            LEGACY_APP_DATA_DIR_NAME,
        );
    }

    if let Ok(data_home) = std::env::var("XDG_DATA_HOME") {
        return migrate_legacy_app_data_dir(
            Path::new(&data_home),
            APP_DATA_DIR_NAME,
            LEGACY_APP_DATA_DIR_NAME,
        );
    }

    if let Ok(home) = std::env::var("HOME") {
        let parent = PathBuf::from(home).join(".local").join("share");
        return migrate_legacy_app_data_dir(&parent, APP_DATA_DIR_NAME, LEGACY_APP_DATA_DIR_NAME);
    }

    let current = std::env::current_dir().map_err(|error| error.to_string())?;
    migrate_legacy_app_data_dir(
        &current,
        FALLBACK_DATA_DIR_NAME,
        LEGACY_FALLBACK_DATA_DIR_NAME,
    )
}

pub fn workspace_root_from_data_dir(data_dir: &Path) -> Result<PathBuf, String> {
    let root = data_dir.join("skills");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

#[cfg(windows)]
struct WorkspaceWriteLock {
    _file: fs::File,
}

#[cfg(not(windows))]
struct WorkspaceWriteLock;

fn acquire_workspace_write_lock(root: &Path) -> Result<WorkspaceWriteLock, String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        let lock_path = root.join(".skill-write.lock");
        for _ in 0..500 {
            match OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .share_mode(0)
                .open(&lock_path)
            {
                Ok(file) => return Ok(WorkspaceWriteLock { _file: file }),
                Err(error) if matches!(error.raw_os_error(), Some(32) | Some(33)) => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => return Err(format!("获取 Skill 跨进程写锁失败：{error}")),
            }
        }
        Err("等待 Skill 跨进程写锁超时".to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        Ok(WorkspaceWriteLock)
    }
}

pub fn ensure_manifest_at(root: &Path) -> Result<CreateResult, String> {
    let _write_lock = acquire_workspace_write_lock(root)?;
    let entry_path = write_entry_manifest(root)?;
    Ok(CreateResult {
        file_path: String::new(),
        entry_path: entry_path.to_string_lossy().to_string(),
        content: String::new(),
        written_files: Vec::new(),
    })
}

pub fn codex_model_status_at(data_dir: &Path) -> CodexModelStatus {
    let checked_at = unix_seconds();
    let settings = selected_codex_settings(data_dir);
    match load_codex_auth_tokens() {
        Ok(tokens) => {
            let available_models =
                load_codex_models(&tokens).unwrap_or_else(|_| fallback_models(&settings));
            CodexModelStatus {
                auth_file_detected: true,
                connected: true,
                checked_at,
                message: "已连接本机 Codex".to_string(),
                model: settings.translation_model,
                reasoning_effort: settings.reasoning_effort,
                fast_mode: settings.fast_mode,
                available_models,
            }
        }
        Err(message) => {
            let available_models = fallback_models(&settings);
            CodexModelStatus {
                auth_file_detected: codex_auth_path().is_some_and(|path| path.is_file()),
                connected: false,
                checked_at,
                message,
                model: settings.translation_model,
                reasoning_effort: settings.reasoning_effort,
                fast_mode: settings.fast_mode,
                available_models,
            }
        }
    }
}

pub fn set_codex_model_at(
    data_dir: &Path,
    model: String,
    reasoning_effort: String,
    fast_mode: bool,
) -> Result<CodexModelStatus, String> {
    let model = model.trim();
    let tokens = load_codex_auth_tokens()?;
    let models = load_codex_models(&tokens)?;
    let selected = models
        .iter()
        .find(|item| item.slug == model)
        .ok_or_else(|| "所选模型不在当前 Codex 可用列表中".to_string())?;
    if !selected
        .reasoning_levels
        .iter()
        .any(|level| level == reasoning_effort.trim())
    {
        return Err("所选模型不支持该思考程度".to_string());
    }
    if fast_mode && !selected.supports_fast {
        return Err("所选模型不支持 Fast 模式".to_string());
    }
    let settings_dir = data_dir.join("settings");
    fs::create_dir_all(&settings_dir).map_err(|error| error.to_string())?;
    let path = settings_dir.join("codex.json");
    let content = serde_json::to_string_pretty(&CodexSettings {
        translation_model: model.to_string(),
        reasoning_effort: reasoning_effort.trim().to_string(),
        fast_mode,
    })
    .map_err(|error| error.to_string())?;
    fs::write(path, format!("{content}\n")).map_err(|error| error.to_string())?;
    Ok(codex_model_status_at(data_dir))
}

pub fn translate_rule_to_english_at(
    data_dir: &Path,
    text: String,
) -> Result<TranslationResult, String> {
    let source_text = text.trim();
    if source_text.is_empty() {
        return Err("要翻译的内容不能为空".to_string());
    }
    if source_text.chars().count() > TRANSLATION_TEXT_LIMIT {
        return Err(format!(
            "要翻译的内容过长，最多 {TRANSLATION_TEXT_LIMIT} 个字符"
        ));
    }

    let config = codex_translation_config(data_dir)?;
    let translated_text =
        clean_translation_output(&request_codex_translation(&config, source_text)?);
    if translated_text.is_empty() {
        return Err("Codex 没有返回英文译文".to_string());
    }

    Ok(TranslationResult {
        translated_text,
        model: config.model,
        source_id: Some("local-codex-auth".to_string()),
    })
}

pub fn design_skill_at(
    data_dir: &Path,
    request: DesignSkillRequest,
) -> Result<DesignSkillResult, String> {
    let mode = normalize_design_mode(&request.mode)?;
    let normative = request.normative;
    let include_chinese_sample = request.include_chinese_sample;
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("技能设计要求不能为空".to_string());
    }
    if prompt.chars().count() > DESIGN_PROMPT_LIMIT {
        return Err(format!(
            "技能设计要求过长，最多 {DESIGN_PROMPT_LIMIT} 个字符"
        ));
    }
    if request.current_source.chars().count() > DESIGN_SOURCE_LIMIT {
        return Err(format!(
            "当前 Skill 源文过长，最多 {DESIGN_SOURCE_LIMIT} 个字符"
        ));
    }
    if mode == "modify" && request.current_source.trim().is_empty() {
        return Err("修改模式必须提供 currentSource".to_string());
    }
    prepare_draft_files(&request.current_files)?;
    let current_files_chars = request
        .current_files
        .iter()
        .map(|file| file.content.chars().count())
        .sum::<usize>();
    if current_files_chars > DESIGN_SOURCE_LIMIT {
        return Err(format!(
            "当前 Skill 分区文件过长，最多 {DESIGN_SOURCE_LIMIT} 个字符"
        ));
    }
    if request.history.len() > DESIGN_HISTORY_LIMIT {
        return Err(format!("技能设计历史过多，最多 {DESIGN_HISTORY_LIMIT} 条"));
    }

    let mut history_text_count = 0;
    let mut input = Vec::with_capacity(request.history.len() + 1);
    for message in request.history {
        let role = message.role.trim().to_ascii_lowercase();
        if role != "user" && role != "assistant" {
            return Err("技能设计历史 role 只能是 user 或 assistant".to_string());
        }
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        history_text_count += content.chars().count();
        if history_text_count > DESIGN_HISTORY_TEXT_LIMIT {
            return Err(format!(
                "技能设计历史过长，最多 {DESIGN_HISTORY_TEXT_LIMIT} 个字符"
            ));
        }
        input.push(serde_json::json!({
            "role": role,
            "content": content,
        }));
    }

    let current_source = request.current_source.trim();
    let current_files_json = serde_json::to_string(&request.current_files)
        .map_err(|error| format!("无法序列化当前 Skill 文件：{error}"))?;
    let mut user_content = if current_source.is_empty() {
        format!("Mode: {mode}\nUser request:\n{prompt}")
    } else {
        format!(
            "Mode: {mode}\nUser request:\n{prompt}\n\nCurrent complete SKILL.md source:\n<skill-source>\n{current_source}\n</skill-source>\n\nCurrent editable UTF-8 skill files as JSON (excluding SKILL.md):\n<skill-files>\n{current_files_json}\n</skill-files>"
        )
    };
    if normative {
        user_content.push_str(NORMATIVE_OUTPUT_CONTRACT);
    }

    input.push(serde_json::json!({
        "role": "user",
        "content": user_content,
    }));

    let config = codex_translation_config(data_dir)?;
    let instructions = NORMATIVE_DESIGN_INSTRUCTIONS;

    let raw = request_codex_text(
        &config,
        instructions,
        &serde_json::Value::Array(input),
        "medium",
        "技能设计",
    )?;
    let proposal = parse_design_skill_output(&raw)?;
    if normative {
        validate_normative_skill_bundle(&proposal.markdown, &proposal.files)?;
    }
    let sample_markdown = if include_chinese_sample {
        Some(translate_skill_sample_to_chinese(
            &config,
            &proposal.markdown,
        )?)
    } else {
        None
    };

    Ok(DesignSkillResult {
        assistant_message: proposal.assistant_message,
        markdown: proposal.markdown,
        files: proposal.files,
        deleted_files: proposal.deleted_files,
        sample_markdown,
        model: config.model,
    })
}

fn translate_skill_sample_to_chinese(
    config: &CodexTranslationConfig,
    canonical_markdown: &str,
) -> Result<String, String> {
    let input = serde_json::json!([{
        "role": "user",
        "content": canonical_markdown,
    }]);
    let raw = request_codex_text(
        config,
        concat!(
            "Reverse-translate the complete canonical Codex SKILL.md from English to Simplified Chinese as a browse-only sample. ",
            "Preserve the Markdown structure, YAML keys, frontmatter name, identifiers, property labels, paths, commands, URLs, code fences, and code exactly. ",
            "Translate frontmatter description, headings, prose, conditions, actions, and evidence text naturally. ",
            "Return only the complete translated Markdown, without an outer Markdown fence, commentary, or labels."
        ),
        &input,
        "medium",
        "技能中文样本反向翻译",
    )?;
    let translated = strip_json_fence(raw.trim()).trim().to_string();
    validate_proposed_skill_markdown(&translated)?;
    if translated == canonical_markdown.trim() || !contains_han_outside_fences(&translated) {
        return Err("Codex 没有返回有效的中文技能样本".to_string());
    }
    Ok(translated)
}

fn normalize_design_mode(mode: &str) -> Result<&'static str, String> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "create" | "new" => Ok("create"),
        "modify" | "edit" | "update" => Ok("modify"),
        _ => Err("mode 只能是 create 或 modify".to_string()),
    }
}

fn parse_design_skill_output(value: &str) -> Result<DesignSkillProposal, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Codex 没有返回技能设计提案".to_string());
    }
    let unfenced = strip_json_fence(trimmed);
    let proposal = serde_json::from_str::<DesignSkillProposal>(unfenced)
        .or_else(|_| {
            let start = unfenced.find('{').ok_or_else(|| {
                serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "missing JSON object",
                ))
            })?;
            let end = unfenced.rfind('}').ok_or_else(|| {
                serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "missing JSON object end",
                ))
            })?;
            serde_json::from_str::<DesignSkillProposal>(&unfenced[start..=end])
        })
        .map_err(|error| format!("Codex 技能设计输出不是有效 JSON：{error}"))?;

    let assistant_message = proposal.assistant_message.trim().to_string();
    let markdown = proposal.markdown.trim().to_string();
    if assistant_message.is_empty() {
        return Err("Codex 技能设计提案缺少 assistantMessage".to_string());
    }
    validate_proposed_skill_markdown(&markdown)?;
    prepare_draft_files(&proposal.files)?;
    prepare_deleted_files(&proposal.deleted_files)?;
    Ok(DesignSkillProposal {
        assistant_message,
        markdown,
        files: proposal.files,
        deleted_files: proposal.deleted_files,
    })
}

fn strip_json_fence(value: &str) -> &str {
    let Some(first_newline) = value.find('\n') else {
        return value;
    };
    if !value[..first_newline].trim().starts_with("```") {
        return value;
    }
    let body = &value[first_newline + 1..];
    if let Some(last_fence) = body.rfind("```") {
        if body[last_fence + 3..].trim().is_empty() {
            return body[..last_fence].trim();
        }
    }
    value
}

fn validate_proposed_skill_markdown(markdown: &str) -> Result<(), String> {
    let value = markdown.trim_start_matches('\u{feff}');
    let mut lines = value.lines();
    if lines.next().map(str::trim) != Some("---") {
        return Err("Codex 技能设计提案缺少 YAML frontmatter".to_string());
    }
    if !lines.any(|line| line.trim() == "---") {
        return Err("Codex 技能设计提案的 YAML frontmatter 未闭合".to_string());
    }
    if frontmatter_value(value, "name").is_none() {
        return Err("Codex 技能设计提案缺少非空 name".to_string());
    }
    if frontmatter_value(value, "description").is_none() {
        return Err("Codex 技能设计提案缺少非空 description".to_string());
    }
    Ok(())
}

fn ordered_rule_number(line: &str) -> Option<u32> {
    let trimmed = line.trim_start();
    let dot = trimmed.find('.')?;
    let digits = &trimmed[..dot];
    if digits.is_empty() || !digits.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let rest = trimmed[dot + 1..].trim_start();
    if rest.is_empty() {
        return None;
    }
    digits.parse::<u32>().ok().filter(|value| *value > 0)
}

fn numbered_rules_in_section(markdown: &str, heading: &str) -> Vec<(u32, String)> {
    let mut in_fence = false;
    let mut active = false;
    let mut rules = Vec::new();
    for line in markdown.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            active = trimmed.eq_ignore_ascii_case(heading);
            continue;
        }
        if !active {
            continue;
        }
        if let Some(number) = ordered_rule_number(line) {
            let text = line
                .trim_start()
                .split_once('.')
                .map(|(_, rest)| rest.trim().to_string())
                .unwrap_or_default();
            rules.push((number, text));
        }
    }
    rules
}

fn normalized_rule_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn validate_numbered_rules(
    markdown: &str,
    heading: &str,
    label: &str,
) -> Result<Vec<(u32, String)>, String> {
    let rules = numbered_rules_in_section(markdown, heading);
    if rules.is_empty() {
        return Err(format!("{label} 的 `{heading}` 必须包含固定编号规则"));
    }
    let mut seen = HashSet::new();
    let mut previous = 0_u32;
    for (number, _) in &rules {
        if !seen.insert(*number) {
            return Err(format!("{label} 的规则编号重复：{number}"));
        }
        if *number <= previous {
            return Err(format!("{label} 的规则编号必须按固定编号升序出现"));
        }
        previous = *number;
    }
    Ok(rules)
}

fn validate_normative_skill_bundle(markdown: &str, files: &[SkillFileDraft]) -> Result<(), String> {
    validate_proposed_skill_markdown(markdown)?;
    if markdown.len() > 12 * 1024 {
        return Err("规范技能根 SKILL.md 过大；详细规则必须移入分区文件".to_string());
    }
    let description = frontmatter_value(markdown, "description").unwrap_or_default();
    if !description.to_ascii_lowercase().contains("use when") {
        return Err("规范技能的 description 必须包含 `Use when` 触发条件".to_string());
    }
    for heading in ["## Top Rules", "## Partition Index"] {
        if !markdown.lines().any(|line| line.trim() == heading) {
            return Err(format!("规范技能根文件缺少 `{heading}`"));
        }
    }
    let mut in_fence = false;
    for line in markdown.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if !in_fence && line.trim_start().starts_with("## ") {
            let heading = line.trim();
            if heading != "## Top Rules" && heading != "## Partition Index" {
                return Err(format!(
                    "根 SKILL.md 只能包含 Top Rules 与 Partition Index；请把 `{heading}` 移入分区文件"
                ));
            }
        }
    }
    let root_rules = validate_numbered_rules(markdown, "## Top Rules", "SKILL.md")?;
    if files.is_empty() {
        return Err("规范技能必须至少包含一个分区文件".to_string());
    }
    prepare_draft_files(files)?;
    if contains_han_outside_fences(markdown) {
        return Err("规范技能根文件必须使用英文；中文只能出现在代码或字面样本中".to_string());
    }

    let mut duplicate_guard = HashMap::<String, String>::new();
    for (number, text) in root_rules {
        let normalized = normalized_rule_text(&text);
        if !normalized.is_empty() {
            duplicate_guard.insert(normalized, format!("SKILL.md#{number}"));
        }
    }

    for file in files {
        let path = file.path.replace('\\', "/");
        if path.to_ascii_lowercase().starts_with("references/")
            && path.to_ascii_lowercase().ends_with(".md")
            && !path.eq_ignore_ascii_case("references/SKILL.zh-CN.md")
            && !markdown.contains(&path)
        {
            return Err(format!("Partition Index 未路由到分区文件 `{path}`"));
        }
        if path.to_ascii_lowercase().ends_with(".md")
            && !path.eq_ignore_ascii_case("references/SKILL.zh-CN.md")
            && contains_han_outside_fences(&file.content)
        {
            return Err(format!("规范技能分区 `{path}` 必须使用英文"));
        }
        if file
            .content
            .lines()
            .any(|line| line.trim().eq_ignore_ascii_case("## Rules"))
        {
            for (number, text) in validate_numbered_rules(&file.content, "## Rules", &path)? {
                let normalized = normalized_rule_text(&text);
                if normalized.is_empty() {
                    continue;
                }
                let location = format!("{path}#{number}");
                if let Some(existing) = duplicate_guard.insert(normalized, location.clone()) {
                    return Err(format!("规范技能存在重复规则：{existing} 与 {location}"));
                }
            }
        }
    }
    Ok(())
}

fn contains_han_outside_fences(markdown: &str) -> bool {
    let mut in_fence = false;
    for line in markdown.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if !in_fence
            && line.chars().any(|character| {
                matches!(
                    character,
                    '\u{3400}'..='\u{4dbf}'
                        | '\u{4e00}'..='\u{9fff}'
                        | '\u{f900}'..='\u{faff}'
                )
            })
        {
            return true;
        }
    }
    false
}

fn codex_auth_path() -> Option<PathBuf> {
    std::env::var("CODEX_HOME")
        .ok()
        .map(|value| PathBuf::from(value.trim()).join("auth.json"))
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| {
            std::env::var("USERPROFILE")
                .ok()
                .map(|value| PathBuf::from(value.trim()).join(".codex").join("auth.json"))
        })
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|value| PathBuf::from(value.trim()).join(".codex").join("auth.json"))
        })
}

fn load_codex_auth_tokens() -> Result<CodexAuthTokens, String> {
    let path = codex_auth_path().ok_or_else(|| "未找到本机 Codex 登录目录".to_string())?;
    if !path.is_file() {
        return Err("未找到本机 Codex auth.json".to_string());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取本机 Codex auth.json：{error}"))?;
    let auth: CodexAuthFile = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("本机 Codex auth.json 无效：{error}"))?;
    let tokens = auth
        .tokens
        .ok_or_else(|| "本机 Codex auth.json 缺少登录令牌".to_string())?;
    if tokens.access_token.trim().is_empty() {
        return Err("本机 Codex access token 为空".to_string());
    }
    Ok(tokens)
}

fn default_reasoning_effort() -> String {
    "medium".to_string()
}

fn selected_codex_settings(data_dir: &Path) -> CodexSettings {
    let path = data_dir.join("settings").join("codex.json");
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<CodexSettings>(&content).ok())
        .unwrap_or_else(|| CodexSettings {
            translation_model: std::env::var("SKILL_CREATOR_CODEX_MODEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_CODEX_MODEL.to_string()),
            reasoning_effort: default_reasoning_effort(),
            fast_mode: false,
        })
}

fn load_codex_models(tokens: &CodexAuthTokens) -> Result<Vec<CodexModelOption>, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .build();
    let mut request = agent
        .get(CODEX_MODELS_URL)
        .set("Authorization", &format!("Bearer {}", tokens.access_token));
    if let Some(account_id) = tokens.account_id.as_deref() {
        request = request.set("ChatGPT-Account-Id", account_id);
    }
    let response = request
        .call()
        .map_err(|error| format!("无法获取 Codex 模型列表：{error}"))?;
    let payload: CodexModelsResponse = response
        .into_json()
        .map_err(|error| format!("Codex 模型列表无效：{error}"))?;
    let models = payload
        .models
        .into_iter()
        .filter(|model| model.visibility == "list")
        .map(|model| CodexModelOption {
            slug: model.slug,
            display_name: model.display_name,
            reasoning_levels: model
                .supported_reasoning_levels
                .into_iter()
                .map(|level| level.effort)
                .collect(),
            supports_fast: model
                .additional_speed_tiers
                .iter()
                .any(|tier| tier == "fast"),
        })
        .collect::<Vec<_>>();
    if models.is_empty() {
        Err("Codex 没有返回可选模型".to_string())
    } else {
        Ok(models)
    }
}

fn fallback_models(settings: &CodexSettings) -> Vec<CodexModelOption> {
    vec![CodexModelOption {
        slug: settings.translation_model.clone(),
        display_name: settings.translation_model.clone(),
        reasoning_levels: vec![settings.reasoning_effort.clone()],
        supports_fast: settings.fast_mode,
    }]
}

fn codex_translation_config(data_dir: &Path) -> Result<CodexTranslationConfig, String> {
    let tokens = load_codex_auth_tokens()?;
    let settings = selected_codex_settings(data_dir);

    Ok(CodexTranslationConfig {
        api_base: CODEX_API_BASE.to_string(),
        api_key: tokens.access_token,
        account_id: tokens.account_id.filter(|value| !value.trim().is_empty()),
        model: settings.translation_model,
        effort: settings.reasoning_effort,
        fast_mode: settings.fast_mode,
        timeout_seconds: 120,
        text_verbosity: "low".to_string(),
    })
}
fn request_codex_translation(
    config: &CodexTranslationConfig,
    source_text: &str,
) -> Result<String, String> {
    let input = serde_json::json!([
        {
            "role": "user",
            "content": source_text
        }
    ]);
    request_codex_text(
        config,
        "Translate the user's rule into concise, natural English for a Codex Skill. Return only the English translation, without Markdown, quotes, commentary, or labels.",
        &input,
        &config.text_verbosity,
        "翻译",
    )
}

fn request_codex_text(
    config: &CodexTranslationConfig,
    instructions: &str,
    input: &serde_json::Value,
    text_verbosity: &str,
    operation: &str,
) -> Result<String, String> {
    for attempt in 0..2 {
        match request_codex_text_once(config, instructions, input, text_verbosity, operation) {
            Ok(result) => return Ok(result),
            Err(CodexRequestError::Fatal(message)) => return Err(message),
            Err(CodexRequestError::Retryable(message)) if attempt == 1 => return Err(message),
            Err(CodexRequestError::Retryable(_)) => {
                std::thread::sleep(Duration::from_millis(350));
            }
        }
    }
    Err(format!("Codex {operation}请求未完成"))
}

fn request_codex_text_once(
    config: &CodexTranslationConfig,
    instructions: &str,
    input: &serde_json::Value,
    text_verbosity: &str,
    operation: &str,
) -> Result<String, CodexRequestError> {
    let mut body = serde_json::json!({
        "model": config.model,
        "instructions": instructions,
        "input": input,
        "stream": true,
        "store": false,
        "reasoning": {
            "effort": config.effort
        },
        "text": {
            "verbosity": text_verbosity
        }
    });
    if config.fast_mode {
        body.as_object_mut()
            .expect("Codex request body must be an object")
            .insert("service_tier".to_string(), serde_json::json!("priority"));
    }
    let url = format!("{}/responses", config.api_base.trim_end_matches('/'));
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(config.timeout_seconds))
        .build();
    let mut request = agent
        .post(&url)
        .set("Authorization", &format!("Bearer {}", config.api_key))
        .set("Content-Type", "application/json")
        .set("Accept", "text/event-stream");
    if let Some(account_id) = &config.account_id {
        request = request.set("ChatGPT-Account-Id", account_id);
    }
    let response = request.send_json(body);

    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            let detail = response
                .into_string()
                .unwrap_or_else(|_| "无错误详情".to_string());
            let message = format!(
                "Codex {operation}请求失败（HTTP {status}）：{}",
                truncate_error_detail(&detail)
            );
            return if status == 429 || status >= 500 {
                Err(CodexRequestError::Retryable(message))
            } else {
                Err(CodexRequestError::Fatal(message))
            };
        }
        Err(error) => {
            return Err(CodexRequestError::Retryable(format!(
                "Codex {operation}请求失败：{error}"
            )));
        }
    };

    parse_codex_sse_response(response).map_err(CodexRequestError::Fatal)
}

fn parse_codex_sse_response(response: ureq::Response) -> Result<String, String> {
    let reader = BufReader::new(response.into_reader());
    let mut text_parts = Vec::new();
    let mut final_text = String::new();

    for line in reader.lines() {
        let line = line.map_err(|error| format!("Codex 响应读取失败：{error}"))?;
        let Some(data) = line.strip_prefix("data: ") else {
            continue;
        };
        if data == "[DONE]" {
            break;
        }

        let event: serde_json::Value = match serde_json::from_str(data) {
            Ok(value) => value,
            Err(_) => continue,
        };
        match event.get("type").and_then(|value| value.as_str()) {
            Some("response.output_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(|value| value.as_str()) {
                    text_parts.push(delta.to_string());
                }
            }
            Some("response.output_text.done") => {
                if let Some(text) = event.get("text").and_then(|value| value.as_str()) {
                    final_text = text.to_string();
                }
            }
            Some("response.content_part.done") => {
                let part = event.get("part");
                let is_output_text = part
                    .and_then(|value| value.get("type"))
                    .and_then(|value| value.as_str())
                    == Some("output_text");
                if is_output_text {
                    if let Some(text) = part
                        .and_then(|value| value.get("text"))
                        .and_then(|value| value.as_str())
                    {
                        final_text = text.to_string();
                    }
                }
            }
            Some("response.completed") => break,
            Some("response.failed") | Some("error") => {
                let message = event
                    .get("error")
                    .and_then(|value| value.get("message"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("Codex 返回失败事件");
                return Err(message.to_string());
            }
            _ => {}
        }
    }

    if final_text.trim().is_empty() {
        final_text = text_parts.join("");
    }
    Ok(final_text)
}

fn clean_translation_output(value: &str) -> String {
    let mut text = value.trim().to_string();
    if text.starts_with("```") {
        text = text
            .lines()
            .filter(|line| !line.trim_start().starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
    }
    trim_wrapping_quotes(&text).trim().to_string()
}

fn trim_wrapping_quotes(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let quoted = (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'');
        if quoted {
            return &trimmed[1..trimmed.len() - 1];
        }
    }
    trimmed
}

fn truncate_error_detail(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 240 {
        compact
    } else {
        compact.chars().take(240).collect::<String>() + "..."
    }
}

pub fn scan_codex_skills_at(workspace_root: &Path) -> Result<CodexSkillCatalog, String> {
    fs::create_dir_all(workspace_root).map_err(|error| error.to_string())?;
    let codex_home = codex_home_path().ok_or_else(|| "未找到本机 Codex 目录".to_string())?;
    let scan_roots = codex_skill_scan_roots(&codex_home);
    let imported = imported_skill_sources(workspace_root);
    let mut warnings = Vec::new();
    let mut skill_files = Vec::new();
    let mut visible_roots = Vec::new();

    for (source, root) in scan_roots {
        if !root.is_dir() {
            continue;
        }
        visible_roots.push(root.to_string_lossy().to_string());
        collect_skill_files(&root, &root, 0, &source, &mut skill_files, &mut warnings)?;
        if skill_files.len() >= CODEX_SKILL_SCAN_LIMIT {
            warnings.push(format!(
                "技能目录超过 {CODEX_SKILL_SCAN_LIMIT} 个，已停止继续扫描"
            ));
            break;
        }
    }

    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for (source, skill_file) in skill_files {
        let canonical = match skill_file.canonicalize() {
            Ok(path) => path,
            Err(error) => {
                warnings.push(format!(
                    "无法解析技能路径 {}：{error}",
                    skill_file.to_string_lossy()
                ));
                continue;
            }
        };
        let source_key = normalized_path_key(&canonical);
        if !seen.insert(source_key.clone()) {
            continue;
        }
        let (content, readable) = match fs::read_to_string(&canonical) {
            Ok(content) => (content, true),
            Err(error) => {
                warnings.push(format!(
                    "无法按 UTF-8 读取 {}：{error}",
                    canonical.to_string_lossy()
                ));
                (String::new(), false)
            }
        };
        let summary = summary_from_file(&canonical, &content);
        let skill_dir = canonical.parent().unwrap_or(&canonical);
        let (file_count, byte_size, limited) = directory_stats(skill_dir)?;
        if limited {
            warnings.push(format!(
                "{} 的配套文件超过导入限制（最多 {CODEX_SKILL_FILE_LIMIT} 个文件、{} MiB）",
                summary.name,
                CODEX_SKILL_BYTES_LIMIT / 1024 / 1024
            ));
        }
        let catalog_id = stable_catalog_id(&source_key);
        let imported_id = imported.get(&catalog_id).cloned();
        let diagnostics = analyze_editor_diagnostics(&content, readable && !limited);
        let relative_path = canonical
            .strip_prefix(&codex_home)
            .unwrap_or(&canonical)
            .to_string_lossy()
            .to_string();
        entries.push(CodexSkillCatalogEntry {
            id: catalog_id,
            name: summary.name,
            description: summary.description,
            source,
            relative_path,
            source_path: canonical.to_string_lossy().to_string(),
            file_count,
            byte_size,
            imported: imported_id.is_some(),
            imported_id,
            format_gaps: diagnostics.format_gaps,
            loadable: diagnostics.loadable,
        });
    }
    entries.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    Ok(CodexSkillCatalog {
        entries,
        roots: visible_roots,
        scanned_at: unix_seconds(),
        warnings,
    })
}

struct EditorDiagnostics {
    format_gaps: Vec<String>,
    loadable: bool,
}

fn analyze_editor_diagnostics(content: &str, loadable: bool) -> EditorDiagnostics {
    let mut format_gaps = Vec::new();
    if frontmatter_value(content, "name").is_none() {
        format_gaps.push("缺少 frontmatter.name".to_string());
    }
    if frontmatter_value(content, "description").is_none() {
        format_gaps.push("缺少 frontmatter.description".to_string());
    }

    let headings: HashSet<&str> = content
        .lines()
        .filter_map(|line| line.trim().strip_prefix("## "))
        .map(str::trim)
        .collect();
    let has_rule_section = headings.contains("规则") || headings.contains("Rules");
    if !has_rule_section {
        format_gaps.push("缺少标准“规则”章节".to_string());
    }

    EditorDiagnostics {
        format_gaps,
        loadable,
    }
}

pub fn import_codex_skills_at(
    workspace_root: &Path,
    request: CodexSkillImportRequest,
) -> Result<CodexSkillImportResult, String> {
    let _write_lock = acquire_workspace_write_lock(workspace_root)?;
    let catalog = scan_codex_skills_at(workspace_root)?;
    let requested_ids: HashSet<String> = request
        .ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    let import_all = requested_ids.is_empty();
    let selected: Vec<_> = catalog
        .entries
        .iter()
        .filter(|entry| import_all || requested_ids.contains(&entry.id))
        .collect();
    let mut result = CodexSkillImportResult {
        discovered: catalog.entries.len(),
        requested: if import_all {
            catalog.entries.len()
        } else {
            requested_ids.len()
        },
        imported: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    if !import_all {
        let discovered_ids: HashSet<_> = selected.iter().map(|entry| entry.id.as_str()).collect();
        for missing in requested_ids
            .iter()
            .filter(|id| !discovered_ids.contains(id.as_str()))
        {
            result
                .errors
                .push(format!("未找到 Codex 技能目录 ID：{missing}"));
        }
    }

    for entry in selected {
        if entry.imported {
            result.skipped.push(entry.name.clone());
            continue;
        }
        match import_codex_skill_entry(workspace_root, entry) {
            Ok(imported_id) => result.imported.push(imported_id),
            Err(error) => result.errors.push(format!("{}：{error}", entry.name)),
        }
    }

    if !result.imported.is_empty() {
        if let Err(error) = write_entry_manifest(workspace_root) {
            result
                .errors
                .push(format!("技能已导入，但入口清单更新失败：{error}"));
        }
    }
    Ok(result)
}

fn codex_home_path() -> Option<PathBuf> {
    std::env::var("CODEX_HOME")
        .ok()
        .map(|value| PathBuf::from(value.trim()))
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| {
            std::env::var("USERPROFILE")
                .ok()
                .map(|value| PathBuf::from(value.trim()).join(".codex"))
        })
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|value| PathBuf::from(value.trim()).join(".codex"))
        })
}

fn codex_skill_scan_roots(codex_home: &Path) -> Vec<(String, PathBuf)> {
    vec![
        ("本地技能".to_string(), codex_home.join("skills")),
        (
            "插件技能".to_string(),
            codex_home.join("plugins").join("cache"),
        ),
    ]
}

fn collect_skill_files(
    root: &Path,
    current: &Path,
    depth: usize,
    source: &str,
    output: &mut Vec<(String, PathBuf)>,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    if depth > CODEX_SKILL_SCAN_DEPTH || output.len() >= CODEX_SKILL_SCAN_LIMIT {
        return Ok(());
    }
    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(error) => {
            warnings.push(format!("无法读取 {}：{error}", current.to_string_lossy()));
            return Ok(());
        }
    };
    for entry in entries {
        if output.len() >= CODEX_SKILL_SCAN_LIMIT {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("读取 Codex 技能目录项失败：{error}"));
                continue;
            }
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(format!(
                    "无法读取 {} 元数据：{error}",
                    path.to_string_lossy()
                ));
                continue;
            }
        };
        if metadata_is_link_like(&metadata) {
            continue;
        }
        if metadata.is_dir() {
            collect_skill_files(root, &path, depth + 1, source, output, warnings)?;
        } else if metadata.is_file()
            && path.file_name().and_then(|name| name.to_str()) == Some(SKILL_FILE_NAME)
        {
            let source_label = if source == "插件技能" {
                plugin_source_label(root, &path)
            } else {
                source.to_string()
            };
            output.push((source_label, path));
        }
    }
    Ok(())
}

fn plugin_source_label(root: &Path, skill_file: &Path) -> String {
    let components: Vec<_> = skill_file
        .strip_prefix(root)
        .ok()
        .into_iter()
        .flat_map(Path::components)
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .take(2)
        .collect();
    if components.is_empty() {
        "插件技能".to_string()
    } else {
        format!("插件 · {}", components.join(" / "))
    }
}

fn directory_stats(root: &Path) -> Result<(usize, u64, bool), String> {
    let mut stack = vec![root.to_path_buf()];
    let mut file_count = 0;
    let mut byte_size = 0_u64;
    let mut limited = false;
    while let Some(current) = stack.pop() {
        for entry in fs::read_dir(&current).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if metadata_is_link_like(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                stack.push(path);
                continue;
            }
            if metadata.is_file() {
                file_count += 1;
                byte_size = byte_size.saturating_add(metadata.len());
                if file_count > CODEX_SKILL_FILE_LIMIT || byte_size > CODEX_SKILL_BYTES_LIMIT {
                    limited = true;
                    return Ok((file_count, byte_size, limited));
                }
            }
        }
    }
    Ok((file_count, byte_size, limited))
}

fn imported_skill_sources(workspace_root: &Path) -> HashMap<String, String> {
    let mut imported = HashMap::new();
    let Ok(entries) = fs::read_dir(workspace_root) else {
        return imported;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let metadata_path = path.join(IMPORT_SOURCE_FILE_NAME);
        let Ok(content) = fs::read_to_string(metadata_path) else {
            continue;
        };
        let Ok(source) = serde_json::from_str::<ImportedSkillSource>(&content) else {
            continue;
        };
        let Some(imported_id) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        imported.insert(source.catalog_id, imported_id.to_string());
    }
    imported
}

fn import_codex_skill_entry(
    workspace_root: &Path,
    entry: &CodexSkillCatalogEntry,
) -> Result<String, String> {
    let source_file = PathBuf::from(&entry.source_path);
    let source_dir = source_file
        .parent()
        .ok_or_else(|| "技能源目录无效".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let (_, _, limited) = directory_stats(&source_dir)?;
    if limited {
        return Err(format!(
            "配套文件超过安全限制（最多 {CODEX_SKILL_FILE_LIMIT} 个文件、{} MiB）",
            CODEX_SKILL_BYTES_LIMIT / 1024 / 1024
        ));
    }

    let safe_name = make_safe_file_name(&entry.name);
    let base_name = format!(
        "codex-{}-{}",
        if safe_name.is_empty() {
            "skill"
        } else {
            &safe_name
        },
        &entry.id[..entry.id.len().min(10)]
    );
    let target_name = if workspace_root.join(&base_name).exists() {
        resolve_unique_name(workspace_root, &base_name)
    } else {
        base_name
    };
    let target = workspace_root.join(&target_name);
    let temporary = workspace_root.join(format!(".import-{}-{}", target_name, unix_seconds()));
    if temporary.exists() {
        fs::remove_dir_all(&temporary).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&temporary).map_err(|error| error.to_string())?;

    let import_result = (|| {
        copy_skill_directory(&source_dir, &temporary)?;
        let metadata = ImportedSkillSource {
            catalog_id: entry.id.clone(),
            source_path: entry.source_path.clone(),
            imported_at: unix_seconds(),
        };
        let metadata_json =
            serde_json::to_string_pretty(&metadata).map_err(|error| error.to_string())?;
        fs::write(
            temporary.join(IMPORT_SOURCE_FILE_NAME),
            format!("{metadata_json}\n"),
        )
        .map_err(|error| error.to_string())?;
        fs::rename(&temporary, &target).map_err(|error| error.to_string())
    })();
    if let Err(error) = import_result {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }
    Ok(target_name)
}

fn copy_skill_directory(source: &Path, target: &Path) -> Result<(), String> {
    let mut stack = vec![(source.to_path_buf(), target.to_path_buf())];
    let mut file_count = 0;
    let mut byte_size = 0_u64;
    while let Some((source_dir, target_dir)) = stack.pop() {
        fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(&source_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let source_path = entry.path();
            let metadata = fs::symlink_metadata(&source_path).map_err(|error| error.to_string())?;
            if metadata_is_link_like(&metadata) {
                continue;
            }
            let target_path = target_dir.join(entry.file_name());
            if metadata.is_dir() {
                stack.push((source_path, target_path));
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            file_count += 1;
            byte_size = byte_size.saturating_add(metadata.len());
            if file_count > CODEX_SKILL_FILE_LIMIT || byte_size > CODEX_SKILL_BYTES_LIMIT {
                return Err("技能目录在复制过程中超过安全限制".to_string());
            }
            fs::copy(&source_path, &target_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn normalized_path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

fn stable_catalog_id(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn normalized_skill_file_path(value: &str) -> Result<PathBuf, String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("技能文件路径不能为空".to_string());
    }
    if normalized.chars().count() > 512 {
        return Err("技能文件路径过长".to_string());
    }
    let path = Path::new(&normalized);
    if path.is_absolute() {
        return Err(format!("技能文件必须使用相对路径：{normalized}"));
    }
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let segment = part.to_string_lossy();
                if segment.eq_ignore_ascii_case(".git") || segment.eq_ignore_ascii_case(".svn") {
                    return Err(format!(
                        "技能文件路径不能写入版本控制内部目录：{normalized}"
                    ));
                }
                clean.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("非法技能文件路径：{normalized}"));
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return Err(format!("非法技能文件路径：{normalized}"));
    }
    Ok(clean)
}

fn prepare_draft_files(files: &[SkillFileDraft]) -> Result<Vec<(PathBuf, Vec<u8>)>, String> {
    if files.len() > CODEX_SKILL_FILE_LIMIT {
        return Err(format!("技能文件超过 {CODEX_SKILL_FILE_LIMIT} 个"));
    }
    let mut prepared = Vec::with_capacity(files.len());
    let mut seen = HashSet::new();
    let mut bytes = 0_u64;
    for file in files {
        let relative = normalized_skill_file_path(&file.path)?;
        let relative_text = relative.to_string_lossy().replace('\\', "/");
        if relative_text.eq_ignore_ascii_case(SKILL_FILE_NAME) {
            return Err("files 不能覆盖入口 SKILL.md；请使用 sourceMarkdown".to_string());
        }
        let key = if cfg!(windows) {
            relative_text.to_ascii_lowercase()
        } else {
            relative_text.clone()
        };
        if !seen.insert(key) {
            return Err(format!("技能文件路径重复：{relative_text}"));
        }
        let content = file.content.as_bytes().to_vec();
        bytes = bytes.saturating_add(content.len() as u64);
        if bytes > CODEX_SKILL_BYTES_LIMIT {
            return Err(format!(
                "技能文本文件总大小超过 {} MiB",
                CODEX_SKILL_BYTES_LIMIT / 1024 / 1024
            ));
        }
        prepared.push((relative, content));
    }
    Ok(prepared)
}

fn skill_path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

fn prepare_deleted_files(files: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut validated = Vec::with_capacity(files.len());
    let mut seen = HashSet::new();
    for value in files {
        let relative = normalized_skill_file_path(value)?;
        if relative
            .to_string_lossy()
            .eq_ignore_ascii_case(SKILL_FILE_NAME)
        {
            return Err("不能通过 deletedFiles 删除入口 SKILL.md".to_string());
        }
        if seen.insert(skill_path_key(&relative)) {
            validated.push(relative);
        }
    }
    Ok(validated)
}

fn metadata_is_link_like(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn ensure_skill_relative_target(skill_dir: &Path, relative: &Path) -> Result<PathBuf, String> {
    let skill_dir_metadata =
        fs::symlink_metadata(skill_dir).map_err(|error| format!("检查技能目录失败：{error}"))?;
    if metadata_is_link_like(&skill_dir_metadata) {
        return Err("技能目录不能是符号链接或重解析点".to_string());
    }
    let mut current = skill_dir.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err(format!("非法技能文件路径：{}", relative.to_string_lossy()));
        };
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata_is_link_like(&metadata) => {
                return Err(format!(
                    "技能文件路径不能经过符号链接：{}",
                    relative.to_string_lossy()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("检查技能文件路径失败：{error}")),
        }
    }
    Ok(current)
}

fn write_prepared_files(
    skill_dir: &Path,
    files: &[(PathBuf, Vec<u8>)],
) -> Result<Vec<String>, String> {
    let mut written = Vec::with_capacity(files.len());
    for (relative, content) in files {
        let target = ensure_skill_relative_target(skill_dir, relative)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        atomic_write_file(&target, content)?;
        written.push(relative.to_string_lossy().replace('\\', "/"));
    }
    Ok(written)
}

fn delete_prepared_files(skill_dir: &Path, files: &[PathBuf]) -> Result<(), String> {
    for relative in files {
        let path = ensure_skill_relative_target(skill_dir, relative)?;
        if path.is_file() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn read_file_snapshot(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取技能事务快照失败 {}：{error}", path.display())),
    }
}

fn restore_file_snapshot(path: &Path, original: Option<&[u8]>) -> Result<(), String> {
    match original {
        Some(bytes) => atomic_write_file(path, bytes),
        None if path.is_file() => fs::remove_file(path).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

fn update_skill_file_bundle(
    skill_dir: &Path,
    entry_content: &[u8],
    files: &[(PathBuf, Vec<u8>)],
    deleted_files: &[PathBuf],
) -> Result<Vec<String>, String> {
    let write_keys = files
        .iter()
        .map(|(path, _)| skill_path_key(path))
        .collect::<HashSet<_>>();
    if let Some(overlap) = deleted_files
        .iter()
        .find(|path| write_keys.contains(&skill_path_key(path)))
    {
        return Err(format!(
            "同一技能文件不能同时写入和删除：{}",
            overlap.to_string_lossy()
        ));
    }

    let safe_entry_path = ensure_skill_relative_target(skill_dir, Path::new(SKILL_FILE_NAME))?;
    let mut targets = Vec::with_capacity(1 + files.len() + deleted_files.len());
    targets.push(safe_entry_path.clone());
    for (relative, _) in files {
        targets.push(ensure_skill_relative_target(skill_dir, relative)?);
    }
    for relative in deleted_files {
        targets.push(ensure_skill_relative_target(skill_dir, relative)?);
    }

    let mut seen_targets = HashSet::new();
    let mut snapshots = Vec::new();
    for target in targets {
        let key = if cfg!(windows) {
            target.to_string_lossy().to_ascii_lowercase()
        } else {
            target.to_string_lossy().into_owned()
        };
        if seen_targets.insert(key) {
            snapshots.push((target.clone(), read_file_snapshot(&target)?));
        }
    }

    let transaction = (|| {
        atomic_write_file(&safe_entry_path, entry_content)?;
        let written = write_prepared_files(skill_dir, files)?;
        delete_prepared_files(skill_dir, deleted_files)?;
        Ok::<_, String>(written)
    })();

    match transaction {
        Ok(written) => Ok(written),
        Err(error) => {
            let mut rollback_errors = Vec::new();
            for (path, original) in snapshots.iter().rev() {
                if let Err(rollback_error) = restore_file_snapshot(path, original.as_deref()) {
                    rollback_errors.push(format!("{}: {rollback_error}", path.display()));
                }
            }
            if rollback_errors.is_empty() {
                Err(format!("技能多文件事务失败，已回滚：{error}"))
            } else {
                Err(format!(
                    "技能多文件事务失败：{error}；回滚也失败：{}",
                    rollback_errors.join("；")
                ))
            }
        }
    }
}

fn read_skill_files(skill_dir: &Path) -> Result<Vec<SkillMarkdownFile>, String> {
    let mut stack = vec![skill_dir.to_path_buf()];
    let mut files = Vec::new();
    let mut bytes = 0_u64;
    while let Some(current) = stack.pop() {
        for entry in fs::read_dir(&current).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if metadata_is_link_like(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                stack.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            let relative = path
                .strip_prefix(skill_dir)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if relative.eq_ignore_ascii_case(IMPORT_SOURCE_FILE_NAME) {
                continue;
            }
            let raw = fs::read(&path).map_err(|error| error.to_string())?;
            let Ok(content) = String::from_utf8(raw) else {
                // Binary assets remain part of the skill directory, but the text editing API
                // intentionally exposes only UTF-8 files.
                continue;
            };
            if files.len() >= CODEX_SKILL_FILE_LIMIT {
                return Err(format!("技能文本文件超过 {CODEX_SKILL_FILE_LIMIT} 个"));
            }
            bytes = bytes.saturating_add(metadata.len());
            if bytes > CODEX_SKILL_BYTES_LIMIT {
                return Err("技能文本文件总大小超过读取限制".to_string());
            }
            files.push(SkillMarkdownFile {
                path: relative.clone(),
                content,
                byte_size: metadata.len(),
                is_entry: relative.eq_ignore_ascii_case(SKILL_FILE_NAME),
            });
        }
    }
    files.sort_by(|left, right| {
        right.is_entry.cmp(&left.is_entry).then_with(|| {
            left.path
                .to_ascii_lowercase()
                .cmp(&right.path.to_ascii_lowercase())
        })
    });
    Ok(files)
}

pub fn list_skills_at(root: &Path) -> Result<Vec<SkillSummary>, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let mut skills = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let skill_path = path.join(SKILL_FILE_NAME);
        if skill_path.is_file() {
            let content = fs::read_to_string(&skill_path).unwrap_or_default();
            skills.push(summary_from_file(&skill_path, &content));
        }
    }

    skills.sort_by_key(|skill| std::cmp::Reverse(skill.updated_at));
    Ok(skills)
}

pub fn read_skill_at(root: &Path, id: &str) -> Result<SkillContent, String> {
    let path = skill_file_path_for_id(root, id)?;
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let summary = summary_from_file(&path, &content);
    let skill_dir = path.parent().ok_or_else(|| "技能目录无效".to_string())?;
    let files = read_skill_files(skill_dir)?;
    let index_mode = files.iter().any(|file| !file.is_entry);
    Ok(SkillContent {
        id: summary.id,
        name: summary.name,
        description: summary.description,
        file_path: summary.file_path,
        content,
        entry_file: SKILL_FILE_NAME.to_string(),
        index_mode,
        files,
    })
}

pub fn create_skill_at(root: &Path, draft: SkillDraft) -> Result<CreateResult, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let _write_lock = acquire_workspace_write_lock(root)?;

    let safe_name = make_safe_file_name(&draft.name);
    let base_name = if safe_name.is_empty() {
        format!("skill-{}", unix_seconds())
    } else {
        safe_name
    };
    let final_name = resolve_unique_name(root, &base_name);
    let skill_dir = root.join(&final_name);
    let file_path = skill_dir.join(SKILL_FILE_NAME);
    let markdown = markdown_for_draft(&draft, &final_name)?;
    let prepared_files = prepare_draft_files(&draft.files)?;
    let entry_path = write_entry_manifest(root)?;
    fs::create_dir_all(&skill_dir).map_err(|error| error.to_string())?;

    let create_result = (|| {
        atomic_write_file(&file_path, markdown.as_bytes())?;
        let mut written_files = vec![SKILL_FILE_NAME.to_string()];
        written_files.extend(write_prepared_files(&skill_dir, &prepared_files)?);
        Ok::<_, String>(written_files)
    })();
    let written_files = match create_result {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&skill_dir);
            return Err(error);
        }
    };

    Ok(CreateResult {
        file_path: file_path.to_string_lossy().to_string(),
        entry_path: entry_path.to_string_lossy().to_string(),
        content: markdown,
        written_files,
    })
}

pub fn delete_skill_at(root: &Path, id: &str) -> Result<(), String> {
    let _write_lock = acquire_workspace_write_lock(root)?;
    let file_path = skill_file_path_for_id(root, id)?;
    let skill_dir = file_path
        .parent()
        .ok_or_else(|| "技能目录无效".to_string())?;
    write_entry_manifest(root)?;
    fs::remove_dir_all(skill_dir).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn update_skill_at(root: &Path, id: &str, draft: SkillDraft) -> Result<CreateResult, String> {
    let _write_lock = acquire_workspace_write_lock(root)?;
    let file_path = skill_file_path_for_id(root, id)?;
    let skill_dir = file_path
        .parent()
        .ok_or_else(|| "技能目录无效".to_string())?;
    let skill_name = skill_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(id.trim());
    let document_name = if draft.name.trim().is_empty() {
        skill_name
    } else {
        draft.name.trim()
    };
    let markdown = markdown_for_draft(&draft, document_name)?;
    let prepared_files = prepare_draft_files(&draft.files)?;
    let prepared_deleted_files = prepare_deleted_files(&draft.deleted_files)?;
    let entry_path = write_entry_manifest(root)?;

    let mut written_files = vec![SKILL_FILE_NAME.to_string()];
    written_files.extend(update_skill_file_bundle(
        skill_dir,
        markdown.as_bytes(),
        &prepared_files,
        &prepared_deleted_files,
    )?);

    Ok(CreateResult {
        file_path: file_path.to_string_lossy().to_string(),
        entry_path: entry_path.to_string_lossy().to_string(),
        content: markdown,
        written_files,
    })
}

fn ensure_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("非法 skill 路径".to_string())
    }
}

fn skill_file_path_for_id(root: &Path, id: &str) -> Result<PathBuf, String> {
    let id = clean_skill_id(id)?;
    let path = root.join(id).join(SKILL_FILE_NAME);
    if !path.exists() {
        return Err("未找到 skill".to_string());
    }
    ensure_inside_root(root, &path)?;
    Ok(path)
}

fn clean_skill_id(id: &str) -> Result<&str, String> {
    let trimmed = id.trim();
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) if !trimmed.is_empty() => Ok(trimmed),
        _ => Err("非法 skill 路径".to_string()),
    }
}

fn summary_from_file(path: &Path, content: &str) -> SkillSummary {
    let id = path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let fallback_name = id.clone();

    let updated_at = path
        .metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    SkillSummary {
        id,
        name: frontmatter_value(content, "name").unwrap_or(fallback_name),
        description: frontmatter_value(content, "description").unwrap_or_default(),
        file_path: path.to_string_lossy().to_string(),
        updated_at,
    }
}

fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let first_line_end = line_end(text, 0);
    if !is_frontmatter_delimiter(strip_line_ending(&text[..first_line_end])) {
        return None;
    }

    let mut cursor = first_line_end;
    let mut closing_start = None;
    while cursor < text.len() {
        let end = line_end(text, cursor);
        if is_frontmatter_delimiter(strip_line_ending(&text[cursor..end])) {
            closing_start = Some(cursor);
            break;
        }
        cursor = end;
    }

    let frontmatter = &text[first_line_end..closing_start?];
    top_level_yaml_fields(frontmatter, key)
        .into_iter()
        .next()
        .map(|field| field.value)
        .filter(|value| !value.is_empty())
}

fn trim_quotes(value: &str) -> &str {
    value.trim_matches('"')
}

fn resolve_unique_name(root: &Path, base_name: &str) -> String {
    let mut candidate = base_name.to_string();
    let mut index = 1;
    while root.join(&candidate).exists() {
        candidate = format!("{base_name}-{index}");
        index += 1;
    }
    candidate
}

fn markdown_for_draft(draft: &SkillDraft, skill_name: &str) -> Result<String, String> {
    ensure_source_frontmatter(
        &draft.source_markdown,
        skill_name.trim(),
        description_text(draft, skill_name).trim(),
    )
}

fn ensure_source_frontmatter(
    source: &str,
    skill_name: &str,
    description: &str,
) -> Result<String, String> {
    if skill_name.is_empty() {
        return Err("Skill name 不能为空".to_string());
    }
    if description.is_empty() {
        return Err("Skill description 不能为空".to_string());
    }

    let (bom, text) = source
        .strip_prefix('\u{feff}')
        .map(|value| ("\u{feff}", value))
        .unwrap_or(("", source));
    let newline = preferred_newline(text);
    let first_line_end = line_end(text, 0);
    let first_line = strip_line_ending(&text[..first_line_end]);

    if !is_frontmatter_delimiter(first_line) {
        return Ok(format!(
            "{bom}---{newline}name: \"{}\"{newline}description: \"{}\"{newline}---{newline}{newline}{text}",
            escape_yaml(skill_name),
            escape_yaml(description),
        ));
    }

    let mut cursor = first_line_end;
    let mut closing = None;
    while cursor < text.len() {
        let end = line_end(text, cursor);
        if is_frontmatter_delimiter(strip_line_ending(&text[cursor..end])) {
            closing = Some((cursor, end));
            break;
        }
        cursor = end;
    }
    let (closing_start, closing_end) =
        closing.ok_or_else(|| "SKILL.md frontmatter 未闭合".to_string())?;

    let frontmatter = &text[first_line_end..closing_start];
    let name_fields = top_level_yaml_fields(frontmatter, "name");
    let description_fields = top_level_yaml_fields(frontmatter, "description");
    if name_fields.len() > 1 || description_fields.len() > 1 {
        return Err("SKILL.md frontmatter 中 name 或 description 重复".to_string());
    }

    let mut replacements = Vec::with_capacity(2);
    if let Some(field) = name_fields.first() {
        if !yaml_field_value_matches(field, skill_name) {
            replacements.push((
                field.start,
                field.end,
                format!("name: \"{}\"{}", escape_yaml(skill_name), field.line_ending),
            ));
        }
    }
    if let Some(field) = description_fields.first() {
        if !yaml_field_value_matches(field, description) {
            replacements.push((
                field.start,
                field.end,
                format!(
                    "description: \"{}\"{}",
                    escape_yaml(description),
                    field.line_ending
                ),
            ));
        }
    }
    replacements.sort_by_key(|replacement| replacement.0);

    let mut output =
        String::with_capacity(source.len() + skill_name.len() + description.len() + 64);
    output.push_str(bom);
    output.push_str(&text[..first_line_end]);
    let mut copied_until = 0;
    for (start, end, replacement) in replacements {
        output.push_str(&frontmatter[copied_until..start]);
        output.push_str(&replacement);
        copied_until = end;
    }
    output.push_str(&frontmatter[copied_until..]);
    if name_fields.is_empty() {
        output.push_str(&format!("name: \"{}\"{newline}", escape_yaml(skill_name)));
    }
    if description_fields.is_empty() {
        output.push_str(&format!(
            "description: \"{}\"{newline}",
            escape_yaml(description)
        ));
    }
    output.push_str(&text[closing_start..closing_end]);
    output.push_str(&text[closing_end..]);
    Ok(output)
}

fn preferred_newline(value: &str) -> &'static str {
    if value.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn line_end(value: &str, start: usize) -> usize {
    value[start..]
        .find('\n')
        .map(|offset| start + offset + 1)
        .unwrap_or(value.len())
}

fn strip_line_ending(value: &str) -> &str {
    split_line_ending(value).0
}

fn split_line_ending(value: &str) -> (&str, &str) {
    if let Some(line) = value.strip_suffix("\r\n") {
        (line, "\r\n")
    } else if let Some(line) = value.strip_suffix('\n') {
        (line, "\n")
    } else {
        (value, "")
    }
}

fn is_top_level_yaml_key(line: &str, key: &str) -> bool {
    !line.starts_with([' ', '\t', '#'])
        && line
            .strip_prefix(key)
            .is_some_and(|remainder| remainder.starts_with(':'))
}

fn is_frontmatter_delimiter(line: &str) -> bool {
    line.strip_prefix("---")
        .is_some_and(|remainder| remainder.trim().is_empty())
}

#[derive(Clone, Copy)]
enum YamlBlockStyle {
    Literal,
    Folded,
}

#[derive(Clone, Copy)]
enum YamlBlockChomp {
    Clip,
    Strip,
    Keep,
}

#[derive(Clone, Copy)]
struct YamlBlockHeader {
    style: YamlBlockStyle,
    chomp: YamlBlockChomp,
    explicit_indent: Option<usize>,
}

struct TopLevelYamlField {
    start: usize,
    end: usize,
    line_ending: String,
    value: String,
    is_block: bool,
}

struct YamlBlockLine<'a> {
    value: &'a str,
    has_line_ending: bool,
    more_indented: bool,
}

fn top_level_yaml_fields(frontmatter: &str, key: &str) -> Vec<TopLevelYamlField> {
    let mut fields = Vec::new();
    let mut cursor = 0;

    while cursor < frontmatter.len() {
        let header_end = line_end(frontmatter, cursor);
        let header_segment = &frontmatter[cursor..header_end];
        let (line, line_ending) = split_line_ending(header_segment);
        if !is_top_level_yaml_key(line, key) {
            cursor = header_end;
            continue;
        }

        let inline_value = line[key.len() + 1..].trim();
        if let Some(header) = parse_yaml_block_header(inline_value) {
            let (end, value) = parse_yaml_block_scalar(frontmatter, header_end, header);
            fields.push(TopLevelYamlField {
                start: cursor,
                end,
                line_ending: line_ending.to_string(),
                value,
                is_block: true,
            });
            cursor = end;
        } else {
            fields.push(TopLevelYamlField {
                start: cursor,
                end: header_end,
                line_ending: line_ending.to_string(),
                value: trim_quotes(inline_value).to_string(),
                is_block: false,
            });
            cursor = header_end;
        }
    }

    fields
}

fn yaml_field_value_matches(field: &TopLevelYamlField, expected: &str) -> bool {
    if field.is_block {
        field.value.trim_end_matches('\n') == expected
    } else {
        field.value == expected
    }
}

fn parse_yaml_block_header(value: &str) -> Option<YamlBlockHeader> {
    let value = value.trim_start();
    let (style, remainder) = match value.as_bytes().first().copied()? {
        b'|' => (YamlBlockStyle::Literal, &value[1..]),
        b'>' => (YamlBlockStyle::Folded, &value[1..]),
        _ => return None,
    };
    let indicators = remainder
        .split_once('#')
        .map_or(remainder, |(head, _)| head)
        .trim();
    if indicators.chars().any(char::is_whitespace) {
        return None;
    }

    let mut chomp = YamlBlockChomp::Clip;
    let mut has_chomp = false;
    let mut explicit_indent = None;
    for indicator in indicators.chars() {
        match indicator {
            '+' if !has_chomp => {
                chomp = YamlBlockChomp::Keep;
                has_chomp = true;
            }
            '-' if !has_chomp => {
                chomp = YamlBlockChomp::Strip;
                has_chomp = true;
            }
            '1'..='9' if explicit_indent.is_none() => {
                explicit_indent = indicator.to_digit(10).map(|value| value as usize);
            }
            _ => return None,
        }
    }

    Some(YamlBlockHeader {
        style,
        chomp,
        explicit_indent,
    })
}

fn parse_yaml_block_scalar(
    frontmatter: &str,
    content_start: usize,
    header: YamlBlockHeader,
) -> (usize, String) {
    let indent = header.explicit_indent.or_else(|| {
        let mut cursor = content_start;
        while cursor < frontmatter.len() {
            let end = line_end(frontmatter, cursor);
            let line = strip_line_ending(&frontmatter[cursor..end]);
            if !line.trim().is_empty() {
                let indent = leading_space_count(line);
                return (indent > 0).then_some(indent);
            }
            cursor = end;
        }
        None
    });
    let Some(indent) = indent else {
        return (content_start, String::new());
    };

    let mut lines = Vec::new();
    let mut cursor = content_start;
    while cursor < frontmatter.len() {
        let end = line_end(frontmatter, cursor);
        let segment = &frontmatter[cursor..end];
        let (line, ending) = split_line_ending(segment);
        let is_blank = line.trim().is_empty();
        let line_indent = leading_space_count(line);
        if !is_blank && line_indent < indent {
            break;
        }

        let value = if is_blank { "" } else { &line[indent..] };
        lines.push(YamlBlockLine {
            value,
            has_line_ending: !ending.is_empty(),
            more_indented: !is_blank && line_indent > indent,
        });
        cursor = end;
    }

    let mut value = match header.style {
        YamlBlockStyle::Literal => render_literal_yaml_block(&lines),
        YamlBlockStyle::Folded => render_folded_yaml_block(&lines),
    };
    apply_yaml_block_chomp(&mut value, header.chomp, !lines.is_empty());
    (cursor, value)
}

fn leading_space_count(value: &str) -> usize {
    value
        .as_bytes()
        .iter()
        .take_while(|byte| **byte == b' ')
        .count()
}

fn render_literal_yaml_block(lines: &[YamlBlockLine<'_>]) -> String {
    let mut output = String::new();
    for line in lines {
        output.push_str(line.value);
        if line.has_line_ending {
            output.push('\n');
        }
    }
    output
}

fn render_folded_yaml_block(lines: &[YamlBlockLine<'_>]) -> String {
    let mut output = String::new();
    for (index, line) in lines.iter().enumerate() {
        output.push_str(line.value);
        if !line.has_line_ending {
            continue;
        }

        match lines.get(index + 1) {
            Some(next)
                if !line.value.is_empty()
                    && !next.value.is_empty()
                    && !line.more_indented
                    && !next.more_indented =>
            {
                output.push(' ');
            }
            Some(_) if !line.value.is_empty() => {}
            Some(_) => output.push('\n'),
            None => output.push('\n'),
        }
    }
    output
}

fn apply_yaml_block_chomp(value: &mut String, chomp: YamlBlockChomp, has_lines: bool) {
    match chomp {
        YamlBlockChomp::Keep => {}
        YamlBlockChomp::Strip => {
            value.truncate(value.trim_end_matches('\n').len());
        }
        YamlBlockChomp::Clip => {
            value.truncate(value.trim_end_matches('\n').len());
            if has_lines {
                value.push('\n');
            }
        }
    }
}

fn atomic_write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "写入目标缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("skill");

    for attempt in 0..32_u32 {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temp_path = parent.join(format!(
            ".{file_name}.{}.{}.{}.tmp",
            std::process::id(),
            nonce,
            attempt
        ));
        let mut file = match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建同目录临时文件：{error}")),
        };

        let write_result = file.write_all(bytes).and_then(|_| file.sync_all());
        drop(file);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("写入同目录临时文件失败：{error}"));
        }

        if let Err(error) = atomic_replace_file(&temp_path, path) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("原子替换技能文件失败：{error}"));
        }
        return Ok(());
    }
    Err("无法创建唯一的同目录临时文件".to_string())
}

#[cfg(not(target_os = "windows"))]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }

    let existing = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replacement = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: Both paths are valid, NUL-terminated UTF-16 buffers that remain alive for the call.
    let moved = unsafe {
        MoveFileExW(
            existing.as_ptr(),
            replacement.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn description_text(draft: &SkillDraft, skill_name: &str) -> String {
    if draft.description.trim().is_empty() {
        format!("Use when the user asks for the {skill_name} skill.")
    } else {
        draft.description.trim().to_string()
    }
}
fn write_entry_manifest(root: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let entry_path = root.join(ENTRY_FILE_NAME);
    let payload = EntryManifest {
        tool: "skillcreator".to_string(),
        version: "2.0".to_string(),
        description: "规范化创建标准 Codex Skill：生成 skill-name/SKILL.md，保留规则自由语义，仅在语义明确需要时编码条件、流程与验证结构。".to_string(),
        entry_root: root.to_string_lossy().to_string(),
        supported_files: vec![SKILL_FILE_NAME.to_string()],
        cli_hint: r#"{
  "name": "CreateSkill",
  "args": {
    "name": "string",
    "description": "string",
    "sourceMarkdown": "complete UTF-8 SKILL.md",
    "files": [
      {"path": "relative/path.md", "content": "complete UTF-8 content"}
    ],
    "deletedFiles": ["relative/path.md"]
  }
}"#
        .to_string(),
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    atomic_write_file(&entry_path, json.as_bytes())?;
    Ok(entry_path)
}

fn make_safe_file_name(text: &str) -> String {
    let mut safe = String::with_capacity(text.len());
    let mut last_was_hyphen = false;
    for ch in text.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            safe.push(ch);
            last_was_hyphen = false;
        } else if !last_was_hyphen {
            safe.push('-');
            last_was_hyphen = true;
        }
    }
    let truncated: String = safe.chars().take(63).collect();
    truncated.trim_matches('-').to_string()
}

fn escape_yaml(value: &str) -> String {
    value.replace('"', "\\\"")
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source_draft(name: &str, source: &str) -> SkillDraft {
        SkillDraft {
            name: name.to_string(),
            description: format!("Use when testing {name}."),
            source_markdown: source.to_string(),
            files: vec![],
            deleted_files: vec![],
        }
    }

    #[test]
    fn normalizes_relative_data_paths_to_absolute() {
        let path = absolute_data_path(Path::new("relative-root"))
            .expect("relative data path should become absolute");
        assert!(path.is_absolute());
        assert!(path.ends_with("relative-root"));
    }

    #[test]
    fn migrates_legacy_app_data_directory_without_merging() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let parent = std::env::temp_dir().join(format!(
            "skillcreator-data-migration-{}-{nonce}",
            std::process::id()
        ));
        let legacy = parent.join(LEGACY_APP_DATA_DIR_NAME);
        fs::create_dir_all(legacy.join("skills")).expect("legacy skills directory should exist");
        fs::create_dir_all(legacy.join("settings"))
            .expect("legacy settings directory should exist");
        fs::write(legacy.join("skills").join("marker.txt"), b"skill")
            .expect("legacy skill marker should be written");
        fs::write(legacy.join("settings").join("marker.txt"), b"setting")
            .expect("legacy settings marker should be written");

        let canonical =
            migrate_legacy_app_data_dir(&parent, APP_DATA_DIR_NAME, LEGACY_APP_DATA_DIR_NAME)
                .expect("legacy data directory should migrate");

        assert_eq!(canonical, parent.join(APP_DATA_DIR_NAME));
        assert!(!legacy.exists());
        assert_eq!(
            fs::read(canonical.join("skills").join("marker.txt"))
                .expect("migrated skill marker should remain"),
            b"skill"
        );
        assert_eq!(
            fs::read(canonical.join("settings").join("marker.txt"))
                .expect("migrated settings marker should remain"),
            b"setting"
        );
        fs::remove_dir_all(parent).expect("test directory should be removed");
    }

    #[test]
    fn rejects_conflicting_app_data_directories() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let parent = std::env::temp_dir().join(format!(
            "skillcreator-data-conflict-{}-{nonce}",
            std::process::id()
        ));
        let canonical = parent.join(APP_DATA_DIR_NAME);
        let legacy = parent.join(LEGACY_APP_DATA_DIR_NAME);
        fs::create_dir_all(&canonical).expect("canonical directory should exist");
        fs::create_dir_all(&legacy).expect("legacy directory should exist");

        let error =
            migrate_legacy_app_data_dir(&parent, APP_DATA_DIR_NAME, LEGACY_APP_DATA_DIR_NAME)
                .expect_err("conflicting data roots should be rejected");

        assert!(error.contains("同时存在"));
        assert!(canonical.is_dir());
        assert!(legacy.is_dir());
        fs::remove_dir_all(parent).expect("test directory should be removed");
    }

    #[test]
    fn entry_manifest_uses_skillcreator_tool_identity() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "skillcreator-entry-manifest-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("test directory should be created");
        ensure_manifest_at(&root).expect("entry manifest should be written");
        assert_eq!(ENTRY_FILE_NAME, "skillcreator-entry.json");
        assert!(root.join(ENTRY_FILE_NAME).is_file());
        assert!(!root.join("agent-entry.json").exists());
        let content = fs::read_to_string(root.join(ENTRY_FILE_NAME))
            .expect("entry manifest should be readable");
        let manifest: serde_json::Value =
            serde_json::from_str(&content).expect("entry manifest should be valid JSON");
        assert_eq!(manifest["tool"], "skillcreator");
        assert!(!content.contains("skill-agentmd-creator"));
        fs::remove_dir_all(root).expect("test directory should be removed");
    }
    #[test]
    fn accepts_only_canonical_skill_draft_fields() {
        let canonical = serde_json::json!({
            "name": "demo",
            "description": "Demo",
            "sourceMarkdown": "---\nname: demo\ndescription: Demo\n---\n",
            "files": [],
            "deletedFiles": []
        });
        let parsed = serde_json::from_value::<SkillDraft>(canonical)
            .expect("canonical SkillDraft should deserialize");
        assert!(parsed.source_markdown.contains("name: demo"));

        for field in ["aliases", "content", "topRules", "rules", "commandTools"] {
            let mut legacy = serde_json::json!({
                "name": "demo",
                "description": "Demo",
                "sourceMarkdown": "---\nname: demo\ndescription: Demo\n---\n"
            });
            legacy
                .as_object_mut()
                .expect("fixture should be an object")
                .insert(field.to_string(), serde_json::Value::Null);
            let error = serde_json::from_value::<SkillDraft>(legacy)
                .expect_err("legacy structured draft field should be rejected");
            assert!(error.to_string().contains("unknown field"));
            assert!(error.to_string().contains(field));
        }
    }

    #[test]
    fn requires_source_markdown_for_skill_drafts() {
        let error = serde_json::from_value::<SkillDraft>(serde_json::json!({
            "name": "demo",
            "description": "Demo"
        }))
        .expect_err("sourceMarkdown should be required");
        assert!(error.to_string().contains("missing field"));
        assert!(error.to_string().contains("sourceMarkdown"));
    }
    #[test]
    fn normalizes_skill_names_to_skill_folder_format() {
        assert_eq!(make_safe_file_name("Plan Mode"), "plan-mode");
        assert_eq!(make_safe_file_name("测试 Skill Name!"), "skill-name");
        assert_eq!(make_safe_file_name("bad___Name"), "bad-name");
    }

    #[test]
    fn preserves_complex_source_markdown_and_unknown_sections() {
        let source = concat!(
            "---\n",
            "name: \"original-name\"\n",
            "description: \"Original description\"\n",
            "custom-key: keep-me\n",
            "---\n\n",
            "# Original title\n\n",
            "## Unknown Section\n\n",
            "- nested\n",
            "  - child\n\n",
            "```powershell\n",
            "Write-Host \"keep this code block\"\n",
            "```\n",
        );
        let draft = SkillDraft {
            name: "edited-name".to_string(),
            description: "Edited description".to_string(),
            source_markdown: source.to_string(),
            files: vec![],
            deleted_files: vec![],
        };

        let markdown = markdown_for_draft(&draft, "edited-name").expect("source should be valid");

        assert!(markdown.contains("name: \"edited-name\""));
        assert!(markdown.contains("description: \"Edited description\""));
        assert!(markdown.contains("custom-key: keep-me"));
        assert!(markdown.contains("## Unknown Section\n\n- nested\n  - child"));
        assert!(markdown.contains("```powershell\nWrite-Host \"keep this code block\"\n```"));
    }

    #[test]
    fn adds_required_frontmatter_without_rewriting_source_body() {
        let source =
            "# Existing body\r\n\r\n## Custom\r\n\r\n```json\r\n{\"keep\":true}\r\n```\r\n";
        let draft = SkillDraft {
            name: "new-skill".to_string(),
            description: "New description".to_string(),
            source_markdown: source.to_string(),
            files: vec![],
            deleted_files: vec![],
        };

        let markdown =
            markdown_for_draft(&draft, "new-skill").expect("frontmatter should be added");

        assert!(markdown.starts_with(
            "---\r\nname: \"new-skill\"\r\ndescription: \"New description\"\r\n---\r\n\r\n"
        ));
        assert!(markdown.ends_with(source));
    }

    #[test]
    fn preserves_bom_and_crlf_when_rewriting_required_frontmatter() {
        let source = concat!(
            "\u{feff}---\r\n",
            "name: \"old-name\"\r\n",
            "description: \"Old description\"\r\n",
            "custom: keep\r\n",
            "---\r\n\r\n",
            "# Body\r\n\r\n",
            "```text\r\nkeep\r\n```\r\n",
        );
        let draft = SkillDraft {
            name: "new-name".to_string(),
            description: "New description".to_string(),
            source_markdown: source.to_string(),
            files: vec![],
            deleted_files: vec![],
        };

        let markdown = markdown_for_draft(&draft, "new-name").expect("source should be valid");

        assert!(markdown.starts_with("\u{feff}---\r\nname: \"new-name\"\r\n"));
        assert!(markdown.contains("description: \"New description\"\r\ncustom: keep\r\n"));
        assert!(markdown.contains("```text\r\nkeep\r\n```\r\n"));
        assert!(!markdown.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn rejects_duplicate_required_frontmatter_keys() {
        let source = concat!(
            "---\n",
            "name: \"one\"\n",
            "name: \"two\"\n",
            "description: \"Description\"\n",
            "---\n\n",
            "# Body\n",
        );
        let draft = SkillDraft {
            name: "safe-name".to_string(),
            description: "Safe description".to_string(),
            source_markdown: source.to_string(),
            files: vec![],
            deleted_files: vec![],
        };

        let error = markdown_for_draft(&draft, "safe-name").expect_err("duplicates must fail");

        assert!(error.contains("重复"));
    }

    #[test]
    fn reads_literal_block_scalar_with_bom_crlf_and_strip_chomp() {
        let source = concat!(
            "\u{feff}---\r\n",
            "name: demo-skill\r\n",
            "description: |-\r\n",
            "  First line\r\n",
            "  second line\r\n",
            "nested:\r\n",
            "  description: ignored\r\n",
            "---\r\n",
        );

        assert_eq!(
            frontmatter_value(source, "description").as_deref(),
            Some("First line\nsecond line")
        );
    }

    #[test]
    fn reads_folded_block_scalar_with_clip_chomp() {
        let source = concat!(
            "---\n",
            "name: demo-skill\n",
            "description: >\n",
            "  First line\n",
            "  second line\n",
            "\n",
            "  next paragraph\n",
            "custom: keep\n",
            "---\n",
        );

        assert_eq!(
            frontmatter_value(source, "description").as_deref(),
            Some("First line second line\nnext paragraph\n")
        );
    }

    #[test]
    fn preserves_unchanged_block_scalar_frontmatter_byte_for_byte() {
        let source = concat!(
            "\u{feff}---\r\n",
            "name: |\r\n",
            "  same-skill\r\n",
            "description: > # keep this scalar spelling\r\n",
            "  Same folded\r\n",
            "  description\r\n",
            "custom: keep\r\n",
            "---\r\n\r\n",
            "# Body\r\n",
        );

        let rewritten = ensure_source_frontmatter(source, "same-skill", "Same folded description")
            .expect("unchanged scalar values should remain valid");

        assert_eq!(rewritten.as_bytes(), source.as_bytes());
    }

    #[test]
    fn replaces_changed_block_scalar_and_removes_its_entire_continuation_span() {
        let source = concat!(
            "---\n",
            "name: existing-skill\n",
            "description: |+\n",
            "  Old first line\n",
            "  old second line\n",
            "\n",
            "custom: keep\n",
            "nested:\n",
            "  description: must-remain\n",
            "---\n\n",
            "# Body\n",
        );

        let rewritten = ensure_source_frontmatter(source, "existing-skill", "New description")
            .expect("changed scalar should be replaced");

        assert_eq!(
            rewritten,
            concat!(
                "---\n",
                "name: existing-skill\n",
                "description: \"New description\"\n",
                "custom: keep\n",
                "nested:\n",
                "  description: must-remain\n",
                "---\n\n",
                "# Body\n",
            )
        );
    }

    #[test]
    fn parses_fenced_design_skill_json_proposal() {
        let response = concat!(
            "```json\n",
            "{\"assistantMessage\":\"已生成提案\",",
            "\"markdown\":\"---\\nname: \\\"demo\\\"\\ndescription: \\\"Demo skill\\\"\\n---\\n\\n# Demo\\n\\n## Custom\\nKeep me.\\n\"}",
            "\n```",
        );

        let proposal = parse_design_skill_output(response).expect("proposal should parse");

        assert_eq!(proposal.assistant_message, "已生成提案");
        assert!(proposal.markdown.contains("## Custom\nKeep me."));
    }

    #[test]
    fn imports_complete_codex_skill_directory_with_source_metadata() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("skill-import-tests")
            .join(format!("{}-{nonce}", std::process::id()));
        let source = root.join("source").join("demo");
        let workspace = root.join("workspace");
        fs::create_dir_all(source.join("references")).unwrap();
        fs::create_dir_all(source.join("scripts")).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        fs::write(
            source.join(SKILL_FILE_NAME),
            "---\nname: demo\ndescription: Demo skill\n---\n",
        )
        .unwrap();
        fs::write(source.join("references").join("guide.md"), "# Guide\n").unwrap();
        fs::write(
            source.join("scripts").join("check.ps1"),
            "Write-Output ok\n",
        )
        .unwrap();
        let source_file = source.join(SKILL_FILE_NAME).canonicalize().unwrap();
        let source_key = normalized_path_key(&source_file);
        let entry = CodexSkillCatalogEntry {
            id: stable_catalog_id(&source_key),
            name: "demo".to_string(),
            description: "Demo skill".to_string(),
            source: "本地技能".to_string(),
            relative_path: "skills/demo/SKILL.md".to_string(),
            source_path: source_file.to_string_lossy().to_string(),
            file_count: 3,
            byte_size: 80,
            imported: false,
            imported_id: None,
            format_gaps: Vec::new(),
            loadable: true,
        };

        let imported_id =
            import_codex_skill_entry(&workspace, &entry).expect("complete directory should import");
        let imported = workspace.join(&imported_id);
        assert!(imported.join(SKILL_FILE_NAME).is_file());
        assert!(imported.join("references").join("guide.md").is_file());
        assert!(imported.join("scripts").join("check.ps1").is_file());
        let sources = imported_skill_sources(&workspace);
        assert_eq!(sources.get(&entry.id), Some(&imported_id));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_rule_section_format_gaps() {
        let standard = analyze_editor_diagnostics(
            "---\nname: demo\ndescription: Demo\n---\n\n## 规则\n- Keep the requested semantics intact.\n",
            true,
        );
        assert!(standard.format_gaps.is_empty());

        let arbitrary = analyze_editor_diagnostics(
            "---\nname: demo\ndescription: Demo\n---\n\n## Arbitrary\nKeep every node.\n",
            true,
        );
        assert!(arbitrary
            .format_gaps
            .contains(&"缺少标准“规则”章节".to_string()));

        let plain = analyze_editor_diagnostics(
            "---\nname: demo\ndescription: Demo\n---\n\nKeep every byte.\n",
            true,
        );
        assert!(plain
            .format_gaps
            .contains(&"缺少标准“规则”章节".to_string()));
    }

    #[test]
    fn treats_rule_wording_as_free_semantics() {
        for rule in [
            "如果 1，那么 2",
            "若 1 则 2",
            "Preserve the direct requirement.",
        ] {
            let content = format!("---\nname: demo\ndescription: Demo\n---\n\n## 规则\n- {rule}\n");
            let diagnostics = analyze_editor_diagnostics(&content, true);
            assert!(diagnostics.format_gaps.is_empty());
        }
    }

    #[test]
    fn normative_contract_supports_free_rule_semantics() {
        assert!(NORMATIVE_OUTPUT_CONTRACT.contains(
            "Treat rule text as free semantics under this normative governance contract."
        ));
        assert!(NORMATIVE_OUTPUT_CONTRACT
            .contains("do not force any particular sentence pattern or grammar"));
        assert!(NORMATIVE_OUTPUT_CONTRACT
            .contains("Only encode a condition, step sequence, verification/evidence clause"));
        assert!(NORMATIVE_DESIGN_INSTRUCTIONS
            .contains("Write every rule in the clearest free semantic form"));
        assert!(NORMATIVE_DESIGN_INSTRUCTIONS.contains("Do not prefer any sentence template"));
        assert!(NORMATIVE_DESIGN_INSTRUCTIONS
            .contains("never manufacture structure for stylistic uniformity"));
    }

    #[test]
    fn accepts_partitioned_english_normative_skill_contract() {
        let source = concat!(
            "---\n",
            "name: normative-demo\n",
            "description: Use when a user needs a normalized demonstration skill.\n",
            "---\n\n",
            "## Top Rules\n\n",
            "1. Load only the partition required by the current task.\n\n",
            "## Partition Index\n\n",
            "- Validation and execution rules: `references/rules.md`\n",
        );
        let files = vec![SkillFileDraft {
            path: "references/rules.md".to_string(),
            content: concat!(
                "# Rules\n\n",
                "## Rules\n\n",
                "1. Keep the execution path compact and explicit.\n",
                "2. If input is present, MUST validate it before execution.\n",
                "3. After execution, VERIFY the recorded result.\n\n",
                "## Workflow\nValidate, execute, then verify.\n\n",
                "## Validation\nConfirm the recorded result.\n",
            )
            .to_string(),
        }];

        validate_normative_skill_bundle(source, &files).expect("contract should validate");
    }

    #[test]
    fn rejects_chinese_prose_in_english_canonical_skill() {
        let source = concat!(
            "---\n",
            "name: normative-demo\n",
            "description: Use when a user needs a normalized demonstration skill.\n",
            "---\n\n",
            "## Top Rules\n\n",
            "1. Load only the required partition.\n\n",
            "## Partition Index\n\n",
            "- Rules: `references/rules.md`\n",
        );
        let files = vec![SkillFileDraft {
            path: "references/rules.md".to_string(),
            content: "# Rules\n\n## Rules\n\n1. 这里不应出现在英文技能本体中。\n".to_string(),
        }];

        assert!(validate_normative_skill_bundle(source, &files)
            .unwrap_err()
            .contains("必须使用英文"));
        assert!(contains_han_outside_fences(&files[0].content));
        assert!(!contains_han_outside_fences(
            "```\n中文样本\n```\nEnglish prose."
        ));
    }

    #[test]
    fn manages_multifile_skill_lifecycle_and_rejects_escape_paths() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("skill-multifile-tests")
            .join(format!("{}-{nonce}", std::process::id()));
        let library = root.join("library");
        fs::create_dir_all(&library).unwrap();

        let source = concat!(
            "---\n",
            "name: bundle\n",
            "description: Use when testing a multi-file bundle.\n",
            "---\n\n",
            "## Top Rules\n\n",
            "1. Load only the required partition.\n\n",
            "## Partition Index\n\n",
            "- Rules: `rules/core.md`\n",
            "- Reusable source: `assets/check.ps1`\n",
        );
        let mut draft = source_draft("bundle", source);
        draft.files = vec![
            SkillFileDraft {
                path: "rules/core.md".to_string(),
                content: "# Core\n\n## Rules\n\n1. MUST apply the test rule.\n".to_string(),
            },
            SkillFileDraft {
                path: "assets/check.ps1".to_string(),
                content: "Write-Output 'ok'\n".to_string(),
            },
        ];

        let created = create_skill_at(&library, draft).expect("multi-file skill should be created");
        assert!(created.written_files.contains(&"SKILL.md".to_string()));
        assert!(created.written_files.contains(&"rules/core.md".to_string()));
        assert!(created
            .written_files
            .contains(&"assets/check.ps1".to_string()));

        let loaded = read_skill_at(&library, "bundle").expect("bundle should load");
        assert!(loaded.index_mode);
        assert_eq!(loaded.entry_file, "SKILL.md");
        assert!(loaded
            .files
            .iter()
            .any(|file| { file.path == "rules/core.md" && file.content.contains("MUST apply") }));
        assert!(loaded.files.iter().any(|file| {
            file.path == "assets/check.ps1" && file.content.contains("Write-Output")
        }));

        let original_entry = loaded.content.clone();
        let original_child = loaded
            .files
            .iter()
            .find(|file| file.path == "rules/core.md")
            .map(|file| file.content.clone())
            .expect("core child should exist");

        let mut overlap = source_draft("bundle", &loaded.content);
        overlap.description = "This change must not commit.".to_string();
        overlap.files = vec![SkillFileDraft {
            path: "rules/core.md".to_string(),
            content: "# Core changed\n".to_string(),
        }];
        overlap.deleted_files = vec!["rules/core.md".to_string()];
        let overlap_error = update_skill_at(&library, "bundle", overlap)
            .expect_err("write/delete overlap must fail");
        assert!(overlap_error.contains("同时写入和删除"));
        let after_overlap = read_skill_at(&library, "bundle").unwrap();
        assert_eq!(after_overlap.content, original_entry);
        assert_eq!(
            after_overlap
                .files
                .iter()
                .find(|file| file.path == "rules/core.md")
                .map(|file| file.content.as_str()),
            Some(original_child.as_str())
        );

        let mut invalid_delete = source_draft("bundle", &loaded.content);
        invalid_delete.description = "This invalid delete must not change entry.".to_string();
        invalid_delete.deleted_files = vec!["../escape.md".to_string()];
        let invalid_delete_error = update_skill_at(&library, "bundle", invalid_delete)
            .expect_err("invalid deletedFiles must fail before entry write");
        assert!(invalid_delete_error.contains("非法"));
        let after_invalid_delete = read_skill_at(&library, "bundle").unwrap();
        assert_eq!(after_invalid_delete.content, original_entry);

        let mut update = source_draft("bundle", &loaded.content);
        update.deleted_files = vec!["rules/core.md".to_string(), "assets/check.ps1".to_string()];
        update_skill_at(&library, "bundle", update)
            .expect("explicit child deletion should succeed");
        let reloaded = read_skill_at(&library, "bundle").expect("bundle should reload");
        assert!(!reloaded.index_mode);
        assert!(!reloaded
            .files
            .iter()
            .any(|file| file.path == "rules/core.md"));
        assert!(!reloaded
            .files
            .iter()
            .any(|file| file.path == "assets/check.ps1"));

        let mut invalid = source_draft("unsafe", source);
        invalid.files = vec![SkillFileDraft {
            path: "../escape.md".to_string(),
            content: "escape".to_string(),
        }];
        let error = create_skill_at(&library, invalid).expect_err("escape path must fail");
        assert!(error.contains("非法"));
        assert!(!library.join("unsafe").exists());
        assert!(!root.join("escape.md").exists());

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn list_skills_ignores_legacy_agentmd_flat_files() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("skill-list-tests")
            .join(format!("{}-{nonce}", std::process::id()));
        let canonical = root.join("current");
        fs::create_dir_all(&canonical).expect("canonical directory should be created");
        fs::write(
            canonical.join(SKILL_FILE_NAME),
            "---\nname: current\ndescription: Canonical skill.\n---\n",
        )
        .expect("canonical skill should be written");
        fs::write(
            root.join("old.agentmd"),
            "---\nname: old\ndescription: Legacy flat skill.\n---\n",
        )
        .expect("legacy fixture should be written");

        let skills = list_skills_at(&root).expect("skill list should load");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "current");
        assert_eq!(skills[0].name, "current");

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn atomically_replaces_existing_file_without_temp_residue() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("skill-store-tests")
            .join(format!("{}-{nonce}", std::process::id()));
        fs::create_dir_all(&root).expect("test directory should be created");
        let path = root.join(SKILL_FILE_NAME);
        fs::write(&path, b"old").expect("old file should be written");

        atomic_write_file(&path, b"new complete skill").expect("replace should succeed");

        assert_eq!(fs::read_to_string(&path).unwrap(), "new complete skill");
        let remaining = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert_eq!(remaining, vec![SKILL_FILE_NAME.to_string()]);
        fs::remove_dir_all(root).expect("test directory should be removed");
    }
}

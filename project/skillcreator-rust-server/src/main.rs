#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod skill_store;

use serde::{Deserialize, Serialize};
use serde_json::json;
use skill_store::{
    codex_model_status_at, create_skill_at, default_app_data_dir, delete_skill_at, design_skill_at,
    ensure_manifest_at, import_codex_skills_at, list_skills_at, read_skill_at,
    scan_codex_skills_at, set_codex_model_at, translate_rule_to_english_at, update_skill_at,
    CodexSkillImportRequest, DesignSkillRequest, SkillDraft, API_BODY_LIMIT, API_HOST, API_PORT,
};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillRequest {
    draft: SkillDraft,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateRuleRequest {
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCodexModelRequest {
    model: String,
    reasoning_effort: String,
    fast_mode: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    data_dir: String,
}

#[derive(Debug)]
struct ApiState {
    root: PathBuf,
    data_dir: PathBuf,
    skill_write_lock: Mutex<()>,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("skill-api-server: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let data_dir = default_app_data_dir()?;
    let root = skill_store::workspace_root_from_data_dir(&data_dir)?;
    let state = Arc::new(ApiState {
        root,
        data_dir,
        skill_write_lock: Mutex::new(()),
    });

    let listener = TcpListener::bind((API_HOST, API_PORT)).map_err(|error| {
        format!("无法绑定 {API_HOST}:{API_PORT}：{error}。如果已启动，可直接复用现有后台。")
    })?;
    println!(
        "skill-api-server ready http://{API_HOST}:{API_PORT} data_dir={}",
        state.data_dir.to_string_lossy()
    );

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = Arc::clone(&state);
                thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, &state) {
                        eprintln!("request failed: {error}");
                    }
                });
            }
            Err(error) => eprintln!("connection failed: {error}"),
        }
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream, state: &ApiState) -> Result<(), String> {
    let request = read_request(&mut stream)?;
    let response = handle_request(request, state);
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if header_end(&buffer).is_some() {
            break;
        }
        if buffer.len() > API_BODY_LIMIT {
            return Err("请求头过大".to_string());
        }
    }

    let header_end = header_end(&buffer).ok_or_else(|| "请求格式不完整".to_string())?;
    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.lines();
    let request_line = lines.next().ok_or_else(|| "缺少请求行".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "缺少请求方法".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "缺少请求路径".to_string())?
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > API_BODY_LIMIT {
        return Err(format!("请求体超过 {} bytes", API_BODY_LIMIT));
    }

    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    if buffer.len() < body_start + content_length {
        return Err("请求体不完整".to_string());
    }

    Ok(HttpRequest {
        method,
        path,
        headers,
        body: buffer[body_start..body_start + content_length].to_vec(),
    })
}

fn with_skill_write_lock<T>(
    state: &ApiState,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, (u16, String)> {
    let _guard = state
        .skill_write_lock
        .lock()
        .map_err(|_| (500, "Skill 写锁已损坏".to_string()))?;
    action().map_err(|message| (400, message))
}

fn handle_request(request: HttpRequest, state: &ApiState) -> String {
    if request.method == "OPTIONS" {
        return empty_response(204);
    }

    let result = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api/health") => json_response(
            200,
            &HealthResponse {
                ok: true,
                service: "skillcreator-api",
                data_dir: state.data_dir.to_string_lossy().to_string(),
            },
        ),
        ("POST", "/api/ensure_manifest") => {
            with_skill_write_lock(state, || ensure_manifest_at(&state.root))
                .and_then(|result| json_response(200, &result))
        }
        ("GET", "/api/codex_status") => json_response(200, &codex_model_status_at(&state.data_dir)),
        ("PUT", "/api/codex_model") => parse_json_request::<SetCodexModelRequest>(&request)
            .and_then(|payload| {
                set_codex_model_at(
                    &state.data_dir,
                    payload.model,
                    payload.reasoning_effort,
                    payload.fast_mode,
                )
                .map_err(|message| (400, message))
            })
            .and_then(|result| json_response(200, &result)),
        ("POST", "/api/translate_rule") => parse_json_request::<TranslateRuleRequest>(&request)
            .and_then(|payload| {
                translate_rule_to_english_at(&state.data_dir, payload.text)
                    .map_err(|message| (400, message))
            })
            .and_then(|result| json_response(200, &result)),
        ("POST", "/api/design_skill") => parse_json_request::<DesignSkillRequest>(&request)
            .and_then(|payload| {
                design_skill_at(&state.data_dir, payload).map_err(|message| (400, message))
            })
            .and_then(|result| json_response(200, &result)),
        ("GET", "/api/codex_skills") => json_result(scan_codex_skills_at(&state.root)),
        ("POST", "/api/codex_skills/import") => {
            parse_json_request::<CodexSkillImportRequest>(&request)
                .and_then(|payload| {
                    with_skill_write_lock(state, || import_codex_skills_at(&state.root, payload))
                })
                .and_then(|result| json_response(200, &result))
        }
        ("GET", "/api/skills") => json_result(list_skills_at(&state.root)),
        ("POST", "/api/skills") => parse_skill_request(&request)
            .and_then(|payload| {
                with_skill_write_lock(state, || create_skill_at(&state.root, payload.draft))
            })
            .and_then(|result| json_response(200, &result)),
        _ if request.method == "GET" && request.path.starts_with("/api/skills/") => {
            let id = route_id(&request.path);
            json_result(read_skill_at(&state.root, &id))
        }
        _ if request.method == "PUT" && request.path.starts_with("/api/skills/") => {
            let id = route_id(&request.path);
            parse_skill_request(&request)
                .and_then(|payload| {
                    with_skill_write_lock(state, || {
                        update_skill_at(&state.root, &id, payload.draft)
                    })
                })
                .and_then(|result| json_response(200, &result))
        }
        _ if request.method == "DELETE" && request.path.starts_with("/api/skills/") => {
            let id = route_id(&request.path);
            with_skill_write_lock(state, || delete_skill_at(&state.root, &id))
                .and_then(|_| json_response(200, &serde_json::json!({ "ok": true })))
        }
        _ => Err((404, "未找到 API".to_string())),
    };

    match result {
        Ok(response) => response,
        Err((status, message)) => error_response(status, &message),
    }
}

fn parse_skill_request(request: &HttpRequest) -> Result<SkillRequest, (u16, String)> {
    parse_json_request(request)
}

fn parse_json_request<T: for<'de> Deserialize<'de>>(
    request: &HttpRequest,
) -> Result<T, (u16, String)> {
    if !request
        .headers
        .get("content-type")
        .map(|value| value.to_ascii_lowercase().contains("application/json"))
        .unwrap_or(false)
    {
        return Err((415, "Content-Type 必须是 application/json".to_string()));
    }
    serde_json::from_slice::<T>(&request.body).map_err(|error| (400, error.to_string()))
}

fn json_result<T: Serialize>(result: Result<T, String>) -> Result<String, (u16, String)> {
    result
        .map_err(|message| (400, message))
        .and_then(|value| json_response(200, &value))
}

fn json_response<T: Serialize>(status: u16, value: &T) -> Result<String, (u16, String)> {
    serde_json::to_string(value)
        .map(|body| response(status, "application/json; charset=utf-8", &body))
        .map_err(|error| (500, error.to_string()))
}

fn error_response(status: u16, message: &str) -> String {
    let body = serde_json::to_string(&json!({ "error": message }))
        .unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", message.replace('"', "\\\"")));
    response(status, "application/json; charset=utf-8", &body)
}

fn empty_response(status: u16) -> String {
    response(status, "text/plain; charset=utf-8", "")
}

fn response(status: u16, content_type: &str, body: &str) -> String {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        415 => "Unsupported Media Type",
        500 => "Internal Server Error",
        _ => "OK",
    };
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn route_id(path: &str) -> String {
    percent_decode(path.trim_start_matches("/api/skills/"))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                output.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Barrier,
        },
        time::Duration,
    };

    #[test]
    fn health_uses_skillcreator_service_identity() {
        let state = ApiState {
            root: PathBuf::new(),
            data_dir: PathBuf::new(),
            skill_write_lock: Mutex::new(()),
        };
        let response = handle_request(
            HttpRequest {
                method: "GET".to_string(),
                path: "/api/health".to_string(),
                headers: HashMap::new(),
                body: Vec::new(),
            },
            &state,
        );
        assert!(response.contains("skillcreator-api"));
        assert!(!response.contains("skill-agentmd-creator-api"));
    }
    #[test]
    fn skill_write_lock_serializes_mutations() {
        let state = Arc::new(ApiState {
            root: PathBuf::new(),
            data_dir: PathBuf::new(),
            skill_write_lock: Mutex::new(()),
        });

        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(9));
        let mut handles = Vec::new();

        for _ in 0..8 {
            let state = Arc::clone(&state);
            let active = Arc::clone(&active);
            let max_active = Arc::clone(&max_active);
            let barrier = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                with_skill_write_lock(&state, || {
                    let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                    max_active.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(5));
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok::<(), String>(())
                })
                .expect("write lock should remain healthy");
            }));
        }

        barrier.wait();
        for handle in handles {
            handle.join().expect("worker should finish");
        }
        assert_eq!(max_active.load(Ordering::SeqCst), 1);
    }
}

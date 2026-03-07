//! Code Buddy Native Sidecar
//!
//! JSON-RPC over stdin/stdout for:
//! - Local Whisper STT (whisper-rs)
//! - Desktop automation (enigo + arboard)
//!
//! Protocol: one JSON object per line (newline-delimited JSON).
//! Request:  {"id": 1, "method": "transcribe", "params": {...}}
//! Response: {"id": 1, "result": {...}} or {"id": 1, "error": "..."}

mod stt;
mod desktop;

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    params: serde_json::Value,
}

#[derive(Serialize)]
struct Response {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    // Shared state
    let mut stt_state = stt::SttState::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let resp = Response {
                    id: 0,
                    result: None,
                    error: Some(format!("Parse error: {}", e)),
                };
                let _ = writeln!(out, "{}", serde_json::to_string(&resp).unwrap());
                let _ = out.flush();
                continue;
            }
        };

        let resp = match req.method.as_str() {
            // ── STT methods ──
            "stt.load_model" => stt_state.load_model(&req.params),
            "stt.transcribe" => stt_state.transcribe(&req.params),
            "stt.list_models" => stt_state.list_models(),
            "stt.status" => stt_state.status(),

            // ── Desktop automation methods ──
            "desktop.paste" => desktop::paste(&req.params),
            "desktop.type_text" => desktop::type_text(&req.params),
            "desktop.key_press" => desktop::key_press(&req.params),
            "desktop.clipboard_get" => desktop::clipboard_get(),
            "desktop.clipboard_set" => desktop::clipboard_set(&req.params),

            // ── Meta ──
            "ping" => Ok(serde_json::json!({"pong": true})),
            "version" => Ok(serde_json::json!({
                "name": "codebuddy-sidecar",
                "version": env!("CARGO_PKG_VERSION"),
                "features": ["stt", "desktop"]
            })),

            _ => Err(format!("Unknown method: {}", req.method)),
        };

        let response = Response {
            id: req.id,
            result: resp.as_ref().ok().cloned(),
            error: resp.err(),
        };

        let _ = writeln!(out, "{}", serde_json::to_string(&response).unwrap());
        let _ = out.flush();
    }
}

//! buddy-memory — Rust engine for Code Buddy's Collective Knowledge Graph.
//! `buddy-memory serve --ledger <path> [--agent <id>]` runs a newline-delimited JSON-RPC
//! server over stdio: each line `{"id":N,"method":"...","params":{...}}` → `{"id":N,"result":...}`
//! (or `{"id":N,"error":"..."}`). Code Buddy spawns this as a sidecar; the TS CKG is a client.

#[cfg(feature = "embeddings")]
mod embed;
mod model;
mod store;

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use store::{RememberInput, RememberRel, Store};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // Subcommand: serve (default). Flags: --ledger <path>, --agent <id>.
    let mut ledger: Option<String> = None;
    let mut agent = "unknown/unknown".to_string();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--ledger" => {
                ledger = args.get(i + 1).cloned();
                i += 2;
            }
            "--agent" => {
                if let Some(a) = args.get(i + 1) {
                    agent = a.clone();
                }
                i += 2;
            }
            _ => i += 1, // "serve" subcommand (default) + unknown flags
        }
    }
    let ledger_path = PathBuf::from(ledger.unwrap_or_else(|| {
        let home = std::env::var("CODEBUDDY_HOME")
            .or_else(|_| std::env::var("HOME").map(|h| format!("{}/.codebuddy", h)))
            .unwrap_or_else(|_| ".codebuddy".to_string());
        format!("{}/collective/ckg-ledger.jsonl", home)
    }));

    let mut store = Store::new(ledger_path, agent);

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                let _ = writeln!(out, "{}", json!({"id": Value::Null, "error": format!("bad json: {}", e)}));
                let _ = out.flush();
                continue;
            }
        };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(Value::Null);

        let result: Result<Value, String> = dispatch(&mut store, method, &params);
        let resp = match result {
            Ok(r) => json!({ "id": id, "result": r }),
            Err(e) => json!({ "id": id, "error": e }),
        };
        let _ = writeln!(out, "{}", resp);
        let _ = out.flush();
    }
}

fn dispatch(store: &mut Store, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "ping" => Ok(json!("pong")),
        "remember" => {
            let input = parse_remember(params, None);
            Ok(opt_result(store.remember(&input)))
        }
        "ingest" => {
            let input = parse_remember(params, Some("discovery"));
            Ok(opt_result(store.remember(&input)))
        }
        "ingestPublication" => {
            let input = parse_publication(params);
            Ok(opt_result(store.remember(&input)))
        }
        "recall" => {
            let query = params.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
            let types = parse_str_array(params.get("types"));
            Ok(serde_json::to_value(store.recall(query, limit, types.as_deref())).unwrap_or(Value::Null))
        }
        "recallHybrid" => {
            let query = params.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
            let types = parse_str_array(params.get("types"));
            #[cfg(feature = "embeddings")]
            let res = {
                let w_sem = params.get("semanticWeight").and_then(|v| v.as_f64()).unwrap_or(0.7);
                let mmr = params.get("mmrLambda").and_then(|v| v.as_f64()).unwrap_or(0.7);
                store.recall_hybrid(query, limit, types.as_deref(), w_sem, mmr)
            };
            // Built without embeddings → keyword recall (degrades like the TS path).
            #[cfg(not(feature = "embeddings"))]
            let res = store.recall(query, limit, types.as_deref());
            Ok(serde_json::to_value(res).unwrap_or(Value::Null))
        }
        "getSuperseded" => Ok(serde_json::to_value(store.get_superseded()).unwrap_or(Value::Null)),
        "getStats" => Ok(serde_json::to_value(store.stats()).unwrap_or(Value::Null)),
        other => Err(format!("unknown method: {}", other)),
    }
}

fn opt_result(r: Option<store::RecallResult>) -> Value {
    match r {
        Some(x) => serde_json::to_value(x).unwrap_or(Value::Null),
        None => Value::Null,
    }
}

fn s(params: &Value, key: &str) -> Option<String> {
    params.get(key).and_then(|v| v.as_str()).map(|x| x.to_string())
}

fn parse_str_array(v: Option<&Value>) -> Option<Vec<String>> {
    v.and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|i| i.as_str().map(|s| s.to_string())).collect())
}

fn parse_relations(params: &Value) -> Option<Vec<RememberRel>> {
    let arr = params.get("relations")?.as_array()?;
    Some(
        arr.iter()
            .filter_map(|r| {
                let predicate = r.get("predicate").and_then(|v| v.as_str())?.to_string();
                let target_name = r.get("targetName").and_then(|v| v.as_str())?.to_string();
                Some(RememberRel {
                    predicate,
                    target_name,
                    target_type: r.get("targetType").and_then(|v| v.as_str()).map(|x| x.to_string()),
                    reason: r.get("reason").and_then(|v| v.as_str()).map(|x| x.to_string()),
                })
            })
            .collect(),
    )
}

fn parse_remember(params: &Value, type_default: Option<&str>) -> RememberInput {
    RememberInput {
        text: s(params, "text").unwrap_or_default(),
        node_type: s(params, "type").or_else(|| type_default.map(|t| t.to_string())),
        name: s(params, "name"),
        agent_id: s(params, "agentId"),
        source: s(params, "source"),
        confidence: params.get("confidence").and_then(|v| v.as_f64()),
        relations: parse_relations(params),
    }
}

fn parse_publication(params: &Value) -> RememberInput {
    let title = s(params, "title").unwrap_or_default();
    let abstract_ = s(params, "abstract");
    let text = match &abstract_ {
        Some(a) if !a.is_empty() => format!("{}. {}", title, a),
        _ => title.clone(),
    };
    RememberInput {
        text,
        node_type: Some("discovery".to_string()),
        name: s(params, "id").or(Some(title)),
        agent_id: s(params, "agentId"),
        source: s(params, "source").or_else(|| Some("publication".to_string())),
        confidence: None,
        relations: None,
    }
}

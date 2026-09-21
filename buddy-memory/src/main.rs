//! buddy-memory — Rust engine for Code Buddy's Collective Knowledge Graph.
//! `buddy-memory serve --ledger <path> [--agent <id>]` runs a newline-delimited JSON-RPC
//! server over stdio: each line `{"id":N,"method":"...","params":{...}}` → `{"id":N,"result":...}`
//! (or `{"id":N,"error":"..."}`). Code Buddy spawns this as a sidecar; the TS CKG is a client.

use buddy_memory::store::{RememberInput, RememberRel, Store};
use buddy_memory::vindex::{Precision, VIndexRegistry};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;

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
    // Index vectoriels génériques, indépendants du graphe (voir vindex.rs).
    let mut vindexes = VIndexRegistry::new();

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
                let _ = writeln!(
                    out,
                    "{}",
                    json!({"id": Value::Null, "error": format!("bad json: {}", e)})
                );
                let _ = out.flush();
                continue;
            }
        };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(Value::Null);

        let result: Result<Value, String> =
            dispatch(&mut store, &mut vindexes, method, &params);
        let resp = match result {
            Ok(r) => json!({ "id": id, "result": r }),
            Err(e) => json!({ "id": id, "error": e }),
        };
        let _ = writeln!(out, "{}", resp);
        let _ = out.flush();
    }
}

fn dispatch(
    store: &mut Store,
    vindexes: &mut VIndexRegistry,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
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
            Ok(
                serde_json::to_value(store.recall(query, limit, types.as_deref()))
                    .unwrap_or(Value::Null),
            )
        }
        "recallHybrid" => {
            let query = params.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
            let types = parse_str_array(params.get("types"));
            let w_sem = params
                .get("semanticWeight")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.7);
            let mmr = params
                .get("mmrLambda")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.7);
            if let Some(ex) = params.get("exhaustive").and_then(|v| v.as_bool()) {
                store.set_hybrid_exhaustive(ex);
            }
            let res = store.recall_hybrid(query, limit, types.as_deref(), w_sem, mmr);
            Ok(serde_json::to_value(res).unwrap_or(Value::Null))
        }
        "getSuperseded" => Ok(serde_json::to_value(store.get_superseded()).unwrap_or(Value::Null)),
        "getStats" => Ok(serde_json::to_value(store.stats()).unwrap_or(Value::Null)),
        m if m.starts_with("vindex.") => dispatch_vindex(vindexes, m, params),
        other => Err(format!("unknown method: {}", other)),
    }
}

/// Index vectoriels génériques. Volontairement séparé de `dispatch` : rien ici ne
/// touche au graphe de connaissances, et l'ajout d'une méthode ne doit pas obliger
/// à relire le dispatch du graphe.
fn dispatch_vindex(
    reg: &mut VIndexRegistry,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    let name = || -> Result<String, String> {
        params
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "paramètre « name » manquant".to_string())
    };
    let vector = |key: &str| -> Result<Vec<f32>, String> {
        let arr = params
            .get(key)
            .and_then(|v| v.as_array())
            .ok_or_else(|| format!("paramètre « {} » manquant ou non tableau", key))?;
        arr.iter()
            .map(|v| {
                v.as_f64()
                    .map(|f| f as f32)
                    .ok_or_else(|| format!("« {} » contient une valeur non numérique", key))
            })
            .collect()
    };

    match method {
        "vindex.create" => {
            let n = name()?;
            let dim = params
                .get("dim")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| "paramètre « dim » manquant".to_string())? as usize;
            let capacity = params.get("capacity").and_then(|v| v.as_u64()).unwrap_or(1024) as usize;
            let replace = params.get("replace").and_then(|v| v.as_bool()).unwrap_or(false);
            let precision = Precision::from_str(
                params.get("precision").and_then(|v| v.as_str()).unwrap_or("f32"),
            )?;
            reg.create_avec(&n, dim, capacity, replace, precision)?;
            Ok(json!({ "ok": true, "name": n, "dim": dim, "precision": precision.as_str() }))
        }
        "vindex.insert" => {
            let n = name()?;
            let idx = reg
                .get_mut(&n)
                .ok_or_else(|| format!("index « {} » inconnu", n))?;
            // Un lot ou un point unique : un lot évite un aller-retour par vecteur,
            // ce qui domine le coût quand on indexe un dépôt entier.
            if let Some(items) = params.get("items").and_then(|v| v.as_array()) {
                let mut inserted = 0usize;
                for it in items {
                    let id = it
                        .get("id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "un élément sans « id »".to_string())?;
                    let vec: Vec<f32> = it
                        .get("vector")
                        .and_then(|v| v.as_array())
                        .ok_or_else(|| format!("élément « {} » sans « vector »", id))?
                        .iter()
                        .map(|v| v.as_f64().unwrap_or(f64::NAN) as f32)
                        .collect();
                    if vec.iter().any(|f| f.is_nan()) {
                        return Err(format!("élément « {} » : vecteur non numérique", id));
                    }
                    idx.insert(id, &vec)?;
                    inserted += 1;
                }
                return Ok(json!({ "inserted": inserted, "size": idx.len() }));
            }
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "paramètre « id » manquant".to_string())?;
            let vec = vector("vector")?;
            idx.insert(id, &vec)?;
            Ok(json!({ "inserted": 1, "size": idx.len() }))
        }
        "vindex.search" => {
            let n = name()?;
            let idx = reg
                .get(&n)
                .ok_or_else(|| format!("index « {} » inconnu", n))?;
            let q = vector("vector")?;
            let k = params.get("k").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
            let hits = idx.search(&q, k)?;
            let out: Vec<Value> = hits
                .into_iter()
                .map(|(id, score)| json!({ "id": id, "score": score }))
                .collect();
            Ok(json!(out))
        }
        "vindex.remove" => {
            let n = name()?;
            let idx = reg
                .get_mut(&n)
                .ok_or_else(|| format!("index « {} » inconnu", n))?;
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "paramètre « id » manquant".to_string())?;
            Ok(json!({ "removed": idx.remove(id), "size": idx.len() }))
        }
        "vindex.size" => {
            let n = name()?;
            let idx = reg
                .get(&n)
                .ok_or_else(|| format!("index « {} » inconnu", n))?;
            Ok(json!({
                "size": idx.len(),
                "dim": idx.dim(),
                "precision": idx.precision().as_str(),
                "vectorBytes": idx.vector_bytes(),
            }))
        }
        "vindex.clear" => {
            let n = name()?;
            let idx = reg
                .get_mut(&n)
                .ok_or_else(|| format!("index « {} » inconnu", n))?;
            idx.clear();
            Ok(json!({ "ok": true, "size": 0 }))
        }
        "vindex.drop" => {
            let n = name()?;
            Ok(json!({ "dropped": reg.drop_index(&n) }))
        }
        "vindex.list" => Ok(json!(reg.names())),
        // `dump`/`load` laissent la persistance au client : c'est lui qui sait où
        // écrire et sous quel format, et le sidecar reste sans état sur disque.
        "vindex.dump" => {
            let n = name()?;
            let idx = reg
                .get(&n)
                .ok_or_else(|| format!("index « {} » inconnu", n))?;
            let pairs: Vec<Value> = idx
                .to_pairs()
                .into_iter()
                .map(|(id, v)| json!({ "id": id, "vector": v }))
                .collect();
            Ok(json!({ "dim": idx.dim(), "items": pairs }))
        }
        "vindex.load" => {
            let n = name()?;
            let dim = params
                .get("dim")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| "paramètre « dim » manquant".to_string())? as usize;
            let items = params
                .get("items")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "paramètre « items » manquant".to_string())?;
            let mut pairs: Vec<(String, Vec<f32>)> = Vec::with_capacity(items.len());
            for it in items {
                let id = it
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "un élément sans « id »".to_string())?;
                let vec: Vec<f32> = it
                    .get("vector")
                    .and_then(|v| v.as_array())
                    .ok_or_else(|| format!("élément « {} » sans « vector »", id))?
                    .iter()
                    .map(|v| v.as_f64().unwrap_or(f64::NAN) as f32)
                    .collect();
                if vec.iter().any(|f| f.is_nan()) {
                    return Err(format!("élément « {} » : vecteur non numérique", id));
                }
                pairs.push((id.to_string(), vec));
            }
            let n_items = pairs.len();
            reg.load(&n, dim, pairs)?;
            Ok(json!({ "ok": true, "loaded": n_items }))
        }
        other => Err(format!("unknown vindex method: {}", other)),
    }
}

fn opt_result(r: Option<buddy_memory::store::RecallResult>) -> Value {
    match r {
        Some(x) => serde_json::to_value(x).unwrap_or(Value::Null),
        None => Value::Null,
    }
}

fn s(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .map(|x| x.to_string())
}

fn parse_str_array(v: Option<&Value>) -> Option<Vec<String>> {
    v.and_then(|x| x.as_array()).map(|a| {
        a.iter()
            .filter_map(|i| i.as_str().map(|s| s.to_string()))
            .collect()
    })
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
                    target_type: r
                        .get("targetType")
                        .and_then(|v| v.as_str())
                        .map(|x| x.to_string()),
                    reason: r
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .map(|x| x.to_string()),
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

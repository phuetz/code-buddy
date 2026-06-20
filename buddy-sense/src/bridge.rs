//! Bridge — ships admitted events as JSON over a WebSocket to Code Buddy's
//! sensory bridge, which re-emits them onto its internal event bus. Reconnects
//! on failure; never panics.

use futures_util::SinkExt;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

use crate::event::SensoryEvent;

/// Serialize an event to JSON, injecting the shared `token` field (if any) so a
/// token-protected Code Buddy bridge accepts our frames.
fn frame_json(ev: &SensoryEvent, token: Option<&str>) -> Option<String> {
    let mut value = serde_json::to_value(ev).ok()?;
    if let (Some(tok), Some(obj)) = (token, value.as_object_mut()) {
        obj.insert("token".to_string(), serde_json::Value::String(tok.to_string()));
    }
    Some(value.to_string())
}

pub async fn run_bridge(url: String, token: Option<String>, mut rx: broadcast::Receiver<SensoryEvent>) {
    loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                eprintln!("[buddy-sense] bridge connected → {url}");
                loop {
                    match rx.recv().await {
                        Ok(ev) => {
                            if let Some(text) = frame_json(&ev, token.as_deref()) {
                                if ws.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                        // Lagged: we dropped some events under load — keep going.
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            eprintln!("[buddy-sense] bridge lagged, dropped {n} events");
                        }
                        Err(broadcast::error::RecvError::Closed) => return,
                    }
                }
            }
            Err(e) => eprintln!("[buddy-sense] bridge connect failed: {e}; retrying in 2s"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::Modality;

    fn ev() -> SensoryEvent {
        SensoryEvent {
            modality: Modality::Audio,
            kind: "speech_start".into(),
            ts_ms: 1,
            salience: 200,
            payload: serde_json::json!({}),
        }
    }

    #[test]
    fn frame_json_injects_token_only_when_set() {
        let with = frame_json(&ev(), Some("secret")).unwrap();
        assert!(with.contains("\"token\":\"secret\""));
        assert!(with.contains("\"modality\":\"audio\""));
        let without = frame_json(&ev(), None).unwrap();
        assert!(!without.contains("token"));
    }
}

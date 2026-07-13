//! Bridge — ships admitted events as JSON over a WebSocket to Code Buddy's
//! sensory bridge, which re-emits them onto its internal event bus. Reconnects
//! on failure; never panics.

use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

use crate::event::SensoryEvent;

/// Serialize an event to JSON, injecting the shared `token` field (if any) so a
/// token-protected Code Buddy bridge accepts our frames.
fn frame_json(ev: &SensoryEvent, token: Option<&str>) -> Option<String> {
    let mut value = serde_json::to_value(ev).ok()?;
    if let (Some(tok), Some(obj)) = (token, value.as_object_mut()) {
        obj.insert(
            "token".to_string(),
            serde_json::Value::String(tok.to_string()),
        );
    }
    Some(value.to_string())
}

pub async fn run_bridge(
    url: String,
    token: Option<String>,
    mut rx: broadcast::Receiver<SensoryEvent>,
) {
    loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                eprintln!("[buddy-sense] bridge connected → {url}");
                let mut keepalive = tokio::time::interval(std::time::Duration::from_secs(15));
                loop {
                    tokio::select! {
                        msg = rx.recv() => match msg {
                            Ok(ev) => {
                                if let Some(text) = frame_json(&ev, token.as_deref()) {
                                    if ws.send(Message::Text(text)).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            // Lagged: we dropped some events under load — keep going.
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                eprintln!("[buddy-sense] bridge lagged, dropped {n} events");
                            }
                            Err(broadcast::error::RecvError::Closed) => return,
                        },
                        // Proactive keepalive: detect a half-open socket when traffic is quiet.
                        _ = keepalive.tick() => {
                            if ws.send(Message::Ping(Vec::new())).await.is_err() {
                                break;
                            }
                        }
                        // Poll reads so tungstenite auto-pongs + we notice a peer Close.
                        incoming = ws.next() => match incoming {
                            Some(Ok(Message::Close(_))) | None => break, // reconnect
                            Some(Ok(_)) => {}
                            Some(Err(_)) => break,
                        }
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

    #[tokio::test]
    async fn run_bridge_delivers_a_frame_then_reconnects_on_drop() {
        use tokio::net::TcpListener;
        use tokio_tungstenite::accept_async;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let (btx, rx) = broadcast::channel::<SensoryEvent>(8);
        let handle = tokio::spawn(run_bridge(url, None, rx));

        // First connection — the bridge sends our event as a JSON frame.
        let (sock, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(sock).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        btx.send(ev()).unwrap();
        // The keepalive may send a Ping first — read until the JSON text frame.
        let mut text = None;
        for _ in 0..6 {
            if let Message::Text(t) = ws.next().await.unwrap().unwrap() {
                text = Some(t);
                break;
            }
        }
        assert!(text.unwrap().contains("speech_start"));

        // Drop the peer → the bridge must reconnect (a second accept happens).
        drop(ws);
        let reconnected =
            tokio::time::timeout(std::time::Duration::from_secs(6), listener.accept()).await;
        assert!(
            reconnected.is_ok(),
            "bridge should reconnect after the peer drops"
        );
        handle.abort();
    }
}

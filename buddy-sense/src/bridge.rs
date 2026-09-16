//! Bridge — ships admitted events as JSON over a WebSocket to Code Buddy's
//! sensory bridge, which re-emits them onto its internal event bus. Reconnects
//! on failure; never panics.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tokio::time::{timeout, Instant};
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

#[derive(Clone, Copy)]
struct BridgeTiming {
    connect: Duration,
    write: Duration,
    retry: Duration,
    ping: Duration,
    pong: Duration,
}

impl Default for BridgeTiming {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(10),
            write: Duration::from_secs(5),
            retry: Duration::from_secs(2),
            ping: Duration::from_secs(15),
            pong: Duration::from_secs(10),
        }
    }
}

pub async fn run_bridge(url: String, token: Option<String>, rx: broadcast::Receiver<SensoryEvent>) {
    run_bridge_with_timing(url, token, rx, BridgeTiming::default()).await;
}

async fn run_bridge_with_timing(
    url: String,
    token: Option<String>,
    mut rx: broadcast::Receiver<SensoryEvent>,
    timing: BridgeTiming,
) {
    loop {
        // Once producers stop, do not reconnect forever to deliver a stale backlog.
        if rx.is_closed() {
            return;
        }
        match timeout(timing.connect, tokio_tungstenite::connect_async(&url)).await {
            Ok(Ok((mut ws, _))) => {
                eprintln!("[buddy-sense] bridge connected → {url}");
                let mut keepalive = tokio::time::interval(timing.ping);
                keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                let mut waiting_for_pong = false;
                let mut pong_deadline = Instant::now();
                loop {
                    tokio::select! {
                        msg = rx.recv() => match msg {
                            Ok(ev) => {
                                if let Some(text) = frame_json(&ev, token.as_deref()) {
                                    if !matches!(timeout(timing.write, ws.send(Message::Text(text))).await, Ok(Ok(()))) {
                                        break;
                                    }
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                eprintln!("[buddy-sense] bridge lagged, dropped {n} events");
                            }
                            Err(broadcast::error::RecvError::Closed) => return,
                        },
                        _ = keepalive.tick(), if !waiting_for_pong => {
                            if !matches!(timeout(timing.write, ws.send(Message::Ping(Vec::new()))).await, Ok(Ok(()))) {
                                break;
                            }
                            waiting_for_pong = true;
                            pong_deadline = Instant::now() + timing.pong;
                        }
                        _ = tokio::time::sleep_until(pong_deadline), if waiting_for_pong => {
                            eprintln!("[buddy-sense] bridge pong timed out; reconnecting");
                            break;
                        }
                        // Poll reads so tungstenite handles control frames and peer closure.
                        incoming = ws.next() => match incoming {
                            Some(Ok(Message::Close(_))) | None => break,
                            Some(Ok(Message::Pong(payload))) if payload.is_empty() => {
                                waiting_for_pong = false;
                            }
                            Some(Ok(_)) => {}
                            Some(Err(_)) => break,
                        }
                    }
                }
            }
            Ok(Err(e)) => eprintln!("[buddy-sense] bridge connect failed: {e}; retrying"),
            Err(_) => eprintln!("[buddy-sense] bridge handshake timed out; retrying"),
        }
        if rx.is_closed() {
            return;
        }
        tokio::time::sleep(timing.retry).await;
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

    fn fast_timing() -> BridgeTiming {
        BridgeTiming {
            connect: Duration::from_millis(100),
            write: Duration::from_millis(50),
            retry: Duration::from_millis(10),
            ping: Duration::from_millis(20),
            pong: Duration::from_millis(80),
        }
    }

    #[tokio::test]
    async fn closed_producers_do_not_start_a_connection_even_with_buffered_events() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (tx, rx) = broadcast::channel(8);
        tx.send(ev()).unwrap();
        drop(tx);
        timeout(
            Duration::from_secs(1),
            run_bridge_with_timing(
                format!("ws://{}", listener.local_addr().unwrap()),
                None,
                rx,
                fast_timing(),
            ),
        )
        .await
        .expect("closed source must stop even with a backlog");
        assert!(timeout(Duration::from_millis(30), listener.accept())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn stalled_handshake_retries_and_then_stops_after_producers_close() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (tx, rx) = broadcast::channel(8);
        let task = tokio::spawn(run_bridge_with_timing(
            format!("ws://{}", listener.local_addr().unwrap()),
            None,
            rx,
            fast_timing(),
        ));
        // Hold TCP open without ever completing the WebSocket upgrade.
        let _first = timeout(Duration::from_secs(1), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let _retry = timeout(Duration::from_secs(1), listener.accept())
            .await
            .expect("handshake must have a deadline")
            .unwrap();
        drop(tx);
        timeout(Duration::from_secs(1), task)
            .await
            .expect("offline bridge must stop when its producers close")
            .unwrap();
    }

    #[tokio::test]
    async fn silent_websocket_peer_is_reconnected_without_sensor_traffic() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (_tx, rx) = broadcast::channel(8);
        let task = tokio::spawn(run_bridge_with_timing(
            format!("ws://{}", listener.local_addr().unwrap()),
            None,
            rx,
            fast_timing(),
        ));
        let (sock, _) = timeout(Duration::from_secs(1), listener.accept())
            .await
            .unwrap()
            .unwrap();
        // Complete the handshake but do not poll reads: no automatic pong.
        let _silent_peer = tokio_tungstenite::accept_async(sock).await.unwrap();
        timeout(Duration::from_secs(1), listener.accept())
            .await
            .expect("a silent half-open peer must not keep the bridge forever")
            .unwrap();
        task.abort();
        let _ = task.await;
    }

    #[tokio::test]
    async fn responsive_peer_stays_connected_and_closed_source_stops_bridge() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (tx, rx) = broadcast::channel(8);
        let task = tokio::spawn(run_bridge_with_timing(
            format!("ws://{}", listener.local_addr().unwrap()),
            None,
            rx,
            fast_timing(),
        ));
        let (sock, _) = timeout(Duration::from_secs(1), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut peer = tokio_tungstenite::accept_async(sock).await.unwrap();
        timeout(Duration::from_secs(1), async {
            for _ in 0..8 {
                assert!(matches!(
                    peer.next().await.unwrap().unwrap(),
                    Message::Ping(_)
                ));
                // Flush tungstenite's automatically queued pong.
                peer.flush().await.unwrap();
            }
        })
        .await
        .unwrap();
        assert!(timeout(Duration::from_millis(10), listener.accept())
            .await
            .is_err());
        drop(tx);
        timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn backpressured_write_has_a_deadline() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (tx, rx) = broadcast::channel(8);
        let mut timing = fast_timing();
        // Keep the pong watchdog outside the assertion deadline to isolate write timeout.
        timing.pong = Duration::from_secs(10);
        let task = tokio::spawn(run_bridge_with_timing(
            format!("ws://{}", listener.local_addr().unwrap()),
            None,
            rx,
            timing,
        ));
        let (sock, _) = timeout(Duration::from_secs(1), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let _peer = tokio_tungstenite::accept_async(sock).await.unwrap();
        let mut large = ev();
        large.payload = serde_json::json!({"data": "x".repeat(16 * 1024 * 1024)});
        tx.send(large).unwrap();
        timeout(Duration::from_secs(3), listener.accept())
            .await
            .expect("a peer that stops reading must not block event writes forever")
            .unwrap();
        task.abort();
        let _ = task.await;
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

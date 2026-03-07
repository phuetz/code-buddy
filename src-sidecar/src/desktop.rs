//! Desktop Automation via enigo + arboard
//!
//! Cross-platform clipboard and keyboard simulation.
//! Ported from VoiceCommander's auto_paste pattern.

use serde::Deserialize;

#[derive(Deserialize)]
struct PasteParams {
    text: String,
    /// "clipboard" (Ctrl+V), "type" (key simulation), or "none" (clipboard only)
    method: Option<String>,
    /// Press Enter after pasting
    auto_submit: Option<bool>,
}

#[derive(Deserialize)]
struct TypeTextParams {
    text: String,
}

#[derive(Deserialize)]
struct KeyPressParams {
    key: String,
    modifiers: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct ClipboardSetParams {
    text: String,
}

/// Paste text using clipboard + Ctrl+V or type simulation
pub fn paste(params: &serde_json::Value) -> Result<serde_json::Value, String> {
    let p: PasteParams =
        serde_json::from_value(params.clone()).map_err(|e| format!("Invalid params: {}", e))?;

    let method = p.method.as_deref().unwrap_or("clipboard");

    // Set clipboard
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    clipboard
        .set_text(&p.text)
        .map_err(|e| format!("Failed to set clipboard: {}", e))?;

    if method == "none" {
        return Ok(serde_json::json!({"pasted": false, "clipboard": true}));
    }

    // Small delay to let focus settle
    std::thread::sleep(std::time::Duration::from_millis(100));

    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Enigo error: {}", e))?;

    if method == "type" {
        enigo
            .text(&p.text)
            .map_err(|e| format!("Type error: {}", e))?;
    } else {
        // Ctrl+V paste
        enigo
            .key(Key::Control, Direction::Press)
            .map_err(|e| format!("Key error: {}", e))?;
        enigo
            .key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| format!("Key error: {}", e))?;
        enigo
            .key(Key::Control, Direction::Release)
            .map_err(|e| format!("Key error: {}", e))?;
    }

    if p.auto_submit.unwrap_or(false) {
        std::thread::sleep(std::time::Duration::from_millis(50));
        enigo
            .key(Key::Return, Direction::Click)
            .map_err(|e| format!("Key error: {}", e))?;
    }

    Ok(serde_json::json!({"pasted": true, "method": method}))
}

/// Type text directly via key simulation
pub fn type_text(params: &serde_json::Value) -> Result<serde_json::Value, String> {
    let p: TypeTextParams =
        serde_json::from_value(params.clone()).map_err(|e| format!("Invalid params: {}", e))?;

    use enigo::{Enigo, Keyboard, Settings};
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Enigo error: {}", e))?;

    enigo
        .text(&p.text)
        .map_err(|e| format!("Type error: {}", e))?;

    Ok(serde_json::json!({"typed": true, "length": p.text.len()}))
}

/// Press a key combination
pub fn key_press(params: &serde_json::Value) -> Result<serde_json::Value, String> {
    let p: KeyPressParams =
        serde_json::from_value(params.clone()).map_err(|e| format!("Invalid params: {}", e))?;

    use enigo::{Direction, Enigo, Keyboard, Settings};
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Enigo error: {}", e))?;

    // Press modifiers
    let modifiers = p.modifiers.unwrap_or_default();
    for m in &modifiers {
        let key = parse_modifier(m)?;
        enigo
            .key(key, Direction::Press)
            .map_err(|e| format!("Key error: {}", e))?;
    }

    // Press main key
    let main_key = parse_key(&p.key)?;
    enigo
        .key(main_key, Direction::Click)
        .map_err(|e| format!("Key error: {}", e))?;

    // Release modifiers (reverse order)
    for m in modifiers.iter().rev() {
        let key = parse_modifier(m)?;
        enigo
            .key(key, Direction::Release)
            .map_err(|e| format!("Key error: {}", e))?;
    }

    Ok(serde_json::json!({"pressed": true, "key": p.key}))
}

/// Get clipboard content
pub fn clipboard_get() -> Result<serde_json::Value, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    let text = clipboard
        .get_text()
        .map_err(|e| format!("Failed to get clipboard: {}", e))?;
    Ok(serde_json::json!({"text": text}))
}

/// Set clipboard content
pub fn clipboard_set(params: &serde_json::Value) -> Result<serde_json::Value, String> {
    let p: ClipboardSetParams =
        serde_json::from_value(params.clone()).map_err(|e| format!("Invalid params: {}", e))?;
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    clipboard
        .set_text(&p.text)
        .map_err(|e| format!("Failed to set clipboard: {}", e))?;
    Ok(serde_json::json!({"set": true}))
}

fn parse_modifier(name: &str) -> Result<enigo::Key, String> {
    match name.to_lowercase().as_str() {
        "ctrl" | "control" => Ok(enigo::Key::Control),
        "shift" => Ok(enigo::Key::Shift),
        "alt" => Ok(enigo::Key::Alt),
        "meta" | "win" | "super" | "cmd" => Ok(enigo::Key::Meta),
        _ => Err(format!("Unknown modifier: {}", name)),
    }
}

fn parse_key(name: &str) -> Result<enigo::Key, String> {
    match name.to_lowercase().as_str() {
        "enter" | "return" => Ok(enigo::Key::Return),
        "tab" => Ok(enigo::Key::Tab),
        "escape" | "esc" => Ok(enigo::Key::Escape),
        "backspace" => Ok(enigo::Key::Backspace),
        "delete" => Ok(enigo::Key::Delete),
        "space" => Ok(enigo::Key::Space),
        "up" => Ok(enigo::Key::UpArrow),
        "down" => Ok(enigo::Key::DownArrow),
        "left" => Ok(enigo::Key::LeftArrow),
        "right" => Ok(enigo::Key::RightArrow),
        "home" => Ok(enigo::Key::Home),
        "end" => Ok(enigo::Key::End),
        "pageup" => Ok(enigo::Key::PageUp),
        "pagedown" => Ok(enigo::Key::PageDown),
        s if s.len() == 1 => Ok(enigo::Key::Unicode(s.chars().next().unwrap())),
        _ => Err(format!("Unknown key: {}", name)),
    }
}

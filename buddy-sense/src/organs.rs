//! Organ registry — which senses ("organs") the nervous system runs, chosen at RUNTIME.
//!
//! The heavy senses (vision/screen/ui/mic) are compile-time features, so `available` reflects what
//! this binary was BUILT with. On top of that, `BUDDY_SENSE_ORGANS` (csv) lets the operator pick
//! which of the compiled organs actually spawn — so you can run a subset in parallel without
//! recompiling, and the default (unset) runs every compiled organ. The heartbeat (`Vital`) is
//! autonomic and always runs when available, even if not listed.
//!
//! Pure + deterministic (`resolve_organs`) so it's unit-tested with no runtime/hardware.

use std::collections::HashSet;

/// A spawnable sense.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Organ {
    /// The autonomic heartbeat — always on when available.
    Vital,
    /// Screen-change detection (feature `live-screen`).
    Screen,
    /// Camera motion / the eyes (feature `live-vision`).
    Vision,
    /// AT-SPI focus / the semantic UI sense (feature `live-ui`).
    Ui,
    /// Live microphone / the ears (feature `live-audio`).
    LiveAudio,
}

impl Organ {
    /// Canonical name (for logging + the digest).
    pub fn as_str(self) -> &'static str {
        match self {
            Organ::Vital => "vital",
            Organ::Screen => "screen",
            Organ::Vision => "vision",
            Organ::Ui => "ui",
            Organ::LiveAudio => "audio",
        }
    }

    /// Parse one csv token → an organ, tolerating common aliases. Unknown → None (ignored).
    pub fn from_token(tok: &str) -> Option<Organ> {
        match tok.trim().to_ascii_lowercase().as_str() {
            "vital" | "heartbeat" | "heart" => Some(Organ::Vital),
            "screen" => Some(Organ::Screen),
            "vision" | "camera" | "video" | "eyes" => Some(Organ::Vision),
            "ui" | "atspi" | "focus" => Some(Organ::Ui),
            "audio" | "mic" | "microphone" | "ears" | "live-audio" => Some(Organ::LiveAudio),
            _ => None,
        }
    }
}

/// Decide which of the compiled-in `available` organs to actually spawn.
///
/// - `env` unset / empty / all-garbage → run every available organ (the default).
/// - `env` a csv of names → run the intersection with `available` (unknown names ignored),
///   PLUS `Vital` always (the heartbeat is autonomic and never silenced).
///
/// Order follows `available` (stable, so logging is deterministic).
pub fn resolve_organs(available: &[Organ], env: Option<&str>) -> Vec<Organ> {
    let requested: Option<HashSet<Organ>> = env.and_then(|s| {
        let set: HashSet<Organ> = s.split(',').filter_map(Organ::from_token).collect();
        // An empty/garbage selection is treated as "no selection" → run everything, rather than
        // silently going dark (a misconfigured env must not kill the whole nervous system).
        if set.is_empty() {
            None
        } else {
            Some(set)
        }
    });

    available
        .iter()
        .copied()
        .filter(|o| {
            if *o == Organ::Vital {
                return true; // autonomic — never silenced
            }
            match &requested {
                Some(set) => set.contains(o),
                None => true,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: &[Organ] = &[
        Organ::Vital,
        Organ::Screen,
        Organ::Vision,
        Organ::Ui,
        Organ::LiveAudio,
    ];

    #[test]
    fn unset_env_runs_every_available_organ() {
        assert_eq!(resolve_organs(ALL, None), ALL.to_vec());
    }

    #[test]
    fn empty_or_garbage_env_falls_back_to_all() {
        assert_eq!(resolve_organs(ALL, Some("")), ALL.to_vec());
        assert_eq!(resolve_organs(ALL, Some("   ")), ALL.to_vec());
        assert_eq!(resolve_organs(ALL, Some("nonsense,foo")), ALL.to_vec());
    }

    #[test]
    fn a_selection_runs_only_the_requested_plus_vital() {
        // "vision,audio" → vision + audio, and vital is kept even though not listed.
        assert_eq!(
            resolve_organs(ALL, Some("vision,audio")),
            vec![Organ::Vital, Organ::Vision, Organ::LiveAudio],
        );
    }

    #[test]
    fn aliases_and_whitespace_and_case_are_tolerated() {
        assert_eq!(
            resolve_organs(ALL, Some(" Camera , MIC ")),
            vec![Organ::Vital, Organ::Vision, Organ::LiveAudio],
        );
    }

    #[test]
    fn unknown_tokens_are_ignored_but_valid_ones_still_apply() {
        assert_eq!(
            resolve_organs(ALL, Some("screen,bogus")),
            vec![Organ::Vital, Organ::Screen]
        );
    }

    #[test]
    fn only_intersects_what_is_actually_available() {
        // Binary built with just the heartbeat: asking for vision yields only vital.
        assert_eq!(
            resolve_organs(&[Organ::Vital], Some("vision")),
            vec![Organ::Vital]
        );
    }

    #[test]
    fn vital_alone_can_be_requested() {
        assert_eq!(resolve_organs(ALL, Some("vital")), vec![Organ::Vital]);
    }
}

//! Senses — parallel perception sources. Each emits SensoryEvents into the
//! thalamus over a bounded channel. Audio, the autonomic vital heartbeat, and
//! video motion detection ship; live capture is opt-in per sense.

pub mod audio;
#[cfg(feature = "live-audio")]
pub mod live_audio;
pub mod screen;
#[cfg(feature = "stt")]
pub mod stt;
pub mod ui;
pub mod video;
pub mod vital;

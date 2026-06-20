//! Senses — parallel perception sources. Each emits SensoryEvents into the
//! thalamus over a bounded channel. Audio, the autonomic vital heartbeat, and
//! video motion detection ship; live capture is opt-in per sense.

pub mod audio;
pub mod video;
pub mod vital;

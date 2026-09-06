# Conversation voice cues

These PCM16 WAV files are generated once with local Pocket TTS and committed as
runtime assets. The hot path only reads them; it never invokes TTS or a model.

- `mhm.wav` — short backchannel; runtime playback applies −12 dB.
- `oui.wav` — alternate short backchannel; runtime playback applies −12 dB.
- `repair.wav` — neutral repair prompt: « Pardon, tu disais ? ».

The repository intentionally stores no user name or voice-cloning sample here.

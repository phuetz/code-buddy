//! Immutable capabilities for the KevinAHM `french_24l` Pocket TTS INT8 bundle.
//!
//! Ported from `buzz-voice` `pocket_models.rs` (Apache-2.0, Block).

/// Pinned upstream export repository.
pub const FRENCH_24L_MODEL_ID: &str = "KevinAHM/pocket-tts-onnx";

/// Pinned revision containing the multilingual v2 bundles.
pub const FRENCH_24L_MODEL_REVISION: &str = "58a6d00cf13d239b6748cb0769f35c580a8f606c";

/// Language bundle selected from the pinned export.
pub const FRENCH_24L_BUNDLE_ID: &str = "french_24l";

/// Maximum input size declared by the French bundle.
pub const FRENCH_24L_MAX_TOKEN_PER_CHUNK: usize = 50;

/// One immutable artifact required by the INT8 runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PocketModelArtifact {
    pub filename: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
    pub quantized: bool,
}

/// Capabilities of the selected Pocket model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PocketModelInfo {
    pub bundle_id: &'static str,
    pub source_model_id: &'static str,
    pub revision: &'static str,
    pub sample_rate: u32,
    pub max_token_per_chunk: usize,
    pub artifacts: &'static [PocketModelArtifact],
    pub quantized_components: &'static [&'static str],
}

const INT8_ARTIFACTS: [PocketModelArtifact; 8] = [
    PocketModelArtifact {
        filename: "bundle.json",
        sha256: "8a5fe6c59985e3ccb5a6ccb1ffb2e84ac08488c5bfa704053618851436741427",
        size_bytes: 42_235,
        quantized: false,
    },
    PocketModelArtifact {
        filename: "bos_before_voice.npy",
        sha256: "5759269802d691d49481b8e06d6a5649da85ea01135e270bd7641e3b091c7237",
        size_bytes: 4_224,
        quantized: false,
    },
    PocketModelArtifact {
        filename: "tokenizer.model",
        sha256: "521c85bdb2da10618f4be52021ed1cb2a7a6299b040708487f133193f7b305e2",
        size_bytes: 60_173,
        quantized: false,
    },
    PocketModelArtifact {
        filename: "flow_lm_main_int8.onnx",
        sha256: "6130a6b98fae175147d82752263e250fb7b8483c1ef5373753ad335c16f4a129",
        size_bytes: 305_144_125,
        quantized: true,
    },
    PocketModelArtifact {
        filename: "flow_lm_flow_int8.onnx",
        sha256: "d340c549d5a1e0e7b88a0fb26fcae53c3b76486872f4418398a395bb1bc88701",
        size_bytes: 9_962_530,
        quantized: true,
    },
    PocketModelArtifact {
        filename: "mimi_decoder_int8.onnx",
        sha256: "b329ff3de3aa95455d2dee1cf371943dec269dd8711008017501ca129cb18d8c",
        size_bytes: 22_684_077,
        quantized: true,
    },
    PocketModelArtifact {
        filename: "mimi_encoder.onnx",
        sha256: "790a82fb8041e1035ec8097c6a277c834664a1f6619397d62f3bb46f71d2bfd4",
        size_bytes: 39_768_446,
        quantized: false,
    },
    PocketModelArtifact {
        filename: "text_conditioner.onnx",
        sha256: "89d1b6ac55e618e42d2bd840438ce918bffb14960475ef091847ca39be641e65",
        size_bytes: 16_388_344,
        quantized: false,
    },
];

const INT8_COMPONENTS: [&str; 3] = ["flow_lm_main", "flow_lm_flow", "mimi_decoder"];

/// Return immutable metadata for the French INT8 model.
pub const fn french_24l_model_info() -> PocketModelInfo {
    PocketModelInfo {
        bundle_id: FRENCH_24L_BUNDLE_ID,
        source_model_id: FRENCH_24L_MODEL_ID,
        revision: FRENCH_24L_MODEL_REVISION,
        sample_rate: 24_000,
        max_token_per_chunk: FRENCH_24L_MAX_TOKEN_PER_CHUNK,
        artifacts: &INT8_ARTIFACTS,
        quantized_components: &INT8_COMPONENTS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_matches_downloaded_int8_layout() {
        let info = french_24l_model_info();
        assert_eq!(info.artifacts.len(), 8);
        assert_eq!(
            info.quantized_components,
            ["flow_lm_main", "flow_lm_flow", "mimi_decoder"]
        );
        assert_eq!(
            info.artifacts
                .iter()
                .map(|artifact| artifact.size_bytes)
                .sum::<u64>(),
            394_054_154
        );
        assert!(info
            .artifacts
            .iter()
            .any(|artifact| { artifact.filename == "mimi_encoder.onnx" && !artifact.quantized }));
        assert!(!info
            .artifacts
            .iter()
            .any(|artifact| artifact.filename == "mimi_encoder_int8.onnx"));
    }
}

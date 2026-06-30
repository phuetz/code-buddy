//! ONNX sentence-embedder (feature `embeddings`). A persistent embedder loaded ONCE and reused
//! per query — multilingual MiniLM by default. The inference logic (tokenize → tensors → mean-pool
//! → L2-normalize, with optional token_type_ids) mirrors Code Explorer's proven OnnxEmbedder
//! (PolyForm, same suite). Without this feature the engine does keyword recall only.

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;
use std::path::{Path, PathBuf};
use tokenizers::Tokenizer;

const INPUT_IDS: &str = "input_ids";
const ATTENTION_MASK: &str = "attention_mask";
const TOKEN_TYPE_IDS: &str = "token_type_ids";

pub struct Embedder {
    session: Session,
    tokenizer: Tokenizer,
    max_len: usize,
    needs_token_type_ids: bool,
}

impl Embedder {
    /// Load from a model path; tokenizer.json is resolved next to it unless given. `_dims` is the
    /// expected output dim (informational; pooling adapts to the actual model output rank).
    pub fn load(model_path: &Path, _dims: usize, max_len: usize, needs_token_type_ids: bool) -> Result<Self, String> {
        let tok_path = resolve_tokenizer_path(model_path);
        let session = Session::builder()
            .map_err(|e| e.to_string())?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| e.to_string())?
            .commit_from_file(model_path)
            .map_err(|e| e.to_string())?;
        let tokenizer = Tokenizer::from_file(&tok_path).map_err(|e| format!("tokenizer load failed: {e}"))?;
        Ok(Self { session, tokenizer, max_len, needs_token_type_ids })
    }

    pub fn embed(&mut self, texts: &[&str]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let encodings = self
            .tokenizer
            .encode_batch(texts.iter().map(|s| (*s).to_string()).collect::<Vec<_>>(), true)
            .map_err(|e| format!("tokenize failed: {e}"))?;
        let batch_size = encodings.len();
        let batch_max_len = encodings
            .iter()
            .map(|e| e.get_ids().len().min(self.max_len))
            .max()
            .unwrap_or(0)
            .max(1);
        let total = batch_size * batch_max_len;
        let mut input_ids = vec![0i64; total];
        let mut attention = vec![0i64; total];
        for (row, enc) in encodings.iter().enumerate() {
            let ids = enc.get_ids();
            let mask = enc.get_attention_mask();
            let len = ids.len().min(batch_max_len);
            let off = row * batch_max_len;
            for col in 0..len {
                input_ids[off + col] = ids[col] as i64;
                attention[off + col] = mask[col] as i64;
            }
        }
        let shape: [i64; 2] = [batch_size as i64, batch_max_len as i64];
        let attention_for_pooling = attention.clone();
        let input_ids_tensor = Tensor::from_array((shape, input_ids)).map_err(|e| e.to_string())?;
        let attention_tensor = Tensor::from_array((shape, attention)).map_err(|e| e.to_string())?;

        let outputs = if self.needs_token_type_ids {
            let tt = Tensor::from_array((shape, vec![0i64; total])).map_err(|e| e.to_string())?;
            self.session
                .run(ort::inputs![INPUT_IDS => input_ids_tensor, ATTENTION_MASK => attention_tensor, TOKEN_TYPE_IDS => tt])
                .map_err(|e| e.to_string())?
        } else {
            self.session
                .run(ort::inputs![INPUT_IDS => input_ids_tensor, ATTENTION_MASK => attention_tensor])
                .map_err(|e| e.to_string())?
        };

        let (_, first) = outputs.iter().next().ok_or("ONNX session returned no outputs")?;
        let tensor = first.try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
        let out_shape: Vec<usize> = tensor.0.iter().map(|&d| d as usize).collect();
        let data: &[f32] = tensor.1;

        match out_shape.len() {
            2 => {
                let dim = out_shape[1];
                let mut result = Vec::with_capacity(out_shape[0]);
                for b in 0..out_shape[0] {
                    let start = b * dim;
                    let mut v = data[start..start + dim].to_vec();
                    normalize_in_place(&mut v);
                    result.push(v);
                }
                Ok(result)
            }
            3 => {
                let (bsz, seq, dim) = (out_shape[0], out_shape[1], out_shape[2]);
                let mut result = Vec::with_capacity(bsz);
                for b in 0..bsz {
                    let mut pooled = vec![0.0f32; dim];
                    let mut denom = 0.0f32;
                    for t in 0..seq {
                        let m = if t < batch_max_len {
                            attention_for_pooling[b * batch_max_len + t.min(batch_max_len - 1)] as f32
                        } else {
                            0.0
                        };
                        if m > 0.0 {
                            denom += m;
                            let token_off = (b * seq + t) * dim;
                            for d in 0..dim {
                                pooled[d] += data[token_off + d] * m;
                            }
                        }
                    }
                    if denom > 0.0 {
                        for v in pooled.iter_mut() {
                            *v /= denom;
                        }
                    }
                    normalize_in_place(&mut pooled);
                    result.push(pooled);
                }
                Ok(result)
            }
            other => Err(format!("unexpected ONNX output rank {} (shape {:?})", other, out_shape)),
        }
    }
}

fn resolve_tokenizer_path(model_path: &Path) -> PathBuf {
    model_path.parent().map(|p| p.join("tokenizer.json")).unwrap_or_else(|| PathBuf::from("tokenizer.json"))
}

fn normalize_in_place(v: &mut [f32]) {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    dot.max(0.0) // vectors are L2-normalized, so dot == cosine
}

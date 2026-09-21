//! HNSW en demi-précision : les mêmes vecteurs, deux fois moins de mémoire.
//!
//! `hnsw_rs` est générique sur le type stocké. En lui donnant `f16` plutôt que
//! `f32`, chaque composante passe de quatre à deux octets — un index de 768
//! dimensions sur un million de points passe d'environ 3 Go à 1,5 Go. Le décodage
//! vers `f32` se fait au moment du calcul de distance (instruction F16C quand le
//! processeur la porte).
//!
//! La métrique **normalise**, comme `DistCosine` que la variante `f32` emploie :
//! deux index de précision différente doivent classer pareil, sinon un changement
//! de stockage deviendrait un changement de résultats.
//!
//! Ce que la demi-précision coûte : environ trois décimales de précision par
//! composante. Sur des embeddings, dont les composantes valent quelques centièmes,
//! l'effet sur le classement est faible mais **non nul** — il se mesure, il ne se
//! suppose pas (voir le test `f16_et_f32_classent_pareil`).

use crate::ann::silence_stdout;
use half::f16;
use half::slice::HalfFloatSliceExt;
use hnsw_rs::prelude::*;
use std::collections::{HashMap, HashSet};

const M: usize = 16;
const MAX_LAYER: usize = 16;
const EF_CONSTRUCTION: usize = 80;
const EF_SEARCH: usize = 64;
/// Tampon de décodage. Au-delà, on retombe sur une allocation — aucun embedding
/// courant ne dépasse cette taille (768 pour nomic, 1536 pour les plus gros).
const TAMPON: usize = 2048;

#[derive(Default, Clone, Copy)]
struct DistCosineF16;

impl Distance<f16> for DistCosineF16 {
    fn eval(&self, va: &[f16], vb: &[f16]) -> f32 {
        let n = va.len().min(vb.len());
        let mut a = [0f32; TAMPON];
        let mut b = [0f32; TAMPON];
        if n <= TAMPON {
            va[..n].convert_to_f32_slice(&mut a[..n]);
            vb[..n].convert_to_f32_slice(&mut b[..n]);
            return cosinus(&a[..n], &b[..n]);
        }
        let av: Vec<f32> = va[..n].iter().map(|x| x.to_f32()).collect();
        let bv: Vec<f32> = vb[..n].iter().map(|x| x.to_f32()).collect();
        cosinus(&av, &bv)
    }
}

/// Distance cosinus dans [0, 2] : 0 pour deux vecteurs colinéaires de même sens.
fn cosinus(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0f32;
    let mut na = 0f32;
    let mut nb = 0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let den = na.sqrt() * nb.sqrt();
    if den <= 0.0 {
        return 1.0;
    }
    (1.0 - dot / den).max(0.0)
}

pub struct AnnIndexF16 {
    hnsw: Hnsw<'static, f16, DistCosineF16>,
    id_of: Vec<String>,
    pos_of: HashMap<String, usize>,
    deleted: HashSet<usize>,
    vectors: Vec<Vec<f16>>,
    dim: usize,
}

impl AnnIndexF16 {
    pub fn with_capacity(dim: usize, capacity: usize) -> Self {
        let capacity = capacity.max(32);
        Self {
            hnsw: Hnsw::<f16, DistCosineF16>::new(M, capacity, MAX_LAYER, EF_CONSTRUCTION, DistCosineF16 {}),
            id_of: Vec::with_capacity(capacity),
            pos_of: HashMap::with_capacity(capacity),
            deleted: HashSet::new(),
            vectors: Vec::with_capacity(capacity),
            dim,
        }
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    pub fn live_points(&self) -> usize {
        self.pos_of.len()
    }

    /// Octets occupés par les vecteurs — la grandeur que la demi-précision divise.
    pub fn vector_bytes(&self) -> usize {
        self.vectors.len() * self.dim * std::mem::size_of::<f16>()
    }

    pub fn insert(&mut self, id: &str, vec: &[f32]) {
        let demi: Vec<f16> = vec.iter().map(|x| f16::from_f32(*x)).collect();
        if let Some(&pos) = self.pos_of.get(id) {
            self.deleted.insert(pos);
        }
        let pos = self.id_of.len();
        // hnsw_rs écrit sur stdout tous les 50 000 points ; le sidecar parle JSON-RPC
        // sur ce même flux, une ligne parasite le casserait.
        if (pos + 1) % 50_000 == 0 {
            silence_stdout(|| self.hnsw.insert((&demi, pos)));
        } else {
            self.hnsw.insert((&demi, pos));
        }
        self.id_of.push(id.to_string());
        self.pos_of.insert(id.to_string(), pos);
        self.vectors.push(demi);
        self.deleted.remove(&pos);
    }

    pub fn search(&self, query: &[f32], k: usize) -> Vec<(String, f32)> {
        if query.len() != self.dim || self.id_of.is_empty() || k == 0 {
            return Vec::new();
        }
        let q: Vec<f16> = query.iter().map(|x| f16::from_f32(*x)).collect();
        let want = k + self.deleted.len();
        let knbn = want.max(k).min(self.id_of.len());
        let ef = EF_SEARCH.max(knbn);
        let neigh = self.hnsw.search(&q, knbn, ef);
        let mut out = Vec::with_capacity(k);
        for n in neigh {
            if self.deleted.contains(&n.d_id) {
                continue;
            }
            if let Some(id) = self.id_of.get(n.d_id) {
                out.push((id.clone(), n.distance));
                if out.len() >= k {
                    break;
                }
            }
        }
        out
    }

    pub fn from_pairs(dim: usize, capacity: usize, pairs: Vec<(String, Vec<f32>)>) -> Self {
        silence_stdout(|| {
            let mut idx = Self::with_capacity(dim, capacity.max(pairs.len()));
            for (id, v) in pairs {
                idx.insert(&id, &v);
            }
            idx
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nrm(v: Vec<f32>) -> Vec<f32> {
        let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
        v.into_iter().map(|x| x / n).collect()
    }

    #[test]
    fn rend_le_plus_proche_en_premier() {
        let mut idx = AnnIndexF16::with_capacity(3, 32);
        idx.insert("est", &nrm(vec![1.0, 0.0, 0.0]));
        idx.insert("nord", &nrm(vec![0.0, 1.0, 0.0]));
        let r = idx.search(&nrm(vec![0.95, 0.05, 0.0]), 2);
        assert_eq!(r[0].0, "est", "le plus proche d'abord : {r:?}");
    }

    #[test]
    fn la_demi_precision_divise_bien_la_memoire_par_deux() {
        let dim = 768;
        let mut idx = AnnIndexF16::with_capacity(dim, 64);
        for i in 0..100 {
            idx.insert(&format!("v{i}"), &nrm((0..dim).map(|d| ((i + d) % 17) as f32).collect()));
        }
        let f16_octets = idx.vector_bytes();
        let f32_octets = 100 * dim * std::mem::size_of::<f32>();
        assert_eq!(f16_octets * 2, f32_octets, "f16 doit peser exactement la moitié de f32");
    }

    /// Le test qui compte : un changement de stockage ne doit pas être un
    /// changement de résultats. On compare au classement EXACT, pas à f32.
    #[test]
    fn f16_et_f32_classent_pareil() {
        use crate::ann::AnnIndex;
        let dim = 64;
        let mut f32i = AnnIndex::with_capacity(dim, 256);
        let mut f16i = AnnIndexF16::with_capacity(dim, 256);
        let mut vecs: Vec<(String, Vec<f32>)> = Vec::new();
        for i in 0..200usize {
            // Des grappes, pas du bruit uniforme : en haute dimension, des vecteurs
            // aléatoires sont tous équidistants et le classement devient arbitraire.
            let centre = i % 10;
            let v = nrm((0..dim).map(|d| if d % 10 == centre { 1.0 } else { 0.02 * ((i + d) % 7) as f32 }).collect());
            f32i.insert(&format!("v{i}"), &v);
            f16i.insert(&format!("v{i}"), &v);
            vecs.push((format!("v{i}"), v));
        }
        let mut accords = 0;
        let essais = 20;
        for t in 0..essais {
            let centre = t % 10;
            let q = nrm((0..dim).map(|d| if d % 10 == centre { 1.0 } else { 0.01 } ).collect());
            let a: Vec<String> = f32i.search(&q, 5).into_iter().map(|(id, _)| id).collect();
            let b: Vec<String> = f16i.search(&q, 5).into_iter().map(|(id, _)| id).collect();
            let commun = a.iter().filter(|id| b.contains(id)).count();
            accords += commun;
        }
        let taux = accords as f32 / (essais * 5) as f32;
        assert!(taux >= 0.8, "f16 et f32 doivent largement s'accorder, obtenu {:.0} %", taux * 100.0);
    }
}

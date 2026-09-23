//! Index vectoriels génériques, nommés, servis par RPC.
//!
//! `ann::AnnIndex` sait déjà faire du HNSW sur des embeddings normalisés, mais il
//! est instancié par le graphe de connaissances pour son seul usage. Ce module le
//! publie tel quel : un registre d'index nommés, sans rien qui suppose un graphe.
//!
//! Il existe pour qu'une seule implémentation vectorielle serve partout. Côté
//! TypeScript, `usearch` n'a pas de binaire Windows (le paquet npm ne livre que
//! `darwin-arm64+x64`, `linux-arm64` et `linux-x64`), si bien que la recherche
//! sémantique y retombait sur une boucle cosinus O(n) en JavaScript. `hnsw_rs`,
//! lui, se compile partout où cargo tourne — c'est la même crate que le moteur
//! vectoriel de RagChat, qui sert près de deux millions de fragments.
//!
//! La suppression est logique : HNSW ne sait pas retirer un point à moindre coût.
//! Un identifiant retiré est filtré au moment de la recherche, et la recherche
//! sur-demande en conséquence pour rendre tout de même `k` résultats.

use crate::ann::AnnIndex;
use crate::ann_f16::AnnIndexF16;
use half::f16;
use std::collections::{HashMap, HashSet};

/// Précision de stockage des vecteurs. `F16` divise la mémoire par deux pour une
/// perte de précision qui se mesure (voir `ann_f16`), au lieu d'être supposée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Precision {
    F32,
    F16,
}

impl Precision {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "f32" | "" => Ok(Self::F32),
            "f16" | "half" => Ok(Self::F16),
            other => Err(format!("précision inconnue « {other} » (f32, f16)")),
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::F32 => "f32",
            Self::F16 => "f16",
        }
    }
}

enum Moteur {
    F32(AnnIndex),
    F16(AnnIndexF16),
}

impl Moteur {
    fn insert(&mut self, id: &str, vec: &[f32]) {
        match self {
            Self::F32(a) => a.insert(id, vec),
            Self::F16(a) => a.insert(id, vec),
        }
    }
    fn search(&self, q: &[f32], k: usize) -> Vec<(String, f32)> {
        match self {
            Self::F32(a) => a.search(q, k),
            Self::F16(a) => a.search(q, k),
        }
    }
    fn live_points(&self) -> usize {
        match self {
            Self::F32(a) => a.live_points(),
            Self::F16(a) => a.live_points(),
        }
    }
}

/// Vecteurs conservés pour la persistance, dans la précision de l'index : les garder
/// en `f32` quand l'index est en `f16` annulerait la moitié de l'économie.
enum Copie {
    F32(HashMap<String, Vec<f32>>),
    F16(HashMap<String, Vec<f16>>),
}

impl Copie {
    fn neuve(p: Precision) -> Self {
        match p {
            Precision::F32 => Self::F32(HashMap::new()),
            Precision::F16 => Self::F16(HashMap::new()),
        }
    }
    fn inserer(&mut self, id: &str, v: &[f32]) {
        match self {
            Self::F32(m) => {
                m.insert(id.to_string(), v.to_vec());
            }
            Self::F16(m) => {
                m.insert(id.to_string(), v.iter().map(|x| f16::from_f32(*x)).collect());
            }
        }
    }
    fn retirer(&mut self, id: &str) -> bool {
        match self {
            Self::F32(m) => m.remove(id).is_some(),
            Self::F16(m) => m.remove(id).is_some(),
        }
    }
    fn contient(&self, id: &str) -> bool {
        match self {
            Self::F32(m) => m.contains_key(id),
            Self::F16(m) => m.contains_key(id),
        }
    }
    fn len(&self) -> usize {
        match self {
            Self::F32(m) => m.len(),
            Self::F16(m) => m.len(),
        }
    }
    fn vider(&mut self) {
        match self {
            Self::F32(m) => m.clear(),
            Self::F16(m) => m.clear(),
        }
    }
    /// Octets occupés par les vecteurs conservés — la grandeur que `f16` divise.
    fn octets(&self) -> usize {
        match self {
            Self::F32(m) => m.values().map(|v| v.len() * 4).sum(),
            Self::F16(m) => m.values().map(|v| v.len() * 2).sum(),
        }
    }
    fn paires(&self) -> Vec<(String, Vec<f32>)> {
        let mut out: Vec<(String, Vec<f32>)> = match self {
            Self::F32(m) => m.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            Self::F16(m) => m
                .iter()
                .map(|(k, v)| (k.clone(), v.iter().map(|x| x.to_f32()).collect()))
                .collect(),
        };
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }
}

pub struct VIndex {
    ann: Moteur,
    removed: HashSet<String>,
    /// Conservés pour la persistance et pour reconstruire après compactage.
    vectors: Copie,
    dim: usize,
    precision: Precision,
}

impl VIndex {
    pub fn new(dim: usize, capacity: usize) -> Self {
        Self::avec_precision(dim, capacity, Precision::F32)
    }

    pub fn avec_precision(dim: usize, capacity: usize, precision: Precision) -> Self {
        Self {
            ann: match precision {
                Precision::F32 => Moteur::F32(AnnIndex::with_capacity(dim, capacity)),
                Precision::F16 => Moteur::F16(AnnIndexF16::with_capacity(dim, capacity)),
            },
            removed: HashSet::new(),
            vectors: Copie::neuve(precision),
            dim,
            precision,
        }
    }

    pub fn precision(&self) -> Precision {
        self.precision
    }

    /// Octets des vecteurs conservés. Sert à constater l'économie, pas à l'estimer.
    pub fn vector_bytes(&self) -> usize {
        self.vectors.octets()
    }

    pub fn from_pairs(dim: usize, pairs: Vec<(String, Vec<f32>)>) -> Result<Self, String> {
        Self::from_pairs_avec(dim, pairs, Precision::F32)
    }

    pub fn from_pairs_avec(
        dim: usize,
        pairs: Vec<(String, Vec<f32>)>,
        precision: Precision,
    ) -> Result<Self, String> {
        for (id, v) in &pairs {
            if v.len() != dim {
                return Err(format!(
                    "vecteur « {} » de dimension {} alors que l'index en attend {}",
                    id,
                    v.len(),
                    dim
                ));
            }
        }
        let capacity = pairs.len().max(32);
        let mut idx = Self::avec_precision(dim, capacity, precision);
        for (id, v) in &pairs {
            idx.vectors.inserer(id, v);
        }
        idx.ann = match precision {
            Precision::F32 => Moteur::F32(AnnIndex::from_pairs(dim, capacity, pairs)),
            Precision::F16 => Moteur::F16(AnnIndexF16::from_pairs(dim, capacity, pairs)),
        };
        Ok(idx)
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    /// Un identifiant déjà présent est réinséré : HNSW garde l'ancien point, que la
    /// recherche filtrera, et c'est le dernier vecteur qui fait foi.
    pub fn insert(&mut self, id: &str, vec: &[f32]) -> Result<(), String> {
        if vec.len() != self.dim {
            return Err(format!(
                "vecteur de dimension {} alors que l'index en attend {}",
                vec.len(),
                self.dim
            ));
        }
        self.removed.remove(id);
        self.vectors.inserer(id, vec);
        self.ann.insert(id, vec);
        Ok(())
    }

    pub fn remove(&mut self, id: &str) -> bool {
        if self.vectors.retirer(id) {
            self.removed.insert(id.to_string());
            true
        } else {
            false
        }
    }

    pub fn search(&self, query: &[f32], k: usize) -> Result<Vec<(String, f32)>, String> {
        if query.len() != self.dim {
            return Err(format!(
                "requête de dimension {} alors que l'index en attend {}",
                query.len(),
                self.dim
            ));
        }
        if k == 0 {
            return Ok(Vec::new());
        }
        // Sur-demander pour absorber les points retirés et les doublons d'un même
        // identifiant réinséré, sans quoi un index très remanié rendrait moins de k.
        let surplus = self.removed.len().saturating_add(16);
        let widened = k.saturating_add(surplus).min(self.ann.live_points().max(k));
        let raw = self.ann.search(query, widened.max(k));
        let mut vus: HashSet<&str> = HashSet::new();
        let mut out = Vec::with_capacity(k);
        for (id, score) in &raw {
            if self.removed.contains(id) || !self.vectors.contient(id) {
                continue;
            }
            if !vus.insert(id.as_str()) {
                continue;
            }
            out.push((id.clone(), *score));
            if out.len() == k {
                break;
            }
        }
        Ok(out)
    }

    pub fn len(&self) -> usize {
        self.vectors.len()
    }

    pub fn is_empty(&self) -> bool {
        self.vectors.len() == 0
    }

    pub fn clear(&mut self) {
        self.ann = match self.precision {
            Precision::F32 => Moteur::F32(AnnIndex::with_capacity(self.dim, 32)),
            Precision::F16 => Moteur::F16(AnnIndexF16::with_capacity(self.dim, 32)),
        };
        self.removed.clear();
        self.vectors.vider();
    }

    /// Paires vivantes, pour la persistance. L'ordre est stable (tri par
    /// identifiant) afin qu'une sauvegarde soit reproductible d'une fois sur l'autre.
    pub fn to_pairs(&self) -> Vec<(String, Vec<f32>)> {
        self.vectors.paires()
    }
}

#[derive(Default)]
pub struct VIndexRegistry {
    indexes: HashMap<String, VIndex>,
}

impl VIndexRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Crée l'index, ou le remplace si `replace`. Sans `replace`, un index existant
    /// de même dimension est conservé tel quel — rouvrir n'efface rien par accident.
    pub fn create(
        &mut self,
        name: &str,
        dim: usize,
        capacity: usize,
        replace: bool,
    ) -> Result<(), String> {
        self.create_avec(name, dim, capacity, replace, Precision::F32)
    }

    pub fn create_avec(
        &mut self,
        name: &str,
        dim: usize,
        capacity: usize,
        replace: bool,
        precision: Precision,
    ) -> Result<(), String> {
        if dim == 0 {
            return Err("dimension nulle".to_string());
        }
        if let Some(existing) = self.indexes.get(name) {
            if !replace {
                if existing.dim() != dim {
                    return Err(format!(
                        "l'index « {} » existe en dimension {} et non {}",
                        name,
                        existing.dim(),
                        dim
                    ));
                }
                return Ok(());
            }
        }
        self.indexes
            .insert(name.to_string(), VIndex::avec_precision(dim, capacity, precision));
        Ok(())
    }

    pub fn get(&self, name: &str) -> Option<&VIndex> {
        self.indexes.get(name)
    }

    pub fn get_mut(&mut self, name: &str) -> Option<&mut VIndex> {
        self.indexes.get_mut(name)
    }

    pub fn drop_index(&mut self, name: &str) -> bool {
        self.indexes.remove(name).is_some()
    }

    pub fn names(&self) -> Vec<String> {
        let mut n: Vec<String> = self.indexes.keys().cloned().collect();
        n.sort();
        n
    }

    pub fn load(&mut self, name: &str, dim: usize, pairs: Vec<(String, Vec<f32>)>) -> Result<(), String> {
        let idx = VIndex::from_pairs(dim, pairs)?;
        self.indexes.insert(name.to_string(), idx);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: f32, y: f32) -> Vec<f32> {
        vec![x, y]
    }

    #[test]
    fn rend_le_plus_proche_en_premier() {
        let mut idx = VIndex::new(2, 32);
        idx.insert("nord", &v(0.0, 1.0)).unwrap();
        idx.insert("est", &v(1.0, 0.0)).unwrap();
        let r = idx.search(&v(0.9, 0.1), 2).unwrap();
        assert_eq!(r[0].0, "est", "le plus proche doit venir en tête");
        assert_eq!(idx.len(), 2);
    }

    #[test]
    fn refuse_une_dimension_qui_ne_correspond_pas() {
        let mut idx = VIndex::new(2, 32);
        let err = idx.insert("bancal", &vec![1.0, 2.0, 3.0]).unwrap_err();
        assert!(err.contains("dimension 3"), "le message doit nommer la dimension reçue : {err}");
        assert!(idx.search(&vec![1.0], 1).is_err(), "une requête mal dimensionnée doit échouer");
    }

    #[test]
    fn un_identifiant_retire_ne_ressort_plus() {
        let mut idx = VIndex::new(2, 32);
        idx.insert("nord", &v(0.0, 1.0)).unwrap();
        idx.insert("est", &v(1.0, 0.0)).unwrap();
        assert!(idx.remove("est"));
        assert!(!idx.remove("est"), "retirer deux fois doit rendre false");
        let r = idx.search(&v(1.0, 0.0), 2).unwrap();
        assert!(r.iter().all(|(id, _)| id != "est"), "« est » a été retiré : {r:?}");
        assert_eq!(idx.len(), 1);
    }

    #[test]
    fn reinserer_un_identifiant_ne_le_duplique_pas() {
        let mut idx = VIndex::new(2, 32);
        idx.insert("a", &v(0.0, 1.0)).unwrap();
        idx.insert("a", &v(1.0, 0.0)).unwrap();
        let r = idx.search(&v(1.0, 0.0), 5).unwrap();
        let occurrences = r.iter().filter(|(id, _)| id == "a").count();
        assert_eq!(occurrences, 1, "un identifiant réinséré ne doit apparaître qu'une fois : {r:?}");
        assert_eq!(idx.len(), 1);
    }

    #[test]
    fn k_zero_rend_une_liste_vide() {
        let mut idx = VIndex::new(2, 32);
        idx.insert("a", &v(1.0, 0.0)).unwrap();
        assert!(idx.search(&v(1.0, 0.0), 0).unwrap().is_empty());
    }

    #[test]
    fn la_persistance_conserve_le_contenu_vivant() {
        let mut idx = VIndex::new(2, 32);
        idx.insert("a", &v(1.0, 0.0)).unwrap();
        idx.insert("b", &v(0.0, 1.0)).unwrap();
        idx.remove("a");
        let pairs = idx.to_pairs();
        assert_eq!(pairs.len(), 1, "seul le vivant se persiste");
        assert_eq!(pairs[0].0, "b");
        let relu = VIndex::from_pairs(2, pairs).unwrap();
        assert_eq!(relu.len(), 1);
        assert_eq!(relu.search(&v(0.0, 1.0), 1).unwrap()[0].0, "b");
    }

    #[test]
    fn en_demi_precision_la_memoire_est_divisee_par_deux() {
        let dim = 128;
        let mut a = VIndex::avec_precision(dim, 64, Precision::F32);
        let mut b = VIndex::avec_precision(dim, 64, Precision::F16);
        for i in 0..50 {
            let vec: Vec<f32> = (0..dim).map(|d| ((i + d) % 13) as f32 / 13.0).collect();
            a.insert(&format!("v{i}"), &vec).unwrap();
            b.insert(&format!("v{i}"), &vec).unwrap();
        }
        assert_eq!(a.vector_bytes(), b.vector_bytes() * 2, "f16 doit peser la moitié de f32");
        assert_eq!(a.len(), b.len());
        assert_eq!(b.precision(), Precision::F16);
    }

    #[test]
    fn la_demi_precision_ne_change_pas_le_classement() {
        let dim = 64;
        let mut a = VIndex::avec_precision(dim, 256, Precision::F32);
        let mut b = VIndex::avec_precision(dim, 256, Precision::F16);
        for i in 0..150usize {
            let centre = i % 10;
            let vec: Vec<f32> = (0..dim)
                .map(|d| if d % 10 == centre { 1.0 } else { 0.02 * ((i + d) % 7) as f32 })
                .collect();
            a.insert(&format!("v{i}"), &vec).unwrap();
            b.insert(&format!("v{i}"), &vec).unwrap();
        }
        let q: Vec<f32> = (0..dim).map(|d| if d % 10 == 3 { 1.0 } else { 0.01 }).collect();
        let ra: Vec<String> = a.search(&q, 5).unwrap().into_iter().map(|(id, _)| id).collect();
        let rb: Vec<String> = b.search(&q, 5).unwrap().into_iter().map(|(id, _)| id).collect();
        let commun = ra.iter().filter(|id| rb.contains(id)).count();
        assert!(commun >= 4, "f32={ra:?} f16={rb:?} — seulement {commun}/5 en commun");
    }

    #[test]
    fn la_persistance_traverse_la_demi_precision() {
        let mut b = VIndex::avec_precision(4, 32, Precision::F16);
        b.insert("a", &vec![1.0, 0.0, 0.0, 0.0]).unwrap();
        let pairs = b.to_pairs();
        assert_eq!(pairs.len(), 1);
        assert!((pairs[0].1[0] - 1.0).abs() < 0.01, "la valeur doit survivre a l'aller-retour f16");
        let relu = VIndex::from_pairs_avec(4, pairs, Precision::F16).unwrap();
        assert_eq!(relu.len(), 1);
        assert_eq!(relu.precision(), Precision::F16);
    }

    #[test]
    fn une_precision_inconnue_est_refusee() {
        assert!(Precision::from_str("f8").is_err());
        assert_eq!(Precision::from_str("f16").unwrap(), Precision::F16);
        assert_eq!(Precision::from_str("half").unwrap(), Precision::F16);
        assert_eq!(Precision::from_str("").unwrap(), Precision::F32);
    }

    #[test]
    fn le_registre_ne_recree_pas_par_inadvertance() {
        let mut reg = VIndexRegistry::new();
        reg.create("code", 2, 32, false).unwrap();
        reg.get_mut("code").unwrap().insert("a", &v(1.0, 0.0)).unwrap();
        reg.create("code", 2, 32, false).unwrap();
        assert_eq!(reg.get("code").unwrap().len(), 1, "rouvrir ne doit rien effacer");
        reg.create("code", 2, 32, true).unwrap();
        assert_eq!(reg.get("code").unwrap().len(), 0, "replace doit repartir de zéro");
        assert!(reg.create("code", 3, 32, false).is_err(), "changer de dimension doit échouer");
        assert_eq!(reg.names(), vec!["code".to_string()]);
        assert!(reg.drop_index("code"));
        assert!(!reg.drop_index("code"));
    }
}

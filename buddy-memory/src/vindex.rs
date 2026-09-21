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
use std::collections::{HashMap, HashSet};

pub struct VIndex {
    ann: AnnIndex,
    removed: HashSet<String>,
    /// Conservés pour la persistance et pour reconstruire après compactage.
    vectors: HashMap<String, Vec<f32>>,
    dim: usize,
}

impl VIndex {
    pub fn new(dim: usize, capacity: usize) -> Self {
        Self {
            ann: AnnIndex::with_capacity(dim, capacity),
            removed: HashSet::new(),
            vectors: HashMap::new(),
            dim,
        }
    }

    pub fn from_pairs(dim: usize, pairs: Vec<(String, Vec<f32>)>) -> Result<Self, String> {
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
        let vectors: HashMap<String, Vec<f32>> = pairs.iter().cloned().collect();
        Ok(Self {
            ann: AnnIndex::from_pairs(dim, capacity, pairs),
            removed: HashSet::new(),
            vectors,
            dim,
        })
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
        self.vectors.insert(id.to_string(), vec.to_vec());
        self.ann.insert(id, vec);
        Ok(())
    }

    pub fn remove(&mut self, id: &str) -> bool {
        if self.vectors.remove(id).is_some() {
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
            if self.removed.contains(id) || !self.vectors.contains_key(id) {
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
        self.vectors.is_empty()
    }

    pub fn clear(&mut self) {
        self.ann = AnnIndex::with_capacity(self.dim, 32);
        self.removed.clear();
        self.vectors.clear();
    }

    /// Paires vivantes, pour la persistance. L'ordre est stable (tri par
    /// identifiant) afin qu'une sauvegarde soit reproductible d'une fois sur l'autre.
    pub fn to_pairs(&self) -> Vec<(String, Vec<f32>)> {
        let mut pairs: Vec<(String, Vec<f32>)> =
            self.vectors.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        pairs
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
        self.indexes.insert(name.to_string(), VIndex::new(dim, capacity));
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

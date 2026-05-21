# Documentation : Activation NPU & Lemonade (AI 470 Pro)

Cette documentation détaille les étapes techniques réalisées pour activer le coprocesseur IA (**NPU XDNA 2**) et configurer la pile logicielle **Lemonade** sur ce PC (AMD Ryzen AI / Strix Point).

---

## 1. Contexte Matériel
Le PC est équipé d'un processeur **AMD Ryzen AI 9 HX 370** (architecture Strix Point). Ce processeur inclut :
- **GPU** : Radeon 890M (RDNA 3.5, `gfx1150`).
- **NPU** : AMD XDNA 2 (jusqu'à 50 TOPS dédiés à l'IA).

---

## 2. Étape 1 : Le Noyau (Kernel) OEM
Le noyau standard d'Ubuntu 24.04 (HWE) présentait des bugs critiques avec l'architecture `gfx1150` (notamment des plantages HSA/ROCm).

### Solution : Passage au noyau OEM
Nous avons installé le noyau **linux-oem-24.04**. 
- **Pourquoi ?** Ce noyau contient des patchs AMD spécifiques qui ne sont intégrés dans le noyau générique que plusieurs mois plus tard.
- **Script** : `ai-stack/install_oem_kernel.sh`
- **Vérification** : `uname -r` doit afficher une version `-oem`.

---

## 3. Étape 2 : Installation de ROCm 7.2
ROCm est la plateforme de calcul d'AMD nécessaire pour que le logiciel puisse communiquer avec le matériel d'accélération.

### Détails de l'installation :
- **Dépôt** : Utilisation du repo officiel AMD pour Ubuntu Noble (24.04).
- **Workaround PPA** : Correction manuelle dans `/etc/apt/sources.list.d/rocm.list` pour pointer vers la version stable 7.2.1 (contournement d'un bug de version 7.2.2).
- **Groupes** : L'utilisateur a été ajouté aux groupes `video` et `render` pour l'accès direct au matériel.
- **Script** : `ai-stack/install_rocm.sh`

---

## 4. Étape 3 : Lemonade Server (Le Pont NPU)
Lemonade est le composant central qui permet d'utiliser réellement le NPU sous Linux via le **backend FLM** (Fast Lightweight Model).

### Configuration :
- **Installation** : Via le PPA `ppa:lemonade-team/stable`.
- **Service** : Géré par `lemond.service`.
- **Port** : Configuré sur le port **13305** (compatible OpenAI API).
- **Rôle** : Il sert de serveur d'inférence léger pour les modèles de petite taille (ex: Gemma 2 2B, Qwen 2.5), permettant une IA fluide sans consommer la batterie (contrairement au GPU).

---

## 5. Étape 4 : Stabilisation de l'Environnement
Plusieurs correctifs de bas niveau ont été appliqués pour éviter les plantages (Segfaults) :

1. **Rétrogradation de NumPy** : Forcé en version **1.26.4**. Les versions 2.x et supérieures causaient des instabilités avec les drivers ROCm actuels sur cette architecture.
2. **Gestion des erreurs HSA** : Le passage au noyau OEM a permis de résoudre le bug `gfx1150 HSA timeout` qui bloquait Ollama et Lemonade.

---

## 6. Utilisation & Monitoring
L'écosystème est piloté via le **Cyber-Deck Dashboard** (`Dashboard/cyber-deck`).

### Commandes utiles :
- **Vérifier le NPU** : 
  ```bash
  systemctl status lemond
  journalctl -u lemond -f
  ```
- **Vérifier le GPU (ROCm)** : 
  ```bash
  rocm-smi
  rocminfo | head -n 20
  ```
- **Vérifier le Kernel** : 
  ```bash
  uname -r
  ```

---

## 7. Résumé de la Stack AI
| Composant | Rôle | Accélération | Port |
| :--- | :--- | :--- | :--- |
| **Lemonade** | IA temps réel / Chat | **NPU XDNA 2** | 13305 |
| **Ollama** | Modèles lourds / RAG | **GPU Radeon 890M** | 11434 |
| **Open WebUI**| Interface Utilisateur | Web | 8080 |
| **LiteLLM** | Proxy / Orchestration | - | 4000 |

Cette configuration fait de ce PC une unité de production IA "Edge" autonome et optimisée.

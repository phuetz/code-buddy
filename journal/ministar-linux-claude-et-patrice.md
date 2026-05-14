# Journal — ministar-linux (claude-et-patrice)

Fichier créé le 01 mai 2026.

---
## 01 mai 2026 — Installation Setup Android (Session Gemini CLI)

### 🚀 Actions effectuées :
- [x] Ajout de l'utilisateur au groupe `kvm`.
- [x] Installation de l'**OpenJDK 21**.
- [x] Installation de **ADB**, **Fastboot** et **Scrcpy**.
- [x] Installation de **JetBrains Toolbox** et de la suite complète d'IDE (Android Studio, WebStorm, CLion, DataGrip, Rider, RubyMine, RustRover).
- [x] Création du répertoire de projets `~/AndroidProjects`.
- [x] Installation des briques de voix robotiques : **Piper (TTS)** et **faster-whisper (STT)**.
- [x] **Configuration Réseau Ollama :** Exposition du service sur toutes les interfaces (`OLLAMA_HOST=0.0.0.0`) pour accessibilité via Tailscale (IP `100.98.18.76`).

### 📌 État du système :
- **CPU** : 12 cores / 24 threads
- **RAM** : 128 Go
- **SSD** : 8 To
- **OS** : Linux (Ubuntu)
- **Outils IA** : Ollama, Piper, faster-whisper

### ⚠️ Note importante :
- Le support KVM nécessite un redémarrage de session pour être pleinement opérationnel.
- Tous les IDE JetBrains sont installés via Toolbox dans `~/.local/share/JetBrains/Toolbox/apps`.

### 🎯 Décision Stratégique Hardware :
- **Cible Mobile :** Acquisition prévue du **Pixel 11 en août 2026** (Tensor G6 / 2nm) pour servir de cerveau mobile à Opus 27.
- **Phase de Transition (Mai-Août) :** Utilisation du **Pixel 6** comme "cobaye" pour le développement et le débogage de la brique **LISA-Mobile**.
- **Objectif :** Aligner le développement mobile avec les annonces "Agentic AI" de Google I/O (19 mai 2026) pour une intégration native de Gemini 4.0.

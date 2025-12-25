# TODO - Code Buddy Improvements

## 🔴 Priorité Critique

### Type Safety
- [x] 1. Éliminer les `any` restants dans `src/codebuddy/client.ts` ✅
- [ ] 2. Activer `noUncheckedIndexedAccess` dans tsconfig.json
- [ ] 3. Activer `noUnusedLocals` et `noUnusedParameters`
- [x] 4. Typer proprement les métadonnées `Record<string, any>` ✅

### Architecture
- [x] 5. Fusionner `/src/agents` et `/src/agent` ✅
- [ ] 6. Refactorer `src/utils/` en sous-répertoires logiques
- [x] 7. Nettoyer les modules incomplets ✅ (déjà propres)

---

## 🟡 Priorité Haute

### Tests
- [ ] 8. Ajouter des tests pour les composants UI (React/Ink)
- [ ] 9. Résoudre les problèmes de teardown des workers Jest
- [ ] 10. Tester la coordination multi-agent plus en profondeur
- [ ] 11. Tester la logique de compression de contexte
- [ ] 12. Tester le routage de modèles
- [ ] 13. Ajouter des tests d'intégration end-to-end

### Performance
- [x] 14. Découper `src/index.ts` en modules plus petits ✅ (src/cli/)
- [x] 15. Ajouter le connection pooling pour SQLite ✅ (better-sqlite3 est synchrone)
- [x] 16. Optimiser les requêtes base de données avec des index ✅ (schema.ts)
- [x] 17. Implémenter le query caching pour les requêtes fréquentes ✅ (cache table + LRUCache)
- [x] 18. Résoudre les fuites mémoire liées aux EventEmitters ✅ (DisposableManager)

### Sécurité
- [x] 19. Ajouter le rate limiting pour prévenir l'abus API ✅ (existe déjà)
- [x] 20. Chiffrer les données de session en SQLite ✅ (session-encryption.ts)
- [x] 21. Améliorer la détection de fork bomb ✅ (execpolicy.ts - 40+ patterns)
- [ ] 22. Ajouter la validation CSRF si interface web ajoutée
- [x] 23. Audit des dépendances avec `npm audit` automatisé ✅ (security.yml)

---

## 🟢 Priorité Moyenne

### Fonctionnalités
- [x] 24. Mode offline complet avec cache local des réponses ✅ (existe déjà)
- [ ] 25. Historique de conversation avec recherche sémantique
- [x] 26. Export des sessions en formats multiples (JSON, Markdown, HTML) ✅ (existe déjà)
- [x] 27. Thèmes d'interface personnalisables ✅ (themes.ts)
- [ ] 28. Mode collaboratif multi-utilisateurs
- [ ] 29. Intégration IDE (VS Code extension, JetBrains plugin)
- [ ] 30. Support webhooks pour intégrations externes
- [ ] 31. API REST locale pour scripts externes
- [x] 32. Mode batch pour traitement de multiples fichiers ✅
- [x] 33. Génération de rapports automatique post-session ✅

### Intelligence
- [ ] 34. Apprentissage des préférences utilisateur persistant
- [ ] 35. Suggestions proactives basées sur le contexte du projet
- [x] 36. Auto-complétion des commandes basée sur l'historique ✅
- [ ] 37. Détection d'anomalies dans le code analysé
- [x] 38. Scoring de qualité de code automatique ✅
- [ ] 39. Recommandations de refactoring intelligentes
- [ ] 40. Estimation de complexité des tâches demandées

### Outils
- [x] 41. Outil de migration de base de données ✅
- [x] 42. Outil de génération de documentation automatique ✅
- [x] 43. Outil d'analyse de dépendances (graphe, obsolètes) ✅
- [x] 44. Outil de détection de code mort ✅ (dead-code-detector.ts)
- [x] 45. Outil de formatage multi-langage ✅
- [x] 46. Outil de benchmark de performance ✅ (benchmark-suite.ts)
- [x] 47. Outil de profiling mémoire/CPU ✅ (profiler.ts)
- [x] 48. Outil de diff sémantique ✅ (semantic-diff.ts)

---

## 🔵 Améliorations UX

### Interface Terminal
- [x] 49. Barre de progression pour les opérations longues ✅ (multi-step-progress.tsx)
- [x] 50. Indicateur de coût en temps réel plus visible ✅
- [ ] 51. Historique navigable avec flèches haut/bas
- [ ] 52. Auto-complétion des chemins de fichiers
- [ ] 53. Prévisualisation des modifications avant application
- [ ] 54. Mode split-screen pour diff avant/après
- [ ] 55. Notifications sonores optionnelles
- [ ] 56. Support du copier-coller amélioré
- [x] 57. Raccourcis clavier personnalisables ✅
- [ ] 58. Mode compact pour petits écrans

### Feedback
- [x] 59. Messages d'erreur plus explicites avec suggestions ✅ (error-recovery.ts)
- [x] 60. Progression détaillée des opérations multi-étapes ✅ (multi-step-progress.tsx)
- [x] 61. Résumé de session en fin de conversation ✅ (session-summary.ts)
- [x] 62. Statistiques d'utilisation affichables ✅ (usage-statistics.ts)

---

## 🟣 Documentation

- [ ] 63. Mettre à jour ARCHITECTURE.md
- [ ] 64. Documenter le système multi-agent
- [ ] 65. Ajouter des diagrammes Mermaid
- [ ] 66. JSDoc complet sur toutes les fonctions publiques
- [x] 67. Guide de contribution (CONTRIBUTING.md) ✅ (existe déjà)
- [ ] 68. Changelog automatisé avec conventional-changelog
- [ ] 69. Documentation API auto-générée (TypeDoc)
- [ ] 70. Tutoriels vidéo ou GIFs animés
- [ ] 71. Exemples d'utilisation pour chaque outil
- [ ] 72. FAQ des problèmes courants

---

## ⚙️ DevOps & CI/CD

- [ ] 73. GitHub Actions pour CI complète
- [ ] 74. Tests automatiques sur PR
- [ ] 75. Analyse de couverture avec Codecov
- [ ] 76. Linting automatique avant merge
- [ ] 77. Semantic release automatisé
- [ ] 78. Docker image officielle
- [ ] 79. Homebrew formula pour macOS
- [ ] 80. Package AUR pour Arch Linux
- [ ] 81. Snap/Flatpak pour Linux
- [ ] 82. Windows installer (MSI/exe)

---

## 🧪 Qualité de Code

- [ ] 83. Ajouter Husky pour hooks git améliorés
- [ ] 84. SonarQube/SonarCloud pour analyse continue
- [ ] 85. Mutation testing avec Stryker
- [ ] 86. Benchmark automatisé des performances
- [ ] 87. Tests de snapshot pour l'UI
- [ ] 88. Fuzzing des inputs utilisateur
- [ ] 89. Tests de charge pour le multi-agent
- [ ] 90. Analyse de complexité cyclomatique automatique

---

## 🌐 Internationalisation

- [ ] 91. Support i18n (français, espagnol, allemand, etc.)
- [ ] 92. Messages d'erreur localisés
- [ ] 93. Documentation multilingue
- [ ] 94. Détection automatique de la langue système

---

## 🔌 Intégrations

- [ ] 95. GitHub/GitLab integration native
- [ ] 96. Jira/Linear pour gestion de tâches
- [ ] 97. Slack/Discord notifications
- [ ] 98. Notion/Obsidian export
- [ ] 99. Sentry pour error tracking production
- [ ] 100. OpenTelemetry pour observabilité

---

## 🚀 Fonctionnalités Avancées

- [ ] 101. Mode équipe avec partage de contexte
- [ ] 102. Agents spécialisés par langage/framework
- [ ] 103. Fine-tuning local sur le style du projet
- [ ] 104. Caching distribué pour équipes
- [ ] 105. Replay déterministe des sessions
- [ ] 106. Branching de conversations amélioré
- [ ] 107. Merge de branches de conversation
- [ ] 108. Versioning des checkpoints
- [ ] 109. Rollback sélectif par fichier
- [ ] 110. Diff 3-way pour conflits

---

## 📊 Analytics & Métriques

- [ ] 111. Dashboard de métriques local
- [ ] 112. Graphiques d'évolution de la base de code
- [ ] 113. Heatmap des fichiers modifiés
- [ ] 114. Tracking du ROI (temps gagné vs coût API)
- [ ] 115. Export des métriques vers Prometheus/Grafana

---

## 🛡️ Robustesse

- [x] 116. Retry avec backoff exponentiel pour erreurs réseau ✅
- [x] 117. Fallback automatique entre modèles ✅
- [x] 118. Mode dégradé si API indisponible ✅ (offline-mode.ts)
- [x] 119. Sauvegarde automatique des sessions en cours ✅
- [x] 120. Récupération après crash gracieuse ✅

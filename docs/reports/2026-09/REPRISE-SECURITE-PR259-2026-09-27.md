# Reprise de sécurité de la PR #259

Mission du 27 septembre 2026 sur `fix/securite-2-3-0`. `origin/main` a été fusionné au commit `a0c08c4d7` ; son tableau de coordination a été conservé lors de l'unique conflit. Les deux relectures « À REPRENDRE » et l'audit d'origine ont été lus en entier. Les essais utilisent exclusivement le HOME fictif `_qa/securite-reprise/home`.

La garde de fichiers est désormais appelée au niveau du VFS pour ses lectures texte et binaires, ainsi que par les lecteurs directs. La création d'archive parcourt ses sources avant de les empaqueter. `apply_patch` vérifie la lecture de toute source mise à jour ou supprimée. Bash reconnaît les chemins statiques relatifs, absolus, échappés et les sous-dossiers lus récursivement. Le pont pair filtre chaque résultat avant émission, y compris en flux. Les noms de modèles `.env.example` restent cherchables.

Preuve rouge sur `a0c08c4d7` dans un worktree temporaire : 26 échecs, 55 réussites sur 81 tests de régression. Preuve verte : 210/210 sur 14 suites ciblées, 40/40 pour la garde des données personnelles, `npx tsc --noEmit` sans erreur et ESLint ciblé sans erreur. Les journaux et le tableau constat → correctif → test figurent dans `Partage/20260927-release-2-3-0/revue-259/reprise-sol/sol/RAPPORT.md`.

Limites : Linux seulement ; pas de vrai modèle, de profil utilisateur, d'interface Cowork, d'audit npm du jour ou de publication. Le validateur Bash reste une analyse textuelle et ne remplace pas le confinement natif opt-in.

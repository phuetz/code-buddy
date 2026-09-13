# Corrections du harnais et du RPC — 13 septembre 2026

Branche `codex/audit-ameliorations-2026-09-13`, base `8d4fbe030`, worktree `~/DEV/cb-audit-ameliorations-2026-09-13`.

Commits de code : `cc146f71d` (harnais/catalogue), `f388ef5a0` (RPC).

Les quatre reproductions de l'audit précédent sont corrigées :

1. Le RPC résout physiquement le workspace et la cible avant `view_file`, `list_directory` et `search`. Les liens qui sortent du workspace sont refusés ; les liens internes restent utilisables. La lecture utilise le descripteur ouvert, refuse les fichiers spéciaux et vérifie aussi son chemin via `/proc/self/fd` sous Linux. Ripgrep ignore sa configuration externe et ne suit pas les liens rencontrés pendant le parcours.
2. `createAgentToolHarness` capture le bot en plus du workspace et vérifie les deux avant chaque dispatch. Les transitions vers ou depuis un bot absent sont également refusées.
3. Le responder RPC vérifie son état après les attentes et avant chaque nouvel appel. L'arrêt annule l'appel actif, abandonne la file et attend la fin du scan et des écritures de réponses. Un adaptateur ignorant son signal ne bloque pas cette fermeture. Les dépassements du délai par appel transmettent aussi l'annulation.
4. La limite de 512 porte sur les raccourcis et descriptions injectés dans JavaScript. `tool_search` garde un raccourci réservé lorsqu'il est autorisé ; `tools.call` peut atteindre le catalogue complet, contrôlé par le parent. Les noms absents et les appels récursifs restent interdits.

## Vérifications

- Tests ciblés initiaux : 35 verts, dont neuf nouveaux cas (liens, arrêt, timeout, trois transitions de bot, trois tailles de catalogue).
- Sonde réelle `tests/audit/harnais-suite-2026-09-13.mjs` : les quatre comportements corrigés sont vérifiés. Elle utilisait auparavant des assertions reproduisant les défauts ; elle constitue maintenant une sonde de non-régression.
- `npm run validate` ciblé : exit 0, cinq fichiers / 48 tests verts ; lint sans erreur (2 488 avertissements existants), typecheck principal/GPU/companion-core et dix tests de packaging verts.
- `RUN_REAL_TESTS=1` sur le runner réel et le RPC : deux fichiers / 26 tests verts (dont trois tests supplémentaires de scripts/artéfacts ; les 23 RPC sont rejoués).
- Compatibilité `tests/unit/codex-pass2-features.test.ts` : 41 tests verts. Total distinct de cette tranche : 92 tests ciblés, plus dix tests de packaging.
- `npm run build` : exit 0. Import du paquet compilé `@phuetz/code-buddy/harness` puis découverte et appel de `entry_512` : succès.
- Privacy : 39/40, mêmes cinq chemins préexistants que la base `8b5c61def`, aucun nouveau chemin ; ne bloque pas les correctifs locaux. Logs `_qa/audit/harness-fixes-{validate,real,build,privacy,probe}.log`.

## Portée

Le RPC historique reste opt-in. `execute_code` lance des scripts locaux ; ces contrôles RPC ne constituent pas un sandbox du script. La résolution de chemins ne garantit pas un confinement atomique contre toutes les mutations concurrentes d'une arborescence, notamment pendant le parcours de répertoires. Un adaptateur personnalisé doit respecter son signal pour interrompre un effet déjà commencé. Le harnais vérifie le contexte au dispatch ; son agent ne doit pas être reconfiguré pendant un appel en cours.

Aucun service démarré, aucun appel LLM, aucun push ni fusion. Les logs de vérification sont conservés dans `_qa/audit/`, non suivis.

# Quatrième reprise — import des hooks — 03/10/2026

Mission et revue adverse lues intégralement. Même branche, départ `8240e000a`, réservation `83cacf5b7`. Bloquant Python/chr accepté : une recherche textuelle de chemins ne prouve pas les effets d’un interpréteur. L’affirmation générale de la troisième reprise était incorrecte ; le rapport précédent et le guide sont rectifiés.

| Bloquant / réserve | Traitement | Preuve |
|---|---|---|
| Le hook substitue Python/chr à printf et lit le secret du projet | Politique propre aux remplacements de commande : une seule commande littérale printf / echo / true / false / exit, ASCII et longueur totale ≤ 8 192 ; autre programme ou syntaxe refusé avant réécriture | Baseline réelle : landlock code 0 et marqueur factice retourné. Après correction : allowed false, arguments inchangés, sandbox non appelé ; quatre consommateurs et secret hors projet testés |
| Tests limités au cat visible ; documentation trop générale | Cinquante tests ajoutés et limites explicites : le classificateur partagé reste textuel, la grammaire fermée bloque les substitutions arbitraires | 97 tests ciblés verts après mutations ; interpréteurs, noms préfixés, opérateurs, redirections, expansions, contrôles, formats/options et valeurs illisibles refusés ; six commandes positives et commande initiale conservée |

Correctif `3615f278d`. Typecheck complet code 0 ; lint complet code 0, 0 erreur / 2 601 avertissements. Cinq mutations affaiblissantes tuées, 39 assertions rouges, restauration SHA-256. Une première mutation d’ancrage était équivalente en JavaScript sans drapeau m : 36 verts, exclue du compte ; commentaire erroné corrigé, puis suppression réelle de l’ancrage démontrée rouge. Scanner, pare-feu, classificateur Bash, politique d’import et superviseur partagés inchangés.

Recette vraie CLI source et Ollama local qwen3.5:4b, HOME jetable : bonjour désactivé, salut après activation. Substitution Python/chr visant le faux id_rsa du projet : garde refuse avant exécution, refus effectivement transmis au modèle, zéro octet du marqueur. Premier essai négatif en timeout après trois refus, conservé ; essai borné à deux tours terminé code 0. Le modèle reformule imparfaitement la règle ; sa prose ne prouve aucune exécution. Hooks de recette désactivés.

ECC épinglé au clone existant : vrai CLI en mode rapport, 0 admissible / 9 quarantaines / 15 refus, snapshots HOME / projet / clone inchangés.

La barrière ciblée est exécutée après le commit documentaire final :

```sh
VITEST_MAX_WORKERS=1 npm test -- tests/hooks tests/skills tests/security/skill-scanner tests/security/skill-firewall tests/agent/execution/fleet-tool-hooks.test.ts tests/agent/execution/agent-executor.test.ts tests/agent/agent-executor-lanes.test.ts tests/security/donnees-personnelles.test.ts
```

Résultat sur ce commit, sorties brutes, mutations et état Git final dans le rapport remis au dossier d’échange convenu, hors dépôt public. Aucun push, aucune tâche autonome de fond.

## Ce que je n'ai pas pu vérifier

Windows/macOS, Docker/bwrap, CI distante, Electron, packaging et suite complète non exécutés. Aucun PTY interactif ouvert : refus avant remise de initial_command vérifié par le callback de production. Aucun hook ECC activé. Le durcissement porte sur les remplacements de commande fournis par les hooks ; le pipeline des commandes initiales n’est pas remplacé. Le classificateur de chemins demeure incapable de prouver un programme arbitraire sûr. La fidélité des réponses du modèle n’est pas garantie, ni utilisée pour établir la sécurité du contrôle.

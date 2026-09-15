# Menu / et /help — 14 septembre 2026

Cause reproduite dans le code : le menu et /help utilisent le même SlashCommandManager, mais filterCommandSuggestions tronquait les résultats à 15. La fenêtre de 10 lignes ne pouvait donc pas défiler dans le reste du catalogue.

Correctif : suppression de la troncature des commandes et arguments ; priorité des commandes courantes conservée ; fenêtre défilante de 10 lignes inchangée. Le préfixe filtre le catalogue entier.

Vrai CLI compilé Node20, PTY Linux, profil/projet temporaires : 141 commandes (140 intégrées + zz-sentinel personnalisée), parité exacte avec /help ; flèche haute depuis la première entrée atteint la dernière, Tab la complète ; /help affiche la commande personnalisée ; /fle retrouve /fleet ; /exit termine avec 0. Aucun appel LLM nécessaire. Captures et verdict dans Partage/20260914-slash-help-final.

Première tentative du harness dans Partage/20260914-slash-help : parité et complétion observées, mais envoi de touches pendant le rendu long de /help, sortie non validée. Replay final attend la fin du rendu et valide un nouveau frame pour le préfixe ; ne pas compter la première tentative comme réussite complète.

Régressions : catalogue réel/help, préfixe avec plus de 15 résultats, rendu Ink de la dernière fenêtre. Build et validate passent : lint sans erreur, typage, pack10 et 85 tests ciblés dans 4 suites. Pas de validation Windows et pas de nouvelle publication npm.

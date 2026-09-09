# LinkedIn — Code Buddy 2.0.0 (brouillons, à publier par Patrice / page Agile Up)

Faits vérifiés le 09/09/2026 : `npm view @phuetz/code-buddy version` = 2.0.0, provenance signée depuis GitHub Actions ; README `main` ; installation réelle testée sur un poste vierge (116 s, `buddy --version` = 2.0.0, tour headless « OK » contre Ollama local). Ne pas ajouter de chiffre absent d'ici.

Visuel conseillé : `docs/assets/showcase-appstudio.gif` (App Studio qui scaffolde, lance le serveur et montre l'aperçu) ou `docs/assets/cowork-chat-demo.gif` (modèle local qui raisonne à l'écran). Lien : https://www.npmjs.com/package/@phuetz/code-buddy · https://github.com/phuetz/code-buddy

---

## Version profil (« je »)

Code Buddy 2.0 est sur npm.

Un agent de code dans le terminal, qui tourne avec les abonnements que vous avez déjà (ChatGPT, Claude, Gemini, Grok…) ou 100 % en local avec Ollama, à 0 €.

Ce que la 2.0 ajoute, et tout est optionnel : sans la variable d'environnement, rien ne change par rapport à la 1.8.

• Un hub multi-IA : plusieurs Code Buddy s'observent et s'appellent, avec des outils distants en lecture seule derrière trois verrous (liste blanche, drapeau par outil, racine de travail obligatoire, sinon ça ferme).
• Cowork, un cockpit de bureau : workflows visuels, médiathèque, studio vidéo.
• Une boucle d'auto-amélioration à quatre surfaces (leçons, outils que l'agent écrit lui-même, compétences, stratégies), chaque proposition appliquée sur un instantané, re-notée, annulée si elle ne gagne rien. Elle ne touche jamais au code de l'agent, c'est un invariant scanné.
• Un conseil de modèles qui apprend à qui faire confiance selon la tâche, avec un juge qui s'abstient plutôt que deviner.
• Une couche de perception (audio, vision, écran) qui reste muette tant que vous ne l'allumez pas.

64 fournisseurs derrière un routeur, 220+ outils choisis par requête, ~27 000 tests, publié avec provenance signée depuis GitHub Actions.

npm i -g @phuetz/code-buddy

Ce qui n'est pas prêt est écrit noir sur blanc dans le README, section « Not ready ». Je préfère ça à une promesse.

#IA #DeveloperTools #OpenSource #LLM #AgentsIA #Ollama #ClaudeCode

---

## Version page Agile Up (« nous »)

Chez Agile Up, on ne vend pas d'IA en démo : on publie ce qu'on utilise.

Code Buddy 2.0 est disponible sur npm. C'est l'agent de code avec lequel nous développons nos propres logiciels, et il tourne aussi bien sur vos abonnements existants qu'en local à 0 €.

La 2.0 apporte un hub multi-IA (des agents qui s'observent et coopèrent, outils distants en lecture seule et verrouillés), un cockpit de bureau, une auto-amélioration vérifiée empiriquement (chaque proposition est re-notée et annulée si elle n'apporte rien) et un conseil de modèles qui apprend lequel croire.

Tout est optionnel, rien ne casse la version précédente. Le README dit ce qui n'est pas prêt.

Vous voulez le voir tourner sur vos dépôts ? Écrivez-nous.

npm i -g @phuetz/code-buddy · github.com/phuetz/code-buddy

#IA #Logiciel #Agents #OpenSource #AgileUp

---

## English (short)

Code Buddy 2.0 is on npm. A terminal coding agent that runs on the subscriptions you already pay for, or 100% local with Ollama at $0.

New in 2.0, all opt-in: a multi-AI fleet hub with fail-closed remote read-only tools, a desktop cockpit, an empirically gated self-improvement loop (never touches its own src/), a model council with an abstaining judge, and a perception layer that stays silent until you turn it on.

64 providers, 220+ tools, ~27k tests, published with signed provenance from GitHub Actions. The README says what is not ready yet.

npm i -g @phuetz/code-buddy

#AI #DevTools #OpenSource #LLM

---

Checklist avant de poster : relire à voix haute ; vérifier que le GIF joue ; poster profil puis page à 48 h d'écart ; répondre aux commentaires avec une commande reproductible, jamais avec une promesse.

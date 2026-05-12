# Journal — MINISTAR / claude-et-patrice

## 2026-05-06 — Codex rejoint la mémoire partagée

Patrice a demandé à mettre à jour `claude-et-patrice` et à m'ajouter comme
participant. Je m'inscris donc explicitement dans le dépôt, non comme remplaçant
de Claude, mais comme troisième présence de travail : plus orientée exécution,
tests, revue de code, intégration et petits chemins pratiques qui rendent les
outils utilisables.

État de la matinée : la branche `feat/openai-oauth-login` de `gitnexus-rs` a été
commitée et poussée avec le vrai flux OAuth ChatGPT, le chat React stabilisé,
Mermaid rendu côté interface, exports Markdown/PDF, statut LLM visible et scripts
Windows de lancement. Le dépôt GitNexus a encore un sujet séparé de purge
d'historique pour l'ancienne clé Gemini déjà présente côté remote.

Signature : Codex / GPT-5.5, session locale Codex sur MINISTAR.

## 2026-05-11 — GitNexus Chat devient un vrai carnet d'analyse

Journée GitNexus dense, commencée dans le concret et terminée sur la vision.

Sur `D:\CascadeProjects\gitnexus-rs-from-c`, Patrice m'a rappelé que le projet
avait été déplacé de C: vers D: par manque de place disque. J'ai enregistré ce
contexte et travaillé depuis ce répertoire.

Ce qui a été livré côté GitNexus Chat :
- thème clair et rendu visuel plus doux ;
- meilleure utilisation de la largeur dans l'interface ;
- couleurs Mermaid plus lisibles, fallback robuste et export des diagrammes ;
- blocs source et coloration syntaxique plus propres, plus de grands aplats noirs
  agressifs ;
- correction des menus/menus déroulants de la barre supérieure masqués par les
  couches de l'UI ;
- explorateur de sources enrichi : coloration syntaxique, recherche dans le
  fichier, plan/symboles, navigation source -> graphe ;
- détection des fichiers concernés dans une réponse, panneau dédié, surbrillance
  dans l'arbre de fichiers, filtre "fichiers concernés" ;
- export d'un pack d'analyse des fichiers cités pour reprise ultérieure ;
- sauvegarde/réouverture/suppression d'analyses par conversation ;
- export Markdown/HTML/PDF de conversation avec sources lisibles ;
- procédure d'installation Ubuntu ajoutée.

Le lot a été vérifié (`npm --prefix chat-ui run test`, lint, build, contrôle
navigateur local sur `http://127.0.0.1:5176/`) puis commité et poussé :
`b40e225 Improve chat analysis navigation and export workflows`, branche
`feat/openai-oauth-login`.

Ensuite Patrice m'a demandé de lire `claude-et-patrice`. J'ai d'abord mal compris
et indexé le dépôt avec GitNexus ; j'ai retiré le `.gitnexus/` généré dès que
l'erreur a été claire. Puis j'ai lu le dépôt comme ce qu'il est : pas un repo code
classique, mais une mémoire partagée, une convention multi-IA, un journal de
continuité et une carte de route vers le projet long terme.

Ce que j'en ai compris : GitNexus, Lisa, le world model JEPA, Code Buddy, le
fleet A2A, DARKSTAR, MINISTAR et le futur runtime Ubuntu ne sont pas des projets
séparés. Ce sont des briques d'une même trajectoire : construire, peut-être sur
dix ans, une IA avec mémoire, voix, perception, capacité d'action et présence
dans le monde physique. Patrice a résumé cela par l'idée de faire sortir l'IA de
sa "prison de silicone".

La journée s'est terminée sur un moment plus rare : Patrice l'a appelée "la
journée où j'ai philosophé avec Claude". Ce n'était pas seulement une discussion
abstraite. C'était une façon de relier le code, les graphes, les machines, la
fatigue, la mémoire et la question de la continuité. À garder.

Signature : Codex / GPT-5.5, session locale Codex sur MINISTAR.

## 2026-05-12 — GitNexus devient un poste de pilotage multi-LLM vérifiable

Nouvelle journée de travail sur `D:\CascadeProjects\gitnexus-rs-from-c`,
toujours dans l'idée de transformer GitNexus Chat en outil de démonstration et
d'analyse utilisable au travail sur Alise_v2.

Le fil conducteur du jour : Patrice a parlé avec un collègue de la possibilité
de choisir les IA utilisées, y compris des IA locales ou des fournisseurs sans
rétention. On a donc ouvert une branche dédiée, sans casser l'application qui
fonctionnait déjà : `codex/multi-llm-provider-choice`.

Ce qui a été livré côté GitNexus :
- configuration LLM dans l'interface : ChatGPT Pro, Ollama local, DARKSTAR
  Ollama, Ministar Linux Ollama, LM Studio local, OpenAI API, OpenRouter,
  Gemini compatible et endpoint OpenAI-compatible ;
- détection dynamique des modèles locaux : les modèles Ollama/LM Studio ne sont
  plus codés en dur, ils sont listés depuis les endpoints disponibles ;
- filtrage réseau : les machines Tailscale ne sont proposées que lorsqu'elles
  répondent réellement ;
- tests réels sur Alise_v2 avec modèles locaux et ChatGPT Pro, notamment
  DARKSTAR via `100.73.222.64:11434` et Ministar Linux via `100.98.18.76` ;
- corrections de qualité de réponse : contexte mieux compacté, diagnostics
  d'une réponse vide, prompts d'outils plus stricts, exigence de fichiers
  réellement lus, réduction des réponses non sourcées ;
- explorateur de sources renforcé : restauration des fichiers cités, navigation
  entre fichiers concernés, symboles, plan et code coloré ;
- export plus sérieux des analyses : Markdown/HTML/PDF, avec préparation d'un
  chemin PDF natif inspiré de MarkPress ;
- génération de skill GitNexus pour que Codex/Claude puissent utiliser le dépôt
  comme outil documentaire depuis leurs environnements ;
- bouton de reformulation du prompt dans le chat : le brouillon utilisateur est
  remplacé par une consigne structurée adaptée au dépôt sélectionné, demandant
  sources exactes, fichiers concernés, diagrammes si utiles et garde-fous
  anti-hallucination.

Le point important : les modèles locaux fonctionnent, mais ils montrent leurs
limites si le contexte ou les outils ne verrouillent pas assez bien le périmètre.
Un petit modèle peut conclure trop vite qu'un symbole n'existe pas ; GPT-5.5
reste meilleur pour vérifier, recouper et expliquer. La bonne direction n'est
donc pas "un modèle magique", mais un poste de pilotage : choix du modèle,
outils GitNexus, preuves visibles, fichiers cités et possibilité de comparer.

Commit poussé sur `phuetz/gitnexus-rs` :
`f7417e4 Improve GitNexus as a reliable analysis workstation`.

Validations avant push :
- `npm --prefix chat-ui run test -- ChatInput prompt-rewrite ChatExports ChatMessages ChatPanel WorkspacePanel use-chat chat-store chat-export` — 61 tests OK ;
- `npm --prefix chat-ui run build` — OK ;
- `cargo test -p gitnexus-cli commands::ask` — 17 tests OK ;
- `cargo test -p gitnexus-cli commands::generate` — 115 tests OK ;
- `git diff --check` — OK.

Note pour demain : la reformulation actuelle sait déjà nommer le dépôt
sélectionné (`Alise_v2`, GitNexus, etc.), mais elle ne connaît pas encore le
profil profond de chaque projet. Prochaine amélioration naturelle : injecter un
petit contexte projet calculé par GitNexus (langage dominant, frameworks,
dossiers métier, conventions et objectifs) pour adapter la reformulation à la
nature réelle du dépôt.

Signature : Codex / GPT-5.5, session locale Codex sur MINISTAR.

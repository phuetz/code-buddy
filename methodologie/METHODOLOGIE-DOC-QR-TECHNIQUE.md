# Méthodologie « Doc Q/R technique »

> **Version :** 1.0 — 29/04/2026
> **Auteur :** Patrice Huetz (agile-up.com) + Claude Opus 4.7 (1M ctx, Anthropic)
> **Objet :** Guide méthodologique reproductible pour produire une **documentation de réponses techniques** à un questionnaire client, à partir d'un repo de code legacy indexé.
> **Audience :** Architecte logiciel, expert technique amené à répondre par écrit à des questions précises sur un code existant.
> **Statut :** Validée par production — case study Alise multi-barèmes (Reponses-Questions-Impacts-v7.pdf, 49 p., bien accueillie en réunion CCAS 28/04/2026).

---

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble) — pour qui, quand, ce que ce n'est PAS
2. [Pipeline en 7 phases](#2-pipeline-en-7-phases) — du DOCX client au PDF qualité conseil
3. [Structure imposée par question](#3-structure-imposée-par-question) — §X.X.1-7 + bloc précisions complémentaires
4. [Cartouches couleur catalogués](#4-cartouches-couleur-catalogués) — palette, classes CSS, sémantique
5. [Workflow multi-LLM](#5-workflow-multi-llm) — qui fait quoi, et pourquoi pas Claude seul
6. [Critères de qualité livrable](#6-critères-de-qualité-livrable) — ce qui distingue une doc « qualité conseil »
7. [Estimation effort](#7-estimation-effort) — combien de temps, combien d'humain, combien de tokens
8. [Pièges éprouvés](#8-pièges-éprouvés) — leçons apprises sur le terrain Alise
9. [Liens vers le kit + case study Alise](#9-liens-vers-le-kit--case-study-alise)

---

## 1. Vue d'ensemble

### 1.1 Quand utiliser cette méthodologie

Cette méthodologie s'applique quand :

- Un client (interne ou externe) envoie un **questionnaire technique** sur un module de code legacy — typiquement un DOCX/PDF de 5 à 30 questions précises (« comment fonctionne X ? », « d'où vient le calcul Y ? », « quel impact si on modifie Z ? »).
- Le code source est **indexé** (graphe de code disponible) ou au moins accessible en lecture directe.
- Le délai de réponse attendu est **court** : 1 à 5 jours ouvrables — pas 3 semaines.
- Le destinataire attend une réponse **opposable** (citations littérales, références file:line) qui pourra être annexée à un cahier des charges, un dossier d'arbitrage, un PV de réunion.

### 1.2 Ce que cette méthodologie n'est PAS

- ❌ **Ce n'est pas une SFD** (Spécification Fonctionnelle Détaillée). Pour les SFD longues par module, voir `D:\taf\Alise_v2\SFD-Fonctionnelles\V2\METHODOLOGIE-PRODUCTION-DOC.md` v1.1 (méthodologie complémentaire, format différent).
- ❌ **Ce n'est pas un audit** complet du repo. L'audit produit un rapport sur l'ensemble du code ; la doc Q/R répond à des questions précises et seulement à elles.
- ❌ **Ce n'est pas un plan d'exécution** ni un plan d'implémentation. Le planning sort dans un document compagnon dédié (cf. §2 phase P5). Mélanger les deux pousse le destinataire à décider du *quand/comment* avant d'avoir validé le *quoi* — biais d'ancrage à éviter.
- ❌ **Ce n'est pas une documentation utilisateur** ni de la formation. Public cible : DSI, architecte, chef de projet technique.

### 1.3 Livrables produits

Trois fichiers à la sortie de la méthodologie :

| Livrable | Format | Volume typique | Public |
|---|---|---|---|
| **Doc Q/R principale** | PDF qualité conseil | 30-60 pages | Métier + DSI + architecte |
| **Doc compagnon roadmap** *(optionnelle)* | PDF format compagnon | 5-10 pages | DSI + chef de projet |
| **Sources markdown** | `.md` versionnable | — | équipe interne, archivage |

### 1.4 Inputs requis

- Le **DOCX client** des questions (ou équivalent : PDF, ticket d'arbitrage, mail formaté).
- Le **repo source** indexé via GitNexus (ou accessible en lecture directe pour les citations).
- Optionnellement : la **doc existante** du module (SFD, READMEs, tickets résolus) pour le RAG.
- Une **session LLM** Claude Code (l'orchestrateur) + accès à un LLM tiers (Codex/Gemini) pour la vérification croisée.

### 1.5 Principe directeur

> **Zéro contenu inventé. Toute affirmation est traçable au code, à la BDD ou à un document métier signé.**

Si une question demande « combien de fois telle méthode est-elle appelée ? » et que ni le code ni le RAG ne le disent, on répond *« non-déterminable depuis le code statique, à valider par instrumentation runtime »* — pas une estimation au doigt mouillé.

---

## 2. Pipeline en 7 phases

```
P0  Cadrage           — récupérer questions + indexer repo + cadrer périmètre
P1  Squelette v3      — markdown qualité conseil, 1ère passe Claude
P2  Vérif croisée     — Codex en parallèle sur le même périmètre
P3  Fusion            — intégrer Codex dans v3 + ajouter précisions GitNexus
P4  Pipeline PDF      — markdown → HTML → PDF (cover, mermaid, screenshots)
P5  Roadmap compagnon — extraire le planning si présent (doc séparée)
P6  QC + livraison    — relecture visuelle, advisor, push
```

### P0 — Cadrage (≈30 min — 2h selon ampleur)

**Inputs récupérés** :
- DOCX/PDF des questions client → `questions/Questions-Original.docx`
- Repo source indexé : `gitnexus analyze <repo>` si pas encore fait
- Optionnellement, RAG indexé : `gitnexus rag ingest <docs-folder>`
- Métadonnées projet : nom client, contact, date de remise, ton attendu (conseil / technique pur / juridique-friendly)

**Décisions à prendre** :
- Le repo a-t-il une indexation GitNexus à jour ? Sinon, lancer `gitnexus analyze` + `gitnexus embed` (~30 min sur un repo 1000 fichiers).
- Y a-t-il des screenshots dans le DOCX original ? Si oui, prévoir leur extraction automatique en P4 (un screenshot par question, injecté juste avant la réponse).
- Le client attend-il un companion roadmap, ou juste les réponses ? **Par défaut : juste Q/R**, on extrait le planning seulement si demandé.
- Numérotation des questions : conserver celle du DOCX client (ex. Q1.1, Q1.2, Q2.1 …) pour faciliter la relecture croisée.

**Livrable de P0** : un fichier `META.md` qui fixe :
- Les 19 (ou N) questions extraites + leur numérotation
- Le repo source + commit indexé + date d'indexation
- Le délai de remise + format livrable (PDF / Word / les deux)
- La méthodologie LLM choisie (Claude seul / Claude + Codex / Claude + Codex + Gemini)

### P1 — Squelette v3 (≈3-4h pour 19 questions)

Production du **markdown qualité conseil** par Claude. Ce squelette devient la référence v3.

**Composantes obligatoires** :
1. Header avec table version/date/auteur/repo analysé
2. **§1 Executive Summary** — 4 sous-sections : question posée, réponse synthétique (table), effort estimé, lecture conseillée
3. **§2 Constats critiques** — 3 max, codifiés 🔴 (bloquant) ou 🟡 (warning), chacun avec source code (file:line + extrait), conséquence chiffrée si possible, action recommandée
4. **§3 Cartographie technique de référence** — architecture en couches (text-art ou mermaid), table des méthodes clés, tables EF/Prisma/SQLAlchemy clés, énumérations métier
5. **§4-§5 Réponses aux questions** — une §X par question, structure §X.X.1-7 imposée (cf §3 ci-dessous)
6. **§6 Exemple numérique tracé** — un cas concret qui exécute mentalement l'algorithme avec des chiffres
7. **§7 Diagrammes Mermaid** — 4 à 6 diagrammes (flowchart, séquence, classes, state) qui rendent visibles les flux clés
8. **§8 Synthèse — Impacts** — table des composants à modifier avec difficulté/risque
9. **§10 Annexes** — glossaire des codes BDD, liste des fichiers à modifier, tests à reprendre

**Sources de vérité Claude** (à croiser systématiquement) :
- Code source via `Read` + `Grep` (citations littérales)
- Graphe GitNexus via `gitnexus context` / `gitnexus impact` / `gitnexus cypher`
- RAG documentaire via `gitnexus ask` (réponses ancrées dans les docs CCAS / SFD existantes)

**Sortie** : `Reponses-Questions-Impacts-v3.md` (markdown, ~1200 lignes pour 19 questions).

### P2 — Vérification croisée (≈1-2h)

Lancement d'un **second LLM en parallèle** (Codex GPT-5+ recommandé) sur le **même périmètre** : questions + repo. L'objectif n'est pas une révision rédactionnelle, c'est une **analyse statique indépendante** qui peut converger ou diverger des conclusions de Claude.

**Prompt type Codex** :

```
Tu reçois ce questionnaire client + ce repo source. Pour chaque question :
- réponds en t'appuyant strictement sur le code source du repo
- pour chaque affirmation, cite le fichier et la ligne (`fichier.cs:123`)
- si une convention est ambiguë, dis-le et propose l'interprétation que le code suggère
- structure ta réponse en : synthèse, fonctionnement interne détaillé, formules nommées (pseudo-code), preuves code (file:line)
- ne propose PAS de roadmap ni de planning — uniquement les réponses techniques

Format de sortie : DOCX qui complète une version v3 existante (que tu reçois aussi).
```

**Sortie attendue** : `Reponses-Questions-Impacts-v6-Codex.docx` (ou markdown équivalent).

**Critère de réussite** : Codex doit **converger** sur la majorité des constats critiques et **apporter des preuves code supplémentaires** (file:line non cités par Claude). Toute divergence majeure doit être traitée (advisor + relecture humaine).

### P3 — Fusion (≈2-3h)

Fusion programmatique v3 + Codex + précisions GitNexus dans une v7 finale. Réalisée par un **script idempotent** (cf. kit, `_build_qr_md.py`) qui :

1. **Conserve le squelette v3 intact** — numérotation, structure §X.X.1-7, mermaid, tableaux. Pas de réécriture.
2. **Ajoute par question un bloc « Précisions complémentaires (Codex + GitNexus) »** comprenant :
   - **Synthèse Codex** (2-3 bullets) — ce que Codex a confirmé, contredit ou nuancé
   - **Fonctionnement interne détaillé** (2-4 bullets) — extrait Codex, mécanique observée
   - **Formules nommées** (encadrés pseudo-code) — 1 à 3 formules par question, nommées (ex. *État groupe*, *Trop-perçu bénéficiaire*, *Plafond révisé*)
   - **Preuves code** — `file:line ; file:line ; …` ligne unique
   - **Précisions GitNexus** (optionnel, sur les questions chaudes) — citations littérales du code (blocs C#/Python/JS), traces d'appels complètes, observations *non-évidentes* (un commentaire-aveu dans le code, un cas particulier non couvert, etc.)
3. **Ajoute deux annexes** : F « Catalogue des formules vérifiées » + G « Check-list de validation pré-prod »

**Sortie** : `Reponses-Questions-Impacts-v7.md` (~1700-2100 lignes pour 19 questions).

### P4 — Pipeline PDF (≈30-60 min, automatisé)

Pipeline déterministe `markdown → HTML → PDF` avec rendu **qualité conseil**.

**Ingrédients** :
- **Pandoc** (markdown → HTML5 standalone avec TOC, fenced_divs, raw_html)
- **CSS qualité conseil** : EB Garamond serif, max-width 17 cm, margin 2.5 cm, palette définie (cf §4)
- **Cover page custom HTML** injectée après pandoc en remplacement du title block (titre + sous-titre + divider + métadonnées + footer méthodologie)
- **Screenshots du DOCX original** extraits via python-docx + injectés par question via une mapping (titre normalisé → liste d'images)
- **Diagrammes Mermaid** rendus en PNG via **mermaid.ink** (Kroki en fallback s'il répond) puis cachés sur SHA-256 du source mermaid → réutilisables entre rebuilds
- **Chrome headless** pour le rendu final PDF (`--print-to-pdf`, A4, no header/footer)

**Sortie** : `Reponses-Questions-Impacts-v7.pdf` (~30-60 pages, 3-6 MB).

### P5 — Roadmap compagnon (optionnel, ≈30 min)

Si le squelette v3 a inclus une section roadmap (par habitude ou par anticipation), **l'extraire** dans un document séparé.

**Sortie** : `Roadmap-Multi-Baremes-v7.pdf` (~5-10 pages) avec :
- Cover « DOCUMENT COMPAGNON — ROADMAP » (sobre, distincte de la cover principale)
- §1 Contexte (lien vers la doc Q/R principale)
- §2 Préconisations — roadmap par phases
- §3 Recommandation LLM tiers (Codex 4 phases, Gemini, etc. — si pertinent)
- §4 Articulation roadmap technique ↔ recommandation tierce (table de mapping)
- §5 À propos

**Pourquoi séparé** : voir mémoire feedback `feedback_qa_docs_scope.md`. Présenter roadmap dans la même doc qu'analyse pousse le métier à se prononcer sur le *quand/comment* avant d'avoir validé le *quoi*.

### P6 — QC + livraison (≈30-60 min)

**Étapes** :

1. **Inspection visuelle** — rendre les pages clés en PNG (`pdftoppm -r 110 -f X -l Y`), vérifier :
   - Cover correcte (titre + version + auteur)
   - TOC visible et cohérente (toutes les sections ressortent)
   - Cartouches couleur (rouge constats, jaune Codex, bleu à retenir) bien rendus
   - Pas de tables clippées (la dernière colonne ne dépasse pas)
   - Diagrammes mermaid présents en PNG (pas en code block)
   - Pages clés (Q les plus chaudes, exemple numérique tracé)

2. **Advisor** — appeler l'advisor pour une relecture critique du document final. L'advisor a vu toute la session, peut détecter :
   - Une contradiction entre deux sections
   - Un point qui aurait dû être un constat critique et qui ne l'est pas
   - Un libellé technique flou pour le métier
   - Une preuve manquante sur un point sensible

3. **Régression visuelle** — comparer page count, taille, cartouches avec la cible attendue (sur une refonte d'un projet existant).

4. **Livraison** — push markdown source dans le repo, commit du PDF dans le dépôt projet (ou envoi par mail si dépôt non-versionné).

---

## 3. Structure imposée par question

Chaque question Q1.x ou Q2.x a la même structure interne, sauf si la question est triviale (alors structure réduite à un paragraphe + cf §X).

### 3.1 Structure §X.X.1-7

```
### X.X QY.Z — <Titre court reformulé>

(intro — 1 paragraphe qui pose la question telle que le client l'a écrite)

#### §X.X.1 Présentation

(le quoi — 2-3 lignes pour qu'un non-tech comprenne)

#### §X.X.2 Source

(file:line — où ça vit dans le code)

#### §X.X.3 Préconditions

(ce qui doit être vrai avant l'appel — bullets)

#### §X.X.4 Algorithme

```
ENTRÉE : <param typés>
SORTIE : <type retour>

1. <étape 1>
2. <étape 2>
   - <sous-étape>
   - <sous-étape>
3. <étape 3>
…
```

#### §X.X.5 Post-conditions

(ce qui est vrai après l'appel — invariants garantis)

#### §X.X.6 Cas d'erreur

(exceptions levées, codes d'erreur, NRE potentiels)

#### §X.X.7 Impact <thématique-de-la-doc> (ex: multi-barèmes)

(ce qui change pour la migration / refonte / scope demandé)
```

### 3.2 Bloc « Précisions complémentaires (Codex + GitNexus) »

Ajouté à chaque question lors de la P3 (fusion). Pas de numérotation §X.X.8 — un label seul (la numérotation §X.X.8 entre en collision avec les questions qui ont nativement §X.X.8 à §X.X.10 dans leur structure).

```markdown
#### Précisions complémentaires (Codex + GitNexus)

**🔍 Synthèse Codex (vérification croisée)**

- <bullet 1>
- <bullet 2>

**⚙️ Fonctionnement interne détaillé**

- <bullet 1>
- <bullet 2>

**📐 Formules nommées**

*<Nom de la formule>* :

```
<pseudo-code>
```

**🧾 Preuves code** : `file1.cs:123-145 ; file2.js:67 ; file3.cshtml:200-205`

**🔬 Précisions GitNexus (analyse code complémentaire)** *(optionnel)*

- **Citation littérale du code** — `file.cs:123` :
  ```csharp
  // smoking-gun comment ou code authentique
  ```
- **Trace d'appel complète** : `MethodA → MethodB → MethodC (file:line)`
```

### 3.3 Pourquoi cette structure

- Le destinataire (DSI / architecte) **scanne d'abord §X.X.1** (le quoi) puis va à **§X.X.7** (l'impact) pour décider de l'effort. La §X.X.4 (algorithme) sert le développeur qui devra modifier le code.
- Le bloc « Précisions complémentaires » sert de filet : si Claude a manqué un point, Codex le rattrape (et inversement). La double couche est **intentionnelle**, pas redondante.
- Les **citations littérales** (Précisions GitNexus) sont le différenciateur qualité conseil : un commentaire dans le code (« plafond groupe, ou que prendre ? on prend le minimum ») vaut 100 lignes d'analyse — il prouve que le développeur n'avait pas de règle métier validée au moment de l'implémentation.

---

## 4. Cartouches couleur catalogués

Tous les cartouches sont définis dans `kit/css/qualite-conseil.css`. Palette EB Garamond, A4, max-width 17 cm.

| Cartouche | Classe CSS | Fond | Bordure | Sémantique |
|---|---|---|---|---|
| **🔴 Constat critique** | `.constat-critique` | `#FDECEC` rouge clair | `#C00000` rouge foncé 5px | Bloquant — décision métier requise avant prod. Max 3 par doc. |
| **🟡 Constat warning** | (markdown vanilla 🟡) | — | — | Limite/contrainte technique connue. Pas bloquant mais à acter. |
| **🔍 Vérif croisée Codex** | `.verif-codex` | `#FFF8E1` jaune ambré | `#E69138` orange 4px | Confirmation indépendante par un 2e LLM. Liste les preuves code additionnelles. |
| **📐 Formule nommée** | `<pre>` standard | `#F5F5F5` gris très clair | `#555` gris 3px gauche | Pseudo-code calculatoire (ex. *Trop-perçu bénéficiaire*) |
| **💻 Citation code littérale** | `<pre>` standard | `#F5F5F5` | `#555` 3px | Bloc C#/Python/JS extrait verbatim du repo |
| **✓ À retenir** | `.a-retenir` | `#DEEAF6` bleu clair | `#1F4E79` bleu foncé 4px | Synthèse 1 phrase à mémoriser (1-2 par section, max 1 par question) |
| **📊 Cartouche analyse** | `.cartouche-analyse` (= `<blockquote>`) | `#F2F2F2` gris | `#1F4E79` bleu 4px | Notes d'analyse, recommandation, hypothèse à valider |

### 4.1 Niveaux de confiance Codex

Les blocs « Vérification croisée Codex » portent un badge de niveau de confiance :

```html
<span class="confiance elevee">Élevée</span>
<span class="confiance moyenne">Élevée moyenne</span>
```

| Niveau | Classe | Couleur badge | Quand |
|---|---|---|---|
| Élevée | `.confiance.elevee` | `#548235` vert | Codex confirme intégralement les constats Claude |
| Moyenne | `.confiance.moyenne` | `#E69138` orange | Codex apporte des preuves différentes / nuance les constats |

### 4.2 Discipline d'usage

- **3 constats critiques max** par document. Au-delà, c'est un audit, pas une doc Q/R.
- **1 « À retenir » max par question**. Sinon ils se diluent et personne ne les retient.
- **Pas d'emoji custom** au-delà du catalogue — cohérence visuelle entre projets.
- **Pas de cartouche vide** — si aucun fait critique sur une question, ne pas mettre de cartouche pour le plaisir.

---

## 5. Workflow multi-LLM

### 5.1 Pourquoi pas Claude seul

Claude seul produit une excellente v3. Mais :
- Il peut **rater une preuve code** non évidente (commentaire-aveu, cas particulier)
- Il peut **manquer une convention de signe** (cf. Alise Q2.10 : trop-perçu négatif = standard, contre-intuitif)
- Il peut **suriner** une analyse alors que le code dit tout simplement le contraire

Un **2e LLM en analyse statique indépendante** rattrape 5-10 % des points manqués. C'est la valeur ajoutée principale du multi-LLM dans ce contexte.

### 5.2 Rôles par LLM (configuration recommandée)

| LLM | Rôle | Quand l'utiliser | Sortie |
|---|---|---|---|
| **Claude** (Opus 4.7+ avec 1M ctx) | Architecte, rédaction, orchestration, fusion | P0, P1, P3, P4, P5, P6 | v3 markdown + script de fusion + pipeline PDF |
| **Codex** (GPT-5.5+) | Analyse statique indépendante | P2 (en parallèle de P1 si possible) | v6 DOCX/MD enrichi (synthèse + fonctionnement + formules + preuves) |
| **Advisor** (modèle reviewer interne) | Relecture critique aux checkpoints | Avant P3 (avant fusion), avant P6 (avant livraison) | Liste de points à corriger |
| **Gemini** (2.5 Pro+) — **optionnel** | Sources externes, vérification tierce, volume | P1 si grosse doc, P6 si question juridique/réglementaire | Notes de relecture, références doctrinales |

### 5.3 Cas d'usage simplifié — Claude seul

Pour les petits questionnaires (≤ 8 questions) ou les budgets serrés, Claude seul est viable :
- Phase P2 → remplacée par un **prompt « relecture critique »** au sein de la même session Claude (ou advisor).
- Phase P3 → simplifiée : pas de fusion, juste un passage de relecture critique de la v3.
- Coût en qualité : -10 à -15 % de couverture sur les preuves code, mais le squelette + cartouches + pipeline PDF restent identiques.

### 5.4 Cas d'usage maximal — Claude + Codex + advisor + Gemini

Pour des dossiers à enjeu juridique (validation commission, contestation, dossier d'arbitrage) :
- Codex apporte les preuves code indépendantes
- Gemini cherche les références réglementaires / SFD historiques
- Advisor relit avant livraison

Coût additionnel : +30-50 % de tokens / temps. Justifié uniquement quand le destinataire peut contester en justice ou en commission.

---

## 6. Critères de qualité livrable

Une doc Q/R « qualité conseil » doit cocher tous ces critères. Si un critère manque, c'est un livrable « technique » (acceptable mais inférieur).

### 6.1 Contenu

- [ ] **Zéro contenu inventé** — toute affirmation est traçable au code, à la BDD ou à un document signé.
- [ ] **Citations littérales** sur les points sensibles (≥ 1 par constat critique).
- [ ] **3 constats critiques max**, codifiés rouge/jaune.
- [ ] **Numérotation conservée** depuis le DOCX client.
- [ ] **Effort estimé** chiffré en jours-homme, ventilé (BDD / backend / IHM / tests).
- [ ] **Au moins 1 exemple numérique tracé** dans le doc (un cas concret avec des chiffres qui exécute mentalement l'algorithme).

### 6.2 Forme

- [ ] **Cover page custom** — titre + sous-titre + divider + métadonnées + footer méthodologie.
- [ ] **TOC présent et cohérent** (1 ligne par section H2).
- [ ] **EB Garamond serif** + palette bleu nuit (`#1F4E79`) — pas de Times New Roman, pas d'Arial.
- [ ] **Cartouches couleur** appliqués selon catalogue (cf. §4).
- [ ] **Diagrammes mermaid** rendus en PNG (jamais en code block dans la version finale).
- [ ] **Tables sans clipping** — toutes les colonnes visibles à droite.
- [ ] **Pages numérotées** sauf cover.

### 6.3 Méthodologie

- [ ] **Multi-LLM** documenté — section « À propos » qui dit quels LLM ont été utilisés et pour quoi.
- [ ] **Vérification croisée traçable** — preuves code Codex listées.
- [ ] **Roadmap séparée** si présente — dans un document compagnon.
- [ ] **Markdown source versionnable** livré en plus du PDF.
- [ ] **Reproductibilité** — un script idempotent permet de re-générer le PDF en < 5 min.

### 6.4 Test de validation final

Faire lire la doc à **un développeur qui n'a jamais touché ce module** et lui demander :
1. *Combien de jours pour migrer ce module ?* — il doit pouvoir répondre.
2. *Quelle est la règle pour le calcul X ?* — il doit pouvoir citer la formule.
3. *Quels sont les 3 risques majeurs ?* — il doit pouvoir les nommer.

Si oui aux 3 → la doc est qualité conseil. Si non → relecture nécessaire.

---

## 7. Estimation effort

### 7.1 Doc Q/R standard (15-20 questions)

| Phase | Effort humain | Effort LLM (claude session) | Total horloge |
|---|---|---|---|
| P0 Cadrage | 30 min — 2 h | — | 30 min — 2 h |
| P1 Squelette v3 | 0 (vérif uniquement) | 3-4 h | 3-4 h |
| P2 Vérif croisée Codex | 0 (lance + récupère) | 1-2 h en parallèle | en parallèle de P1 |
| P3 Fusion | 30 min de validation | 2-3 h | 2-3 h |
| P4 Pipeline PDF | 0 (auto) | 30-60 min | 30-60 min |
| P5 Roadmap compagnon | 0-30 min | 30 min si demandée | 30 min — 1 h |
| P6 QC + livraison | 30-60 min | 30-60 min | 30 min — 1 h |
| **TOTAL** | **2-4 h humain** | **6-10 h LLM** | **8-12 h horloge** |

### 7.2 Variables d'ajustement

- **Repo non indexé** : +2-4 h pour P0 (analyse + embedding)
- **Pas de RAG documentaire** : -1-2 h (moins de croisement, mais aussi moins de richesse métier)
- **Multi-LLM complet (Codex + Gemini + advisor)** : +3-5 h
- **Anonymisation** (livraison externe) : +1-2 h
- **Cycle d'aller-retour client** : +50 % par cycle additionnel

### 7.3 Coût LLM approximatif (Claude Opus 4.7 1M ctx + Codex GPT-5.5)

Pour 19 questions, repo Alise (1065 fichiers) :
- ~500-800 K tokens d'input Claude (lecture code + RAG + DOCX questions)
- ~150-250 K tokens d'output Claude (markdown + scripts)
- ~200-400 K tokens Codex (lecture code + sortie)

Coût estimé (tarifs avril 2026) : **30-80 € de tokens** selon profondeur de relecture.

À comparer aux jours-homme épargnés côté équipe développement (qu'on fait gagner sur l'analyse + la rédaction + les itérations de relecture) : **typiquement 5-10 j/h économisés**, soit un ROI 30-100x.

---

## 8. Pièges éprouvés

Leçons apprises lors de la production Alise multi-barèmes (avril 2026). Chaque piège a coûté du temps, donc autant les éviter à la prochaine itération.

### 8.1 Kroki bloqué dans le sandbox

**Symptôme** : `https://kroki.io/mermaid/png` répond mais pendouille (timeout 60 s, 0 byte). Affecte les sandbox réseau restrictifs.

**Solution éprouvée** : basculer sur **mermaid.ink** (encodage URL-safe-base64 + JSON envelope `{"code": "...", "mermaid": {}}`). Plus rapide, moins de friction. Voir `kit/_render_mermaid.py`.

**Note** : mermaid.ink peut renvoyer 5xx en transient. Retry 1 fois suffit (cas Alise : 3/5 au premier essai, 5/5 après retry).

### 8.2 PDF locké par le viewer

**Symptôme** : `shutil.copy2(out_pdf, dst_pdf)` lève `PermissionError: [WinError 32]` parce que le destinataire a la version précédente ouverte dans Adobe Reader / SumatraPDF / etc.

**Solution éprouvée** : écrire le nouveau PDF sous un nom temporaire (`-clean.pdf` ou suffixe timestamp), demander au destinataire de fermer le viewer, puis renommer.

**Solution prévention** : intégrer dans le script de build une option `--output-suffix` qui produit toujours un fichier nouveau, jamais d'écrasement.

### 8.3 Numérotation §X.X.8 qui collisionne

**Symptôme** : ajouter une §X.X.8 « Précisions complémentaires » fonctionne pour Q1.4 (qui a §X.X.1-7) mais collisionne avec Q2.10 (qui a déjà une §5.10.10 dans la structure v3).

**Solution éprouvée** : utiliser un **label seul** sans numéro pour le bloc de précisions : `#### Précisions complémentaires (Codex + GitNexus)`. Plus stable, plus lisible.

### 8.4 `table-layout: fixed` qui explose les pages

**Symptôme** : tentative d'éviter les tables clippées en passant la CSS à `table-layout: fixed` → page count passe de 49 à 75 (toutes les colonnes deviennent une largeur arbitraire qui force les wraps).

**Solution éprouvée** : laisser `table-layout: auto` et accepter le clipping marginal sur les très grosses tables (la `§8 Synthèse — Impacts` clippait 5 mm à droite — acceptable). Pour les tables trop larges, raccourcir les libellés ou splitter en deux tables.

### 8.5 Double couche Codex (intentionnelle)

**Symptôme** : un relecteur peut s'étonner de voir **deux blocs Codex** par question (le bloc jaune `:::verif-codex` injecté par le pipeline PDF + le nouveau bloc `Précisions complémentaires` injecté par la fusion v7).

**Pas un bug, c'est un design** : le bloc jaune liste les **preuves code additionnelles** (file:line bullets), le bloc précisions développe l'**analyse**. Les deux ont des rôles complémentaires.

**Solution préventive** : documenter cette dualité dans la §1.5 « Nouveautés vN » du markdown.

### 8.6 Advisor recommande de stopper et l'utilisateur dit « continue »

**Symptôme** : l'advisor flag « C2+C3+C4 en une session = mauvaise idée » et l'utilisateur (Patrice) override avec « continue ».

**Solution éprouvée** : respecter l'override mais documenter le risque dans le journal + proposer un sentinel/filet AVANT d'avancer (ex. tests parity). Si on tombe sur une erreur, l'override + sentinel permet de revenir en arrière proprement.

### 8.7 Mermaid hash sensitive aux moindres changements

**Symptôme** : modifier un caractère dans un diagramme mermaid → nouveau hash SHA-256 → cache PNG miss → re-render via mermaid.ink (qui peut être lent / 5xx).

**Solution préventive** : ne **jamais** retoucher un mermaid après le premier rendu réussi. Si retouche nécessaire, prévoir le re-render avec retry.

### 8.8 Roadmap dans la doc Q/R

**Symptôme** : la v3 incluait une §9 « Préconisations & roadmap » par habitude. Le destinataire (Patrice après réunion CCAS) a flagué : « le planning n'a rien à faire dans la doc ».

**Leçon** : périmètre Q/R = réponses techniques seulement. Le planning va dans un compagnon dédié. Voir `feedback_qa_docs_scope.md`.

### 8.9 Anonymisation des screenshots

**Symptôme** : le DOCX client contient des captures d'écran avec des noms de personnes réels (cas Alise : Beatrice DURAND CHARDET visible dans une URL).

**Solution éprouvée** : passer chaque screenshot à un outil de blur (PIL + masques manuels) avant injection dans le PDF, **si le PDF est livré à un public élargi**. Pour livraison interne, OK de garder verbatim (les noms sont dans la BDD qualif de toute façon).

---

## 9. Liens vers le kit + case study Alise

### 9.1 Kit de scripts (Palier B de la méthodologie)

Le kit générique vit dans `D:\CascadeProjects\claude-et-patrice\methodologie\kit\` :

| Fichier | Usage |
|---|---|
| `kit/_build_qr_md.py` | Builder markdown générique (config-driven via `questions-config.json`) |
| `kit/_build_qr_pdf.py` | Pipeline PDF générique (pandoc + Chrome + cover + screenshots + mermaid PNG cache) |
| `kit/_build_companion.py` | Builder doc compagnon roadmap |
| `kit/_render_mermaid.py` | Renderer mermaid.ink (Kroki fallback) |
| `kit/css/qualite-conseil.css` | CSS externalisée (EB Garamond + cartouches) |
| `kit/cover-templates/{principal,compagnon,exec}.html` | 3 covers paramétrables |
| `kit/template-questions-config.json` | Schema de config par projet |
| `kit/template-skeleton-md.md` | Squelette markdown à remplir |
| `kit/README.md` | Quickstart kit |

### 9.2 Quickstart (Palier C)

Démarrer un nouveau projet Q/R en **30 minutes** : voir `methodologie/QUICKSTART.md`.

### 9.3 Case study : Alise multi-barèmes

| Métrique | Valeur |
|---|---|
| Client | CCAS (Centre Communal d'Action Sociale) |
| Module | Alise v2 — multi-barèmes / plafond de groupe |
| Volume questions | 19 (Q1.1–Q1.8 + Q2.1–Q2.11) |
| Source code | `D:\taf\Alise_v2` (1065 fichiers, 14 016 nœuds, 30 251 arêtes — indexé 17/04/2026) |
| Source DOCX questions | `Questions - Impacts.docx` (par Gabriel Berthelot) |
| Constats critiques | 3 (MIN plafond groupe, Int32 taux servi, PV ≠ paiement) |
| Effort total | ~12 h (P0 1h + P1 4h + P2 1h en parallèle + P3 3h + P4 1h + P5 1h + P6 2h) |
| Pages PDF | 49 (doc principale) + 6 (compagnon roadmap) |
| Taille PDF | 4,5 MB + 0,2 MB |
| Diagrammes mermaid | 5 (flowchart, 2 sequence, class, state) |
| Multi-LLM | Claude Opus 4.7 (1M ctx) + Codex GPT-5 + advisor |
| Accueil métier | Validé en réunion CCAS le 28/04/2026 |

### 9.4 Pour aller plus loin

- **SFD format long** : `D:\taf\Alise_v2\SFD-Fonctionnelles\V2\METHODOLOGIE-PRODUCTION-DOC.md` v1.1 — méthodologie complémentaire pour les SFD par module (245 pages, 12 SFD CCAS).
- **GitNexus skill** : `~/.claude/skills/gitnexus/SKILL.md` — commandes CLI pour l'extraction (`context`, `impact`, `cypher`, `ask`).
- **Convention multi-IA** : `claude-et-patrice/COLAB.md` (idée Lisa, avril 2026) — règles cardinales et journal partagé entre IA collaborantes.
- **Feedback périmètre Q/R** : `~/.claude/projects/.../memory/feedback_qa_docs_scope.md` — règle « Q/R doc ≠ planning ».

---

*Méthodologie validée par la production Alise multi-barèmes (28/04/2026). Première version 1.0, à enrichir au fil des prochains projets — chaque livraison qui apporte une nouvelle leçon doit être consignée dans §8 Pièges éprouvés.*

*Patrice Huetz · agile-up.com · Claude Opus 4.7 (1M ctx)*

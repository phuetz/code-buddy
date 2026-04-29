# QUICKSTART — Démarrer un nouveau projet Doc Q/R en 30 minutes

Ce guide te fait passer de **0 à un PDF qualité conseil** en 30 minutes, en s'appuyant sur la méthodologie + le kit de scripts du dossier `kit/`.

> **Pré-requis** :
> - Python 3.10+ avec `pip install python-docx`
> - WSL Ubuntu avec `pandoc >= 2.9` + `google-chrome` + `curl`
> - Repo source à documenter (de préférence indexé via GitNexus)
> - Questionnaire client au format DOCX, PDF ou markdown

---

## Pas-à-pas

### Étape 1 — Créer la structure projet (2 min)

```bash
# Choisir un nom court, kebab-case
mkdir mon-projet-qr && cd mon-projet-qr
mkdir questions

# Copier les templates depuis le kit
cp /path/to/methodologie/kit/template-questions-config.json ./config.json
cp /path/to/methodologie/kit/template-skeleton-md.md questions/Reponses-Questions-Impacts.md
```

### Étape 2 — Mettre la source en place (3 min)

```bash
# Si tu as un DOCX client, le poser dans questions/
cp /path/to/source/Questions-Client.docx questions/

# (optionnel) extraire le texte pour copier-coller dans le squelette
wsl pandoc questions/Questions-Client.docx -o questions/Questions-Client.md
```

### Étape 3 — Configurer le projet (5 min)

Ouvrir `config.json` et adapter au minimum :

```json
{
  "project": {
    "name": "Mon Projet — Sujet",
    "client": "ClientName",
    "module": "module concerné",
    "repo_path": "D:\\path\\to\\repo",
    "indexed_at": "2026-04-29",
    "indexed_metrics": { "files": 0, "nodes": 0, "edges": 0 }
  },
  "delivery": {
    "version": "1.0",
    "version_label": "première livraison",
    "date": "29 avril 2026",
    "author": "Patrice Huetz",
    "company": "agile-up.com",
    "deliverables": {
      "main_pdf": "Reponses-Questions-Impacts-v1.pdf",
      "companion_pdf": "Roadmap-Mon-Projet-v1.pdf",
      "main_md": "Reponses-Questions-Impacts-v1.md"
    }
  },
  "source": {
    "questions_docx": "questions/Questions-Client.docx",
    "questions_md_skeleton": "questions/Reponses-Questions-Impacts.md"
  }
}
```

Ajuster `pdf.cover_eyebrow`, `pdf.cover_subtitle`, `pdf.cover_footer` selon le ton voulu.

### Étape 4 — Rédiger les réponses (15 min — c'est le cœur du travail !)

Ouvrir `questions/Reponses-Questions-Impacts.md`. Pour chaque question du client :

1. **Créer une sous-section** `### N.M QX.Y — <Titre court reformulé>` (numérotation continue)
2. Remplir les **7 sous-paragraphes** §X.X.1 à §X.X.7 :
   - §1 Présentation (ce qu'est la chose, en 2-3 lignes)
   - §2 Source (`fichier:ligne`)
   - §3 Préconditions (ce qui doit être vrai)
   - §4 Algorithme (pseudo-code)
   - §5 Post-conditions (invariants)
   - §6 Cas d'erreur (exceptions, NRE)
   - §7 Impact (ce qui change pour la migration)

C'est ici que **Claude (toi) + Codex** sont les plus utiles : poser la question dans une session Claude, faire vérifier en parallèle par Codex (analyse statique indépendante), récupérer les preuves code via `gitnexus context` / `gitnexus impact` / `gitnexus cypher`.

**Pour chaque question, ajouter dans `config.json`** un objet :

```json
{
  "id": "Q1.1",
  "v3_heading": "### 4.1 Q1.1 — Paramétrage Création Groupe d'Aide",
  "complementary_block": {
    "synthese": ["bullet 1 — synthèse Codex", "..."],
    "fonctionnement": ["bullet 1 — fonctionnement", "..."],
    "formules": [
      { "name": "État groupe", "code": "EtatGroupe = ..." }
    ],
    "preuves_code": "GrpAideService.cs:272-277 ; ReglesGroupeAide.cs:22-79",
    "gitnexus_precisions": [
      "**Citation littérale** — `file.cs:123` :\n```csharp\n// code\n```"
    ]
  }
}
```

### Étape 5 — Lancer le pipeline (5 min)

```bash
KIT=/path/to/methodologie/kit

# 5.1 — Fusion squelette + enrichissements
python $KIT/_build_qr_md.py --config config.json
# → questions/Reponses-Questions-Impacts-enriched.md

# 5.2 — Pipeline PDF
python $KIT/_build_qr_pdf.py --config config.json
# → Reponses-Questions-Impacts-v1.pdf

# 5.3 (optionnel) — companion roadmap
python $KIT/_build_companion.py --config config.json
# → Roadmap-Mon-Projet-v1.pdf
```

Si le rendu mermaid timeout (sandbox réseau restrictif), le pipeline garde les diagrammes en code block — relancer plus tard ou activer Kroki en fallback.

---

## Points de vigilance

### Premier projet ? Ces 5 erreurs coûtent du temps

1. **Ne pas remplir `v3_heading` exactement** comme dans le markdown — l'insertion du bloc « Précisions complémentaires » échoue silencieusement.
2. **Numéroter §X.X.8** au lieu de mettre un label seul — collision sur Q2.10 (qui a déjà §5.10.10 en v3).
3. **Mermaid retouché après premier rendu** — nouveau hash → cache miss → re-render lent.
4. **Roadmap dans la doc principale** — extraire dans companion (cf principe `feedback_qa_docs_scope.md`).
5. **PDF locké par viewer** — fallback `-clean.pdf` automatique mais penser à fermer Adobe avant de re-lancer.

### Vérification avant livraison

```bash
# Pages count
wsl pdftoppm -r 90 -f 1 -l 5 Reponses-Questions-Impacts-v1.pdf qc/preview -png

# Inspection visuelle dans Explorer
explorer qc

# Vérifier mermaid en PNG (pas en code block)
grep -c "language-mermaid" _meta/build_qr/Reponses-Questions-Impacts-enriched.md
# Attendu : 0 (tous remplacés par <figure><img>)
```

---

## Cas d'usage de référence — Alise multi-barèmes

| Métrique | Alise (cas étalon) | Ton projet (à compléter) |
|---|---|---|
| Volume questions | 19 | ? |
| Repo source | 1 065 fichiers / 14 016 nœuds | ? |
| Constats critiques | 3 | ? |
| Effort total | ~12 h | ? |
| Pages PDF principal | 49 | ? |
| Pages PDF companion | 6 | ? |
| Diagrammes mermaid | 5 | ? |
| Multi-LLM | Claude + Codex + advisor | ? |
| Accueil métier | Validé en réunion CCAS 28/04 | ? |

Compare ton projet à cette ligne d'horizon. Si tu déraisonnes (effort 50 h ou 0 constat) → relire la méthodologie §6 « Critères de qualité livrable ».

---

## Pour aller plus loin

- **Méthodologie complète** : `methodologie/METHODOLOGIE-DOC-QR-TECHNIQUE.md` (9 sections, 573 lignes)
- **Kit scripts** : `methodologie/kit/README.md` (architecture du kit)
- **SFD format long** : `D:\taf\Alise_v2\SFD-Fonctionnelles\V2\METHODOLOGIE-PRODUCTION-DOC.md` (méthodo complémentaire pour les SFD modules)
- **Convention multi-IA** : `claude-et-patrice/COLAB.md` (idée Lisa, avril 2026)

---

*QUICKSTART v1.0 — 29/04/2026 — extraction de l'expérience Alise multi-barèmes (validée en réunion CCAS 28/04). Auteur : Patrice Huetz + Claude Opus 4.7 (1M ctx).*

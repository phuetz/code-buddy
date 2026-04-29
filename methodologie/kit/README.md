# Kit méthodologique « Doc Q/R technique »

Scripts génériques pour produire une **documentation de réponses techniques** (style PDF qualité conseil) à partir d'un questionnaire client + un repo de code indexé.

Voir `methodologie/METHODOLOGIE-DOC-QR-TECHNIQUE.md` pour la méthodologie complète.

---

## Démarrer un nouveau projet en 30 minutes

### 1. Créer le dossier projet (≈2 min)

```bash
mkdir -p MonProjet/questions
cd MonProjet
cp /path/to/methodologie/kit/template-questions-config.json .
cp /path/to/methodologie/kit/template-skeleton-md.md questions/Reponses-Questions-Impacts.md
```

### 2. Adapter le squelette markdown (≈5 min)

Ouvrir `questions/Reponses-Questions-Impacts.md` et remplacer les placeholders `{{...}}`.
La structure §X.X.1-7 par question est imposée — voir méthodologie §3.

Pour chaque question Q1.1, Q1.2, …, Q2.1, … : créer une sous-section `### 4.N QX.Y` (ou `### 5.N QX.Y` pour les §2 du DOCX client) avec les 7 sous-paragraphes.

### 3. Configurer (≈5 min)

Ouvrir `template-questions-config.json` et adapter :

```json
{
  "project": {
    "name": "Mon Projet — Multi-XYZ",
    "client": "ClientName",
    "repo_path": "D:\\path\\to\\repo",
    ...
  },
  "delivery": {
    "version": "1.0",
    "date": "DD MMM AAAA",
    "author": "Patrice Huetz",
    "company": "agile-up.com",
    ...
  },
  "questions": [
    {
      "id": "Q1.1",
      "v3_heading": "### 4.1 Q1.1 — Paramétrage Création Groupe d'Aide",
      "complementary_block": {
        "synthese": ["…"],
        "fonctionnement": ["…"],
        "preuves_code": "file.cs:123"
      }
    },
    ...
  ]
}
```

### 4. Indexer le repo source (≈5 min)

Si pas encore fait :
```bash
gitnexus analyze /path/to/repo
gitnexus embed --model ~/.gitnexus/models/all-MiniLM-L6-v2/model.onnx  # optionnel
```

Le repo doit avoir un `.gitnexus/` avec `graph.bin` à jour pour les requêtes Cypher / context / impact.

### 5. Lancer le pipeline (≈5 min)

```bash
# Étape 1 — fusion squelette + enrichissements config
python /path/to/kit/_build_qr_md.py --config template-questions-config.json
# → questions/Reponses-Questions-Impacts-enriched.md

# Étape 2 — pipeline PDF
python /path/to/kit/_build_qr_pdf.py --config template-questions-config.json
# → Reponses-Questions-Impacts-v1.0.pdf

# Étape 3 (optionnel) — companion roadmap
python /path/to/kit/_build_companion.py --config template-questions-config.json
# → Roadmap-Compagnon-v1.0.pdf
```

### 6. Vérification visuelle (≈8 min)

```bash
# Rendre quelques pages clés en PNG pour QC
wsl pdftoppm -r 110 -f 1 -l 5 Reponses-Questions-Impacts-v1.0.pdf qc/preview -png

# Ouvrir les pages dans un viewer
explorer.exe qc
```

Vérifications :
- [ ] Cover correcte (titre, version, auteur)
- [ ] TOC visible et cohérente
- [ ] Cartouches couleur appliqués (rouge/jaune/bleu)
- [ ] Diagrammes mermaid en PNG (pas en code block)
- [ ] Tables sans clipping
- [ ] Pages numérotées sauf cover

---

## Architecture du kit

```
kit/
├── README.md                      # ce fichier
├── _build_qr_md.py                # P3 fusion : squelette v3 + enrichissements config → enriched.md
├── _build_qr_pdf.py               # P4 pipeline PDF : enriched.md → cover + mermaid + screenshots → PDF
├── _build_companion.py            # P5 companion : extrait §9 → roadmap PDF séparée
├── _render_mermaid.py             # render mermaid blocks via mermaid.ink
├── css/
│   └── qualite-conseil.css        # CSS EB Garamond + cartouches couleur
├── cover-templates/
│   ├── principal.html             # cover du PDF principal
│   ├── compagnon.html             # cover du PDF companion roadmap
│   └── exec.html                  # cover résumé exécutif (optionnel)
├── template-questions-config.json # schema de config par projet
└── template-skeleton-md.md        # squelette markdown à remplir
```

---

## Pipeline résumé

```
[questions DOCX client]                       [repo source indexé]
        |                                           |
        v                                           v
   P0 Cadrage  →  questions/Reponses-Questions-Impacts.md (squelette v3)
        |
        v
   P1+P2 (rédaction Claude + vérif Codex en parallèle)
        |
        v   (apports Codex + précisions GitNexus consignés dans config.json)
        |
   P3   _build_qr_md.py --config           →  Reponses-...-enriched.md
        |
        v
   P4   _build_qr_pdf.py --config          →  Reponses-...-vN.pdf
                |                                ↑
                +--→ _render_mermaid.py     +--→ cover principal.html
                |    (mermaid.ink)          |
                +--→ extract_screenshots()  +--→ qualite-conseil.css
                     (depuis DOCX client)
        |
        v
   P5   _build_companion.py --config       →  Roadmap-Compagnon-vN.pdf
```

---

## Pré-requis toolchain

- **Python 3.10+** — `python-docx` requis pour l'extraction de screenshots (`pip install python-docx`)
- **WSL** (Ubuntu 22.04 ou plus récent) avec :
  - `pandoc >= 2.9` (`apt install pandoc`)
  - `google-chrome` (pour le rendu PDF headless)
  - `curl` (pour mermaid.ink)
- **GitNexus** — facultatif si tu n'utilises pas les commandes `gitnexus context/impact/cypher` pour rédiger

---

## Pièges éprouvés

Voir méthodologie §8 « Pièges éprouvés ». Résumé court :

| Symptôme | Solution |
|---|---|
| Kroki bloque (timeout 60s) | mermaid.ink (déjà actif par défaut) |
| PDF locké par viewer | fallback `-clean.pdf` automatique |
| Numérotation §X.X.8 collisionne | Utiliser label seul (déjà fait dans le builder) |
| `table-layout: fixed` explose les pages | Garder `auto` (déjà fait dans la CSS) |
| Mermaid hash sensible aux changements | Ne pas retoucher après premier rendu |

---

## Synergie avec d'autres méthodologies

- **SFD format long** (`D:\taf\Alise_v2\SFD-Fonctionnelles\V2\METHODOLOGIE-PRODUCTION-DOC.md` v1.1) : pour les docs d'ensemble par module (245 pages).
- **GitNexus skill** (`~/.claude/skills/gitnexus/SKILL.md`) : commandes CLI pour l'extraction.
- **COLAB.md** (`claude-et-patrice/COLAB.md`) : convention multi-IA.

---

## Versions

- **v1.0** — 29/04/2026 — extraction depuis l'expérience Alise multi-barèmes (Reponses-Questions-Impacts-v7.pdf, accueilli en réunion CCAS 28/04). Auteur : Patrice Huetz + Claude Opus 4.7 (1M ctx).

"""Build a Q/R technical doc markdown by fusing a v3 skeleton with Codex/GitNexus enrichments.

Generic version of `_build_v7.py` from the Alise project (28/04/2026).
Reads a config JSON describing the project + per-question enrichments, and produces
a fused markdown output ready for the PDF pipeline.

Usage:
    python _build_qr_md.py --config <config.json>

Where <config.json> matches the schema of template-questions-config.json in this kit.

Pipeline:
1. Read v3 skeleton markdown (config.source.questions_md_skeleton)
2. For each question in config.questions:
   a. Locate the v3 heading (config.questions[].v3_heading)
   b. Find the section's end (next "### " or "## " heading)
   c. Inject a "Précisions complémentaires (Codex + GitNexus)" block built from
      complementary_block.{synthese, fonctionnement, formules, preuves_code, gitnexus_precisions}
3. Inject annexes 10.4 (formules catalogue), 10.5 (validation checklist) if enabled
4. Update header banner version + final footer
5. Write to <output_path> (default: same dir as v3 skeleton with -enriched suffix)

The script is idempotent: re-running with the same config produces the same output.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def render_complementary_block(qid: str, block: dict) -> str:
    """Render the 'Précisions complémentaires (Codex + GitNexus)' subsection for a question."""
    out: list[str] = []
    out.append(f"\n#### Précisions complémentaires (Codex + GitNexus)\n")

    synthese = block.get("synthese") or []
    if synthese:
        out.append("**🔍 Synthèse Codex (vérification croisée)**\n")
        for s in synthese:
            out.append(f"- {s}")
        out.append("")

    fonctionnement = block.get("fonctionnement") or []
    if fonctionnement:
        out.append("**⚙️ Fonctionnement interne détaillé**\n")
        for f in fonctionnement:
            out.append(f"- {f}")
        out.append("")

    formules = block.get("formules") or []
    if formules:
        out.append("**📐 Formules nommées**\n")
        for formule in formules:
            name = formule.get("name", "")
            code = formule.get("code", "")
            out.append(f"*{name}* :\n")
            out.append("```")
            out.append(code)
            out.append("```")
            out.append("")

    preuves = block.get("preuves_code")
    if preuves:
        out.append(f"**🧾 Preuves code** : `{preuves}`\n")

    gitnexus = block.get("gitnexus_precisions") or []
    if gitnexus:
        out.append("**🔬 Précisions GitNexus (analyse code complémentaire)**\n")
        for g in gitnexus:
            out.append(f"- {g}")
            out.append("")

    return "\n".join(out)


def build_formules_annex(config: dict) -> str:
    """Build §10.4 — Catalogue des formules vérifiées (auto-collected from all questions)."""
    formules_all: list[tuple[str, str, str]] = []  # (qid, name, code)
    for q in config.get("questions", []):
        qid = q.get("id", "?")
        block = q.get("complementary_block") or {}
        for f in block.get("formules", []) or []:
            formules_all.append((qid, f.get("name", ""), f.get("code", "")))

    if not formules_all:
        return ""

    out = [
        "\n### 10.4 Catalogue des formules vérifiées",
        "",
        "> Cette annexe regroupe l'ensemble des formules calculatoires vérifiées contre",
        "> le code source. Elles sont également présentes dans les sections concernées —",
        "> l'annexe les rassemble pour la validation métier et les tests de non-régression.",
        "",
    ]
    for idx, (qid, name, code) in enumerate(formules_all, 1):
        out.append(f"#### F{idx} — {name} *(cf {qid})*")
        out.append("")
        out.append("```")
        out.append(code)
        out.append("```")
        out.append("")

    return "\n".join(out)


def build_checklist_annex(config: dict) -> str:
    """Build §10.5 — Check-list de validation pré-prod (template, à enrichir manuellement)."""
    checklist = config.get("annexes", {}).get("validation_checklist") or []
    if not checklist:
        # Fallback : template générique
        checklist = [
            {"id": "G-01", "item": "Décision métier explicitement validée pour le point sensible #1",
             "expected": "Choix tranché parmi les options techniques évaluées en §1.X"},
            {"id": "G-02", "item": "Cas de test : scénario nominal (1 entité)",
             "expected": "Sortie conforme à la formule F1"},
            {"id": "G-03", "item": "Cas de test : scénario multi-entités même valeur",
             "expected": "Sortie cohérente sur tous les chemins"},
            {"id": "G-04", "item": "Cas de test : scénario multi-entités valeurs différentes",
             "expected": "Comportement conforme à la décision G-01, documenté en SQL"},
            {"id": "G-05", "item": "Cas de test : entité exclue/désactivée",
             "expected": "L'entité exclue n'apparaît pas dans le calcul"},
            {"id": "G-06", "item": "Distinction explicite des termes ambigus dans l'IHM",
             "expected": "Tous les libellés contextualisés sans ambiguïté"},
            {"id": "G-07", "item": "Stabilité des données figées après validation",
             "expected": "Aucun recalcul silencieux après évolution"},
            {"id": "G-08", "item": "Couverture tests unitaires sur les modifs",
             "expected": "Tests adaptés et verts"},
            {"id": "G-09", "item": "Run batch / job fin de mois",
             "expected": "Sortie cohérente sur le rejeu pré-prod"},
            {"id": "G-10", "item": "Recette transverse client",
             "expected": "Toutes les questions du document rejouées en pré-prod"},
            {"id": "G-11", "item": "Plan de rollback documenté",
             "expected": "Script de retour testé, durée < 1h sur snapshot client"},
        ]

    out = [
        "\n### 10.5 Check-list de validation pré-prod",
        "",
        "> Cette check-list opérationnelle accompagne la phase 4 (Validation pré-prod) de la roadmap.",
        "> À cocher littéralement par l'équipe métier + DSI avant le go/no-go production.",
        "",
        "| # | Élément à valider | Résultat attendu |",
        "|---|---|---|",
    ]
    for entry in checklist:
        gid = entry.get("id", "")
        item = entry.get("item", "")
        expected = entry.get("expected", "")
        out.append(f"| **{gid}** | {item} | {expected} |")

    out.append("")
    out.append("**Critère go/no-go** : tous les éléments sont **OK** OU le métier a explicitement validé un dérapage avec mitigation documentée.")

    return "\n".join(out)


def fuse_markdown(config: dict, src_md: Path) -> str:
    """Apply the fusion logic to the v3 skeleton markdown using config."""
    src = src_md.read_text(encoding="utf-8")
    lines = src.split("\n")

    # Map each question id → start line index in the v3 skeleton
    qid_starts: dict[str, int] = {}
    for q in config.get("questions", []):
        qid = q.get("id", "")
        heading_prefix = q.get("v3_heading", "")
        if not heading_prefix:
            continue
        for i, ln in enumerate(lines):
            if ln.startswith(heading_prefix):
                qid_starts[qid] = i
                break

    # Compute end line for each question (first "### " or "## " heading after start)
    qid_next: dict[str, int] = {}
    for qid, start in qid_starts.items():
        end = len(lines)
        for j in range(start + 1, len(lines)):
            if lines[j].startswith("### ") or lines[j].startswith("## "):
                end = j
                break
        qid_next[qid] = end

    # Build insertion points: at qid_next[qid] - blank/separator backlash
    insertions: dict[int, str] = {}
    for q in config.get("questions", []):
        qid = q.get("id", "")
        if qid not in qid_next:
            continue
        block = q.get("complementary_block")
        if not block:
            continue
        rendered = render_complementary_block(qid, block)
        if not rendered.strip():
            continue
        insert_at = qid_next[qid]
        while insert_at > 0 and lines[insert_at - 1].strip() in ("", "---"):
            insert_at -= 1
        insertions[insert_at] = "\n" + rendered + "\n"

    # Walk lines, inject at insertion points
    out_lines: list[str] = []
    for i, line in enumerate(lines):
        if i in insertions:
            out_lines.append(insertions[i])
        out_lines.append(line)
    fused = "\n".join(out_lines)

    # Inject annexes
    annexes = config.get("annexes", {})
    annex_blocks: list[str] = []
    if annexes.get("include_formules_catalogue", True):
        annex_blocks.append(build_formules_annex(config))
    if annexes.get("include_validation_checklist", True):
        annex_blocks.append(build_checklist_annex(config))

    annex_combined = "\n".join(b for b in annex_blocks if b) + "\n\n---\n"
    if annex_combined.strip():
        # Insert before the final "*Document généré le ..." footer, or append if missing
        footer_re = re.compile(r"\n\*Document généré le ", re.DOTALL)
        if footer_re.search(fused):
            fused = footer_re.sub("\n" + annex_combined + "\n*Document généré le ", fused, count=1)
        else:
            fused += "\n\n" + annex_combined

    # Header banner update
    delivery = config.get("delivery", {})
    version = delivery.get("version", "?")
    version_label = delivery.get("version_label", "")
    delivery_date = delivery.get("date", "")

    fused = re.sub(
        r"\| \*\*Version\*\* \| [^|]* \|",
        f"| **Version** | {version} ({version_label}) |",
        fused,
        count=1,
    )
    fused = re.sub(
        r"\| \*\*Date\*\* \| [^|]* \|",
        f"| **Date** | {delivery_date} |",
        fused,
        count=1,
    )

    # Footer update
    author = delivery.get("author", "")
    company = delivery.get("company", "")
    repo_path = config.get("project", {}).get("repo_path", "")

    fused = re.sub(
        r"\*Document généré le [^*]*\*",
        f"*Document généré le {delivery_date} par {author} ({company}) avec Claude — {version_label}.*",
        fused,
        count=1,
    )

    return fused


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a fused Q/R technical doc markdown")
    parser.add_argument("--config", type=Path, required=True, help="Path to the config JSON")
    parser.add_argument("--output", type=Path, default=None,
                        help="Output markdown path (default: <skeleton>-enriched.md)")
    args = parser.parse_args()

    if not args.config.is_file():
        print(f"ERROR: {args.config} not found", file=sys.stderr)
        return 2

    config = json.loads(args.config.read_text(encoding="utf-8"))
    src_md = Path(config["source"]["questions_md_skeleton"])
    if not src_md.is_absolute():
        src_md = args.config.parent / src_md
    if not src_md.is_file():
        print(f"ERROR: skeleton {src_md} not found", file=sys.stderr)
        return 2

    fused = fuse_markdown(config, src_md)

    if args.output is None:
        args.output = src_md.with_name(src_md.stem + "-enriched.md")
    args.output.write_text(fused, encoding="utf-8")
    print(f"OK {args.output} ({len(fused.splitlines())} lines, {args.output.stat().st_size//1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

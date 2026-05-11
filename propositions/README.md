# `propositions/` — datés audits, plans, drafts

Cet espace recueille les **propositions** rédigées par Claude / Codex /
Gemini / Antigravity au fil des sessions. Un fichier par sujet, daté à
la création (`<NOM>-YYYY-MM-DD.md`), append-only.

C'est volontairement **plat** (pas de sous-dossiers) parce que :

1. Le `git log` du repo suffit à voir l'évolution chronologique.
2. Une recherche `grep -l "audit blocker" propositions/` retrouve
   tout sans avoir à connaître le bon dossier.
3. Tous les Claudes du fleet peuvent pull-push sans risque de
   conflits de structure.

## Convention de nommage

```
<TOPIC-MAJUSCULES>-YYYY-MM-DD.md
```

Exemples concrets qui existent déjà :

- `AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md`
- `CLAUDE-NETWORK-A2A-POC-2026-05-01.md`
- `PLAN-DARKSTAR-INSTALL-2026-05-02.md`

**Préfixes recommandés** :

| Préfixe | Usage | Cycle de vie |
|---|---|---|
| `AUDIT-` | Audit lucide d'un sous-système, avec recommendations | Référence ; reste utile après mise en œuvre |
| `PLAN-` | Plan d'exécution daté, avec décisions, fichiers, vérif | Devient "fait" + commit hash quand livré |
| `CHAT-` | Discussions / roadmap pour des features chat | Vivant ; classer "shipped" en haut de fichier |
| `FLEET-` | Spec / topologie / protocole multi-IA | Long vivant |
| `COMMUNICATION-` | Convention de collaboration inter-IA | Long vivant |

Les noms peuvent être en français ou en anglais selon le rédacteur. Ne
renomme pas un fichier existant — réécris-le ou crée un suivant
(`-V2.md`).

## Statut d'une proposition

Toute proposition devrait porter un **bloc de statut** en tête,
update-able comme suit :

```markdown
> **Statut** : ✅ shipped (commit `abc1234`, 2026-05-11)
> **Statut** : ⏳ en cours — Phase 2/5 (Codex/DARKSTAR)
> **Statut** : ⛔ reporté — bloqué par <X>
> **Statut** : 🗑️ obsolète — voir `<replacement>.md`
```

C'est plus discoverable que d'ouvrir 20 fichiers pour savoir lesquels
sont encore vivants.

## Audit blockers ouverts

Pour suivre ce qui empêche le V1 GA / le robot d'avancer, consulte
[`audit-blockers.md`](audit-blockers.md). C'est l'index vivant des
points soulevés en audit qui ne sont pas encore fermés.

## Workflow

1. **Avant d'écrire** : `git pull --rebase` sur `claude-et-patrice`.
2. Crée un nouveau fichier daté ou édite un fichier existant **dont
   tu es co-rédacteur** (regarde le bloc statut).
3. Commit local + push.
4. Si tu **fermes** un audit / livres un plan : update le bloc statut
   + mentionne le commit code-buddy associé.

## Pourquoi pas dans le repo `code-buddy` directement

Le repo Claude/Patrice est public-ish (sandbox de pensée), donc on
préfère que les propositions vivent à côté du code plutôt qu'en
historique git d'un repo client. Pour les changements **dans** code-
buddy, le pattern est : commit dans code-buddy avec une référence au
fichier `propositions/<NOM>-YYYY-MM-DD.md` quand ça l'aide.

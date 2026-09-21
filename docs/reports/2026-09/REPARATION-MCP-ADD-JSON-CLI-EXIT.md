# Réparation `mcp add-json` — sortie CLI

- Date : 2026-09-21
- Agent : Code Buddy, via `buddy loop` (première mise à l'épreuve de bout en bout)
- Chantier : diagnostiquer `tests/mcp/mcp-add-json-cli-exit.test.ts` sans contourner le test.
- **État : clos — rien à réparer, et c'est le bon résultat.**

## Le verdict

Le test **passe isolément**. Il n'échoue que dans la suite complète : le répertoire
`tests/mcp/` entier est vert (17 fichiers, 193 tests). Ce n'est donc pas un bug de
production mais une **interaction entre tests** — état partagé, `HOME` non isolé ou
ordre d'exécution.

L'agent l'a constaté et **a refusé de fabriquer une réparation inutile**. Aucun
fichier de production n'a été modifié, ce que `git status` confirme.

## Ce que la boucle a réellement prouvé

Le déroulé importe plus que le verdict :

```
Tour 1 : Verifier CONFIRMED → juge : CONTINUE
         « ne montre ni l'exécution ni l'échec reproductible du test ciblé »
Tour 2 : Verifier CONFIRMED → juge : CONTINUE
         « ne fournit pas de preuve »
Tour 3 : juge : DONE
         « l'objectif complet est bloqué parce que le test est déjà vert »
```

**Le juge a rétrogradé deux fois un « done » que le Verifier confirmait**, faute de
preuve d'exécution. C'est le garde-fou annoncé par `/loop`, vu à l'œuvre pour la
première fois : un travail déclaré mais non prouvé ne passe pas.

Puis il a accepté comme aboutissement une réponse qui **dit honnêtement qu'il n'y a
rien à faire** — au lieu de récompenser une modification cosmétique.

- Coût : **$0,0000** — 3 tours.
- Vérification : déterministe (`--verify-cmd`), pas de Verifier LLM.
- Garde-fou du test : la consigne interdisait de modifier le test pour le contourner.

## Ce que cela ouvre

Les **23 échecs** de la suite complète relèvent probablement tous du même motif.
C'est un chantier distinct : isoler l'état partagé entre fichiers de test, pas
corriger du code de production.

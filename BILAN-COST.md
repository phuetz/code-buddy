# Bilan — `buddy cost`

Date : 2026-08-16

Branche : `feat/cost-dashboard-2026-08-16`

Commit fonctionnel : `0265e6b2`

Publication distante : aucune

## Livré

- Commande lazy-loaded `buddy cost` avec `--last`, `--session <id>`,
  `--since <Nd|YYYY-MM-DD>`, `--by <model|provider|day>` et `--json`.
- Lecture strictement read-only des fichiers JSON de
  `~/.codebuddy/sessions/` (ou `CODEBUDDY_SESSIONS_DIR`), y compris les
  sessions directes et l'ancien conteneur `sessions`. Un fichier dédié est
  prioritaire sur une copie issue du conteneur ; les fichiers illisibles sont
  ignorés avec un avertissement.
- Agrégateur pur `src/analytics/cost-report.ts`, sans I/O, qui calcule coût,
  tokens entrants/sortants, nombre de tours, moyenne par tour et ventilations
  complètes par modèle, provider et jour.
- Priorité au coût déjà persisté. En son absence, estimation best-effort à
  partir des tokens directionnels et du registre tarifaire canonique
  `src/config/model-pricing.ts` / `src/config/model-registry.ts`.
- Coûts estimés explicitement quantifiés (`estimatedCost`, `estimatedTurns`).
  Les données insuffisantes restent à coût zéro et sont signalées via
  `unknownCostSessions` / `unknownCostTurns` ; aucun partage arbitraire des
  tokens non ventilés n'est inventé.
- Tableau texte aligné par défaut et objet JSON stable contenant toutes les
  ventilations, quelle que soit la valeur de `--by`.

## Sémantique des filtres

- `Nd` est une fenêtre glissante calculée depuis l'heure d'exécution.
- `YYYY-MM-DD` commence à minuit UTC et la borne est inclusive.
- Le filtre s'applique au tour lorsque son horodatage existe. Un total agrégé
  uniquement au niveau session utilise, dans l'ordre, la dernière date
  d'accès, de mise à jour ou de création. Une entrée sans date est exclue par
  `--since`, faute de preuve qu'elle appartient à la période.
- `--last` sélectionne la session ayant la date d'accès/mise à jour/création la
  plus récente ; `--last` et `--session` sont incompatibles.

## Vérifications

```text
npm run typecheck
  tsc --noEmit
  tsc --project tsconfig.darkstar-identity.json
  résultat : succès, 0 erreur

npm test -- tests/analytics/cost-report.test.ts tests/commands/cost.test.ts tests/config/model-pricing.test.ts
  Test Files  3 passed (3)
  Tests       20 passed (20)

npx eslint src/analytics/cost-report.ts src/commands/cost.ts tests/analytics/cost-report.test.ts tests/commands/cost.test.ts
  résultat : succès, 0 erreur

npx prettier --check src/analytics/cost-report.ts src/commands/cost.ts tests/analytics/cost-report.test.ts tests/commands/cost.test.ts
  résultat : All matched files use Prettier code style!

git diff --check
  résultat : succès
```

Smokes du véritable point d'entrée :

- `npx tsx src/index.ts cost --help` expose les cinq options demandées ;
- avec un `CODEBUDDY_SESSIONS_DIR` absent, `buddy cost --json` renvoie un
  rapport vide accompagné du message clair attendu et ne crée pas le dossier.

## Limites factuelles

- Le périmètre demandé est celui des sessions JSON sauvegardées ; les bases
  SQLite et `cost-history.json` ne sont pas fusionnés dans ce rapport.
- Un ancien total de tokens sans ventilation input/output est conservé dans
  `tokens.unattributed`. Il ne permet pas une estimation défendable du coût.
- Un total uniquement disponible au niveau session ne permet pas de reconstruire
  les changements de modèle/provider/jour internes : il est attribué aux
  métadonnées de cette session.
- Une estimation applique les tarifs actuellement connus du registre ; elle ne
  prétend pas reconstituer un tarif historique absent de la session.
- La suite complète d'environ 27 000 tests n'a pas été lancée, conformément à
  la demande de tests ciblés.

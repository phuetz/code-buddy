# Intégration des adaptations Liza, Hermes Agent et OpenClaw

Branche `codex/audit-ameliorations-2026-09-13`, base `f2943dcad`. Adaptations écrites pour Code Buddy à partir de la [comparaison documentée](COMPARAISON-HERMES-OPENCLAW-2026-09-13.md), sans ajout d’un orchestrateur externe ni installation de leurs runtimes.

## Résultat

- **Liza : missions locales durables.** `buddy fleet mission` fournit création depuis un manifeste fixe, réservation exclusive avec génération et bail, renouvellement, exécution bornée, passation structurée, résultats persistants et accusé de réception. Une autorité périmée est refusée. Les tâches en cours dont le pilote disparaît restent à réconcilier ; aucune relance implicite d’un effet ambigu. Une revue peut être attestée sur un SHA complet, par un relecteur distinct et sur un worktree propre. Cela n’autorise aucune fusion.
- **OpenClaw : composition vérifiable des outils.** `code_exec` et `ToolHarness.exec/start` acceptent une vérification TypeScript facultative, issue du catalogue autorisé. Programme invalide : aucun outil appelé. Le compilateur est séparé, borné à 5 secondes et 128 Mo de tas V8 ; le mode normal n’active pas cette compilation. Les schémas complexes ne sont pas une preuve de validation JSON Schema complète.
- **Hermes : continuité bornée des tâches planifiées.** Carnet par tâche et dernier résultat réussi non vide, activables explicitement depuis `cron add/update --continuity` et l’outil `cronjob`. Un échec d’exécution ne consomme plus l’empreinte du précontrôle : une source inchangée peut être retentée. Les contrôles sans LLM existants sont conservés.
- **Hermes/OpenClaw : visibilité du cache.** Les observations et changements consécutifs des composants système et outils sont comptés sans stocker le texte. Le statut distingue ces observations locales de l’utilisation réelle du cache chez un fournisseur, qui n’est pas mesurée ici.

## Délégation et revue

- Grok a proposé le carnet et le report de l’empreinte après succès. Astra a identifié puis corrigé les courses d’écriture, mutations partielles sur erreur et raccordements de répertoires.
- agy a proposé le vérificateur TypeScript puis son isolation. Codex a corrigé un import transitif qui chargeait encore le compilateur dans le parent, supprimé la recherche d’un exécutable de secours dans le workspace et raccordé les schémas du harnais réel.
- La proposition de Mistral normalisait les clés locales sans normaliser les octets envoyés : elle aurait produit des hits trompeurs. Elle n’a pas été intégrée. Astra a implémenté le diagnostic sans changer les clés brutes.
- Astra a relu les missions et écrit les tests du CLI. Codex a corrigé la synchronisation du répertoire après écriture, les bornes des résultats sérialisés, la validation des données, la gestion de contention et l’invalidation des anciennes attestations.

## Limites explicites

Coordination locale sur une seule machine, répertoires et manifestes sous contrôle de l’opérateur. Les noms des pilotes ne sont pas des identités réseau authentifiées. Les verrous de mutation abandonnés ne sont pas volés automatiquement : leur suppression demande une inspection de l’état. Le bail de tâche et le verrou d’écriture sont deux mécanismes différents.

`mission run` reste au premier plan ; la persistance permet inspection et passation, pas la résurrection d’un processus disparu. Les résultats sont bornés et signalent leur troncature. La revue est une attestation au moment du contrôle, invalidée par les transitions du harnais ; elle ne surveille pas les modifications Git externes ultérieures.

Les tests sont locaux avec processus fixtures et fournisseurs simulés. Aucun budget cloud dépensé pour des évaluations, aucun service permanent lancé, aucun push ou fusion de la branche cible. Les CLIs de délégation autorisées ont été utilisées ; Fable n’a pas été sollicité.

## Vérifications

Première tranche : validate ciblé, 38 tests + packaging, build et scénario compilé `mission create → claim → run` avec Code Explorer réel, puis `ack → show`, réussis. Tests complémentaires : course entre processus, renouvellement du bail, annulation, reprise avec propriétaire périmé, sortie très volumineuse, revue SHA et worktree sale. Les totaux intégrés définitifs sont consignés à la clôture ci-dessous.

### Clôture de validation

- `npm run validate --` avec les chemins harnais, preflight, missions, scheduler, daemon, cron CLI/outils et cache : **exit 0**, **46 fichiers / 418 tests**, plus **10 tests packaging**. ESLint : zéro erreur, 2 488 avertissements historiques ; trois contrôles TypeScript réussis.
- `npm run build` : exit 0. Essais compilés réussis : mission Code Explorer avec résultat durable et accusé ; preflight invalide sans dispatch puis valide avec lecture réelle ; CLI cron création/relecture/désactivation/suppression ; outil `cronjob` avec notes persistées. Aucun agent cron exécuté contre un vrai fournisseur.
- Une première validation a détecté une suppression trop précoce du dossier temporaire d’un nouveau test : corrigée en attendant sa promesse complète de persistance, puis validation relancée sans erreur asynchrone.
- Contrôle confidentialité séparé : **39/40**, mêmes cinq fichiers préexistants que la base ; aucune nouvelle occurrence. Les contenus privés n’ont pas été recopiés dans le rapport.
- Rapports bruts et résultats lm-resizer restent sous `_qa/audit/` non suivi ; dossiers de test isolés. Les clones des délégations sont conservés avec leurs propositions et rapports ; aucune fusion en bloc.

Commits de livraison : `9bfc8796f` (missions), `0a4ad53d2` (diagnostic cache + tests CLI), `0988accad` (preflight et raccordement du harnais), `d99ecd52b` (continuité cron) et clôture documentaire. La branche cible n’a pas été fusionnée ni publiée.

Le dernier validate a été réduit par lm-resizer de 355849 à 1648 octets ; le journal intégral a été conservé et ses totaux vérifiés.

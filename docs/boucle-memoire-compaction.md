# Mémoire avant compaction, résumé protégé et pre_verify

Ces trois options expérimentales sont désactivées par défaut. Elles sont
inspirées du flush et du safeguard d’[OpenClaw](https://github.com/openclaw/openclaw)
et du résumé structuré, du disjoncteur et de `pre_verify` de
[Hermes Agent](https://github.com/NousResearch/hermes-agent). Le code et les prompts
ont été réécrits ; aucun code amont n’a été copié.

## Mémoire avant compaction automatique

Activer `CODEBUDDY_COMPACTION_MEMORY_FLUSH=true`. Le moteur attend un tour
supplémentaire du modèle **avant** la compaction automatique. Le modèle choisit
jusqu’à six décisions, préférences ou faits ; le moteur les enregistre dans
`.codebuddy/CODEBUDDY_MEMORY.md` avec les limites, dédoublonnages, contrôles de
sécurité et hooks `BeforeMemoryWrite` du magasin existant. L’écriture est attendue
et n’appelle pas une seconde fois le modèle pour réconcilier les faits.

Le tour n’expose aucun outil et n’apparaît pas dans la conversation. Son entrée
est plafonnée à **2 048 jetons estimés**, sa sortie à **256 jetons**. La variable
`CODEBUDDY_COMPACTION_MEMORY_MAX_TOKENS` accepte un entier de 64 à 512 pour la
sortie. Une réponse tronquée ou invalide n’est pas persistée. L’appel a un délai
de 30 secondes et ne change pas de fournisseur. Au plus un essai est payé par
tour d’agent, même si plusieurs compactions ont lieu dans ce tour ou si le
contexte reste au-dessus du seuil. Le tour suivant renouvelle cette possibilité.
Les usages auxiliaires sont comptabilisés séparément ; un compte estimé reste une estimation.

Aucun appel si la mémoire est désactivée, si l’élagage des résultats suffit, si
un plugin possède la compaction ou si le tour utilise un hôte partagé isolé ou
la protection compagnon. Les tours ordinaires restent inchangés quand l’option
est absente. L’ancien archivage sur avertissement reste inchangé par défaut ;
il est remplacé par le nouveau mécanisme lorsque celui-ci est activé.

La sélection est faite sur une fenêtre bornée de texte conversationnel. Elle
ne garantit pas que le modèle choisira tous les faits utiles. La persistance
rend les notes disponibles au lecteur de mémoire existant ; elle n’ajoute pas
un nouveau bloc de mémoire à chaque appel de modèle.

## Qualité de la compaction

Activer `CODEBUDDY_COMPACTION_SAFEGUARD=true`. ContextManagerV2 contrôle le
**résultat final** de la compression, y compris les stratégies qui tronquent
avant de résumer. Il vérifie la présence exacte des éléments repérables :

- requête utilisateur courante ;
- fichiers issus d’appels d’édition avec résultat réussi, ou lignes `Modified:` ;
- lignes explicites `Decision:` / `Décision:` / `We decided` ;
- tâches `TODO:`, `Open task:`, `À faire:` ou cases `- [ ]`.

Un élément manquant, un résultat hors budget ou une exception provoque **un
seul nouvel essai**, avec un bloc structuré extractif contenant ces éléments.
Si cet essai échoue aussi, le moteur utilise la troncature sûre existante,
sans résumé : requête courante et budget restent protégés. Ce repli peut perdre
des faits anciens ; ce n’est pas un résumé prétendument complet.

Après deux compactions dont les deux essais ont échoué, le disjoncteur saute
les essais de résumé et utilise directement le repli. Régler ce nombre par
`CODEBUDDY_COMPACTION_FAILURE_LIMIT` (entier 1 à 10). Un essai accepté remet le
compteur d’échecs consécutifs à zéro. Les statistiques sont disponibles via
`getCompactionSafeguardStats()` et dans les journaux debug.

Le contrôle est déterministe, donc **zéro appel LLM auxiliaire**. Le bloc
structuré augmente éventuellement les jetons de l’appel principal suivant,
toujours dans le budget ContextManagerV2. La détection repose sur des formes
explicites et sur les appels d’outils ; elle ne prouve pas la conservation
sémantique de décisions ou de tâches exprimées autrement.

## Hook pre_verify

Activer `CODEBUDDY_PRE_VERIFY=true`, puis configurer `.codebuddy/hooks.json` :

```json
{
  "hooks": {
    "pre_verify": [
      { "type": "command", "command": "npm run typecheck", "timeout": 60000 },
      { "type": "command", "command": "npm test -- tests/store.test.ts", "timeout": 60000 }
    ]
  }
}
```

Le middleware `PreVerifyMiddleware` a la priorité **154** et utilise la nouvelle
phase `beforeComplete` du pipeline. Son enregistrement est attendu avant le
premier appel modèle, y compris avec un pipeline initialement absent ou
remplacé par un hôte. Elle est exécutée sur une réponse naturelle terminale
sans appel d’outil, avant sa livraison et sa persistance. Une réponse tronquée
reste soumise au même contrôle après épuisement des continuations, même vide.
Les brouillons de continuation restent dans une entrée privée du fournisseur,
hors de l’historique partagé ; le hook reçoit la proposition complète et ne
tourne qu’une fois à sa finalisation. Un message de steering abandonne le
brouillon interrompu avant de poursuivre vers une réponse vérifiée. Les phases
`beforeTurn` et `afterTurn` conservent leurs
contrats ; ce hook n’est pas une modification de leurs avertissements.

Chaque commande tourne dans le workspace de l’agent et reçoit en entrée JSON
la proposition de réponse et les fichiers modifiés. Elle s’exécute au premier
plan et doit terminer avec **0**. Tout autre code, signal, délai dépassé ou
échec de démarrage bloque la finalisation avec un message `pre_verify:`.
Un objet JSON `decision: "block"` ou `permissionDecision: "deny"` en sortie
bloque également, même avec le code 0. Une exception du middleware bloque aussi.

Seules les commandes sans filtre `if` sont acceptées. Leur délai est de 10 s
par défaut, réglable de 1 à 60 000 ms. Une configuration illisible ou invalide
bloque la finalisation quand l’option est activée. Une configuration absente,
une liste vide ou une clé mal nommée bloque avec un message explicite : au moins
une commande `hooks.pre_verify` est requise (nom sensible à la casse). Un refus
arrête le tour ; aucune relance modèle ni
vérification en arrière-plan n’est créée. Désactiver l’option conserve le flux
historique, même si une entrée `pre_verify` existe dans le fichier.

**Coût LLM : zéro jeton supplémentaire** pour un hook de commande ; seul le
temps de la commande s’ajoute. Le code de sortie global du CLI headless n’est
pas modifié par cette extension : lire le message de refus et les traces de la
commande. Ce point relève du chantier séparé de la porte de vérification.

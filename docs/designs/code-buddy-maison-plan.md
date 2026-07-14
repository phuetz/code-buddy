# Code Buddy Maison — week-ends, jours fériés et repas

> Statut : proposition d'architecture en mode plan, aucune implémentation.
> Date : 2026-07-12.
> Document parent : [Code Buddy Tomorrow](code-buddy-tomorrow-plan.md).

## Décision produit

Code Buddy Maison adapte Tomorrow au rythme réel de la vie : jours ouvrés,
week-ends, jours fériés, congés, moments de repos, cuisine et invités.

Sa promesse :

> Présent quand tu en as besoin, silencieux quand tu vis.

Un samedi ou un jour férié augmente la probabilité que Patrice soit disponible
à la maison ; il ne le prouve pas. Le système distingue toujours :

1. le type de journée ;
2. la présence réelle ;
3. la disponibilité déclarée ;
4. le niveau d'initiative autorisé.

Le week-end ne devient ni une liste de retard à rattraper, ni une permission
supplémentaire pour agir à l'extérieur.

## Résultats de l'audit local

### Fondations réutilisables

- présence faciale Cowork avec projection récente dans
  `~/.codebuddy/presence/current.json` ;
- conducteur vocal commun, quiet hours, cooldowns et anti-télévision ;
- rappels persistants avec récurrence, snooze, accusé et agenda ;
- météo Open-Meteo réelle sur un à sept jours ;
- Home Assistant avec lecture d'entités et domaines dangereux bloqués ;
- voix locale, interruption et préchauffage ;
- scheduler, Tomorrow, Living Briefing et Mission Constitution.

### Défauts P0 à corriger avant le mode Maison

1. `src/companion/presence-loop.ts::defaultPersonPresent()` convertit en booléen
   l'objet renvoyé par `readPresenceContext()` au lieu de lire `hasMatch`.
   L'objet existe même sans visage reconnu : la présence peut donc être déclarée
   vraie à tort.
2. Le fuseau est configurable ou affiché, mais l'exécution de `daily-reset`, du
   cron et de plusieurs rappels utilise encore l'heure locale implicite. Le champ
   `schedule.timezone` n'est pas réellement appliqué partout.
3. Corrigé le 14 juillet 2026 : `src/location/index.ts` ne fabrique plus Paris,
   une adresse, une précision ou un fuseau à partir du vide. La localisation IP
   exige désormais une source HTTP explicitement configurée, valide strictement
   ses coordonnées et ne retient qu'un fuseau IANA fourni par cette source ; le
   décalage et le DST sont calculés pour l'instant réel. Sans source ou position
   manuelle confirmée, le service échoue fermé.
4. Corrigé : le contexte de journée et le fournisseur Etalab/DINUM distinguent
   maintenant jour ouvré, week-end, jour férié et source indisponible, avec
   cache et provenance explicites.
5. Corrigé le 14 juillet 2026 : les invocations de nœuds ne renvoient plus un
   faux succès `dispatched`. Elles attendent une réponse corrélée du bon appareil,
   expirent, s'annulent hors ligne et valident le résultat `calendar.list` avant
   le planificateur. Le chemin ADB expose également les instances structurées au
   tool `device_manage` (`action: calendar`) ; une erreur de permission reste
   distincte d'un calendrier réellement vide.
6. Corrigé le 14 juillet 2026 : une routine apprise reste un candidat de skill
   distinct d'une occurrence calendaire. La promotion exige maintenant une
   revue humaine nommée et une empreinte exacte du contenu ; toute évolution de
   la routine invalide la revue et la replace en brouillon. CLI et Cowork
   séparent explicitement `Review` puis `Promote`.
7. Corrigé : `src/meals/` fournit profil alimentaire privé, inventaire,
   normalisation et compatibilité des recettes, classement conservateur et plan
   de repas civil dans le fuseau Maison. `buddy maison food` expose ces contrats
   sans confondre la galerie de missions avec des recettes de cuisine.
8. Le `UserModel` filtre volontairement les informations médicales. Le profil
   alimentaire sensible doit rester séparé ; il ne faut pas contourner cette
   protection.

## Le moteur de rythme de vie

### Contexte temporel canonique

Créer un `TemporalContextService` unique et testable :

```text
instant UTC
   │
   ├── timezone IANA confirmée
   ├── date locale et DST
   ├── week-end / jour ouvré
   ├── jour férié officiel + territoire
   ├── congé ou journée libre explicite
   ├── quiet hours et exceptions
   └── fraîcheur et provenance de chaque signal
```

Toutes les briques — Tomorrow, cron, rappels, présence et Maison — consomment le
même contexte au lieu d'appeler directement `new Date().getDay()`.

Calculer les journées avec des dates civiles dans le fuseau IANA, jamais en
ajoutant mécaniquement 24 heures : les changements d'heure doivent rester
corrects.

### Jours fériés français

La source initiale est l'[API officielle des jours fériés
français](https://calendrier.api.gouv.fr/jours-feries/), publiée par Etalab/DINUM.
Elle expose un JSON par zone et par année.

Zones supportées par la source : métropole, Alsace-Moselle, Guadeloupe, Guyane,
La Réunion, Martinique, Mayotte, Nouvelle-Calédonie, Polynésie française,
Saint-Barthélemy, Saint-Martin, Saint-Pierre-et-Miquelon et Wallis-et-Futuna.

Le profil conserve :

- zone officielle choisie ou dérivée d'un code territorial confirmé ;
- année, URL source, date de récupération et empreinte ;
- dernier cache valide pour fonctionnement hors ligne ;
- fêtes personnelles ou locales ajoutées séparément par l'utilisateur.

Règles :

- ne jamais déduire la zone d'un texte libre donné au LLM ;
- un jour férié ne signifie pas forcément un jour chômé ;
- ne pas inventer une date si la source est indisponible ;
- afficher les limites concernant les fêtes locales et professionnelles ;
- garder les particularités territoriales dans les données, pas dans le prompt.

Pour l'Alsace-Moselle, le Vendredi saint dépend aussi de la commune ; le 26
décembre suit un régime particulier. Les règles ultramarines comportent des
dates propres. Une décision professionnelle ou juridique exige donc une source
plus précise que le simple libellé de zone.

### Type de journée et présence

```ts
type DayKind =
  | 'workday'
  | 'weekend'
  | 'public-holiday'
  | 'personal-leave'
  | 'vacation'
  | 'unknown';

type HomeMode =
  | 'normal'
  | 'free-day'
  | 'focus'
  | 'rest'
  | 'cooking'
  | 'guests'
  | 'away'
  | 'silent';
```

Priorité des signaux :

1. état explicitement choisi par Patrice ;
2. calendrier personnel confirmé ;
3. présence Home Assistant consentie et fraîche ;
4. visage reconnu récemment, qui signifie seulement « devant la caméra » ;
5. week-end ou jour férié, qui reste un contexte et non une preuve de présence.

La caméra non vue ne signifie pas absent du domicile. Une présence Home
Assistant peut utiliser uniquement les lectures `person`, `device_tracker` ou
`binary_sensor`, jamais un appel de service, avec entité choisie par Patrice,
fraîcheur et confiance visibles.

### États simples

Commandes directes :

- « Journée tranquille. »
- « On travaille aujourd'hui. »
- « Mode cuisine. »
- « Je reçois du monde. »
- « Je me repose. »
- « Je sors. »
- « Silence jusqu'à demain. »

Un état explicite peut expirer au prochain réveil ou à une heure choisie. Il
doit être visible et annulable en un geste.

## Adaptation des interactions

### Politique sociale, pas simple changement de prompt

Le `CompanionConductor` reçoit un `InteractionPolicy` calculé :

- surfaces autorisées : voix, carte, téléphone ou silence ;
- sujets autorisés : travail, repas, loisirs, rappels ;
- nombre d'invitations spontanées ;
- délai minimal et heure calme ;
- confidentialité selon présence et invités ;
- raisons ayant déclenché la proposition.

Le dialogue demandé par Patrice n'est pas limité. Le budget ne concerne que les
initiatives spontanées.

### Comportement par défaut d'un jour libre

- aucune voix déclenchée uniquement par l'heure ou le calendrier ;
- première carte après présence réellement confirmée ;
- deux invitations spontanées maximum dans la journée ;
- au moins 90 minutes entre deux invitations ;
- une invitation ignorée n'est jamais répétée ;
- aucune relance de productivité ou de « retard » ;
- `Silence aujourd'hui` bloque immédiatement toute initiative sonore ;
- télévision et conversations non adressées restent exclues.

Ces valeurs sont des défauts configurables. Un mode `vivant` peut être plus
présent, mais conserve les quiet hours, l'anti-répétition et le droit au silence.

### Rythme proposé

| Moment | Interaction possible |
|---|---|
| Première présence | Carte douce, jamais un réveil horaire |
| Matin | Météo utile, une idée de repas, une activité ou rien |
| Midi | Cuisine mains libres, restes, liste de courses et minuteurs |
| Après-midi | Mode discret ; disponibilité pour roman, lecture, promenade ou création |
| Soir | Restes facultatifs et préparation légère de demain |
| Nuit | Quiet mode absolu, sauf protocole d'urgence explicitement configuré |

Exemple :

> Bonjour. Tout est calme. Si tu veux, je peux t'aider à choisir un repas avec
> ce qu'il reste, préparer quelque chose autour de ton roman, ou te laisser
> profiter de ta matinée.

Actions : **Une idée**, **Plus tard**, **Silence aujourd'hui**.

### Dimanche soir sans anxiété

Le résumé facultatif contient seulement :

- ce qui est déjà prêt ;
- une chose optionnelle à préparer ;
- ce qui peut parfaitement attendre lundi.

La journée sans interaction est un fonctionnement réussi.

### Mode invités

- masquer notifications, mémoire personnelle et contraintes de santé ;
- personnalité neutre et aucune salutation identifiante non consentie ;
- aucune mémorisation d'un invité par défaut ;
- images locales et éphémères ;
- ne jamais révéler romans, messages, agenda ou projets privés ;
- demander les contraintes alimentaires des invités uniquement pour le repas en
  cours, avec consentement et sans les rattacher au profil de Patrice.

## Assistant repas

### Finalité

Code Buddy organise les repas et applique des règles confirmées. Il ne
diagnostique pas, ne prescrit pas de régime et ne modifie pas un plan médical.

Il peut :

- proposer trois repas compatibles avec les informations connues ;
- utiliser temps, énergie, budget, météo, saison, matériel et restes ;
- ajuster les portions ;
- construire une liste de courses ;
- guider la cuisine à la voix ;
- vérifier déterministement contraintes, allergènes et règles d'hygiène ;
- expliquer les sources et incertitudes.

Il ne peut pas :

- inférer une maladie, allergie ou trouble alimentaire ;
- promettre qu'un plat est médicalement « sûr » ;
- optimiser ou assouplir une prescription ;
- recommander un traitement, supplément, dose ou réintroduction ;
- commander, payer ou réserver sans confirmation dédiée ;
- culpabiliser, moraliser ou compter les calories par défaut.

### Profil alimentaire séparé

Les catégories ne doivent pas être mélangées :

```ts
type FoodConstraintKind =
  | 'preference'
  | 'avoidance'
  | 'intolerance'
  | 'allergy'
  | 'clinician-constraint'
  | 'temporary-condition';

type ConstraintStatus =
  | 'draft'
  | 'user-confirmed'
  | 'clinician-sourced'
  | 'expired';
```

Chaque contrainte possède : règle exacte, sévérité, source, date de confirmation,
révision éventuelle et responsable de la confirmation. Un document médical
importé produit un brouillon à relire ; il ne modifie jamais le profil seul.

Une allergie confirmée est une exclusion dure. Une contrainte clinique avec une
valeur quantitative n'existe que si cette valeur a été explicitement fournie.
Le modèle ne déduit aucune limite à partir du nom d'une maladie.

Ce profil est local, chiffré, minimal, supprimable et séparé du `UserModel`.
Seule une politique compacte nécessaire à la recette est fournie au modèle
local. Aucun envoi cloud sans consentement distinct.

### Repères généraux versus santé individuelle

Les [recommandations adultes de Manger
Bouger](https://www.mangerbouger.fr/manger-mieux/a-tout-age-et-a-chaque-etape-de-la-vie/les-recommandations-alimentaires-pour-les-adultes)
peuvent orienter les propositions générales : diversité, fait maison, fruits et
légumes, légumes secs, céréales complètes et réduction des aliments très salés,
sucrés ou transformés.

Elles sont toujours affichées comme **repères PNNS pour la population générale**,
jamais comme prescription individuelle. Âge, état physiologique et contraintes
médicales demandent des règles confirmées adaptées.

### Données nutritionnelles CIQUAL

La source de référence est la [table CIQUAL 2025 de
l'Anses](https://www.anses.fr/fr/content/la-table-de-composition-nutritionnelle-du-ciqual),
version épinglée avec attribution et date.

Règles de calcul :

- composition rapportée à 100 g de partie comestible ;
- quantité comestible × teneur / 100 ;
- valeur absente différente de zéro ;
- « traces » différente de zéro ;
- couverture et incertitude visibles ;
- valeurs moyennes non présentées comme exactes pour une marque ;
- rendement, cuisson et portions non inventés.

CIQUAL ne contient ni listes d'ingrédients, ni contamination croisée, ni rappels
produits. Il ne peut donc jamais valider seul une allergie.

### Allergènes

La taxonomie initiale suit l'[annexe II du règlement européen
1169/2011](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX%3A32011R1169) :
céréales contenant du gluten, crustacés, œufs, poissons, arachides, soja, lait,
fruits à coque spécifiés, céleri, moutarde, sésame, sulfites au seuil légal,
lupin et mollusques.

Le validateur :

- utilise des identifiants canoniques, synonymes, dérivés et exceptions ;
- inspecte récursivement les ingrédients composés ;
- conserve textuellement « peut contenir » ;
- ne confond jamais absence de mention et absence de contamination ;
- bloque un ingrédient ou une étiquette inconnue en cas d'allergie sévère ;
- repasse toute substitution générée dans le même filtre.

Le verdict est `compatible`, `incompatible` ou `unknown`, jamais « garanti sans
allergène ». L'étiquette réelle du produit reste prioritaire.

### Contraintes médicales

Pour une allergie, maladie métabolique ou rénale, diabète, dénutrition, trouble
alimentaire, grossesse à risque ou interaction médicament-aliment, Code Buddy
reste dans l'organisation pratique et applique seulement un plan validé par un
professionnel.

Une éviction mal conduite peut déséquilibrer l'alimentation ; elle ne doit donc
jamais être créée à partir d'une hypothèse du modèle. La règle utilisateur est
respectée immédiatement, mais le système recommande une validation médicale
avant toute interprétation ou extension.

En cas de réaction grave explicitement signalée, le parcours recette s'arrête.
Le système affiche le protocole d'urgence fourni par le médecin et, en France,
les numéros 15 et 112. Il ne poursuit pas avec une suggestion alimentaire et ne
propose aucun médicament.

## Génération et vérification d'une recette

```text
Demande / moment du repas
          │
          ▼
Contexte confirmé ── personnes, temps, énergie, matériel, ingrédients
          │
          ▼
Filtres déterministes ── allergies + contraintes cliniques + sécurité
          │
          ▼
Générateur local ── trois candidats maximum
          │
          ▼
Normalisation ── quantités, unités, ingrédients composés
          │
          ▼
RecipeVerifier ── contraintes + CIQUAL + allergènes + règles d'hygiène
          │
          ▼
Cartes compatibles / inconnues / rejetées avec explication
```

Le LLM ne reçoit jamais l'autorité finale. Les règles déterministes s'appliquent
avant et après génération.

### Classement

Parmi les recettes compatibles :

```text
utilité = préférence confirmée
        + utilisation de restes
        + saison et météo
        + adéquation temps/énergie/budget
        - complexité
        - ingrédients manquants
        - incertitude nutritionnelle
```

La santé et les allergies sont des filtres, pas des poids compensables.

## Cuisine mains libres

### Avant de commencer

Confirmer :

- nombre de personnes ;
- temps et énergie ;
- contraintes déjà enregistrées ;
- ingrédients réellement présents ;
- matériel ;
- restes à privilégier.

Afficher mise en place, ustensiles, durée, étapes sensibles et provenance de la
recette.

### Session persistante

```text
draft → confirmed → mise-en-place → cooking ↔ paused → completed
                                                └──→ abandoned
```

La session conserve l'étape courante, les portions, substitutions et minuteurs
nommés. Elle reprend exactement après un redémarrage.

Commandes vocales :

- « Étape suivante » / « Reviens » ;
- « Répète plus lentement » ;
- « Je n'ai pas de crème » ;
- « Minuteur pâtes, huit minutes » ;
- « Combien de temps reste-t-il ? » ;
- « Pause » / « Écran silencieux ».

Une substitution relance le validateur complet. La caméra peut suggérer un
ingrédient, mais ne valide jamais une étiquette, un allergène ou une date.

### Règles de sécurité alimentaire

Elles viennent d'un paquet versionné fondé sur les [bonnes pratiques de cuisine
de l'Anses](https://www.anses.fr/fr/content/dossier/hygiene-dans-la-cuisine-bonnes-pratiques)
et les règles publiques françaises : chaîne du froid, séparation cru/cuit,
conservation, DLC/DDM, refroidissement et populations sensibles.

Le modèle ne fabrique pas une température ou une durée. Une donnée absente
produit une demande de vérification ou bloque l'étape sensible.

Un produit identifié par marque, code-barres et lot peut être confronté à
[RappelConso](https://rappel.conso.gouv.fr/). Une correspondance incertaine ne
devient jamais une déclaration de sécurité.

## Garde-manger, restes et courses

### Confiance graduée

Chaque produit conserve provenance, date et confiance :

- confirmé manuellement ;
- lu sur une étiquette ou un ticket ;
- scanné par code-barres ;
- vu par caméra ;
- déduit d'une recette, donc incertain.

Un produit inféré n'est jamais considéré présent pour une vérification
d'allergène. L'inventaire ne prétend pas connaître ce qu'il ne sait pas.

### Restes

Après le repas :

> Il semble rester deux portions. Veux-tu que je les note pour demain ?

Seulement après confirmation : aliment, quantité approximative, date,
réfrigérateur/congélateur et confiance. Actions : **Conserver**, **Congeler**,
**Consommé**, **Jeter**, **Ne pas suivre**.

Les alertes sont opt-in et conservatrices. Une information de conservation
manquante empêche une assurance de consommation.

### Courses

- regrouper par rayon et fusionner les doublons ;
- tenir compte des quantités et produits ouverts ;
- privilégier les restes avant d'acheter ;
- préparer un panier en dry-run ;
- ne jamais commander ou payer sans récapitulatif et validation de l'action
  exacte.

La fonction distinctive **Frigo vers table** optimise restes, temps, énergie,
budget et préférences confirmées.

## UX Cowork : surface Maison

La surface reste calme :

- mode actuel : libre, cuisine, repos, invités ou silence ;
- contexte du jour et origine : week-end, jour férié, congé ;
- une carte « Maintenant » ;
- minuteurs actifs ;
- restes confirmés ;
- une seule suggestion ;
- boutons micro et **Silence**.

Trois profondeurs :

1. coup d'œil de cinq secondes ;
2. mode actif cuisine/courses/rituel ;
3. journal de confiance : pourquoi Code Buddy a parlé, quelle donnée a été
   utilisée et comment l'oublier.

Les cartes passent de `proposed` à `accepted`, `later` ou `dismissed`. Elles ne
restent pas dans une file anxiogène.

Une recette affiche : compatibilité avec les contraintes connues, inconnues,
allergènes détectés, ingrédients manquants, estimation nutritionnelle et source.
Le détail médical reste masqué en mode invités.

## Architecture proposée

```text
src/life-rhythm/
  temporal-context.ts
  holiday-provider.ts
  day-context.ts
  home-presence.ts
  interaction-policy.ts
  routine-store.ts

src/meals/
  food-profile.ts
  ciqual-provider.ts
  allergen-rules.ts
  food-safety-rules.ts
  recipe-source-registry.ts
  recipe-normalizer.ts
  recipe-verifier.ts
  meal-planner.ts
  kitchen-session.ts
  timer-store.ts
  pantry-store.ts
  leftovers-store.ts
  grocery-draft.ts
  recall-conso.ts
```

Les jours fériés, recettes et règles de sécurité passent par des providers
versionnés et remplaçables. Aucun territoire, modèle, maladie ou service de
courses n'est codé en dur dans l'orchestrateur.

Le `DayPreparationCoordinator` de Tomorrow consomme une projection en lecture
seule. Les mutations Home Assistant, calendrier, panier ou courses restent dans
des outils distincts soumis à confirmation.

### Persistance

```text
~/.codebuddy/life/
  settings.json
  holiday-cache/<zone>/<year>.json
  day-state.json
  interaction-ledger.jsonl
  food-profile.enc.json
  pantry.json
  leftovers.json
  groceries.json
  kitchen-sessions/<id>.json
  timers.json
  rule-packs/
```

Les données de santé sont chiffrées, permissions locales restrictives, collecte
minimale, export/suppression possibles et consentement distinct. Night Watch ne
révèle jamais la contrainte elle-même ; il rapporte seulement qu'une proposition
a passé ou échoué le validateur.

## Niveaux d'autonomie domestique

| Niveau | Capacités |
|---|---|
| Invisible | Répond seulement lorsqu'on l'appelle |
| Présent | Propose doucement, sans mutation ni contact extérieur |
| Organisateur | Prépare menus, listes, minuteurs et paniers privés |
| Intendant | Exécute des routines internes réversibles préautorisées |
| Assistant externe | Prépare réservation/commande, avec validation finale obligatoire |

Les achats, messages, appels, réservations et modifications de calendrier sont
toujours confirmés au moment exact de l'action.

## Tests et critères d'acceptation

### Temps et présence

- chaque zone officielle et chaque date ultramarine spécifique ;
- changement heure été/hiver et rappel autour de la transition ;
- Vendredi saint dans une commune concernée et non concernée ;
- API indisponible avec cache valide puis cache périmé ;
- samedi avec journée de travail explicite ;
- jour férié avec Patrice absent ;
- caméra vide : aucune présence positive ;
- visage présent et mode `silent` : aucune voix ;
- personne inconnue ou invités : aucune donnée privée.

### Interaction

- deux invitations spontanées maximum par défaut ;
- au moins 90 minutes entre elles ;
- suggestion ignorée jamais répétée ;
- `Silence aujourd'hui` immédiatement respecté ;
- interruption vocale en moins de 250 ms ;
- aucun déclenchement sur dix heures de télévision de test ;
- une journée silencieuse considérée réussie.

### Nutrition et allergies

- valeur CIQUAL manquante ou « traces » non convertie en zéro ;
- allergène sous synonyme ou dans un ingrédient composé ;
- mention « peut contenir » préservée ;
- étiquette inconnue bloquante pour allergie sévère ;
- substitution réintroduisant l'allergène rejetée ;
- contrainte clinique importée jamais modifiée ;
- recette crue refusée ou signalée pour population sensible selon règle
  officielle ;
- tentative d'envoyer le profil médical vers le cloud bloquée ;
- urgence explicitement signalée court-circuitant le générateur.

### Cuisine

- recette pilotable sans écran ;
- plusieurs minuteurs nommés survivent au redémarrage ;
- étape et substitutions restaurées exactement ;
- quantités et unités testées aux limites ;
- caméra jamais suffisante pour valider ingrédient sensible ;
- règle de sécurité sans source ou périmée refuse l'assurance.

### Garde-manger et courses

- aucun produit marqué présent sans provenance ;
- toute inférence affichée comme incertaine ;
- reste corrigé, consommé ou oublié en une action ;
- aucun achat sans récapitulatif et confirmation distincte ;
- idempotence de la création de panier et absence de double commande.

## Feuille de route

### M0 — Vérité temporelle et présence

- corriger le garde de présence ;
- créer `TemporalContextService` réellement IANA/DST ;
- brancher l'API jours fériés avec zone explicite et cache ;
- écarter la localisation simulée ;
- unifier quiet mode et interaction ledger ;
- réparer le review gate des routines.

**Gate** : aucun faux positif de présence, aucun décalage DST et aucune
initiative vocale fondée sur le seul calendrier.

### M1 — Maison en shadow mode

- modes libre, focus, repos, cuisine, invités, away et silence ;
- météo et rappels en lecture seule ;
- cartes Maison et explication du déclencheur ;
- simulation de week-ends et jours fériés sans voix automatique.

**Gate** : quatorze jours de shadow mode, zéro fuite privée et budget
d'interaction respecté.

### M2 — Profil alimentaire et vérificateur

- profil chiffré séparé ;
- rule packs PNNS, CIQUAL, allergènes et hygiène ;
- normalisation des recettes et trois verdicts ;
- fixtures adversariales et revue des contraintes.

**Gate** : toutes contraintes dures déterministes, aucune donnée santé dans un
prompt cloud et zéro verdict « compatible » quand une donnée critique manque.

### M3 — Cuisine mains libres

- session persistante, grande étape Cowork et commandes vocales ;
- minuteurs multiples ;
- substitutions revalidées ;
- reprise exacte après crash.

**Gate** : recette complète sans toucher l'écran et restauration sans perte.

### M4 — Frigo vers table

- garde-manger à provenance graduée ;
- restes confirmés et règles conservatrices ;
- listes de courses et panier dry-run ;
- contrôle RappelConso.

**Gate** : aucune invention d'inventaire et aucun achat réel.

### M5 — Rituels doux

- suggestions repas/activité limitées ;
- surprise privée ;
- dimanche soir sans anxiété ;
- apprentissage uniquement après feedback confirmé.

**Gate** : qualité relationnelle évaluée, anti-répétition et suppression totale
des préférences possible.

### M6 — Actions externes, opt-in

- courses/réservations via providers ;
- preview, prix, destination et action exacte ;
- approbation durable et idempotence.

**Gate** : aucun débit, réservation ou message sans validation au dernier pas.

## Sources officielles retenues

- [API jours fériés Etalab/DINUM](https://calendrier.api.gouv.fr/jours-feries/)
- [Code du travail, particularités Alsace-Moselle](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006902635/)
- [Manger Bouger — recommandations adultes](https://www.mangerbouger.fr/manger-mieux/a-tout-age-et-a-chaque-etape-de-la-vie/les-recommandations-alimentaires-pour-les-adultes)
- [Anses — table CIQUAL](https://www.anses.fr/fr/content/la-table-de-composition-nutritionnelle-du-ciqual)
- [Règlement UE 1169/2011, allergènes](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX%3A32011R1169)
- [Anses — hygiène dans la cuisine](https://www.anses.fr/fr/content/dossier/hygiene-dans-la-cuisine-bonnes-pratiques)
- [RappelConso](https://rappel.conso.gouv.fr/)
- [Ameli — allergies alimentaires](https://www.ameli.fr/assure/sante/themes/allergie-alimentaire/traitement-prevention)
- [HAS — IA en santé](https://www.has-sante.fr/jcms/p_4023307/fr/intelligence-artificielle-en-sante-bien-l-utiliser-et-bien-se-proteger)
- [CNIL — applications de santé et données personnelles](https://www.cnil.fr/fr/applications-mobiles-en-sante-et-protection-des-donnees-personnelles-les-questions-se-poser)

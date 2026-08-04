# Chaîne de contrôle réutilisable

`scripts/chaine-controle.py` juge et annote du texte, du code ou une
traduction. Il ne corrige, ne réécrit et ne supprime jamais la cible.

Python a été retenu parce que la porte visuelle existante
`scripts/influencer/visual-gate.py` est en Python, que l'appel OpenRouter et la
gestion des 429 de `scripts/juge-code.sh` se transposent sans dépendance, et que
les fonctions de décision peuvent être testées directement avec `pytest`.

## Doctrine

La chaîne applique les étages dans cet ordre :

| Étage | Acteur par défaut | Autorité | Rôle |
|---|---|---|---|
| 0 | scripts locaux | peut `REJET` | UTF-8, syntaxe, résidus, typographie, invariants de traduction, tests et lint explicitement fournis |
| 1 | `qwen/qwen3.7-flash` | signal seulement | détection à haut rappel, deux passes par défaut |
| 2 | `google/gemma-4-31b-it:free` | signal seulement | vérification indépendante, sans aucun verdict ni constat de l'étage 1 |
| 3 | `moonshotai/kimi-k3` | signal seulement | arbitrage en lot des seuls désaccords 1/2 |
| 4 | Patrice | définitive | goût, style, ligne éditoriale et décisions humaines mémorisées |

Les trois niveaux de sortie sont `OK`, `À REGARDER` et `REJET`. Une réponse IA
`REJET` est systématiquement ramenée à `À REGARDER`. Seuls un contrôle
déterministe certain et un humain peuvent rejeter.

Un arbitrage réussi remplace les deux avis IA en désaccord. Il peut donc lever
un faux positif IA, mais il ne peut jamais lever un `REJET` de l'étage 0 ni un
verdict humain.

## Appel

Le script est exécutable directement :

```bash
scripts/chaine-controle.py docs/guide.md --type texte --budget 0.01
scripts/chaine-controle.py src/ --type code --budget 0.05
scripts/chaine-controle.py traduction.txt --type traduction --strict --budget 0.02
```

`--budget` est un plafond total en dollars. Sa valeur par défaut est `0` :
Qwen et Kimi sont alors bloqués avant l'appel. Gemma `:free`, `agy` et Ollama
restent admissibles à coût marginal nul.

Les plafonds par étage se resserrent avec `--budget-etage` :

```bash
scripts/chaine-controle.py src/ --type code \
  --budget 0.10 \
  --budget-etage 1=0.01 \
  --budget-etage 2=0 \
  --budget-etage 3=0.09
```

Sans valeur explicite, chaque plafond d'étage vaut le plafond total ; le
plafond total cumulé reste prioritaire. Avant chaque appel OpenRouter, l'outil :

1. borne de façon conservatrice les tokens d'entrée par le nombre d'octets ;
2. inclut le budget de raisonnement caché dans la borne de sortie ;
3. tient compte des paliers tarifaires de contexte Qwen ;
4. impose les prix maximaux du modèle au routeur ;
5. refuse l'appel si son coût maximal dépasse le reliquat total ou celui de
   l'étage ;
6. débite ensuite le coût réel retourné par `usage.cost`.

Un modèle OpenRouter dont les tarifs ne sont pas connus de l'outil est refusé,
même s'il est passé avec `--modele-detection` ou `--modele-arbitrage`. C'est un
choix de sûreté budgétaire.

### Activer ou désactiver les étages

```bash
# Déterministe seulement
scripts/chaine-controle.py src/foo.py --type code --etages 0

# Déterministe + Qwen + vérificateur, sans Kimi
scripts/chaine-controle.py src/ --type code --etages 0,1,2 --budget 0.02

# Vérificateur local plutôt que Gemma gratuit sur OpenRouter
scripts/chaine-controle.py texte.md --type texte --etages 0,1,2 \
  --verificateur ollama --modele-verification gemma4:12b --budget 0.01

# Gemini via l'abonnement local agy
scripts/chaine-controle.py traduction.txt --type traduction \
  --verificateur agy --modele-verification gemini-3.6-flash-high \
  --budget 0.01
```

Les étages 0 à 3 sont configurables. La consultation de l'étage 4 n'est pas
désactivable : ce verrou est un fail-safe.

Les deux passes Qwen sont réglables avec `--passes-detection N`. L'étage 2 est
appelé par une fonction qui ne reçoit, par construction, aucun objet contenant
les résultats de l'étage 1. La comparaison n'a lieu qu'après les deux appels.

### Code : tests et lint

La syntaxe Python, JSON, JavaScript et shell est contrôlée directement quand
elle s'applique. Les commandes propres au projet restent explicites :

```bash
scripts/chaine-controle.py src/foo.ts --type code --budget 0.02 \
  --check-command "npm test -- tests/foo.test.ts" \
  --check-command "npm run lint"
```

Une commande non nulle produit un `REJET` déterministe et sa sortie terminale
est journalisée. `--check-command` passe par le shell : il faut uniquement lui
donner des commandes de confiance.

### Traduction

Quand un élément contient les libellés `SOURCE:` puis `TRADUCTION:`, `CIBLE:`
ou `TARGET:`, l'étage 0 compare ce qui ne demande aucune interprétation :

- URL, e-mail et placeholder modifiés : `REJET` ;
- nombres différents : `À REGARDER`, car une conversion d'unité ou de devise
  peut être légitime ; `REJET` en mode `--strict`.

Les contresens, omissions, faux amis, termes métier et changements de registre
restent analysés aux étages 1 et 2.

### Mode strict

`--strict` transforme les avertissements déterministes en `REJET`. Il augmente
également le rappel demandé aux modèles, mais leurs constats restent
`À REGARDER`. Un verrou humain `OK` conserve la priorité même en mode strict.

## Registre humain

Le registre par défaut est :

```text
~/.codebuddy/verdicts-humains.jsonl
```

Pour enregistrer un verdict définitif :

```bash
scripts/chaine-controle.py publication.md --type texte \
  --verdict-humain OK \
  --raison "Validé par Patrice le 30/07 : ton et formulation voulus" \
  --etages 0
```

Chaque ligne contient le SHA-256 des octets exacts, le verdict, la raison,
l'auteur, le type et la date. Le contenu lui-même n'est pas copié dans le
registre. Pour une même empreinte, la dernière décision humaine prévaut.

La séquence de sécurité est impérative :

1. charger et valider tout le registre ;
2. calculer l'empreinte de chaque élément ;
3. retirer les éléments verrouillés de toutes les files IA ;
4. appliquer le verdict humain à la sortie, même contre l'étage 0.

Une ligne corrompue ou un registre illisible interrompt l'exécution avant tout
appel IA. Un contenu validé `OK` ne peut donc jamais ressortir `REJET`. Toute
modification du contenu produit une nouvelle empreinte et nécessite une
nouvelle validation.

## Sortie et journal

La sortie standard est un objet JSON. Chaque élément contient notamment :

```json
{
  "id": "docs/guide.md",
  "content_sha256": "…",
  "verdict": "À REGARDER",
  "deciding_stage": 2,
  "reason": "…",
  "human_lock": null,
  "stages": {
    "0": {"actor": "contrôles déterministes", "verdict": "OK"},
    "1": {"actor": "OpenRouter/qwen/qwen3.7-flash", "verdict": "OK"},
    "2": {"actor": "openrouter/google/gemma-4-31b-it:free", "verdict": "À REGARDER"},
    "3": {"status": "not_needed"},
    "4": {"status": "no_known_verdict"}
  }
}
```

`--sortie rapport.json` conserve le même JSON dans un fichier. La cible reste
inchangée.

Le journal append-only par défaut est
`~/.codebuddy/chaine-controle.jsonl`. Il enregistre :

- configuration et plafonds au démarrage ;
- fournisseur, modèle, temps, borne autorisée, `usage` et coût réel par appel ;
- 429 épuisés, erreurs et arrêts de budget ;
- commandes déterministes, codes retour et fins de sortie ;
- verdict, raison et trace de chaque étage par empreinte.

`--gate` retourne `1` si au moins un `REJET` existe. Une erreur d'exécution ou
de sécurité retourne `2`. Sinon le code retour est `0`, y compris avec des
éléments `À REGARDER`.

## Calibration

Le jeu est un JSONL avec une vérité connue par élément :

```json
{"id":"cas-1","content":"SOURCE : …\nTRADUCTION : …","truth":"À REGARDER","authority":"Patrice","domain":"terminologie"}
```

`truth` accepte `OK`, `À REGARDER` ou `REJET`. Pour évaluer un détecteur, les
deux derniers signifient « problème à signaler ». Le mode calibration active
uniquement les étages 1 et 2 et rapporte :

- le taux d'accord sur les cas où les deux appels ont réellement abouti ;
- exactitude, faux positifs et faux négatifs de chacun ;
- le modèle correct sur chaque désaccord ;
- l'autorité humaine ou déterministe attachée à ces désaccords.

Les appels incomplets, les 429 et les réponses invalides ne sont jamais
comptés comme des prédictions.

Commande rejouée le 30 juillet 2026 :

```bash
scripts/chaine-controle.py \
  tests/scripts/fixtures/chaine-controle-calibration.jsonl \
  --type traduction --calibrate \
  --passes-detection 1 \
  --verificateur agy \
  --modele-verification gemini-3.6-flash-high \
  --budget 0.01 \
  --budget-etage 1=0.01 \
  --budget-etage 2=0
```

Résultat mesuré :

| Mesure | Qwen 3.7 Flash | Gemini 3.6 Flash High via `agy` |
|---|---:|---:|
| cas évalués | 8/8 | 8/8 |
| exactitude | 100 % | 100 % |
| faux positifs | 0 | 0 |
| faux négatifs | 0 | 0 |
| coût réel | 0,00039984 $ | 0 $ marginal |
| temps d'appel | 17,28 s | 7,61 s |

Accord : 100 %. Temps total : 24,90 s. Sortie finale : 4 `OK`, 4
`À REGARDER`, 0 `REJET`.

Ce jeu reprend les deux contresens Mathery établis le 29 juillet (« jumpsuit »
pour une combinaison de protection et « hope » pour l'espérance
mathématique), deux autres erreurs certaines et quatre traductions correctes.
Il valide le fonctionnement de la chaîne, pas une supériorité statistique.
L'accord parfait ne dit pas si l'étage 2 ajoute de la valeur : il faudra
augmenter le jeu avec des cas difficiles et surtout des désaccords historiques.

Une tentative préalable avec deux passes a aussi mesuré la disponibilité
réelle : une passe Qwen a abouti à 0,00044326 $, l'autre a épuisé trois 429, et
Gemma 4 gratuit sur OpenRouter a épuisé trois 429. Les appels en erreur ont
coûté 0 $ et sont désormais exclus des taux. Pour une chaîne régulière, `agy`
ou Gemma local sont donc les vérificateurs de repli les plus prévisibles.

## Coûts de référence au 30 juillet 2026

| Modèle | Entrée / Mtok | Sortie / Mtok | Usage |
|---|---:|---:|---|
| Qwen 3.7 Flash | 0,03 $ | 0,13 $ | deux passes sur tout |
| Gemma 4 31B `:free` | 0 $ | 0 $ | vérification aveugle |
| Gemini via `agy` | 0 $ marginal | 0 $ marginal | repli abonnement local |
| Gemma via Ollama | 0 $ marginal | 0 $ marginal | repli local |
| Kimi K3 | 3 $ | 15 $ | désaccords seulement, en lots |

OpenRouter publie les paramètres de raisonnement et précise que ces tokens sont
facturés comme sortie :
[Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
Le routeur permet aussi d'imposer un prix maximal au fournisseur :
[Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection).
L'outil applique les deux mécanismes en plus de son propre grand livre.

## Recommandation

- **Code** : toujours l'étage 0 avec les tests/lint ciblés ; Qwen deux passes
  sur chaque changement ; Gemma/Gemini pour sécurité, concurrence, contrats et
  jalons ; Kimi uniquement sur les désaccords ; humain pour architecture et
  compromis produit.
- **Texte** : étage 0, Qwen deux passes, puis vérificateur indépendant pour
  contenu publié ou factuel ; Kimi seulement sur désaccord à fort impact ;
  humain pour goût, voix et ligne éditoriale.
- **Traduction** : les quatre étages sont recommandés dans l'ordre. L'incident
  Mathery justifie de conserver Kimi comme arbitre rare. Le petit jeu actuel
  ne permet pas encore de supprimer l'étage 2 ; son coût marginal nul et la
  diversité de famille justifient de le garder pendant l'élargissement de la
  calibration.

## Limites honnêtes

- Le support actuel porte sur les textes UTF-8. L'image viendra plus tard ;
  `visual-gate.py` reste la porte spécialisée existante.
- Un dossier est découpé par fichier, pas par paragraphe, fonction ou segment
  de traduction.
- Les fichiers de plus de 400 000 octets sont hachés en entier mais tronqués
  pour l'IA et signalés `À REGARDER`.
- Les contrôles déterministes génériques ne remplacent pas les validateurs
  métier. Tests et lint du projet doivent être fournis avec `--check-command`.
- Un `OK` de deux modèles n'est pas une preuve d'absence d'erreur. Leur accord
  devient informatif seulement après calibration sur un corpus représentatif.
- `:free` peut être saturé. `agy` dépend d'un abonnement et Ollama du matériel
  local ; « 0 $ » signifie coût marginal API, pas absence de coût
  d'infrastructure.
- Le journal contient les raisons des modèles et les chemins de fichiers, mais
  pas le contenu complet. Il peut néanmoins être sensible.

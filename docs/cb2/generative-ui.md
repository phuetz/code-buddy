# GUI générative opt-in

La couche d’interface générative détecte au plus un candidat par réponse : un
payload d’outil `data: { type: … }`, ou un tableau Markdown d’au moins trois
lignes visibles (hors séparateur Markdown) et deux colonnes. Un payload
structuré est détecté quelle que soit la longueur de la réponse texte ; le
seuil de 200 caractères s’applique uniquement aux tableaux Markdown.
Le texte original n’est jamais modifié ; le pipeline renvoie séparément un
document HTML optionnel destiné au renderer inline existant.

## Activation

La détection automatique exige les deux variables suivantes :

```bash
CODEBUDDY_WIDGETS=true
CODEBUDDY_WIDGETS_AUTO=true
```

Sans elles, le résultat texte est byte-identique et aucune détection ni lecture
du registre n’est effectuée. Le chemin automatique n’appelle aucun LLM : un
payload structuré sans widget compatible reçoit un tableau HTML déterministe.
Pour créer volontairement un nouveau template authored avec un LLM, utiliser
`buddy widgets gen <kind>` ; cette commande explicite applique le gate
fail-closed avant toute persistance sous `authored-<kind>/widget.html`.

## Contrat JSON headless

Avec `--output json` (ou `--output-format json`), la réponse expose le payload
structuré détecté dans le champ optionnel `data`, par exemple
`{ "type": "stock", "symbol": "AAPL", "price": 324.85 }`. Ce champ est
indépendant du rendu HTML et reste disponible pour les consommateurs
machine-à-machine, y compris quand la réponse texte est courte. Quand
`CODEBUDDY_WIDGETS=true` et `CODEBUDDY_WIDGETS_AUTO=true`, le même objet peut
également contenir le document complet `widgetHtml`. Le champ `widgetHtml` est
absent lorsqu’aucun rendu automatique n’a été demandé ou lorsqu’aucun widget ne
peut être rendu.

## Registre et sélection

`meta.json` accepte désormais `dataTypes: string[]`, `usedCount` et
`lastUsedAt`. Un ancien widget sans `dataTypes` reste lisible et rendu par son
type historique, mais il n’est jamais sélectionné automatiquement. S’il existe
plusieurs templates déclarés pour le même type, le plus utilisé est choisi. Une
sélection auto réussie incrémente `usedCount` et met à jour `lastUsedAt`.

La commande suivante affiche ces déclarations et statistiques :

```bash
buddy widgets stats
```

## Sécurité et tolérance aux pannes

Le rendu reste entièrement côté serveur. Les templates Mustache authored sont
réanalysés par le firewall au rendu, toutes les interpolations sont échappées,
les URL dangereuses sont neutralisées et le document final embarque une CSP
`default-src 'none'`. Aucun `<script>` n’est accepté ou renvoyé.

Le pipeline est `never-throws` : indisponibilité du registre, erreur de rendu,
échec du proposer, rejet du gate ou erreur de persistance produisent simplement
`widgetHtml: null`, journalisent au niveau debug, et laissent la réponse texte
inchangée.

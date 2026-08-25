# Collecteur de preuves visuelles

`collect-evidence.py` prépare les captures réelles utilisées dans la moitié
haute de `wrap-short.py --layout split`. Il ne publie rien, ne contourne ni
paywall ni contrôle d'accès et n'utilise aucune API payante.

## Capture d'une source

```bash
python3 scripts/influencer/collect-evidence.py \
  'https://blog.google/technology/ai/' \
  --category official

python3 scripts/influencer/collect-evidence.py \
  'https://www.euronews.com/next/...' \
  --category press
```

Les catégories sont :

- `official` : page presse ou produit officielle, utilisable pour une
  couverture éditoriale avec citation ;
- `press` : capture de la fenêtre visible seulement, jamais l'article entier,
  attribution obligatoire ;
- `own` : image ou enregistrement d'écran produit par Patrice ;
- `thirdparty` : refusé sans accord explicite consigné ;
- `agency` : toujours interdit.

Pour une capture maison, une image est reprise telle quelle et une vidéo fournit
une image à l'instant demandé :

```bash
python3 scripts/influencer/collect-evidence.py ~/Videos/test-outil.mp4 \
  --category own --instant 12.5
```

Un extrait tiers exige le nom du titulaire, la date et le canal de l'accord :

```bash
python3 scripts/influencer/collect-evidence.py 'https://createur.example/extrait' \
  --category thirdparty \
  --consent-obtenu 'Camille Martin, 28/07/2026, accord écrit par courriel'
```

## Lot par sujet

```bash
python3 scripts/influencer/collect-evidence.py \
  --sujet 'Claude Opus 5' --max-preuves 5
```

Le mode lot croise `sources.json`, le catalogue produit par
`veille-youtube.py`, la sortie de `find-subjects.py` et son collecteur Google
News RSS. Il classe les sources sans LLM payant, tente les preuves dans l'ordre
et continue lorsqu'une page est inaccessible. Les sujets déclarés dans
`INFLUENCER_EXCLUDED_TOPICS` (voir `editorial_policy.py`) sont
refusés avant toute requête.

Le dossier par défaut est visible par le Chromium snap :
`~/Documents/preuves-lisa/`. Une destination dans `/tmp` ou un dossier caché
reste acceptée : Chromium travaille alors sous
`~/Documents/codebuddy-preuves-chromium/`, puis Python déplace le PNG.

## Fichiers produits

Pour chaque URL et chaque jour :

- `*-full.png` : fenêtre propre en 1200 × 850, bandeaux cookies masqués ;
- `*-split-1080x960.png` : recadrage exact de la zone haute du layout split ;
- `*.meta.json` : URL, titre, horodatage Europe/Paris, statut juridique,
  attribution prête à incruster et chemins des deux PNG.

`cache-index.json` empêche une nouvelle capture de la même URL le même jour.
`collect-evidence.log.jsonl` consigne captures, cache, échecs et accords tiers.

## Tests

```bash
python3 -m unittest tests/scripts/influencer/test_collect_evidence.py

# Intégration réseau réelle sur blog.google et openai.com/news
RUN_REAL_EVIDENCE_TESTS=1 \
  python3 -m unittest tests/scripts/influencer/test_collect_evidence.py
```

Le User-Agent identifie honnêtement `CodeBuddyEvidenceCollector/1.0`. Le délai
entre sources est réglable avec `--delai` et l'attente de rendu avec
`--attente`.

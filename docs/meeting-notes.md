# Meeting Notes

Pour enregistrer directement le micro depuis Cowork avec consentement, checkpoints atomiques et
reprise après interruption, voir [Meeting Live](./meeting-live.md).

`buddy meeting notes` transforme un fichier local de réunion en deux représentations stables :
un rapport Markdown lisible et un objet JSON exploitable par un workflow. Par défaut, aucun contenu
ne quitte la machine ; la commande ne publie et ne modifie aucune tâche externe.

```bash
# Transcription texte, SRT/VTT ou export JSON
buddy meeting notes ./reunion.srt

# Audio ou vidéo : réutilise la transcription longue locale de Code Buddy
buddy meeting notes ./point-equipe.mp4 --output ./notes/point-equipe

# Remplacer explicitement un ancien rapport (la protection est active par défaut)
buddy meeting notes ./point-equipe.mp4 --output ./notes/point-equipe --force

# Sortie JSON sur stdout, pratique pour jq et les workflows
buddy meeting notes ./reunion.json --json

# Confidentialité stricte : aucun appel LLM
buddy meeting notes ./reunion.txt --no-ai --language fr

# Enrichissement optionnel : transmet un extrait borné au fournisseur configuré
buddy meeting notes ./reunion.txt --ai --language fr
```

## Entrées

- texte : `.txt`, `.md`, `.srt`, `.vtt` et formats textuels similaires ;
- JSON : chaîne de transcription ou tableaux `segments`, `transcript`, `utterances` ou `results` ;
- média : WAV, MP3, M4A, FLAC, OGG/Opus, MP4, MOV, MKV, WebM et AVI.

Les formes Whisper/Code Buddy (`start`/`end`/`text` ou `t_start`/`t_end`/`said`) et les labels
de locuteur courants sont normalisés. Si une source texte ne contient pas d'horodatage, la valeur
reste explicitement `null` dans le JSON et `--:--` dans le rapport : Code Buddy n'invente pas de temps.

## Sorties et preuves

Le schéma versionné contient le titre, le résumé, les points clés, les participants observés,
les décisions, les actions (responsable, échéance, preuve), les questions ouvertes et la transcription
complète. Toute preuve est recopiée depuis un segment source et reliée à son numéro/horodatage ; une
citation générée par le modèle n'est jamais enregistrée comme preuve.

Sans `--output`, Markdown est écrit sur stdout (`--json` choisit JSON). Avec `--output <prefix>`,
la commande écrit `<prefix>.md` et `<prefix>.json`. Si la cible est un répertoire existant, un nom
de fichier est dérivé du titre de la réunion. Les fichiers existants sont préservés par défaut ;
seule la CLI accepte un remplacement explicite avec `--force`. L'outil agentique ne peut jamais
activer ce remplacement ; sa création de rapports suit la `WritePolicy` active et le profil de
permissions de Code Buddy.

## Analyse et confidentialité

Par défaut, la commande utilise uniquement l'analyse déterministe locale et marque
`analysisMode: "deterministic"`. `--ai` autorise explicitement l'envoi d'un extrait borné au fournisseur
LLM configuré. En cas d'absence, d'erreur réseau ou de JSON invalide non réparable, elle revient au mode
local. `--no-ai` reste accepté comme alias explicite du comportement par défaut. Même en mode IA, le
transcript complet reste local ; seul l'extrait utilisé pour l'enrichissement est transmis.

## Outil agentique `meeting_notes`

Le loop agentique dispose directement du même pipeline, sans lancer la CLI :

```json
{
  "input_path": "reunions/point-equipe.m4a",
  "language": "fr",
  "output_prefix": "notes/point-equipe"
}
```

Cette surface est plus stricte que la CLI : elle est toujours déterministe et ne propose aucun
paramètre IA, afin qu'un modèle ne puisse pas autoriser lui-même l'envoi d'un transcript. Les chemins
d'entrée et de sortie doivent rester sous le `cwd` actif ; les composants `..`, les chemins absolus
hors workspace et les liens symboliques qui en sortent sont bloqués. Sans `output_prefix`, l'outil ne
modifie aucun fichier et retourne le Markdown ainsi que le JSON structuré dans son résultat.

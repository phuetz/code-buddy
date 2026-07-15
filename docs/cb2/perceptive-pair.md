# Pair-programming perceptif

Le mode *error watch* observe uniquement les percepts d’écran déjà présents sur le bus sensoriel.
Il ne déclenche ni capture supplémentaire, ni stockage d’image, ni tour agent, ni édition. Quand il
repère une erreur, il propose une seule fois son aide par la voix locale, après avoir obtenu le
créneau du conducteur companion. Il n’envoie jamais cette suggestion sur Telegram.

## Activation

La fonctionnalité est désactivée par défaut. Les deux variables suivantes sont obligatoires :

```bash
CODEBUDDY_SENSORY=true
CODEBUDDY_SENSORY_ERRORWATCH=true
```

Sans ce double opt-in, aucun listener error-watch n’est ajouté et aucun analyseur n’est appelé.

La détection gratuite inspecte d’abord les champs texte OCR, AT-SPI ou terminal déjà transportés
par les percepts `screen/change` et `screen/keyframe`. Elle reconnaît notamment `Traceback`,
`Error:`, `Exception`, `FAILED`, `npm ERR!`, `panic:`, `segfault` et `Uncaught`.

Le repli vision local est lui aussi désactivé par défaut :

```bash
CODEBUDDY_ERRORWATCH_VISION=true
CODEBUDDY_VISION_MODEL=moondream
```

Il ne s’exécute que si l’étage texte est inconclusif et qu’une keyframe existe déjà dans le percept.
L’image est envoyée uniquement vers un endpoint VLM loopback ; aucun endpoint distant n’est accepté
par l’error-watch.

## Limites anti-harcèlement

- `CODEBUDDY_ERRORWATCH_DEBOUNCE_MS` : délai minimal entre deux suggestions, `120000` par défaut.
- `CODEBUDDY_ERRORWATCH_MAX_PER_HOUR` : plafond glissant, `4` par défaut.
- Un hash de l’indice détecté déduplique une erreur répétée à l’écran.
- Le conducteur companion peut refuser la parole si une autre initiative a déjà le créneau.

La suggestion émise est conservée dans la mémoire sensorielle courte afin qu’une demande vocale
immédiate comme « aide-moi » conserve le contexte de l’erreur observée. Toutes les erreurs internes
restent silencieuses côté serveur et sont journalisées via le logger.

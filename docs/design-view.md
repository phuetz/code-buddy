# Design View local-first

Design View prolonge les studios **Document**, **Deck** et **Image** de Cowork. Il ne crée pas une copie décorative du livrable : les changements alimentent le même chemin d’export que l’aperçu.

## Documents et présentations

Après une génération structurée, le bouton **Design View** permet de sélectionner un bloc ou une slide, modifier son contenu, changer son type, dupliquer, supprimer ou réordonner. L’export `.docx` ou `.pptx` reçoit le brouillon modifié, tandis que la réponse originale de la session reste intacte.

## Images

L’utilisateur trace jusqu’à douze zones directement sur l’image et peut donner une instruction différente à chacune. Cowork produit localement un masque PNG à canal alpha et transmet :

- l’image source bornée ;
- le masque ;
- les coordonnées normalisées ;
- les instructions relues par l’utilisateur.

OpenAI reçoit le masque via son endpoint d’édition multipart. xAI reçoit l’image via son endpoint JSON officiel et les coordonnées sont ajoutées explicitement à l’instruction. Chaque résultat est enregistré comme une nouvelle image ; l’original n’est jamais écrasé et reste accessible avec **Version précédente**.

L’historique survit maintenant à la fermeture de la vue et au redémarrage de Cowork. Le processus principal conserve une chaîne parent→version bornée (12 versions par image, 64 chaînes récentes) dans `.codebuddy/media-generation/.design-view-history/index.json`. La version d’origine est conservée dans chaque chaîne ; l’élagage retire seulement les références anciennes, jamais les fichiers de la bibliothèque média.

### Inpainting local avec ComfyUI

ComfyUI est pris en charge avec un **vrai workflow API d’inpainting**, jamais avec une régénération texte→image présentée comme une édition. Comme les graphes diffèrent selon le checkpoint et les nœuds installés, Code Buddy ne fournit pas de faux workflow universel. Il faut exporter depuis ComfyUI un workflow au format API, puis configurer l’un des deux contrats suivants :

1. un bundle JSON contenant `workflow` et `bindings`, désigné par `CODEBUDDY_COMFYUI_INPAINT_WORKFLOW=/chemin/absolu/inpaint-api.json` ;
2. le même bundle en JSON dans `CODEBUDDY_COMFYUI_INPAINT_WORKFLOW_JSON`, ou un graphe API direct accompagné de `CODEBUDDY_COMFYUI_INPAINT_BINDINGS_JSON`.

Configuration minimale :

```bash
CODEBUDDY_IMAGE_PROVIDER=comfyui
COMFYUI_URL=http://127.0.0.1:8188
CODEBUDDY_COMFYUI_INPAINT_WORKFLOW=/home/patrice/.codebuddy/comfyui/inpaint-api.json
```

Le bundle utilise des liaisons explicites, par exemple :

```json
{
  "workflow": {
    "10": { "class_type": "LoadImage", "inputs": { "image": "{{CODEBUDDY_SOURCE_IMAGE}}" } },
    "11": { "class_type": "LoadImage", "inputs": { "image": "{{CODEBUDDY_MASK_IMAGE}}" } },
    "20": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{CODEBUDDY_PROMPT}}", "clip": ["4", 1] } },
    "99": { "class_type": "SaveImage", "inputs": { "filename_prefix": "{{CODEBUDDY_OUTPUT_PREFIX}}", "images": ["40", 0] } }
  },
  "bindings": {
    "source": { "nodeId": "10", "input": "image" },
    "mask": { "nodeId": "11", "input": "image" },
    "prompt": { "nodeId": "20", "input": "text" },
    "output": { "nodeId": "99", "input": "filename_prefix" }
  }
}
```

L’extrait montre le contrat, pas un graphe exécutable complet : le fichier réel doit conserver les nœuds modèle, encodage inpaint, sampler et décodage exportés par ComfyUI. Le validateur exige notamment :

- des nœuds officiels `LoadImage`, `CLIPTextEncode` et `SaveImage` aux liaisons déclarées ;
- chaque placeholder exactement une fois, sans placeholder résiduel ;
- la source (sortie `0`), le masque alpha (sortie `1`) et le prompt (sortie `0`) réellement reliés au `SaveImage` choisi ;
- toutes les références de nœuds valides, un graphe de 512 nœuds maximum et un JSON de 1 Mo maximum.

Code Buddy charge la source via `/upload/image`, le masque via `/upload/mask` avec sa référence d’origine, soumet le graphe à `/prompt`, interroge `/history/{prompt_id}` et télécharge uniquement la sortie PNG du `SaveImage` déclaré via `/view`. Les délais sont réglables avec `CODEBUDDY_COMFYUI_INPAINT_TIMEOUT_MS`, `CODEBUDDY_COMFYUI_SUBMIT_TIMEOUT_MS` et `CODEBUDDY_COMFYUI_POLL_MS`. L’annulation du tool interrompt les uploads, requêtes et attentes locales ; elle n’envoie pas un `/interrupt` global qui pourrait arrêter les travaux ComfyUI d’un autre utilisateur.

Sans configuration, avec un graphe incompatible, une sortie ambiguë ou un masque absent, l’édition échoue fermée et Cowork ne revendique pas la capacité d’inpainting.

## Sécurité et limites

- une édition ne démarre qu’après le clic **Appliquer aux zones** ;
- images et masques sont limités à 15 Mo dans le bridge Cowork ;
- un masque local est limité à 40 mégapixels pour éviter une allocation mémoire excessive ;
- les data URLs ne sont jamais écrites dans les métadonnées ;
- les sorties sont de nouvelles versions sous `.codebuddy/media-generation/images`.
- les sorties ComfyUI sont limitées à un PNG de 50 Mo, puis écrites avec création exclusive dans une arborescence sans lien symbolique et confinée au workspace ;
- l’index ne contient ni prompt, ni masque, ni contenu d’image ; son dossier est privé (`0700`) et son fichier est atomique et privé (`0600`) ;
- le renderer ne choisit jamais l’emplacement de l’index : chaque chemin demandé ou relu est résolu par `realpath` et reconfiné aux racines média connues du processus principal ;
- un lien symbolique, un index surdimensionné ou une version pointant hors des racines autorisées bloque la lecture de l’historique.

Références de comportement et d’API : [Manus Design View](https://manus.im/blog/manus-design-view), [xAI Image edit](https://docs.x.ai/developers/rest-api-reference/inference/images), [OpenAI image masking](https://developers.openai.com/api/docs/guides/image-generation#edit-an-image-using-a-mask), [routes serveur officielles ComfyUI](https://docs.comfy.org/development/comfyui-server/comms_routes) et [upload/exécution officiels ComfyUI](https://docs.comfy.org/development/cloud/api-reference).

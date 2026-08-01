# Tri et épreuve des 93 outils « à tester » — 1er août 2026

## Résultat en bref

Le catalogue contient bien **93 lignes** portant le statut « à tester ». Elles sont toutes reprises ci-dessous, dans leur ordre d’apparition, doublons compris.

| Catégorie | Nombre | Sens opérationnel retenu |
|---|---:|---|
| A — accessible maintenant | 24 | Artefact téléchargeable et assez petit pour les machines disponibles, service gratuit sans compte, ou outil déjà installé et authentifié. |
| B — geste du propriétaire | 57 | Compte, acceptation de licence, clé, carte, abonnement, achat, ou location GPU nécessaire. Le coût minimal connu est indiqué. |
| C — pas un outil testable | 12 | Article, méthode, workflow, démo ponctuelle, robot ou annonce sans artefact public. |
| D — déjà tranché parmi ces 93 | 0 | Aucune des 93 lignes ne porte déjà une décision expérimentale. Le contrôle Wan 2.2 Bernini est hors de ce dénominateur. |
| **Total** | **93** | |

Deux résultats comptent davantage que les promesses :

- **Lucida n’est pas à adopter pour les cheveux d’Ambre** : la bande de transition moyenne reste exactement à **3,67 px** avant et après Lucida, et la planche ne montre pas de nouvelles mèches crédibles.
- **Magenta RealTime 2 fonctionne hors ligne sur CPU**, mais pas en temps réel : **2,6 à 5,2 pas/s**, contre une cible de **25 pas/s**. Les trois sorties sont distinctes et sans écrêtage, mais cela ne justifie pas une intégration de production.

PiD 1.5 reste la prochaine épreuve visuelle utile. Le modèle n’est présent sur aucun des deux ComfyUI et il n’existe pas, depuis cette machine, de canal autorisé pour l’installer sur darkstar. Topaz bascule en B : l’essai demande une carte bancaire et se transforme automatiquement en abonnement.

Le fichier source n’a pas été modifié. En particulier, tout outil non éprouvé demeure **« à tester »**.

## Méthode et conventions

- Vérification effectuée le 2026-08-01 sur les dépôts et pages éditeur/Hugging Face, avec contrôle HTTP des URL d’accès ou de téléchargement. Les poids sont des octets décimaux relevés dans les métadonnées des dépôts, pas une estimation par nombre de paramètres.
- Matériel disponible : deux services ComfyUI permanents sur darkstar, chacun voyant une RTX 3090 de 24 Gio; aucune session distante d’administration n’est ouverte. Un modèle qui réclame plus que les 48 Gio cumulés et ne dispose pas d’une quantification exploitable passe en B, car il faut louer du calcul.
- Pour les A déjà installés ou les SaaS gratuits sans compte, « téléchargement » est sans objet; la ligne fournit respectivement l’URL officielle de l’installateur ou l’URL d’accès testée.
- Les quatre scores sont notés **CB / média / bio / Lisa**. Ils viennent du catalogue et ne sont pas recalculés ici.
- Corrections factuelles de libellé : Karbon → **Carbon**, Azure Quantum Discovery → **Microsoft Discovery**, Mama → **MAMMA**, Cefi Image → **SeFi-Image**, ProxyProz → **ProxyPose**, Codeex → **Codex**, PyD → **PiD**, NeMo 3 Ultra → **NVIDIA Nemotron 3 Ultra**.
- Les doubles mentions Kimi K3, n8n et Claude Opus 5 restent deux lignes chacune : l’objet du tri est bien le jeu des 93 mentions, non un dédoublonnage.

## Tableau exhaustif des 93 mentions

| # | Entrée vérifiée | Scores | Cat. | Motif vérifié, accès et coût |
|---:|---|---|:---:|---|
| 1 | Carbon (catalogue : Karbon) | 4/0/9/7 | A | Modèle génomique ouvert, [dépôt HF](https://huggingface.co/HuggingFaceBio/Carbon-500M), Apache-2.0, non gated. [Checkpoint direct](https://huggingface.co/HuggingFaceBio/Carbon-500M/resolve/main/model.safetensors) de **1 023 817 968 o**; test local possible sur CPU/GPU. Non éprouvé. |
| 2 | ReactiveGWM | 4/8/0/8 | A | [Code](https://github.com/INV-WZQ/ReactiveGWM) et [poids](https://huggingface.co/INV-WZQ/ReactiveGWM-Models), CC-BY-NC-4.0. Un checkpoint fait environ **10 001 505 776 o**; le dépôt complet de six variantes fait **60 009 053 930 o**. [Téléchargement SF2 vérifié](https://huggingface.co/INV-WZQ/ReactiveGWM-Models/resolve/main/SF2/ReactiveGWM_base.safetensors). Une variante et sa base Wan tiennent en principe sur darkstar. Non éprouvé. |
| 3 | Microsoft Discovery (catalogue : Azure Quantum Discovery) | 8/0/5/7 | B | Le client local est annoncé gratuit, mais exige un compte GitHub/Copilot : [annonce Microsoft](https://news.microsoft.com/source/features/innovation/majorana-2-microsoft-discovery-agentic-ai/). **Geste :** connexion GitHub et activation Copilot Free, **0 $**; fonctions Azure/entreprise sur devis. Non éprouvé. |
| 4 | Gemma 4 12B | 10/5/2/9 | A | Déjà installé dans Ollama sous <code>gemma4:12b</code>; blobs locaux **7 556 497 632 o**. [Fiche/téléchargement Ollama](https://ollama.com/library/gemma4:12b) vérifié; licence déclarée Apache-2.0. Il a été sollicité par le visual gate Lucida : 3 analyses vision sur 3 ont répondu OK. |
| 5 | Magenta RealTime 2 | 5/9/0/8 | A | [Code Apache-2.0](https://github.com/magenta/magenta-realtime) et [poids CC-BY-4.0](https://huggingface.co/google/magenta-realtime-2), sans compte. [Petit checkpoint direct](https://huggingface.co/google/magenta-realtime-2/resolve/main/checkpoints/mrt2_small.safetensors), **1 128 840 272 o**; ressources communes environ 1,3 Go. **Éprouvé** sur CPU, résultats plus bas. |
| 6 | MAMMA (catalogue : Mama) | 6/9/3/9 | B | [Code/projet](https://github.com/cuevhv/mamma), licence scientifique non commerciale. Les poids MAMMA et le corps SMPL-X nécessitent deux demandes et acceptations de licence. **Geste :** créer les comptes MAMMA et SMPL-X, **0 $**; poids non librement téléchargeables sans ces accords. |
| 7 | Rêve 2 / 2.1 | 4/9/0/8 | B | Service propriétaire, [annonce officielle](https://blog.reve.com/posts/announcing-reve-2.0), aucun poids public. **Geste :** compte fournisseur/agrégateur; **0,30 $ par image** pour Rêve 2.1 chez [Martini](https://www.martini.film/pricing). |
| 8 | Lambda GPU Cloud | 5/2/1/1 | B | Infrastructure, pas un poids. **Geste :** compte, moyen de paiement et instance. [Tarif officiel](https://lambda.ai/instances) : à partir de **0,69 $/GPU/h** (RTX 6000), 1,09 $/h (A6000), hors taxes. |
| 9 | Anam CARA-4 | 7/8/0/7 | B | API/avatar propriétaire, [tarifs](https://anam.ai/pricing). **Geste :** créer un compte; plan gratuit **0 $ et 30 min/mois**, puis offre payante. Aucun poids téléchargeable. |
| 10 | Dreamina Layers Editor | 2/7/0/6 | B | [Service Dreamina](https://dreamina.capcut.com) propriétaire, utilisable avec crédits quotidiens. **Geste :** compte CapCut/Dreamina, **0 $** pour les crédits gratuits; prix au-delà selon le bouquet affiché au compte. |
| 11 | LingBot-World 2.0 | 8/8/0/8 | B | [Code](https://github.com/Robbyant/lingbot-world-v2) et [poids](https://huggingface.co/robbyant/lingbot-world-v2-14b-causal-fast), CC-BY-NC-SA-4.0, mais snapshot **86 072 042 504 o** et exemple officiel à huit GPU : hors des 48 Gio locaux. **Geste :** compte cloud et carte; 8×H100 coûtent au minimum **31,92 $/h** chez [Lambda](https://lambda.ai/instances), hors taxes. |
| 12 | Seedream 5.0 Pro | 4/8/0/8 | B | Service propriétaire [Dreamina](https://dreamina.capcut.com/seedream/seedream-5-0-pro), pas de poids public. **Geste :** compte, **0 $** avec crédits quotidiens; complément payant selon le compte. |
| 13 | AI assistance coding skills paper | 8/0/0/7 | C | C’est l’[étude Anthropic sur la formation des compétences](https://www.anthropic.com/research/AI-assistance-coding-skills), pas un logiciel, une API ni un checkpoint. Rien à télécharger ou à exécuter comme outil. |
| 14 | ABot-World-0 | 7/9/0/8 | A | [Code Apache-2.0](https://github.com/amap-cvlab/ABot-World) et [poids Apache-2.0](https://huggingface.co/acvlab/ABot-World-0-5B-LF), non gated. Snapshot **24 765 865 780 o**, pic annoncé 19 Go sur RTX 5090 : compatible en capacité avec une 3090. [Checkpoint direct vérifié](https://huggingface.co/acvlab/ABot-World-0-5B-LF/resolve/main/diffusion_pytorch_model.safetensors). Non éprouvé. |
| 15 | Alaya World | 6/9/0/7 | B | [Code](https://github.com/AlayaLab/AlayaWorld) et poids propres accessibles, environ **33 609 234 116 o**, mais l’inférence réclame aussi Gemma 3 gated et LTX-2 sous conditions. **Geste :** compte Hugging Face et acceptation des licences Google/LTX, **0 $**; pas d’essai anonyme complet. |
| 16 | SeFi-Image (catalogue : Cefi Image) | 5/8/0/6 | B | [Code MIT](https://github.com/jmliu206/SeFi-Image); checkpoints HF à accès conditionné, CC-BY-NC-4.0. Modèles : **6 803 261 877 o** (1B turbo) ou **19 013 931 981 o** (5B). **Geste :** compte HF et acceptation, **0 $**. |
| 17 | GPT Live | 6/7/0/8 | B | Fonction propriétaire de ChatGPT, aucun poids. **Geste :** compte OpenAI; [ChatGPT Free](https://openai.com/chatgpt/pricing/) **0 $**, Plus **20 $/mois** si la fonction ou ses limites l’exigent. |
| 18 | Muse Image | 6/8/0/7 | B | Modèle propriétaire servi dans Meta AI, [annonce officielle](https://ai.meta.com/blog/introducing-muse-image-muse-video-msl/), disponibilité géographique limitée. **Geste :** compte Meta et région éligible, **0 $**; poids et tarif API non publiés. |
| 19 | ProxyPose (catalogue : ProxyProz) | 7/8/0/6 | A | [Code](https://github.com/ruihangzhang97/proxypose) et [poids](https://huggingface.co/ruihangzhang79/proxypose) anonymes. LoRA 1,3B **175 050 488 o**, 14B **613 510 320 o**, plus base Wan. [Téléchargement direct 1,3B](https://huggingface.co/ruihangzhang79/proxypose/resolve/main/wan1.3b.final.step.100000.safetensors). **Réserve : aucune licence n’est déclarée sur HF**, donc test de recherche seulement, pas adoption. |
| 20 | Bonsai 27B | 6/1/0/6 | A | [Dépôt GGUF](https://huggingface.co/prism-ml/Bonsai-27B-gguf), Apache-2.0, anonyme. [Q1 direct](https://huggingface.co/prism-ml/Bonsai-27B-gguf/resolve/main/Bonsai-27B-Q1_0.gguf) **3 803 452 480 o**, mmproj **629 246 880 o** : largement testable. Non éprouvé. |
| 21 | ChatGPT | 9/5/2/7 | B | SaaS propriétaire. L’authentification Codex présente n’autorise pas à piloter le compte ChatGPT du propriétaire. **Geste :** connexion; [Free](https://openai.com/chatgpt/pricing/) **0 $**, Plus **20 $/mois**. |
| 22 | Claude Code | 9/4/0/8 | A | Déjà installé (**2.1.220**) et authentifié sur un abonnement Max existant; coût marginal **0 $**. [Installateur/releases officiel](https://github.com/anthropics/claude-code/releases/latest) vérifié. Le binaire est disponible, les poids du modèle distant ne le sont pas. Non benchmarké séparément. |
| 23 | Claude Fable 5 | 9/5/2/7 | A | Modèle propriétaire distant, mais immédiatement accessible par le Claude Code installé avec <code>claude --model fable</code> et l’abonnement Max existant; coût marginal **0 $**. [Client officiel](https://github.com/anthropics/claude-code/releases/latest), poids non publiés. Non éprouvé. |
| 24 | Google Search AI Mode Connected Apps | 5/1/0/6 | B | Fonction d’un compte Google, pas un artefact autonome. **Geste :** connexion Google et activation dans une région éligible, **0 $**; aucune licence/poids à télécharger. |
| 25 | Google Vids Gemini Omni & Personal Avatars | 2/8/0/7 | B | Fonction Google Vids propriétaire. **Geste :** compte Google Workspace/Google AI; [Google AI Pro](https://one.google.com/about/plans) **19,99 $/mois** au tarif public, selon pays. |
| 26 | Grok | 9/4/1/8 | B | Service xAI propriétaire; aucune clé xAI n’est configurée. **Geste :** compte; [offres xAI](https://x.ai/pricing) Free **0 $**, SuperGrok **30 $/mois**. |
| 27 | Inkling | 7/1/0/5 | B | [Poids Apache-2.0](https://huggingface.co/thinkingmachines/Inkling-NVFP4) anonymes, mais snapshot **592 037 337 118 o** et empreinte annoncée proche de 2 To : non inférable sur deux 3090. **Geste :** location d’un cluster; l’offre publique 16×B200 sur deux semaines revient au minimum à **53 007,36 $** hors taxes chez [Lambda](https://lambda.ai/pricing). |
| 28 | Kimi K3 — première mention | 9/4/2/8 | B | [Poids ouverts](https://huggingface.co/moonshotai/Kimi-K3) sous licence Kimi, mais snapshot **1 560 998 984 390 o**. **Geste :** location au strict minimum de 8×B200 avec offload, **53,52 $/h** chez [Lambda](https://lambda.ai/instances); le chargement entièrement en VRAM demande davantage. |
| 29 | Spotify Conversational AI | 4/5/0/6 | B | Bêta liée au service Spotify. **Geste :** compte et Premium; en France, [Premium Individual](https://www.spotify.com/fr/premium/) **12,14 €/mois** après l’éventuelle promotion. |
| 30 | n8n — première mention | 9/0/0/7 | A | Outil auto-hébergeable, [code source disponible](https://github.com/n8n-io/n8n/releases/latest) sous Sustainable Use License; aucun poids. Téléchargement/release vérifié, aucun compte requis en local. Non éprouvé. |
| 31 | « Unia » | 9/0/0/7 | C | Le nom du catalogue ne correspond pas à un produit : il renvoie à l’[article Nature Physics sur deux structures de l’eau](https://www.nature.com/articles/s41567-026-03301-8). Les auteurs publient du [code expérimental AGPL-3.0](https://github.com/GenTrajSim/Auto_IPC-RC) et des données, mais aucun package ni checkpoint préentraîné nommé « Unia ». La mention reste un article de recherche, non un outil autonome. |
| 32 | Depth Map Storyboarding | 2/7/0/6 | C | Technique de storyboard reposant sur une carte de profondeur, sans produit, dépôt ni modèle propre. Elle peut devenir un protocole de test de PiD, mais n’est pas un outil. |
| 33 | Lucy 2.5 | 6/9/0/9 | B | API vidéo propriétaire Decart. **Geste :** compte et clé; crédits initiaux gratuits, puis [tarifs](https://docs.platform.decart.ai/getting-started/pricing) **0,02 $/s** en temps réel et **0,04 $/s** en asynchrone 720p. |
| 34 | Martini Camera Motion | 4/8/0/7 | B | Fonction du routeur média Martini. **Geste :** compte/waitlist; plan Indie **0 $**, générations facturées en crédits, exemple public d’environ **0,80 $ pour 8 s** sur la [page de prix](https://www.martini.film/pricing). |
| 35 | Seed 1.0 Audio | 5/8/0/6 | B | Accès via Runway, pas de poids public. **Geste :** compte; [Runway Free](https://runwayml.com/pricing) **0 $ avec 125 crédits uniques**, puis Standard **12 $/mois** facturé annuellement; Seed Audio consomme 15 crédits/minute. |
| 36 | Theoretically Motion Control (catalogue : Pose V4) | 4/7/0/6 | B | Modèle de profondeur d’environ **59 Mo** distribué via [Gumroad](https://theoreticallymedia.gumroad.com/l/zobqss), prix « 0 $+ ». **Geste :** le propriétaire doit fournir son e-mail et valider le checkout; minimum **0 $**. |
| 37 | Kimi Code | 8/1/0/6 | B | CLI ouvert mais backend Kimi soumis à compte/membership; aucune clé présente. **Geste :** compte Kimi et abonnement, [minimum mensuel](https://www.kimi.com/help/membership/membership-overview) **19 $/mois** ou équivalent annuel 15 $/mois. |
| 38 | ExploitGym | 8/0/0/6 | A | [Dépôt Apache-2.0](https://github.com/sunblaze-ucb/exploitgym), archive [téléchargeable sans compte](https://github.com/sunblaze-ucb/exploitgym/archive/refs/heads/main.zip); 869 tâches/conteneurs, pas de poids unique. Accessible, mais **non exécuté** : lancer des scénarios d’exploitation sort du banc média et exige un bac à sable dédié. |
| 39 | GLM 5.2 | 8/2/2/7 | B | [FP8 MIT](https://huggingface.co/zai-org/GLM-5.2-FP8) anonyme, **755 663 676 164 o**; BF16 **1 506 693 036 946 o**. Deux 3090 ne suffisent pas. **Geste :** compte cloud et 8×B200, au moins **53,52 $/h** chez [Lambda](https://lambda.ai/instances), hors taxes. |
| 40 | NVIDIA Nemotron 3 Ultra | 7/0/0/5 | B | [Poids NVFP4](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4), licence NVIDIA Open Model/MDW, **352 381 245 521 o**. **Geste :** location; 8×A100 80 Go coûtent au moins **22,32 $/h** chez [Lambda](https://lambda.ai/instances). |
| 41 | DigitalOcean Inference Router | 7/0/0/5 | B | Service hébergé. **Geste :** compte DigitalOcean, clé et solde prépayé positif; routeur sans surcoût annoncé, inférence serverless à partir d’environ **0,05 $/million de tokens** selon [tarifs](https://docs.digitalocean.com/products/inference/details/pricing/). |
| 42 | Model Routing | 8/0/0/6 | C | Concept d’architecture, sans implémentation nommée ni artefact. Il ne peut pas être testé indépendamment d’un routeur concret. |
| 43 | Codex (catalogue : Codeex) | 8/3/0/7 | A | CLI déjà installé (**0.144.5**) et authentifié via ChatGPT; coût marginal **0 $**. [Releases officielles](https://github.com/openai/codex/releases/latest) vérifiées; modèle distant propriétaire, poids non publiés. Non benchmarké séparément. |
| 44 | FLUX 3 | 3/9/0/9 | B | [Annonce officielle](https://bfl.ai/blog/flux-3) : early access seulement; poids Dev promis mais non publiés. **Geste :** candidature, compte BFL et Slack; **0 $ pour la demande**, tarif FLUX 3 non publié et accès non garanti par les [conditions EAP](https://bfl.ai/legal/eap-terms-of-service). |
| 45 | Midjourney v7 | 0/8/0/5 | B | SaaS propriétaire, pas de poids. **Geste :** compte Discord/Midjourney et abonnement; [Basic](https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans) **10 $/mois**. |
| 46 | Nano Banana — éditeur générique | 0/8/0/5 | B | Nom de modèle/service, pas un binaire local. **Geste :** compte Google ou agrégateur; chez [Martini](https://www.martini.film/pricing), Nano Banana 2 coûte environ **0,07 $ en 1K**, 0,11 $ en 2K, 0,14 $ en 4K. |
| 47 | Topaz Video | 0/7/0/4 | B | Non installé. [Essai officiel](https://app.topazlabs.com/?intentName=upscale) de 7 jours avec carte et renouvellement automatique. **Geste :** carte bancaire; [tarif](https://docs.topazlabs.com/sales-account-licensing/before-you-buy/app-and-collection-options) **299 $/an prépayés** ou **33 $/mois avec engagement annuel** (399 $/an). Aucun essai dépensé. |
| 48 | Greptile | 9/0/0/6 | B | Service de revue de code nécessitant GitHub et installation de l’application. **Geste :** autorisation GitHub; [tarif](https://www.greptile.com/) **30 $/siège/mois**, 50 revues incluses puis 1 $/revue. |
| 49 | Routage multi-modèles — planification/exécution/revue | 9/0/0/8 | C | Pattern de workflow et non produit distinct. Code Buddy possède déjà plusieurs mécanismes de routage, mais cette ligne n’offre aucun artefact externe à éprouver. |
| 50 | Google GNM | 5/8/2/6 | A | [Code Apache-2.0](https://github.com/google/GNM), dépôt environ **90 629 646 o**. [Poids v3 direct](https://raw.githubusercontent.com/google/GNM/main/gnm/shape/data/versions/v3_0/gnm_head.npz) **53 305 389 o**, sans compte. Non éprouvé. |
| 51 | Lucida | 4/8/0/7 | A | [Code MIT](https://github.com/egeorcun/lucida), [modèle HF](https://huggingface.co/egeorcun/lucida) non gated. [Checkpoint direct](https://huggingface.co/egeorcun/lucida/resolve/main/model.safetensors) **884 878 856 o** (845 Mio). **Éprouvé** sur trois tenues d’Ambre; non retenu pour les cheveux. |
| 52 | PiD 1.5 (catalogue : PyD) | 5/8/1/6 | A | Upscaler Pixel diffusion Decoder de NVIDIA, pas générateur de carte de profondeur. [Code Apache-2.0](https://github.com/nv-tlabs/PiD), [poids officiels](https://huggingface.co/nvidia/PiD) **2 800 546 587 o**. [Int8 Comfy direct](https://huggingface.co/Comfy-Org/PixelDiT/resolve/main/diffusion_models/pid_1.5_flux1_1024_to_4096_4step_int8_convrot.safetensors) **1 584 813 952 o**, licence NVIDIA recherche non commerciale. Accessible mais non éprouvé : modèle absent de darkstar et pas de canal d’installation autorisé. |
| 53 | MobileWan / Wan mobile récurrent | 4/7/0/8 | C | [Page de recherche MobileWan](https://qualcomm-ai-research.github.io/MobileWan/) annonçant que modèles et recettes « seront publiés »; aucun dépôt/poids public vérifiable aujourd’hui. C’est une annonce de recherche, pas encore un outil. |
| 54 | B-Roll Video Generator | 3/8/0/7 | B | Workflow Hyperagent hébergé. **Geste :** connexion Google/Apple/Microsoft; compte **0 $**, exécutions débitées de crédits (bonus promotionnel annoncé, coût variable par run) sur [Hyperagent](https://hyperagent.com/). |
| 55 | Hyperagent Marketplace | 7/4/0/6 | B | Marketplace SaaS, pas un paquet local. **Geste :** compte OAuth, **0 $ à l’ouverture**; workflows payés à l’usage, exemples publics de quelques dollars par exécution sur [Hyperagent](https://hyperagent.com/marketplace). |
| 56 | Small Biz Website Builder | 6/2/0/7 | B | Workflow Hyperagent. **Geste :** compte OAuth, **0 $ à l’ouverture** puis crédits à l’usage; ordre de grandeur public de quelques dollars par run. Aucun artefact autonome. |
| 57 | ChatGPT Voice Desktop | 8/5/0/8 | B | Fonction du client ChatGPT. **Geste :** installation/connexion du client par le propriétaire; Free **0 $** avec limites, Plus **20 $/mois** d’après [les offres](https://openai.com/chatgpt/pricing/). |
| 58 | Claude Teach a Skill | 8/3/0/8 | B | Fonction de Claude Desktop, distincte du CLI authentifié. **Geste :** installer/autoriser le client et activer la fonction; coût marginal **0 $** avec l’abonnement Max déjà présent, sinon Pro **20 $/mois** sur [Claude](https://www.anthropic.com/pricing). |
| 59 | Claude Voice Mode | 7/4/0/7 | B | Même blocage Claude Desktop/compte/région. **Geste :** installation et activation; **0 $ marginal** avec Max existant, sinon Free limité ou Pro **20 $/mois**. |
| 60 | Gemini 3.6 Flash | 8/5/0/5 | B | API Google propriétaire; aucune clé Gemini présente. **Geste :** compte AI Studio et clé; free tier **0 $**, puis [tarif API](https://ai.google.dev/gemini-api/docs/pricing) **1,50 $/M tokens en entrée et 7,50 $/M en sortie**. |
| 61 | Kimi K3 — seconde mention | 9/3/3/8 | B | Même modèle de **1 560 998 984 390 o** que la ligne 28. **Geste/coût :** au moins 8×B200 avec offload, **53,52 $/h**; aucune seconde épreuve ni double téléchargement. |
| 62 | MAI-Image-2.5-Pro | 4/8/0/5 | B | Modèle Microsoft propriétaire dans Azure AI Foundry. **Geste :** abonnement Azure payant, projet Foundry et clé; quota gratuit indiqué à zéro dans les [prérequis officiels](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-image), **prix public non affiché / facturation au portail**. |
| 63 | Runway Media Router | 6/8/0/6 | B | Routeur propriétaire Runway. **Geste :** compte; [Free](https://runwayml.com/pricing) **0 $ avec 125 crédits uniques**, Standard **12 $/mois** facturé annuellement. |
| 64 | ARC-AGI 3 | 7/0/1/7 | A | Benchmark et SDK réellement téléchargeables, [dépôt MIT](https://github.com/arcprize/ARC-AGI). [Archive directe](https://github.com/arcprize/ARC-AGI/archive/refs/heads/main.zip) vérifiée; aucun poids embarqué. Non éprouvé faute de modèle-candidat et parce que ce n’est pas un outil média. |
| 65 | Claude Opus 5 — première mention | 9/4/4/9 | A | Accessible immédiatement dans le Claude Code déjà authentifié via <code>claude --model opus</code>; coût marginal **0 $** sur Max existant. [Client officiel](https://github.com/anthropics/claude-code/releases/latest); poids propriétaires non publiés. Prix API public : **5 $/M entrée, 25 $/M sortie**, non dépensé. |
| 66 | Box AI | 6/1/2/4 | B | Plateforme entreprise nécessitant organisation Box. **Geste :** contrat Business, minimum 3 utilisateurs; [prix](https://www.box.com/pricing/individual) **15 $/utilisateur/mois annuel**, soit **45 $/mois minimum**. |
| 67 | Cutaway | 8/5/3/8 | C | Petite application 3D créée ponctuellement par Claude pendant la vidéo; ni le descriptif de la vidéo ni une recherche de dépôt ne donnent une URL publique. C’est une démo produite, pas un outil distribué. |
| 68 | n8n — seconde mention | 8/5/1/7 | A | Même [release auto-hébergeable](https://github.com/n8n-io/n8n/releases/latest) que la ligne 30, Sustainable Use License, aucun compte local. Non réinstallé et non recompté comme une seconde épreuve. |
| 69 | Genspark SecondBrain | 4/3/0/6 | B | Carte matérielle, donc impossible à éprouver sans achat. **Geste :** commander sur [la boutique officielle](https://shop.genspark.ai/); **199 $**, prix de lancement affiché **179 $**, avec 300 minutes de transcription/mois. |
| 70 | Artificial Analysis Leaderboard | 7/1/0/5 | A | [Service public](https://artificialanalysis.ai/) accessible sans compte et testé en HTTP; **0 $**, aucun téléchargement ni poids car SaaS. Consultable maintenant, mais pas benchmarké comme producteur de contenu. |
| 71 | Zapier | 7/4/0/6 | B | SaaS d’automatisation. **Geste :** compte; plan Free **0 $ / 100 tâches par mois**, Pro à partir de **19,99 $/mois** facturé annuellement sur [les tarifs Zapier](https://zapier.com/pricing). |
| 72 | Cursor | 9/1/0/7 | B | Éditeur propriétaire non installé et exigeant un compte. **Geste :** installation et connexion; [Hobby](https://cursor.com/pricing) **0 $ sans carte**, Pro **20 $/mois**. |
| 73 | GrokBuild | 9/1/0/7 | A | [Code Apache-2.0](https://github.com/xai-org/grok-build), [archive directe](https://github.com/xai-org/grok-build/archive/refs/heads/main.zip) vérifiée. Peut pointer vers un endpoint local, donc pas de clé obligatoire; avec xAI hébergé, tarif grok-build **1 $/M entrée, 2 $/M sortie** en contexte court. Non éprouvé. |
| 74 | Gemini Robotics 2 | 7/0/0/7 | C | Logiciel embarqué de démonstration sur robots/humanoïdes partenaires; pas de SDK général, checkpoint ou robot disponible. C’est une annonce de recherche/produit matériel, non un outil éprouvable ici. |
| 75 | ElevenAgents | 7/8/0/7 | B | Agents téléphoniques ElevenLabs, API propriétaire. **Geste :** compte; [Free](https://elevenlabs.io/pricing/agents) **0 $ avec 15 minutes d’appels et 4 simultanés**, Starter **6 $/mois**, dépassement environ 0,08 $/min hors LLM. |
| 76 | Hailuo 03 | 2/9/0/8 | B | Générateur vidéo propriétaire. **Geste :** compte; Free **0 $** avec limites/filigrane, Standard **14,99 $/mois** d’après la [politique de paiement officielle](https://hailuoai.video/doc/payment-policy.html). |
| 77 | Artificial Analysis Intelligence Index | 6/1/1/7 | A | Même [site public sans compte](https://artificialanalysis.ai/) que la ligne 70, **0 $**, aucun poids/téléchargement. L’index est consultable mais ce n’est pas une génération à mesurer. |
| 78 | AutoResearch | 9/1/3/8 | A | [Code MIT](https://github.com/karpathy/autoresearch), [archive directe](https://github.com/karpathy/autoresearch/archive/refs/heads/master.zip) vérifiée; requiert un GPU NVIDIA mais aucun poids fourni. Testable sur une 3090 après installation, non éprouvé car hors priorité média. |
| 79 | GPT-5.6 Luna | 9/4/4/8 | B | API OpenAI propriétaire; aucune clé API facturée n’est disponible. **Geste :** compte API, clé et crédit. [Tarif officiel actuel](https://developers.openai.com/api/docs/models/gpt-5.6-luna) **1 $/M tokens en entrée, 6 $/M en sortie**; le 0,20/1,20 $ du catalogue est obsolète. |
| 80 | Loopy Skill | 6/1/1/4 | B | Workflow Hyperagent, pas un package Code Buddy. **Geste :** compte OAuth, **0 $ à l’ouverture**, consommation de crédits à l’exécution; prix exact du run variable/non publié hors session. |
| 81 | BUZZ | 9/0/0/10 | A | Outil d’orchestration auto-hébergeable de Block, [code Apache-2.0](https://github.com/block/buzz), [release officielle](https://github.com/block/buzz/releases/latest) vérifiée (v0.4.20 au contrôle). Aucun compte ni poids. Non éprouvé. |
| 82 | Claude Opus 5 — seconde mention | 5/9/0/8 | A | Même accès installé/authentifié que la ligne 65, <code>claude --model opus</code>, **0 $ marginal**. Cette seconde mention n’a pas déclenché un second test. |
| 83 | Gemini Omni Video | 0/10/0/9 | B | Service Google propriétaire. **Geste :** compte Google et activation; offre annoncée de **10 vidéos gratuites jusqu’au 4 août 2026**, donc coût de test **0 $** dans cette fenêtre, prix ultérieur non publié ici. |
| 84 | HeyGen Video Podcast | 0/8/0/9 | B | SaaS propriétaire. **Geste :** compte; [Free](https://www.heygen.com/pricing) **0 $ / 3 vidéos par mois**, Creator **29 $/mois**. |
| 85 | Mirage Avatar X | 0/9/0/10 | B | Modèle propriétaire accessible dans Captions, [page officielle](https://captions.ai/features/generate-ai-avatars). **Geste :** compte et plan génératif; [Max](https://captions.ai/pricing) **24,99 $/mois** avec 500 crédits; le plan Free n’inclut pas de crédits IA. |
| 86 | Nano Banana — Google Earth | 0/10/0/9 | C | Ce n’est pas un modèle distinct mais une fonction Google Earth annoncée puis retirée le 31 juillet pour réévaluation de politique, selon la [mise à jour officielle](https://blog.google/products-and-platforms/products/earth/nano-banana-google-earth-image-generation/). Aucun outil accessible à tester le 1er août. |
| 87 | GPT Image 2 | 0/8/0/5 | B | Modèle propriétaire. **Geste :** compte/API ou agrégateur; chez [Martini](https://www.martini.film/pricing), environ **0,01 $** en 1K faible, **0,04 $** moyen et **0,14 $** élevé. |
| 88 | Recraft | 2/9/0/7 | B | Service propriétaire. **Geste :** compte; [plan Free](https://www.recraft.ai/pricing) **0 $**, mais sorties publiques et détenues par Recraft; offres privées payantes. Aucun poids public. |
| 89 | Recraft 4.1 | 0/8/0/6 | B | Version du même service. **Geste :** compte Recraft, coût de premier essai **0 $** sur Free; tarif payant affiché dans l’offre selon volume. |
| 90 | SeaArt / SeaDance | 0/8/0/6 | B | Service propriétaire. **Geste :** compte; [plan de base](https://docs.seaart.ai/guide-1/1-seaart-ai-basic-page) **0 $ avec 150 stamina quotidiens**, achats nécessaires au-delà. |
| 91 | Technique 360 Video Character Sheet | 0/8/0/7 | C | Méthode de création d’une planche de personnage à 360°, sans application, dépôt ou modèle spécifique. À reprendre comme protocole, pas comme outil. |
| 92 | Technique Blotting Out Faces | 0/7/0/6 | C | Astuce de masquage des visages pour guider une génération, sans artefact propre. Ce n’est pas testable indépendamment du modèle hôte. |
| 93 | Workflow First Frame vs Omni | 0/8/0/7 | C | Comparaison de deux stratégies de production vidéo, non un logiciel ni un modèle. Elle relève d’un futur banc de workflow. |

### Contrôle D hors des 93

Le catalogue conserve bien **Wan 2.2 Bernini** comme « écarté » avec une identité **ArcFace 0,269**, sous le seuil requis **0,55**. Cette ligne n’a pas le statut « à tester », n’entre donc pas dans les 93, et n’a pas été relancée. La catégorie D vaut par conséquent zéro dans le tableau, sans effacer cette mémoire négative.

## Épreuves réalisées

### 1. Lucida — détourage des cheveux

#### Artefact et corpus

- Dépôt local hors projet : <code>/home/patrice/.local/share/lucida</code>.
- Environnement isolé existant : <code>/home/patrice/.venvs/lucida</code>.
- Checkpoint : **884 878 856 o**, SHA géré par Hugging Face, MIT, sans compte.
- Trois PNG ont été lus dans <code>~/.codebuddy/personas/ambre/wardrobe-automne/</code>; aucun fichier sous <code>~/.codebuddy/personas/</code> n’a été écrit ou modifié.
- Référence d’identité : uniquement <code>~/.codebuddy/personas/ambre/identity-kit/ambre-cafe-frontal.jpg</code> pour le score unitaire, puis le dossier canonique complet pour le visual gate. Aucun composite généré n’a servi de référence.

Les commandes d’inférence exactes étaient :

~~~bash
/usr/bin/time -f 'elapsed=%e max_rss_kib=%M exit=%x' \
  /home/patrice/.venvs/lucida/bin/bgr remove \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-doudoune-sapin.png \
  -o /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/rgba/ambre-doudoune-sapin-lucida.png \
  --model lucida

/usr/bin/time -f 'elapsed=%e max_rss_kib=%M exit=%x' \
  /home/patrice/.venvs/lucida/bin/bgr remove \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-kimono-traditionnel-sakura.png \
  -o /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/rgba/ambre-kimono-traditionnel-sakura-lucida.png \
  --model lucida

/usr/bin/time -f 'elapsed=%e max_rss_kib=%M exit=%x' \
  /home/patrice/.venvs/lucida/bin/bgr remove \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-cocooning-flanelle-sapin.png \
  -o /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/rgba/ambre-cocooning-flanelle-sapin-lucida.png \
  --model lucida
~~~

| Tenue | Temps CPU | RSS max |
|---|---:|---:|
| Doudoune | 21,99 s | 4 080 072 Kio |
| Kimono | 18,15 s | 4 088 916 Kio |
| Flanelle | 17,91 s | 4 152 460 Kio |

Pour rendre le masque visible sur les mêmes décors, deux compositions de diagnostic ont été produites avec ImageMagick :

~~~bash
convert PLATE \( RGBA_LUCIDA -resize x720 \) \
  -gravity center -compose over -composite SORTIE_720

convert PLATE \( RGBA_LUCIDA -crop 1080x720+0+230 +repage \) \
  -gravity center -compose over -composite SORTIE_NATIVE
~~~

Ce ne sont **pas** des propositions de cadrage de production : la version 720 redimensionne la personne et la version native en coupe le bas. Elles servent à inspecter l’alpha. La différence d’échelle visible sur la planche interdit notamment de comparer naïvement l’esthétique générale du composite courant et celle du diagnostic Lucida.

#### Largeur de transition

Commande rejouée sur les quatre séries :

~~~bash
python3 scripts/influencer/mesurer-detourage.py \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-doudoune-sapin.png \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-kimono-traditionnel-sakura.png \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-cocooning-flanelle-sapin.png \
  /home/patrice/Videos/personas/ambre-scenes/automne-composites/ambre-012-chalet-balcon-doudoune.png \
  /home/patrice/Videos/personas/ambre-scenes/automne-composites/ambre-017-jardin-pluie-kimono-traditionnel.png \
  /home/patrice/Videos/personas/ambre-scenes/automne-composites/ambre-030-salon-dore-flanelle.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-012-doudoune-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-017-kimono-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-030-flanelle-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-012-doudoune-lucida-native.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-017-kimono-lucida-native.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-030-flanelle-lucida-native.png
~~~

| Tenue | Source non composée | Composite courant | Lucida à 720 px | Lucida crop natif |
|---|---:|---:|---:|---:|
| Doudoune | 7 px / 270 colonnes | 3 px / 328 | **2 px / 330** | 4 px / 358 |
| Kimono | 7 px / 270 | 5 px / 275 | **5 px / 207** | 5 px / 182 |
| Flanelle | 7 px / 270 | 3 px / 323 | **4 px / 252** | 5 px / 95 |
| **Moyenne** | **7,00 px** | **3,67 px** | **3,67 px** | **4,67 px** |

Le 4,67 px de la colonne native n’est pas un gain comparable : le sujet a une autre échelle et le nombre de colonnes exploitables chute jusqu’à 95. La comparaison honnête est **3,67 → 3,67 px** à hauteur de sortie identique. La doudoune régresse même de 3 à 2 px.

#### Identité ArcFace

Commandes exactes :

~~~bash
/home/patrice/.venvs/tri-outils-qc/bin/python \
  scripts/darkstar/score-arcface-images.py \
  --reference /home/patrice/.codebuddy/personas/ambre/identity-kit/ambre-cafe-frontal.jpg \
  --output /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/mesures/arcface-sources.json \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-doudoune-sapin.png \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-kimono-traditionnel-sakura.png \
  /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-cocooning-flanelle-sapin.png

/home/patrice/.venvs/tri-outils-qc/bin/python \
  scripts/darkstar/score-arcface-images.py \
  --reference /home/patrice/.codebuddy/personas/ambre/identity-kit/ambre-cafe-frontal.jpg \
  --output /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/mesures/arcface.json \
  /home/patrice/Videos/personas/ambre-scenes/automne-composites/ambre-012-chalet-balcon-doudoune.png \
  /home/patrice/Videos/personas/ambre-scenes/automne-composites/ambre-017-jardin-pluie-kimono-traditionnel.png \
  /home/patrice/Videos/personas/ambre-scenes/automne-composites/ambre-030-salon-dore-flanelle.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-012-doudoune-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-017-kimono-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-030-flanelle-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-012-doudoune-lucida-native.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-017-kimono-lucida-native.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-030-flanelle-lucida-native.png
~~~

| Tenue | Source vs frontal canonique | Composite courant | Lucida 720 | Lucida natif |
|---|---:|---:|---:|---:|
| Doudoune | 0,3949004560 | 0,2758243788 | 0,3877145715 | 0,4062631053 |
| Kimono | 0,3976562320 | 0,2135966630 | 0,3872689316 | 0,4038682933 |
| Flanelle | 0,4007949770 | 0,0410358924 | 0,3869725829 | 0,4025687767 |

Ces nombres montrent que Lucida **préserve** le visage de la source qu’il détoure; ils ne prouvent pas qu’il « répare » l’identité des composites existants, puisque ces derniers sont des générations différentes. Autre constat important : les trois sources validées ne dépassent elles-mêmes que 0,395 à 0,401 face à l’unique portrait frontal. Le seuil 0,55 ne doit donc pas devenir un verdict binaire pour ces angles/tenues avec une seule référence.

#### Visual gate

OpenCV a été maintenu en 4.12 dans l’environnement de contrôle : OpenCV 5 cassait l’appel <code>HoughLinesP</code>. Aucun script de mesure n’a été modifié. Commande exacte :

~~~bash
for image_path in \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-012-doudoune-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-017-kimono-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/composites/ambre-030-flanelle-lucida.png
do
  /home/patrice/.venvs/tri-outils-qc/bin/python \
    scripts/influencer/visual-gate.py "$image_path" \
    --persona ambre \
    --reference /home/patrice/.codebuddy/personas/ambre/identity-kit \
    --force --no-journal --ollama-models gemma4:12b
done
~~~

| Composite Lucida | Verdict | Identité multi-références | Vision Gemma 4 | Autres signaux |
|---|---|---:|---|---|
| Doudoune | À REGARDER | 0,8373744055 | OK | contour résiduel 0,738703, sous 0,74; modèle mains absent |
| Kimono | À REGARDER | 0,8383182744 | OK | pseudo-texte 17/18, signal OCR peu fiable; modèle mains absent |
| Flanelle | À REGARDER | 0,8372131661 | OK | contour résiduel **0,884939**, au-dessus de 0,74; modèle mains absent |

L’écart entre environ 0,40 en référence frontale unique et environ 0,84 ici vient de l’agrégation multi-références du visual gate; ce ne sont pas deux mesures interchangeables.

#### Planche-contact et examen

[Planche-contact Lucida, 1664×1002, 420 175 o](</home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/planche-contact-lucida.jpg>) — SHA-256 <code>5b11ea1d35284bb3a60f58750b95c373678a64824485c51bee8ea5782621a801</code>, conservée hors Git avec les sorties.

Commande d’assemblage :

~~~bash
montage \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/01-source.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/02-alpha.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/03-existing.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/04-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/05-source.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/06-alpha.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/07-existing.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/08-lucida.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/09-source.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/10-alpha.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/11-existing.png \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/contact/12-lucida.png \
  -tile 4x3 -geometry 400x318+8+8 -background '#20242a' \
  /home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/planche-contact-lucida.jpg
~~~

Examen visuel : l’alpha est continu et conserve quelques mèches latérales, mais la crête supérieure reste une forme lisse de « casque ». Aucune nouvelle mèche crédible n’apparaît à l’échelle de sortie; sur la doudoune, le bord est même plus dur. Le meilleur nombre du crop natif vient surtout de l’échelle. C’est exactement le cas où une mesure peut monter sans que l’image s’améliore.

**Verdict Lucida : non retenu pour le détourage de cheveux.** Le test ne tranche pas encore ses promesses sur le verre, les transparences partielles ou les ombres de texte; pour ces usages précis, la ligne reste « à tester ».

### 2. PiD 1.5 — faisabilité avant épreuve

La vérification officielle corrige une hypothèse du catalogue : PiD signifie **Pixel diffusion Decoder** et produit une image agrandie; ni le dépôt ni le modèle Comfy n’exposent une carte de profondeur. Il peut relever le plancher 720p, mais ne remplace pas un depth estimator pour le storyboard.

Les deux services ont été interrogés en lecture seule :

~~~bash
curl -fsS http://darkstar:8188/system_stats |
  jq '{argv:.system.argv,devices:[.devices[]|{name,vram_total,vram_free}]}'
curl -fsS http://darkstar:8189/system_stats |
  jq '{argv:.system.argv,devices:[.devices[]|{name,vram_total,vram_free}]}'

for port in 8188 8189
do
  curl -fsS "http://darkstar:$port/object_info" |
    jq -r '[keys[] | select(ascii_downcase|contains("pid"))] | join(", ")'
  curl -fsS "http://darkstar:$port/models/diffusion_models" |
    jq -r '[.[] | select(ascii_downcase|contains("pid"))] | join(", ")'
done
~~~

Résultat :

- argv 8188 : <code>D:\DEV\ComfyUI\main.py --listen 0.0.0.0 --port 8188 --disable-auto-launch</code>;
- argv 8189 : même commande sur le port 8189;
- une RTX 3090 de **25 769 279 488 o** visible par service;
- nœuds présents : <code>PiDColorBiasCorrection</code>, <code>PiDConditioning</code> et les deux preprocessors PiDiNet;
- **aucun nom contenant PiD dans diffusion_models**, sur les deux ports.

Le gestionnaire Comfy ne propose pas PiD dans son registre autorisé; SSH et le partage de fichiers ne donnent pas de canal d’administration depuis cette machine. Copier 1,58 Go par une voie détournée ou redémarrer un service permanent aurait violé le périmètre. Aucun processus n’a été tué, libéré ou relancé.

**Verdict PiD : A, non éprouvé, statut inchangé « à tester ».** Pour reprendre : le propriétaire doit fournir un canal d’installation sûr vers <code>ComfyUI/models/diffusion_models</code>, ou déposer lui-même le checkpoint Int8 vérifié. Aucun achat ni compte n’est nécessaire.

### 3. Topaz — contrôle d’accès

Aucun exécutable Topaz n’est installé localement et aucun nœud Topaz n’est exposé par les deux ComfyUI. L’essai officiel impose une carte bancaire et démarre automatiquement l’abonnement après sept jours. Conformément à « ne dépense rien », aucun compte, essai ou téléchargement propriétaire n’a été créé.

**Verdict Topaz : B, non éprouvé, statut inchangé « à tester ».** Ne pas acheter avant d’avoir mesuré PiD.

### 4. Magenta RealTime 2 — génération audio locale

Magenta avait le meilleur score média restant (9) dans A. L’environnement et les modèles sont hors dépôt :

~~~bash
/home/patrice/.local/bin/uv venv --python 3.12 /home/patrice/.venvs/mrt2
/home/patrice/.local/bin/uv pip install \
  --python /home/patrice/.venvs/mrt2/bin/python 'magenta-rt[jax]'

/home/patrice/.venvs/mrt2/bin/mrt models init \
  --source hf --download-path /home/patrice/.cache/tri-outils/mrt2
/home/patrice/.venvs/mrt2/bin/mrt models download mrt2_small \
  --source hf --download-path /home/patrice/.cache/tri-outils/mrt2
/home/patrice/.venvs/mrt2/bin/mrt checkpoints download mrt2_small \
  --source hf --download-path /home/patrice/.cache/tri-outils/mrt2

ln -s /home/patrice/.cache/tri-outils/mrt2 \
  /home/patrice/.cache/tri-outils/magenta-rt-v2
~~~

Le cache final fait 2,8 Go; le checkpoint JAX réellement exécuté fait **1 128 840 272 o**. Voici le bloc exact qui a généré et conservé les trois sorties :

~~~bash
mkdir -p /home/patrice/Videos/personas/tri-outils-2026-08-01/mrt2
run_mrt2() {
  mrt2_slug="$1"
  mrt2_prompt="$2"
  MAGENTA_HOME=/home/patrice/.cache/tri-outils \
  JAX_PLATFORMS=cpu XLA_PYTHON_CLIENT_PREALLOCATE=false \
    /usr/bin/time \
    -o "/home/patrice/Videos/personas/tri-outils-2026-08-01/mrt2/$mrt2_slug.time" \
    -f 'elapsed_total=%e max_rss_kib=%M exit=%x' \
    /home/patrice/.venvs/mrt2/bin/mrt jax generate \
    --prompt "$mrt2_prompt" --duration 4.0 --model mrt2_small \
    --checkpoint mrt2_small.safetensors
  cp /home/patrice/.cache/tri-outils/magenta-rt-v2/outputs/output_audio_jax_mrt2_small.wav \
    "/home/patrice/Videos/personas/tri-outils-2026-08-01/mrt2/$mrt2_slug.wav"
}
run_mrt2 acoustique \
  'warm French acoustic folk, fingerpicked guitar, no vocals'
run_mrt2 electronique \
  'cinematic electronic pulse, 110 bpm, deep bass, no vocals'
run_mrt2 piano \
  'intimate solo piano nocturne, slow and delicate, no vocals'
~~~

| Prompt | Génération seule | Débit | Temps total | RSS max | LUFS-I | Vrai pic | RMS |
|---|---:|---:|---:|---:|---:|---:|---:|
| Acoustique | 19,1 s / 100 frames | 5,2 pas/s | 27,68 s | 4 174 056 Kio | -21,6 | -6,3 dBFS | -23,42 dB |
| Électronique | 38,3 s / 100 frames | 2,6 pas/s | 52,20 s | 4 497 480 Kio | -19,9 | -5,5 dBFS | -19,60 dB |
| Piano | 27,7 s / 100 frames | 3,6 pas/s | 42,78 s | 4 236 184 Kio | -29,7 | -15,2 dBFS | -32,24 dB |

Les trois WAV font exactement 4,000 s, 48 kHz, stéréo, et ont trois SHA-256 distincts. Aucun n’écrête. Le débit ne représente que **10 à 21 % de la cible temps réel** de 25 pas/s; la variance entre essais signale en outre une contention CPU possible.

Mesure audio :

~~~bash
ffprobe -v error \
  -show_entries format=duration:stream=sample_rate,channels \
  -of default=nw=1 SORTIE.wav
ffmpeg -hide_banner -nostats -i SORTIE.wav \
  -filter:a 'ebur128=peak=true' -f null -
ffmpeg -hide_banner -nostats -i SORTIE.wav \
  -af 'astats=metadata=1:reset=0' -f null -
~~~

[Planche-contact MRT2, 1500×2217, 2 428 812 o](</home/patrice/Videos/personas/tri-outils-2026-08-01/mrt2/planche-contact-mrt2.png>) — SHA-256 <code>9a6b9a72e1c1ec8cf924e5e74d806e89e9590127cb2eadc4cc222dc2a6cc98d3</code>, waveform et spectrogramme des trois sorties, hors Git. Les trois textures spectrales sont visiblement différentes et cohérentes avec les familles demandées : harmoniques rythmiques et larges pour l’acoustique, énergie plus dense/grave pour l’électronique, partiels espacés et faible niveau pour le piano. Une planche spectrale ne remplace toutefois pas une écoute humaine; aucune appréciation de musicalité n’est inventée ici.

Commandes de planche, répétées pour chacun des trois slugs :

~~~bash
ffmpeg -y -hide_banner -loglevel error -i SORTIE.wav \
  -filter_complex 'showwavespic=s=1200x180:colors=0x4da3ff' \
  -frames:v 1 SLUG-wave.png
ffmpeg -y -hide_banner -loglevel error -i SORTIE.wav \
  -lavfi 'showspectrumpic=s=1200x360:legend=1:color=fiery:scale=log' \
  SLUG-spectrum.png

montage acoustique-panel.png electronique-panel.png piano-panel.png \
  -tile 1x3 -geometry +8+8 -background '#20242a' \
  planche-contact-mrt2.png
~~~

**Verdict MRT2 : exécutable et distinctif en offline, non retenu pour le temps réel sur cette machine.** Il reste pertinent si un futur besoin de musique offline accepte un facteur de temps réel de 4,8 à 9,6× et si le propriétaire valide les WAV à l’écoute.

## Recommandations d’adoption

### Aucun nouvel outil à intégrer en production aujourd’hui

Cette conclusion n’est pas une absence de résultat :

1. **Ne pas adopter Lucida dans la chaîne cheveux d’Ambre.** Chiffre décisif : **3,67 px avant, 3,67 px après** à taille comparable. La planche confirme l’absence de nouvelles mèches et une régression doudoune **3 → 2 px**.
2. **Ne pas adopter MRT2 comme moteur temps réel sur ce CPU.** Chiffre décisif : **2,6–5,2 pas/s** pour une cible de **25**, soit seulement **10–21 %** de la cadence. Conserver le cache uniquement comme candidat offline jusqu’à une écoute humaine.
3. **Conserver Gemma 4 12B dans le visual gate existant**, sans prétendre qu’il est nouvellement validé comme modèle général. Signal disponible : sous-test vision **OK sur 3/3** diagnostics Lucida. Les trois verdicts globaux restent « À REGARDER », preuve que Gemma ne doit pas autoriser seul une publication.
4. **Tester PiD avant toute dépense Topaz.** PiD Int8 ne pèse que **1 584 813 952 o** contre un abonnement Topaz à **299 $/an**. Le prochain banc doit partir des mêmes trois images 720p, générer des sorties 4K, puis rejouer ArcFace, visual gate et une planche côte à côte. <code>mesurer-detourage.py</code> sera aussi rejoué pour détecter un éventuel lissage artificiel du bord, mais pas utilisé comme mesure de netteté.
5. **Ne pas adopter ProxyPose en production**, même avant résultat visuel : son dépôt de poids ne déclare aucune licence. Un test de recherche reste possible; un usage publié ne l’est pas proprement.

La priorité recommandée au prochain accès darkstar est donc : **PiD Int8 → inspection visuelle/identité → seulement si PiD échoue, décision explicite du propriétaire sur l’essai Topaz**. Il ne faut pas attendre de PiD une carte de profondeur; pour ce besoin, il faudra sélectionner séparément un depth estimator.

## Ce qui n’a pas été éprouvé, et pourquoi

### A encore ouverts

Les lignes suivantes restent toutes « à tester » :

- **PiD 1.5** : artefact et licence vérifiés, mais checkpoint absent des deux ComfyUI et aucun canal autorisé pour le déposer. C’est le seul blocage directement prioritaire.
- **ABot-World-0** (média 9), puis **ReactiveGWM, ProxyPose et Google GNM** (média 8) : leurs runtimes ne sont pas des nœuds Comfy disponibles; les installer sur le Windows permanent sans accès d’administration n’était pas possible. ABot représente 24,8 Go; ReactiveGWM demande en plus sa base Wan; ProxyPose porte la réserve de licence signalée.
- **Carbon, Bonsai 27B et AutoResearch** : localement accessibles, mais sans rapport direct avec le défaut cheveux/720p et sans protocole métier comparable ni planche utile. Ils viennent après les A média ci-dessus.
- **Claude Code, Claude Fable 5, Codex, Claude Opus 5** (deux mentions), **n8n** (deux mentions), **GrokBuild et BUZZ** : binaires/services accessibles, mais aucune tâche de programmation ou d’orchestration commune n’a été définie. Une simple réponse de démonstration ne serait pas une mesure honnête.
- **ExploitGym** : téléchargeable, mais ses 869 scénarios d’exploitation demandent un bac à sable et une autorisation de banc sécurité distincte.
- **ARC-AGI 3** : SDK accessible, mais il faut choisir le modèle-candidat, le budget et la métrique de run.
- **Artificial Analysis Leaderboard et Intelligence Index** : pages consultables sans compte, mais elles publient des mesures; elles ne produisent pas un artefact auquel appliquer le protocole visuel.
- **Gemma 4 12B** : utilisé seulement comme composant du visual gate, pas benchmarké séparément; il ne passe donc pas de « à tester » à « retenu » sur la seule base de 3 réponses.

### B, C et D

- Les **57 B** n’ont reçu aucun compte, clé, carte, abonnement, acceptation de licence ou location GPU. Le geste et le prix minimal de chacun figurent dans sa ligne.
- Les **12 C** n’ont pas d’artefact exécutable aujourd’hui. Ils restent des signaux, des techniques ou des annonces; aucun n’est marqué « écarté » pour autant.
- Aucune ligne des 93 n’est D. Le seul résultat D contrôlé, **Wan 2.2 Bernini à 0,269 ArcFace**, était déjà hors de ce lot et n’a pas été retesté.

## Artefacts et intégrité du dépôt

Seul ce rapport appartient au dépôt. Les modèles, WAV, PNG, JSON de mesure et planches sont volontairement hors Git :

- Lucida : <code>/home/patrice/Videos/personas/tri-outils-2026-08-01/lucida/</code>;
- MRT2 : <code>/home/patrice/Videos/personas/tri-outils-2026-08-01/mrt2/</code>;
- caches modèles : <code>/home/patrice/.cache/tri-outils/</code>;
- environnements : <code>/home/patrice/.venvs/lucida</code>, <code>/home/patrice/.venvs/mrt2</code> et <code>/home/patrice/.venvs/tri-outils-qc</code>.

Aucun poids ni média n’est ajouté au dépôt; aucun fichier sous <code>~/.codebuddy/personas/**</code> n’a été écrit; aucun processus darkstar n’a été arrêté; aucune dépense ni création de compte n’a eu lieu.

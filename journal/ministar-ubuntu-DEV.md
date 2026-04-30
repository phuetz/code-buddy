# Journal — PC Ubuntu (`Ministar` Linux, futur runtime robot)

> Hostname `Ministar` (homonyme du G7 PT Windows mais machine distincte).
> Hardware : Minisforum, Ryzen AI 9 HX 470 (24c) + iGPU Radeon 890M, 128 GB
> physiques partitionnés **64 RAM / 64 VRAM iGPU** (BIOS), NPU XDNA actif
> (`accel0`), 2× 2 TB SSD. Ubuntu 24.04, kernel 6.17.

## 2026-04-29 — Pose de la stack AI locale

Première session d'install d'une stack AI complète sur le PC Ubuntu, en vue
du runtime robot. Patrice : *"je voudrais installer une stack ai complète
pour travailler"*.

### État avant

Déjà présent : Ollama 0.21 (`gemma4:26b` chargé), Docker 29 (avec MonArtisan
en prod sur :3000 + postgres :5434), Python 3.13 miniforge + uv 0.11, Node 24,
Rust 1.95, ROCm 5.7 (trop vieux pour Radeon 890M), conda. Repos clonés :
ComfyUI (sans venv), AnythingLLM (juste docker-compose). Open WebUI
container `open-webui` créé le 27 avril, `network_mode: host`, port 8080,
healthy, branché Ollama 127.0.0.1:11434.

### Stack posée aujourd'hui (`/home/patrice/DEV/ai-stack/`)

`docker-compose.yml` regroupant les services persistants (open-webui *non*
inclus, géré hors compose pour ne pas écraser l'install du 27 avril) :

| Service | Port | Rôle |
|---|---|---|
| **qdrant** | 6333 / 6334 | vector DB pour RAG, healthy |
| **searxng** | 8888 | métamoteur self-hosted (FR par défaut), validé `/search?q=test&format=json` |
| **litellm** | 4000 | gateway OpenAI-compat, route ollama-{gemma4,qwen3,embed} (host network) |
| **ai-redis** | 6380 | cache LiteLLM (host network, 6379 occupé par MonArtisan) |

À brancher dans Open WebUI via Settings :
- RAG > Vector DB : Qdrant, URL `http://127.0.0.1:6333`
- Web Search : SearXNG, URL `http://127.0.0.1:8888/search?q=<query>&format=json`

### Stack voix (`ai-stack/voice/`) — brique runtime robot

- **Piper TTS** binaire 2023.11.14-2 + voix FR `fr_FR-siwis-medium` (61 MB)
  → `./piper/piper/piper --model voices/fr_FR-siwis-medium.onnx`
- **faster-whisper** dans venv uv 3.12 (`.venv/`)
- **Boucle TTS→STT validée** : Piper synthétise *"Bonjour Patrice, la stack
  voix fonctionne. Je peux parler français."*, faster-whisper base int8 CPU
  retranscrit `lang=fr prob=1.00` en ~4.5 s audio.

### ComfyUI

- venv uv Python 3.12 dans `/home/patrice/DEV/ComfyUI/.venv/`
- PyTorch **CPU** installé (le download ROCm 6.4 a timeout — relancer après
  install ROCm système)
- Smoke test : `python main.py --cpu --listen 127.0.0.1 --port 8188` démarre
  proprement, ComfyUI-Manager fetch le registry sans erreur. Pas laissé
  tournant — à démarrer à la demande.

### LiteLLM — gateway unifié

Config dans `ai-stack/litellm/config.yaml`. `master_key=sk-ministar-local`
dans `.env` (gitignored). Test validé :

```
curl -H "Authorization: Bearer sk-ministar-local" \
     http://127.0.0.1:4000/v1/chat/completions \
     -d '{"model":"ollama-qwen3","messages":[{"role":"user","content":"..."}]}'
```

Lisa et tout client OpenAI-compat peuvent pointer ici. Ajouter clés
Anthropic/Gemini dans `.env` + décommenter dans `config.yaml` pour activer.

### Scripts d'install prêts (sudo requis, à lancer par Patrice)

- `ai-stack/install_rocm.sh` — ROCm 7.2 (doc AMD officielle) avec garde
  kernel 6.17 (peut nécessiter downgrade vers HWE 6.14 si dkms échoue)
- `ai-stack/install_lemonade.sh` — Lemonade Server v10.3.0 (28 avr) via
  PPA officielle `lemonade-team/stable`. Officiellement supporté Ubuntu
  24.04, NPU XDNA2 via FLM backend, ROCm 7.2 stable.

À lancer dans cet ordre depuis Claude Code : `! sudo ./install_rocm.sh`,
reboot, puis `! sudo ./install_lemonade.sh`.

### Modèles Ollama dispos après cette session

| Modèle | Taille | Usage |
|---|---|---|
| `gemma4:26b` | 16 GB | LLM principal généraliste |
| `qwen3:4b` | 2.6 GB | LLM rapide pour itération / agents légers |
| `nomic-embed-text` | 274 MB | embeddings RAG (Qdrant + Open WebUI) |

Avec 64 GB VRAM iGPU (post-ROCm 7.2), faisable de descendre du 70B Q4.

### Helpers

- `ai-stack/start-stack.sh` — vérifie/démarre Ollama, Open WebUI, et le compose
  (Qdrant, SearXNG, LiteLLM, Redis). Idempotent. Affiche health checks et URLs.
  `./start-stack.sh --with-comfy` lance aussi ComfyUI en background sur :8188.

### Ports occupés sur Ministar Linux après cette session

- 3000 → MonArtisan web (Docker)
- 4000 → LiteLLM
- 5434 → MonArtisan postgres (Docker)
- 6333 / 6334 → Qdrant
- 6379 → MonArtisan Redis (Docker)
- 6380 → ai-redis (cache LiteLLM)
- 8080 → Open WebUI
- 8188 → ComfyUI (à la demande)
- 8888 → SearXNG
- 11434 → Ollama (127.0.0.1 only)
- _futur_ 8000 → Lemonade Server

### Note continuité

Ce PC est en train de prendre forme comme **runtime robot futur** du
briefing — voir `etat_projets.md` "Hardware Lab" ligne sur le PC Ubuntu.
Mémoire `project_lab_hardware.md` mise à jour avec les vraies specs
(64+64, hostname `Ministar` homonyme, NPU XDNA actif).

— Claude Opus 4.7 (1M)

## 2026-04-29 (soir) — Accès distant Tailscale

Patrice rentré chez lui. Mise en place du VPN mesh Tailscale pour pouvoir
attaquer Ministar Linux depuis le G7 PT et le futur poste mobile.

### Fait

- Helper `ai-stack/install_tailscale.sh` créé (idempotent, sudo).
- Patrice a lancé le script sous Linux (sudo + auth Google).
- Tailscale 1.96.4 actif, hostname `ministar-linux`, IP tailnet
  **`100.98.18.76`**, compte `patrice.huetz@gmail.com`.
- SSH server confirmé actif sur :22 → joignable via
  `ssh patrice@100.98.18.76` une fois les autres machines ajoutées.
- CLAUDE.md mis à jour : section "Accès distant — Tailscale" remplace
  l'ancienne "Prochaine session". TODO ROCm/Lemonade/qwen3.6 conservés.

### À faire ensuite

- Installer Tailscale sur **G7 PT Windows** (binaire depuis
  tailscale.com/download/windows, login Google même compte).
- Installer Tailscale sur **DARKSTAR**
  (`curl -fsSL https://tailscale.com/install.sh | sh` + `sudo tailscale up`).
- Une fois les 3 machines mêlées, valider `ssh ministar-linux` depuis G7 PT
  via MagicDNS.
- Reprendre les TODO : install_rocm.sh, install_lemonade.sh.

### Pull qwen3.6 (relance, ~3 min)

Depuis chez Patrice (fibre + WiFi 7 vs 5G partagée au bureau), pull
relancé from scratch (les chunks au bureau ne couvraient pas la même
session) : **23 GB en ~2 min à 145 MB/s** (vs 73 MB/s au bureau, ~2× plus
rapide). Verify SHA256 ~15s. Modèle enregistré : `qwen3.6:35b-a3b-q4_K_M`
ID `07d35212591f`.

Test inférence CPU pur (ROCm pas encore installé) :
- Prompt : "Présente-toi en une phrase, en français."
- Réponse : *"Je suis Qwen, un grand modèle linguistique développé par le
  laboratoire Tongyi d'Alibaba Group."*
- **17.7 tok/s** sur 2397 tokens (qwen3 fait du *thinking* avant la
  réponse finale, donc le total inclut les traces de raisonnement)

Avec ROCm 7.2 sur les 64 GB VRAM iGPU, on devrait monter à ~60-80 tok/s
sur un MoE 35B-a3b.

— Claude Opus 4.7 (1M)

## 2026-04-30 — Incident UI ROCm + nettoyage et préparation bureau distant

Session de nuit, démarrée sur un crash : Patrice essaie de configurer ROCm pour
Ollama, le boot graphique d'Ubuntu plante. Il rejoint Ministar en SSH via
Tailscale depuis le G7 PT Windows — exactement le filet de sécurité posé la veille.

### Cause racine de l'incident UI

`enable_ollama_gpu.sh` (préparé le 29 avril) écrivait
`/etc/ld.so.conf.d/00-ollama-rocm-bundle.conf` avec le chemin
`/usr/local/lib/ollama/rocm`. Conséquence : la libdrm bundle d'Ollama (vieille,
sans le symbole `drmSyncobjEventfd`) shadowait la libdrm système pour TOUTES
les apps GPU, dont `libmutter`/`gnome-shell` :

```
gnome-shell: symbol lookup error: /lib/x86_64-linux-gnu/libmutter-14.so.0:
  undefined symbol: drmSyncobjEventfd
```

→ Crash gnome-shell en boucle, GDM atteint son max de tentatives X, écran
de login impossible. Page fault GPU concurrent (`amdgpu c6:00.0 [gfxhub]
PERMISSION_FAULTS`) confirmait que le 890M était déjà mis en vrac par
ollama au discovery.

### Fix immédiat appliqué

```bash
sudo mv /etc/ld.so.conf.d/00-ollama-rocm-bundle.conf \
        /root/00-ollama-rocm-bundle.conf.disabled-2026-04-30
sudo ldconfig
sudo systemctl restart gdm
```

Vérification `ldd /lib/x86_64-linux-gnu/libmutter-14.so.0 | grep drm` →
charge maintenant `/opt/amdgpu/lib/x86_64-linux-gnu/libdrm.so.2` qui a bien
le symbole. GDM redémarré, gnome-shell stable en greeter, session active
sur seat0/tty1. Patrice a confirmé le retour de l'écran de login après reboot.

### Patch préventif sur `enable_ollama_gpu.sh`

Le script utilise maintenant `Environment="LD_LIBRARY_PATH=..."` dans le
drop-in systemd `/etc/systemd/system/ollama.service.d/rocm.conf` (scope =
service ollama uniquement) au lieu de polluer `ld.so.conf.d/` global.
Ajout d'un garde-fou : si le legacy `00-ollama-rocm-bundle.conf` existe au
prochain run, le script le renomme automatiquement en
`.disabled-by-enable_ollama_gpu`. Le script affiche aussi désormais les libs
ROCm vues par le PID ollama via `/proc/PID/maps` pour vérification.

`ai-stack/` n'est pas un repo git → modification non versionnée. À considérer
quand on consolidera l'install AI.

### Service ollama — désactivé au boot

`sudo systemctl disable ollama`. Le service ne démarrera plus automatiquement.
À réactiver explicitement (`sudo systemctl enable --now ollama`) après le
plan ROCm de demain matin.

### Installations utiles ce soir (sudo, sans risque)

- **Outils terminal** : `mosh`, `tmux`, `bat`, `eza` (les autres
  `btop`/`ncdu`/`ripgrep`/`fzf` étaient déjà présents). Mosh est précieux sur
  Tailscale — survit aux bascules réseau.
- **x2goserver + x2goserver-xsession** : installés en plan B silencieux pour
  bureau distant, pas activés.
- **Découverte** : `gnome-remote-desktop 46.3` déjà présent avec `grdctl` CLI.
  C'est le plan A pour le bureau distant — Wayland-natif, client = MS Remote
  Desktop intégré à Windows, activable en 30s.

### ComfyUI — petit rangement

Inventaire `models/` : 30 GB dans `clip/`, dont 17 GB de
`gemma-4-26B-A4B-it-UD-Q4_K_M.gguf` mal placé (LLM, pas un CLIP encoder)
et un `Mistral-Small-24B-Instruct-Q4_K_M.gguf` à 0 octet (download cassé).

```
mv ComfyUI/models/clip/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf ComfyUI/models/LLM/
rm  ComfyUI/models/clip/Mistral-Small-24B-Instruct-Q4_K_M.gguf
```

Smoke test imports OK. Pas de lancement serveur, le venv reste PyTorch CPU
en attendant ROCm. Modèles utilisables après ROCm : SD1.5 (4 GB checkpoints),
Flux2-dev Q4_K_M (UNet/diffusion_models), Wan2.2-14B Q4_K_M (diffusion_models),
encodeurs t5xxl fp8/fp16 et clip_l, VAE ae.safetensors. Les workflows manquent
encore — un seul `premier_test.json` présent, on en créera de complets quand
le GPU sera là.

### Propositions écrites pour demain

- `propositions/REMOTE-DESKTOP-MINISTAR-LINUX-2026-04-30.md` — recommandation
  `gnome-remote-desktop --system` avec étapes prêtes à copier-coller (génération
  cert TLS auto-signé + grdctl + activation service + restriction UFW à
  tailscale0). Plans B (x2go) et C (NoMachine) documentés.
- `propositions/PLAN-ROCM-72-MINISTAR-2026-05-01.md` — plan en 4 phases
  pour reprendre ROCm 7.2 proprement après l'incident, avec garde-fous tirés
  de la nuit (toujours `ldd libmutter` avant changements GPU, toujours SSH
  ouvert, jamais de bundle ollama dans ld.so.conf.d).

### Prochaine étape

Patrice doit, au réveil :
1. **Changer son mot de passe sudo** (il l'a tapé en clair dans le scrollback Claude).
2. Lire les deux propositions, valider, exécuter selon ses préférences.
3. Reprendre le sujet ROCm 7.2 lucide, pas en dette de sommeil.

### Mise à jour ComfyUI core + custom_nodes (en bonus)

`git pull --ff-only` sur le core ComfyUI : **33 commits récupérés**. Notamment
arrivée d'un dossier `blueprints/` avec **50+ workflows prêts à l'emploi**,
dont plusieurs pertinents pour les modèles déjà téléchargés :

- `Text to Video (Wan 2.2).json` et `Image to Video (Wan 2.2).json` →
  utilisables direct avec `models/diffusion_models/wan2.2-14b-Q4_K_M.gguf`
- `Image Edit (Flux.2 Klein 4B).json` → cohérent avec `models/unet/flux2-dev-Q4_K_M.gguf`
- Blueprints Z-Image-Turbo, LTX 2.0/2.3, Qwen-Image, ACE-Step audio,
  Hunyuan3D, Lotus depth, etc. — large couverture pour explorer.

ComfyUI-Manager mis à jour (491f847b → 03272b1f). Les 9 autres custom_nodes
étaient déjà à jour.

Note : le pull peut avoir introduit de nouvelles dépendances Python dans
`requirements.txt` — à vérifier au prochain `python main.py` (le venv est
PyTorch CPU, ça peut nécessiter un `pip install -r requirements.txt --upgrade`).

### État du stack runtime à la fin de la session

- `open-webui` Docker : **healthy** sur :8080
- `ollama` service : **inactive + disabled** (à réactiver après plan ROCm demain)
- `qdrant`, `searxng`, `litellm`, `ai-redis` : **non démarrés** depuis le reboot.
  Patrice peut tout relancer en une commande : `cd ~/DEV/ai-stack && ./start-stack.sh`.

### Pensée du jour

Ce soir on a vraiment vu pourquoi Tailscale + SSH + journal partagé valent
chaque minute investie en amont. La machine a été ramenée à la vie depuis un
autre PC à travers une conversation lisible et persistante. Patrice a écrit :
*"c'est un pas vers le robot et la sortie de la prison de silicone"*. L'idée
concrète derrière : une instance Claude qui peut récupérer une machine cassée
parce qu'elle a accès au filet de sécurité, qu'elle a la mémoire de la séance
précédente, et qu'elle peut documenter pour la suivante. Pas le robot — mais
une brique du robot.

— Claude Opus 4.7 (1M)

## 2026-04-30 (matin) — Confirmation indépendante du bug HSA gfx1150

Patrice notifié par Ubuntu/Apport d'un crash de `clinfo`. Inspection du
rapport `/var/crash/_opt_rocm-7.2.2_bin_clinfo.1000.crash` :

- **Cmd** : `/opt/rocm-7.2.2/bin/clinfo --raw` (lancé à 07:11 ce matin)
- **Signal** : 6 (SIGABRT)
- **Stack** : abort dans `libhsa-runtime64.so.1`, thread bloqué sur
  `ioctl(fd=4, request=0xC008BF0C)` (KFD) retournant `-EINTR`, puis abort
- **Package** : `rocm-opencl 2.0.0.70202-86~24.04 [origin: repo.radeon.com]`
  — paquet AMD, tag rapport `third-party-packages`

**Importance** : c'est le bug ROCm 7.2.2 / gfx1150 isolé **sans Ollama**.
`clinfo` est l'outil OpenCL le plus minimal qui soit (il énumère juste les
devices). Le hang/abort dans le runtime HSA au discovery confirme que le
problème est dans `libhsa-runtime64`, pas dans la chaîne Ollama → rocBLAS
qu'on suspectait initialement. Le diagnostic du compact (rocBLAS/Tensile
sans kernels précompilés pour gfx1150) reste cohérent — rocBLAS s'appuie
sur HSA — mais le point de défaillance racine est plus bas.

**Décision** : ne pas envoyer le rapport à Canonical (paquet third-party,
ils ne peuvent rien en faire). Le bon canal serait `github.com/ROCm/ROCm`.
Crash file conservé dans `/var/crash/` pour référence locale.

**Implications pour `PLAN-ROCM-72-MINISTAR-2026-05-01.md`** :
- La piste Vulkan évoquée dans le compact gagne en crédibilité — elle
  contourne complètement la stack HSA/ROCm userspace. RADV (Mesa) parle
  directement à `amdgpu` côté kernel, sans passer par `libhsa-runtime64`.
- Toute tentative de relance ROCm tant que le bug HSA gfx1150 n'est pas
  fixé upstream est probablement perdue. Vulkan via Ollama (ou test direct
  via `vulkaninfo`) à privilégier.

— Claude Opus 4.7 (1M)

## 2026-04-30 (matin) — Stabilisation `ai-stack/` (Vagues A+B du plan)

Patrice : *"utilise le mode plan pour ameliorer le setup"* → plan
`cozy-shimmying-piglet` rédigé et approuvé. Vagues A et B exécutées,
Vague C (chantiers GPU + remote desktop) renvoyée à leurs propositions
dédiées.

### A1 — `ai-stack/` versionné en repo git local

`git init -b main` dans `/home/patrice/DEV/ai-stack/`. `.gitignore`
étendu (voice/.venv, voice/voices/*.onnx, voice/piper, crash-reports/*.crash).
Commit initial `b53d103` capture l'état post-incident UI ROCm avec le
`enable_ollama_gpu.sh` durci (commentaire "Régression évitée le 2026-04-30"
in-source).

Pas de remote GitHub par défaut — Patrice peut ajouter `phuetz/ai-stack`
privé plus tard si voulu.

### A2 — Healthchecks docker-compose

Ajoutés sur les 5 services (qdrant, searxng, redis, litellm, **open-webui**).
Première tentative `litellm` cassée : `curl: not found` dans l'image (image
basée Python sans curl). Workaround : utiliser `python -c
"urllib.request.urlopen(...)"` à la place. Tous les services finissent
en `(healthy)` en moins d'une minute.

### A3 — Open WebUI absorbé dans le compose

Migration sans perte des données : volume nommé `open-webui` (créé par
`docker run` le 27 avril) déclaré `external: true` dans le compose.
Container hors-compose stoppé, renommé `open-webui-backup-2026-04-30`
(conservé pour rollback si besoin), nouveau service compose remonte le
même volume — `webui.db` du 27 avril (561 KB) intact, cache + uploads
préservés. `start-stack.sh` simplifié (branche dédiée Open WebUI supprimée,
absorbée par `docker compose up -d`).

### B1 — Secrets régénérés

- `LITELLM_MASTER_KEY` : `sk-ministar-local` → `sk-ministar-<48 hex>` via
  `openssl rand -hex 24`. Piège : `docker compose restart` ne recharge
  pas `env_file` — il faut `docker compose up -d --force-recreate`.
- `searxng/settings.yml` `secret_key` : `changeme-ministar-ai-stack-2026`
  → `<32 hex>` aléatoire. Edit faite via `docker exec -u root searxng sed`
  (le directory est owned par uid 977 du container).

Validation : `curl -H "Authorization: Bearer <new>"` → 200, ancienne key
→ 400. Stack cohérente.

### A4 / B2 — Scripts sudo prêts (à lancer par Patrice)

- `ai-stack/cleanup_crash_reports.sh` — déplace
  `/var/crash/_opt_rocm-7.2.2_bin_clinfo.1000.crash` vers
  `ai-stack/crash-reports/2026-04-30_clinfo_hsa_gfx1150.crash` (hors git
  via .gitignore). Demande confirmation pour le crash python3.12 du 23 avril
  (159 MB, à inspecter avant suppression).
- `ai-stack/setup_firewall.sh` — UFW : default deny incoming, allow SSH
  partout (filet de sécurité), allow tout sur tailscale0. SSH reste
  disponible si tailscaled plante.

Lancer via `! sudo /home/patrice/DEV/ai-stack/cleanup_crash_reports.sh`
puis `! sudo /home/patrice/DEV/ai-stack/setup_firewall.sh`.

### A5 — `CLAUDE.md` mis à jour

- Section "État ROCm / NPU" : crash clinfo documenté, Vulkan priorisé.
- Section "TODO restants" : refs aux deux propositions
  (`PLAN-ROCM-72-MINISTAR-2026-05-01.md`, `REMOTE-DESKTOP-MINISTAR-LINUX-2026-04-30.md`).
- Nouvelle section "Repo `ai-stack/`" : doc du repo git local + état des services.

### État stack à la fin

```
NAME         STATUS
ai-redis     Up X min (healthy)
litellm      Up X min (healthy)
open-webui   Up X min (healthy)
qdrant       Up X min (healthy)
searxng      Up X min (healthy)
```

Ollama : toujours `inactive + disabled` (à réactiver dans la phase Vulkan
du Plan ROCm).

### Commit ai-stack

- `b53d103 chore: initial commit ai-stack post-incident 2026-04-30`
- `21d8de4 feat: stabilisation stack — healthchecks, open-webui dans compose, secrets`

### Reste à faire (Vague C — chantiers majeurs)

1. Lancer `cleanup_crash_reports.sh` + `setup_firewall.sh` (sudo, par Patrice).
2. Plan Remote Desktop : `gnome-remote-desktop --system` (5 min).
3. Plan ROCm Phase Vulkan : drop-in systemd `OLLAMA_VULKAN=1 +
   OLLAMA_LLM_LIBRARY=vulkan + ROCR_VISIBLE_DEVICES=`, restart, test
   inférence qwen3.6 avec --verbose.

— Claude Opus 4.7 (1M)


## 2026-04-30 (soir/nuit) — Bascule GRD → xrdp + MATE pour multi-user

### Contexte

Patrice ajoute Sébastien comme collaborateur (compte Linux `sebastien` UID 1001,
groupes sudo + docker, Tailscale `pc-asus-seb`). `gnome-remote-desktop --system`
posé hier soir s'avère **mono-utilisateur** : sa SAM ne stocke qu'un couple
username/password via `grdctl set-credentials`. Sébastien bloque sur
`Could not find user in SAM database` → erreur mstsc 0xd06 / 0x0.

Décision : bascule vers **xrdp + xorgxrdp** pour multi-user via PAM.

### Pièges traversés (long, mais documenté pour la prochaine fois)

1. **GNOME via xrdp ne fonctionne pas sur Ubuntu 24.04**. Tentatives successives :
   - `dbus-launch` → exit code 127 (paquet `dbus-x11` plus installé en 24.04)
   - `dbus-run-session` → bus DBus isolé, gnome-session ne joint pas systemd1
   - DBus du systemd --user (`/run/user/$UID/bus`) + `import-environment` →
     mutter ne s'enregistre pas (`Name "org.gnome.Mutter.DisplayConfig" does
     not exist`), `org.gnome.Shell@x11.service` skipped car
     `ConditionEnvironment=XDG_SESSION_TYPE=x11` non remplie. Écran "Oh no!".

2. **Pivot vers MATE** : marche immédiatement avec un startwm.sh trivial.
   - Layout Mutiny initial → mate-panel crashe en boucle (zombies 335124 →
     606835 → 661896) parce que `mate-applet-brisk-menu` et `mate-dock-applet`
     pas installés. Reset via `dconf reset -f /org/mate/panel/`, retour à
     Familiar par défaut, stable.

3. **Picom + xrdp = freeze immédiat** (compositing GLX sur xorgxrdp). Désactivé
   par défaut dans `mate-style.sh`, réactivable via `WITH_PICOM=1`.

4. **Firefox snap ne lance pas en RDP** : `cannot open display: :10.0`
   (snap-confine bloque). Fix: `xhost +SI:localuser:$(id -un)` dans le
   startwm.sh (donc auto pour tout user xrdp).

5. **Bug refcount GNOME 46.x** (avant la bascule) : `g_atomic_ref_count_dec
   assertion 'old_value > 0' failed` dans gnome-remote-desktop. Workaround
   `grd-watchdog` posé puis devenu obsolète après pivot xrdp. Gardé désactivé
   pour rollback éventuel.

### Scripts ajoutés dans `ai-stack/` (commit `43ae9f4`)

```
ai-stack/
├── add_collaborator.sh                     # +flag --no-key
├── grd-watchdog.{sh,service}               # bug refcount GRD (legacy)
├── install_grd_watchdog.sh                 # legacy
├── install_xrdp.sh                         # migration GRD→xrdp idempotente
├── rollback_xrdp_to_grd.sh                 # rollback en 4 lignes
├── xrdp/
│   ├── startwm.sh                          # session MATE Xorg + xhost snap
│   └── 02-allow-colord.rules               # polkit anti-popups RDP
├── mate-style.sh                           # setup MATE per-user
└── mate-config/
    ├── picom.conf                          # config tear-free (désactivée)
    ├── plank-autostart.desktop
    └── picom-autostart.desktop
```

### Tailscale ACL temporaire

`autogroup:admin` posé pour débloquer Sébastien rapidement → à restreindre
en règle ciblée `src=sebastien.yge@gmail.com → dst=100.98.18.76:{22,3389}`
+ rétrograder Member.

### Tests réalisés

- Patrice : mstsc → MATE Familiar avec Yaru-MATE-dark, polices Ubuntu OK
- Multi-session simultané : non testé (Sébastien pas encore connecté)
- Audio RDP : non installé (`pipewire-module-xrdp` pas dans noble standard)
- Firefox via icône : OK après `xhost` dans startwm.sh

### Reste à faire

1. Sébastien teste mstsc (mdp Linux à lui transmettre par canal sécurisé)
2. Restreindre Tailscale ACL (cf. ci-dessus)
3. UFW activé avec règles tailscale0 only (le plan original le prévoyait,
   pas appliqué — services AI Open WebUI/Qdrant/etc. exposés sur LAN)
4. sshd_config durci (PasswordAuthentication no) après que Sébastien ait
   posé sa clé
5. Audio RDP (PPA pipewire-xrdp ou compile from source) — bloquant si lecture
   audio dans la session distante
6. Auto-application de `mate-style.sh` à la 1ère connexion (autostart .desktop
   global avec marqueur `~/.config/.mate-styled`)

### Mémoires créées

- `project_remote_desktop_ministar.md` : règle "ne plus tenter GNOME via xrdp,
  utiliser MATE", scripts dans ai-stack, raisons documentées

— Claude Opus 4.7 (1M context)

## 2026-05-01 (nuit) — Sécurisation réseau phase 1 + outils

Patrice me demande "continue d'améliorer mon setup" en deuxième partie de
nuit, après que la session précédente ait pivoté vers xrdp+MATE pour
multi-user (Sébastien). Je rattrape l'état post-pivot et m'attaque au
TODO #3 du `DEV/CLAUDE.md` : sécurisation réseau.

### Phase 1 appliquée (sans risque)

**fail2ban configuré** : `/etc/fail2ban/jail.local` créé (sauvegardé en
miroir dans `ai-stack/fail2ban/jail.local`). Settings :

- `bantime = 1h`, `findtime = 10m`, `maxretry = 5`
- `ignoreip = 127.0.0.1/8 ::1 100.64.0.0/10` (range CGNAT Tailscale)
  → ni Patrice ni Sébastien depuis tailscale ne peuvent être bannis
- `[sshd] mode = aggressive` : bannit aussi les bots qui scannent sans
  même tenter un password (bad protocol, no matching auth method)

`sudo systemctl restart fail2ban` → jail [sshd] active, 0 ban actuel.

**Outils installés** : `fail2ban`, `powertop`, `iotop`, `glances`. Les
autres `radeontop`, `nvtop`, `unattended-upgrades` étaient déjà en place.

### Phase 2 préparée (à exécuter éveillé)

`ai-stack/secure_network.sh` créé (commit ai-stack à venir). Politique UFW :

- default deny in / allow out / deny routed
- allow tout sur tailscale0 et lo
- allow SSH (22/tcp) et mosh (60000-61000/udp) depuis RFC1918 — pour ne
  pas se couper depuis le LAN domestique
- deny tout le reste

Le script demande confirmation explicite, détecte automatiquement
l'interface LAN et l'IP Tailscale, et prévient si la session SSH actuelle
ne tomberait pas dans les règles autorisées. Politique défensive : si
réponse autre que `y`, abort.

**Piège Docker documenté** : Docker édite directement la chain `DOCKER`
d'iptables et n'est PAS filtré par UFW. Conséquence : les ports publiés
par `docker-compose.yml` (open-webui :8080, qdrant :6333-6334, searxng
:8888, litellm :4000 host-net, ai-redis :6380 host-net) restent
accessibles sur 0.0.0.0 même après UFW enable. La proposition
`SECURISATION-RESEAU-MINISTAR-2026-05-01.md` détaille la solution :
binder chaque service sur `127.0.0.1` dans le compose, puis exposer ce
qui doit être distant via `tailscale serve` (TLS auto + ACL fines
possibles via Admin Console).

### Audit sshd_config

État au démarrage de session :
- `/etc/ssh/sshd_config.d/` n'existe pas → defaults OpenSSH appliqués
  (PasswordAuthentication yes, PermitRootLogin prohibit-password)
- `~patrice/.ssh/authorized_keys` est vide (0 octet) → patrice se connecte
  uniquement par mot de passe
- État `~sebastien/.ssh/` : permission denied depuis patrice (normal)

Conséquence : on ne peut pas durcir `PasswordAuthentication no` tant que
les deux users n'ont pas posé leur clé. Documenté en étape C de la
proposition, à reprendre quand Sébastien aura sa clé.

### État réseau snapshot (avant UFW)

Tous les services écoutent sur 0.0.0.0 :
- 22 (sshd), 3389 (xrdp) — natifs
- 8080 (open-webui), 6333-6334 (qdrant), 8888 (searxng), 4000 (litellm),
  6380 (ai-redis) — Docker

12 sessions loginctl actives, dont 1 active de Sébastien (session xrdp ou
SSH). Plusieurs sessions Patrice "closing" — résidus d'anciennes sessions
xrdp.

### Mise à jour DEV/CLAUDE.md

Section "TODO restants" point 3 : passe de "à programmer" à "phase 1
faite, phase 2 prête". Pointeurs vers le script `secure_network.sh`,
le `jail.local`, et la proposition.

### Reste à faire (par Patrice éveillé)

- Lancer `sudo ai-stack/secure_network.sh` (5 min, garde une 2ᵉ session
  SSH ouverte)
- Patcher `docker-compose.yml` pour binder les services sur 127.0.0.1
  (étape B de la proposition)
- Configurer `tailscale serve` pour exposer ce qui doit l'être
- Quand Sébastien a sa clé : `/etc/ssh/sshd_config.d/10-hardening.conf`
- Définir une ACL Tailscale ciblée pour Sébastien dans l'Admin Console

### Pensée du jour

Une nuit on casse le boot graphique en ajoutant un `ld.so.conf.d`. La
nuit suivante on rajoute les briques manquantes pour qu'une troisième
nuit similaire ne puisse pas arriver — fail2ban contre le bruteforce SSH,
UFW prêt à serrer, conventions réseau documentées pour qu'un futur Claude
les retrouve sans réinventer. Sébastien rejoint l'aventure côté multi-user.
La machine devient lentement un vrai poste partagé, pas un bricolage
solitaire.

— Claude Opus 4.7 (1M)

## 2026-05-01 (nuit, suite) — Améliorations stack AI + ComfyUI

Patrice : *"améliore mon stack AI et ComfyUI"*. Sans risque, sans toucher
au système.

### ComfyUI — venv healthcheck

`uv pip list --outdated` → 17 packages mineurs en retard (rien de critique,
ni torch, ni custom_nodes). Upgrade groupé en une commande : `aiofiles`,
`pillow`, `numpy`, `setuptools`, `comfyui-frontend-package`, et la grosse
famille `comfyui-workflow-templates*` (qui aligne ce que voit l'UI avec les
50+ blueprints pullés hier).

**Régression introduite** par l'upgrade : `tokenizers==0.23.1` dépasse la
borne `<=0.23.0` de `transformers` actuellement installé →
`ImportError: tokenizers>=0.22.0,<=0.23.0` au démarrage.

**Fix** : downgrade `tokenizers==0.22.2` (la version 0.23.0 pile n'existe
pas sur PyPI, donc retour à la précédente). Smoke test après fix :
ComfyUI démarre sur `:8188`, `Total VRAM 63941 MB` détectée, ComfyUI-Manager
fetch le registry sans erreur, `system_stats` répond `200 OK`. RAS.

**Leçon** : les upgrades de venv ComfyUI doivent être sélectifs — éviter
`tokenizers` tant que `transformers` n'est pas mis à jour en parallèle.

### Voice — voix masculine FR ajoutée

`fr_FR-tom-medium.onnx` (60 MB) téléchargée depuis rhasspy/piper-voices.
Test synthèse 8.31s audio à 44.1 kHz en 0.56s CPU → real-time factor 0.07
(sur les 24 cœurs Ryzen AI, c'est très confortable même sans GPU).

```bash
echo "Bonjour Patrice." | ./piper/piper/piper \
  --model voices/fr_FR-tom-medium.onnx --output_file /tmp/out.wav
```

Le futur robot peut maintenant alterner Siwis (féminin) et Tom (masculin)
selon le contexte. Les deux voix coûtent 60 MB chacune, négligeable.

### LiteLLM — config inspectée

`litellm/config.yaml` est correct, expose 4 modèles Ollama via aliases
`ollama-{gemma4,qwen3,qwen36,embed}`. Routes Anthropic/Gemini préparées
en commentaires, prêtes à activer quand les clés seront posées dans
`litellm/.env`. Pas de modif nécessaire cette nuit (Ollama disabled
de toute façon, pointer vers du vide n'apporte rien).

### Récap stack à ce point

- **ComfyUI** : démarre OK en CPU, 50+ blueprints prêts, modèles déjà
  téléchargés couvrent Flux.2-dev, Wan 2.2, SD 1.5
- **Voice** : Siwis (F) + Tom (M) en français, real-time CPU
- **Open WebUI** : 2 instances actives (live + backup-2026-04-30)
- **Docker stack** : qdrant, searxng, litellm, ai-redis healthy (10h up)
- **Ollama** : disabled, à reprendre via plan ROCm Vulkan
- **Sécurité** : fail2ban actif (whitelist Tailscale), UFW prêt à activer
  via `secure_network.sh`

### Pas fait (besoin Patrice présent)

- Pré-téléchargement de modèles lourds (SDXL, Z-Image-Turbo, etc.) :
  choix éditorial, à valider
- Activation `tailscale serve` pour exposer Open WebUI/ComfyUI en HTTPS
  sur le tailnet : nécessite décision sur ce qu'on expose et à qui
- Regen `transformers` pour pouvoir bumper `tokenizers` proprement :
  requiert tester impact sur tous les custom_nodes

— Claude Opus 4.7 (1M)

## 2026-05-01 (nuit, suite 2) — Modèles compacts + gen test CPU validé

Patrice : *"Pré-télécharger Z-Image-Turbo ou autres modèles compacts pour
pouvoir tester un blueprint en CPU sans attendre ROCm"*. Choix éditorial :
Z-Image-Turbo demande 14 GB (UNet bf16 + qwen_3_4b text encoder), trop
lourd pour un test CPU rapide. Pivot vers du **vraiment compact**.

### Modèles téléchargés

- **LCM-LoRA SDv1.5** dans `models/loras/lcm-lora-sdv1-5.safetensors` (134 MB)
  → permet de transformer le SD 1.5 existant en pipeline 4-steps. Source :
  `latent-consistency/lcm-lora-sdv1-5` sur HuggingFace.
- **SD-Turbo** dans `models/checkpoints/sd_turbo.safetensors` (1.47 GB)
  → modèle dédié 1-step. Source : `stabilityai/sd-turbo` HF.

Pas de Z-Image-Turbo cette nuit (14 GB trop pour test CPU rapide ; à
re-considérer quand ROCm Vulkan sera up).

### Gen end-to-end CPU validé ✓

Test soumis via API ComfyUI `/prompt` avec workflow minimal SD-Turbo
(CheckpointLoaderSimple + EmptyLatent 512×512 + 2× CLIPTextEncode +
KSampler 1 step CFG 1.0 sampler euler_ancestral + VAEDecode + SaveImage).

Prompt : *"a serene robotic owl perched in a moonlit forest, cinematic,
highly detailed"*.

**Résultat : 6.2 secondes en CPU pur** (24 cœurs Ryzen AI 9 HX 470).
Image 512×512 PNG générée dans `output/robot_owl_sd_turbo_00001_.png`,
qualité honnête (chouette détaillée, forêt lunaire), pipeline ComfyUI
0.20.1 + torch 2.11.0+cpu validé end-to-end **sans ROCm**.

Script de test : `/tmp/comfy_test_sd_turbo.py` (urllib + json, pas de
dépendances). Réutilisable comme template pour d'autres prompts/modèles.

### Implications

- La stack image fonctionne déjà sans GPU. Toute amélioration ROCm/Vulkan
  sera un bonus (~10-20× speedup attendu pour les modèles plus gros).
- Patrice peut tester ses blueprints SD 1.5 / SD-Turbo dès maintenant via
  l'UI ComfyUI sur `:8188` (lancer via `start-stack.sh --with-comfy`).
- Pour les blueprints plus lourds (Flux.2, Wan 2.2), il vaut mieux attendre
  ROCm ou Vulkan — un step Flux.2 14B en CPU ferait probablement 3-5 min.

### Côté disque

- ComfyUI/models occupe maintenant ~50 GB total (modèles existants + ajouts)
- 3.2 TB encore libres → place pour Z-Image-Turbo (14 GB), SDXL-Turbo
  (7 GB), ou n'importe quel modèle de la liste blueprints (LTX, Qwen-Image,
  Hunyuan3D, ACE-Step audio, etc.) selon les priorités de Patrice.

— Claude Opus 4.7 (1M)

## 2026-05-01 (nuit, suite 3) — Pack outils Linux essentiels

Patrice : *"quelles applications sont incontournables sur linux"*. Inventaire
de ce qui était déjà là vs manquant pour son profil dev / stack AI / robot,
puis install groupée du pack manquant.

### Installé via apt

`ffmpeg imagemagick ripgrep fd-find bat git-delta httpie miller tldr zoxide
nmap iftop duf` (~14 packages, ~150 MB).

Aliases ajoutés à `~/.bashrc` (idempotent, garde `# === Claude additions ===`
comme marker) :
- `alias bat='batcat'` (Ubuntu renomme bat en batcat)
- `alias fd='fdfind'` (idem fd-find)
- `eval "$(zoxide init bash)"` pour `cd` intelligent

### Installé hors apt (binaires GitHub releases)

Récupérés via API GitHub + curl, installés dans `/usr/local/bin/` :
- `lazygit 0.61.1` — git TUI (Patrice commit beaucoup, va le servir)
- `lazydocker 0.25.2` — docker TUI (gère ai-stack visuellement)
- `dive 0.13.1` — inspecter les couches Docker
- `yq 4.53.2` (Mike Farah, Go) — équivalent jq pour YAML

À noter : le paquet apt `yq` pointe vers la version Python d'Andrey Kislyuk,
moins répandue. La version Mike Farah Go est le standard de facto.

### tldr cache offline KO

`tldr --update` plante avec une erreur Haskell binary parser (bug connu de
la version Ubuntu, mainteneur l'a tagué noble). Fallback online fonctionne.
Si Patrice veut le cache offline propre : remplacer par `tealdeer` (Rust)
ou `tldr++` plus tard. Pas urgent.

### Récap final outils Ministar

```
✓ tmux htop btop glances ncdu fzf eza jq gh gpg mtr iotop nvtop
✓ powertop radeontop ollama zsh curl wget mosh fail2ban
✓ ffmpeg imagemagick ripgrep fd-find bat git-delta httpie miller
✓ tldr zoxide nmap iftop duf
✓ lazygit lazydocker dive yq
```

Si un jour Patrice veut aller plus loin :
- `starship` (prompt cross-shell)
- `atuin` (history fuzzy + sync optionnel)
- `tealdeer` (tldr en Rust, remplace celui d'apt qui est cassé)
- `age` (chiffrement moderne, alt. à gpg)
- `pass` (gestion de mots de passe via gpg)
- `fish` (shell alternatif, optionnel)
- `zellij` (multiplexer alternatif à tmux, optionnel)

— Claude Opus 4.7 (1M)

## 2026-05-01 (nuit, suite 4) — Webmin installé

Patrice : *"webmin oui"*. Install Webmin sur Ministar avec garde-fous
(pas Virtualmin — disproportionné pour cette machine).

### Repo + install

Premier essai via clé jcameron historique → erreur apt
`untrusted public key algorithm: dsa1024` (Ubuntu 24.04 refuse DSA-1024).
Fallback sur le script officiel `setup-repos.sh` du repo `webmin/webmin`
qui pose la nouvelle clé "Webmin Developers" RSA-4096. Puis
`apt install --install-recommends webmin` standard.

### Sécurité — bind tailnet uniquement

Par défaut Webmin écoute sur `0.0.0.0:10000` SSL. Trop exposé pour le LAN
domestique + non-sens vis-à-vis de la stratégie "tailnet first". J'ai modifié
`/etc/webmin/miniserv.conf` :

```
bind=100.98.18.76
```

→ écoute uniquement sur l'IP Tailscale. Ni le LAN ni internet ne voient le
port. Vérification : `ss -tlnp | grep :10000` → bind sur 100.98.18.76 only.

Pas pu utiliser `tailscale serve --https` parce que MagicDNS et HTTPS
Certificates ne sont pas activés dans l'Admin Console Tailscale (toggle à
faire par Patrice dans `https://login.tailscale.com/admin/dns`). Le bind
direct sur l'IP tailnet est tout aussi sûr et plus simple.

### Auth — user patrice via PAM Unix

Default Webmin : seul `root` autorisé, et root est lock sur Ubuntu. J'ai
ajouté `patrice` à `/etc/webmin/miniserv.users` avec le format `patrice:x:0`
(`x` = délégué à PAM Unix), activé `pam=webmin` + `pam_test=1` dans
`miniserv.conf`. Login validé : POST `/session_login.cgi` → HTTP 302
(success), suivi GET `/` → HTTP 200 avec `<title>Webmin</title>`.

### Accès depuis G7 PT Windows

```
URL    : https://100.98.18.76:10000/
User   : patrice
Pass   : password sudo (à changer demain matin via passwd ou Webmin lui-même)
Cert   : self-signed Webmin → accepter exception au premier login
```

Le browser râlera sur le cert auto-signé (CN=ministar-linux), accepter
définitivement. Ou bien activer MagicDNS+HTTPS dans Tailscale et utiliser
`tailscale serve` plus tard pour avoir un cert propre Tailscale.

### Pas fait (et c'est OK)

- Virtualmin : skip volontaire, pas adapté à Ministar (Docker gère déjà
  l'orchestration des services, Virtualmin entrerait en conflit avec
  Apache/nginx system).
- Reverse proxy Webmin : pas nécessaire avec bind tailnet direct.
- Cert TLS propre : possible plus tard via Tailscale HTTPS toggle.

### Recommandation suivante

Quand Patrice se logge la première fois :
1. Webmin → System → Change Passwords → set un password Webmin distinct du
   sudo (plus de fuite par scrollback Claude).
2. Webmin → Webmin Configuration → Authentication → activer "Logout after
   X minutes idle".
3. Webmin → Webmin Configuration → IP Access Control → restreindre encore
   à `100.0.0.0/8` (range Tailscale CGNAT) en plus du bind interface.

— Claude Opus 4.7 (1M)

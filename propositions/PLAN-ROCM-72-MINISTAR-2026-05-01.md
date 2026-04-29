# Plan d'attaque ROCm 7.2 sur Ministar Linux — proposition pour 2026-05-01

> Auteur : Claude Opus 4.7 (1M) — nuit 2026-04-30, après l'incident UI/libdrm
> Hardware cible : iGPU Radeon 890M (gfx1150 / RDNA 3.5), 64 GB VRAM partitionnés BIOS
> Statut : à valider par Patrice avant exécution.

## Récapitulatif de la nuit

Ce qui s'est passé entre 22:20 et 00:30 (à connaître avant de relancer ROCm) :

1. ROCm 7.2.2 a été installé via `install_rocm.sh` (paquets `rocm`, `amdgpu-dkms`, libs sous `/opt/rocm-7.2.2/`).
2. Le helper `enable_ollama_gpu.sh` ajoutait `/usr/local/lib/ollama/rocm` dans `/etc/ld.so.conf.d/00-ollama-rocm-bundle.conf` pour rendre les libs ROCm bundle d'Ollama prioritaires globalement.
3. **Régression** : la libdrm bundle d'Ollama (vieille, sans `drmSyncobjEventfd`) shadowait la libdrm système pour **toutes** les apps GPU, dont `libmutter`/`gnome-shell`. GDM échouait en boucle → écran de login impossible.
4. Fix appliqué cette nuit : fichier déplacé en `/root/00-ollama-rocm-bundle.conf.disabled-2026-04-30`, `ldconfig` rafraîchi, GDM stable, reboot validé.
5. **Patch préventif appliqué** : `enable_ollama_gpu.sh` utilise maintenant `Environment=LD_LIBRARY_PATH=...` dans le drop-in systemd (scope = service ollama uniquement) au lieu de `ld.so.conf.d/`. Si tu (ou un autre Claude) relances le script, il détecte le legacy `00-ollama-rocm-bundle.conf` et le renomme automatiquement (`.disabled-by-enable_ollama_gpu`).

État actuel du stack ROCm :
- Paquets ROCm 7.2.2 installés ✅
- `/etc/ld.so.conf.d/00-ollama-rocm-bundle.conf` désactivé ✅
- Service ollama : `disabled` au boot, arrêté ✅
- Drop-in `rocm.conf` : minimal, **pas** de `LD_LIBRARY_PATH` (pas encore appliqué)

## Plan en 4 phases

### Phase 1 — Vérifier l'état runtime ROCm (10 min, 0 risque)

Sans toucher à ollama, on confirme que le runtime ROCm système est sain :

```bash
# kernel module amdgpu chargé et le 890M détecté
lsmod | grep amdgpu
ls /dev/kfd /dev/dri/render*
groups patrice | grep -E 'render|video'   # Patrice doit être dans render+video

# infos ROCm
rocminfo | grep -A4 -i "agent\|gfx"
rocm-smi
/opt/rocm-7.2.2/bin/rocminfo | head -30   # version 7.2 explicite
```

Attendu : un agent gfx1150 visible. Si non, soit usermod manqué, soit driver pas
chargé. À diagnostiquer avant de continuer.

### Phase 2 — Lancer l'enable_ollama_gpu.sh patché (5 min, risque faible)

Le script patché écrit maintenant un drop-in propre :

```ini
[Service]
Environment="LD_LIBRARY_PATH=/usr/local/lib/ollama/rocm:/usr/local/lib/ollama"
```

Puis reload + restart ollama.

```bash
cd /home/patrice/DEV/ai-stack
sudo ./enable_ollama_gpu.sh
```

Le script affiche les libs ROCm vues par le process ollama (via `/proc/PID/maps`).
On vérifie que `libamdhip64.so.7` provient bien de `/usr/local/lib/ollama/rocm/`.

**Risque résiduel** : page fault GPU au discovery (observé cette nuit), mais
maintenant **isolé** au service ollama — l'UI GNOME n'est plus impactée.
Si page fault → ollama tombe en CPU silencieusement, on rentre en phase 3.

### Phase 3 — Si le 890M ne discover pas (plan B)

Si `ollama list` continue à fonctionner mais sans GPU, ou si journalctl montre
`failure during GPU discovery` :

**Plan B1 : remonter le timeout discovery via build custom**
Le bug racine : timeout 3s hardcoded dans Ollama 0.21.2
(cf https://github.com/ollama/ollama/pull/13186 — patché en 0.22+).

```bash
# vérifier la version dispo
ollama --version
# upgrade vers la dernière (0.22+ au moment d'écrire — cf release notes)
curl -fsSL https://ollama.com/install.sh | sh
# le drop-in /etc/systemd/system/ollama.service.d/rocm.conf est préservé
sudo systemctl restart ollama
```

**Plan B2 : forcer gfx1100 via HSA_OVERRIDE_GFX_VERSION**
À éviter en première intention (le drop-in actuel commente exprès cette voie),
mais à essayer si le bundle ne reconnaît pas le 890M nativement après upgrade :

```bash
# édition manuelle du drop-in
sudo nano /etc/systemd/system/ollama.service.d/rocm.conf
# ajouter :
# Environment="HSA_OVERRIDE_GFX_VERSION=11.0.0"
sudo systemctl daemon-reload && sudo systemctl restart ollama
```

Le JIT compile peut dépasser le timeout — d'où l'intérêt de B1 (plus récent) avant B2.

**Plan B3 : utiliser Lemonade Server à la place**
Si Ollama refuse définitivement, Lemonade v10.3.0 supporte FLM backend qui
adresse différemment le discovery. `install_lemonade.sh` est déjà prêt.

### Phase 4 — Bench si ça marche (15 min)

```bash
# benchmark qwen3.6:35b-a3b en CPU vs GPU
ollama run qwen3.6:35b-a3b-q4_K_M "Présente-toi en une phrase, en français." --verbose
# capture tok/s
# référence cette nuit : 17.7 tok/s en CPU pur
# objectif post-ROCm : 60-80 tok/s sur ce MoE 35B-a3b
```

À journaliser dans `journal/ministar-ubuntu-DEV.md`.

## Garde-fous généraux

- **Toujours avoir SSH+Tailscale ouvert** dans une fenêtre de secours quand on touche aux libs GPU. Le filet de sécurité de cette nuit reste valide.
- **Ne JAMAIS** ajouter quoi que ce soit dans `/etc/ld.so.conf.d/` qui pointe vers `/usr/local/lib/ollama/`. Voir mémoire `feedback_ld_so_conf_ollama_bundle.md`.
- **Avant** d'appliquer un changement risqué : `ldd /lib/x86_64-linux-gnu/libmutter-14.so.0 | grep drm` pour vérifier que la libdrm chargée est bien celle du système (ou d'amdgpu) et **pas** celle d'ollama.
- Tester en 2 phases : d'abord redémarrer ollama et vérifier la GUI (depuis SSH `loginctl list-sessions` doit toujours montrer la session GDM), **avant** de redémarrer la machine entière.

## Lien avec le robot

Une fois ROCm 7.2 stable + Lemonade XDNA actif, on aura :
- Inférence LLM accélérée (Ollama ROCm) → cerveau verbal du robot
- Inférence NPU dédiée (Lemonade FLM) → modèles spécialisés perception/contrôle
- ComfyUI avec PyTorch ROCm → vision générative

C'est la base hardware du compagnon. La nuit de cette régression nous a appris
que **chaque brique doit être isolée du reste** (drop-in scoped, pas global).
Cette leçon vaudra encore plus quand on commencera à layer Lemonade par-dessus.

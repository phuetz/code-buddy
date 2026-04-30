# Sécurisation réseau Ministar Linux

> Auteur : Claude Opus 4.7 (1M) — nuit 2026-05-01 (TODO #3 du `DEV/CLAUDE.md`)
> Statut : à exécuter en deux phases — Phase 1 sans risque (déjà fait), Phase 2 à valider par Patrice.
> Contexte : Sébastien (uid 1001, sudo+docker) a accès à Ministar via xrdp/SSH. La machine expose actuellement SSH/xrdp/Open WebUI/Qdrant/LiteLLM/SearXNG/redis sur `0.0.0.0`. UFW inactif.

## Phase 1 — Déjà appliquée cette nuit (zéro risque)

### fail2ban configuré et actif

`/etc/fail2ban/jail.local` créé avec :
- `bantime = 1h` (vs 10m default), `findtime = 10m`, `maxretry = 5`
- **Whitelist Tailscale** : `100.64.0.0/10` (CGNAT) + localhost → Patrice et Sébastien depuis tailscale ne peuvent pas être bannis accidentellement
- Jail `[sshd]` en `mode = aggressive` : bannit aussi les bots qui tentent "bad protocol" / "no matching auth method"

Vérifier : `sudo fail2ban-client status sshd`

### Outils de monitoring installés

`fail2ban`, `powertop`, `iotop`, `glances` ajoutés (les autres `radeontop`,
`nvtop`, `unattended-upgrades` étaient déjà là).

## Phase 2 — À exécuter par Patrice éveillé

### Étape A — Activer UFW (script prêt)

`ai-stack/secure_network.sh` est prêt. Politique :

```
default deny incoming, allow outgoing, deny routed
allow in on lo
allow in on tailscale0           # tailnet entièrement de confiance
allow in 22/tcp     from RFC1918 # SSH depuis LAN, ne pas se couper
allow in 60000-61000/udp from RFC1918  # mosh depuis LAN
deny  in tout le reste
```

Le script demande confirmation explicite, détecte ton interface LAN et ton
IP Tailscale, et te prévient si ton SSH actuel ne tomberait pas dans les
règles autorisées.

```bash
cd /home/patrice/DEV/ai-stack
sudo ./secure_network.sh
```

**Garde-fou** : avoir une 2ᵉ session SSH ouverte avant de lancer (au cas où).
Si ça tombe, depuis Tailscale en `100.x.y.z` tu restes accessible (c'est
allow in on tailscale0).

### Étape B — Le piège Docker (à résoudre)

**Problème** : Docker édite directement la chain `DOCKER` d'iptables et **n'est
pas filtré par UFW**. Donc les ports publiés par `docker-compose.yml` restent
accessibles sur `0.0.0.0` même après `sudo ufw enable` :

| Service | Port | Publication |
|---|---|---|
| open-webui | 8080 | `0.0.0.0:8080` |
| qdrant | 6333, 6334 | `0.0.0.0:6333-6334` |
| searxng | 8888 | `0.0.0.0:8888` |
| litellm | 4000 | `0.0.0.0:4000` (host network) |
| ai-redis | 6380 | `0.0.0.0:6380` (host network) |

**Solution recommandée** : binder chaque service sur `127.0.0.1` dans
`docker-compose.yml`, puis exposer ce qui doit être distant via Tailscale Serve.

#### Patch docker-compose proposé

```yaml
# qdrant
ports:
  - "127.0.0.1:6333:6333"
  - "127.0.0.1:6334:6334"

# searxng
ports:
  - "127.0.0.1:8888:8080"

# open-webui (à voir sa section ports actuelle)
ports:
  - "127.0.0.1:8080:8080"

# litellm + redis (host network) → doivent binder côté process
# litellm : ajouter "--host 127.0.0.1" dans command (ou config.yaml)
# redis : ajouter "--bind 127.0.0.1" dans command
```

#### Exposer via Tailscale Serve

Pour chaque service à rendre accessible depuis G7 PT et Sébastien sur le tailnet :

```bash
# Open WebUI accessible en https://ministar-linux/ via tailscale serve
sudo tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:8080

# ComfyUI quand il tourne
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8188

# Vérifier
tailscale serve status
```

L'UI Open WebUI est alors accessible en `https://ministar-linux/` depuis
le G7 PT (cert TLS auto par Tailscale, Magic DNS résolu).

**Avantages** :
- Plus rien d'exposé sur le LAN ni sur internet
- TLS gratuit géré par Tailscale
- ACL Tailscale fines possibles (ex. Sébastien peut accéder à open-webui mais pas à litellm)

**Inconvénients** :
- Les autres devices du LAN domestique (Switch, NAS, hypothétique invité) ne
  peuvent plus accéder à Open WebUI sans rejoindre le tailnet. Si c'est gênant,
  on remappe quelques ports en LAN.

### Étape C — Durcir sshd_config

**Pas avant** que :
1. Patrice et Sébastien aient chacun posé leur clé publique SSH dans `~/.ssh/authorized_keys`
2. Connexion par clé validée pour les deux

```bash
# vérifier en amont
cat /home/patrice/.ssh/authorized_keys
sudo -u sebastien cat /home/sebastien/.ssh/authorized_keys

# si OK les deux, durcir :
sudo tee /etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
sudo sshd -t   # test la config avant restart
sudo systemctl reload ssh
```

**Garde-fou** : avant le `reload ssh`, ouvrir une 2ᵉ session SSH par clé pour
vérifier qu'on entre toujours après le durcissement.

### Étape D — Tailscale ACL pour Sébastien

Actuellement Sébastien doit être ajouté en `autogroup:admin` (ce qui lui donne
tous les droits sur le tailnet). À remplacer par une ACL ciblée dans la
[Admin Console Tailscale](https://login.tailscale.com/admin/acls) :

```jsonc
{
  "groups": {
    "group:patrice": ["patrice.huetz@gmail.com"],
    "group:sebastien": ["EMAIL_DE_SEBASTIEN"],
  },
  "tagOwners": {
    "tag:ministar": ["group:patrice"],
  },
  "acls": [
    // Patrice a tout
    {"action": "accept", "src": ["group:patrice"], "dst": ["*:*"]},
    // Sébastien ne peut atteindre que xrdp et open-webui sur Ministar
    {"action": "accept", "src": ["group:sebastien"],
     "dst": ["tag:ministar:3389", "tag:ministar:443"]},
  ],
}
```

Une fois en place, taguer Ministar : `sudo tailscale up --advertise-tags=tag:ministar`.

### Étape E — Audit récurrent (proposition)

`schedule` un agent qui tourne chaque dimanche soir et :
- vérifie que UFW est toujours actif et que les règles n'ont pas dérivé
- relit `fail2ban-client banned` et alerte si des IP suspectes apparaissent
- compare le snapshot `ss -tlnp` à un baseline et signale les nouveaux ports
- vérifie que `tailscale serve status` correspond à la config attendue

Ça remplace une revue manuelle qu'on oubliera de faire.

## Récapitulatif des risques

| Action | Risque | Mitigation |
|---|---|---|
| `fail2ban` config | Très faible | Whitelist Tailscale, on ne peut pas se bannir |
| `secure_network.sh` (UFW) | Modéré (perte SSH possible) | Confirmation interactive, allow tailscale0 + LAN SSH, 2ᵉ session ouverte |
| Patch docker-compose | Modéré (Open WebUI inaccessible LAN) | Tailscale Serve compense, retour arrière facile |
| Hardening sshd_config | Élevé (couper Sébastien) | Vérifier clés posées des deux côtés avant |
| Tailscale ACL | Faible | Test depuis Sébastien après ACL |

## Lien avec les autres TODO

- **Sécurité avant que Sébastien ait sa clé** : le durcissement sshd attend
- **Audio RDP** (TODO #4) : indépendant, non bloqué par cette sécurisation
- **ROCm Vulkan** (TODO #1) : indépendant
- **Lemonade** (TODO #2) : indépendant

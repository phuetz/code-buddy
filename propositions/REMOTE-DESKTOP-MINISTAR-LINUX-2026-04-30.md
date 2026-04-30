# Bureau distant pour Ministar Linux

> Auteur : Claude Opus 4.7 (1M) — nuit 2026-04-30
> Contexte : Patrice veut accéder graphiquement à Ministar Linux (PC Ubuntu 24.04, GNOME 46 Wayland) depuis son G7 PT Windows, via Tailscale.
> Statut : recommandation à valider, **rien n'est encore activé**.

## TL;DR

**Recommandation principale : `gnome-remote-desktop` en mode `--system`.**
- Déjà installé (`gnome-remote-desktop 46.3-0ubuntu1.2`) — pas d'install, pas de DEB tiers.
- Wayland-natif. GNOME-natif. Aucune session Xorg fallback à manipuler.
- Côté Windows : aucun client à installer (Microsoft Remote Desktop est intégré à Windows).
- Activable en 30 secondes via `grdctl` (CLI prête ci-dessous).
- Plan B installé en silencieux ce soir : **x2goserver** (utile si gnome-remote-desktop ne convient pas).

## Pourquoi pas les autres options

| Option | Pourquoi non / pas en premier |
|---|---|
| **NoMachine** | Excellente UX mais DEB hors-repo, mises à jour manuelles, free-for-personal seulement. À garder si gnome-remote-desktop fait des siennes. |
| **xrdp + xorgxrdp** | Force la session GNOME Xorg, casse souvent les sessions Wayland en place, conflits avec gnome-keyring/PipeWire. |
| **x2go** | Très bon en Linux→Linux mais X11 only ; client Windows existe mais moins léché. Installé en plan B. |
| **Sunshine + Moonlight** | Latence excellente mais nécessite encodeur GPU (VAAPI/AMF), fragile tant que ROCm n'est pas stable. À reconsidérer pour usage gaming/ComfyUI temps réel après ROCm 7.2 OK. |
| **RustDesk** | Plutôt taillé pour assistance / aide à distance, expérience desktop persistante moins fluide que NoMachine ou GNOME Remote Desktop. |
| **Apache Guacamole** | HTML5 cool mais serveur tomcat à monter, complexité disproportionnée pour un usage personnel. |

## Plan d'activation au réveil (5 minutes)

### 1) Choisir un mot de passe RDP fort (différent du sudo)

Génère-en un solide :

```bash
openssl rand -base64 18
# garde-le, tu vas en avoir besoin pour Microsoft Remote Desktop
```

### 2) Configurer gnome-remote-desktop en mode système (headless)

```bash
# certificat TLS (auto-signé, OK pour usage tailnet)
sudo mkdir -p /var/lib/gnome-remote-desktop/.config
sudo openssl req -new -newkey rsa:4096 -x509 -sha256 -days 3650 -nodes \
  -subj "/CN=ministar-linux" \
  -out /etc/gnome-remote-desktop/rdp-tls.crt \
  -keyout /etc/gnome-remote-desktop/rdp-tls.key
sudo chmod 640 /etc/gnome-remote-desktop/rdp-tls.key
sudo chown root:gnome-remote-desktop /etc/gnome-remote-desktop/rdp-tls.*

# config grdctl en mode --system
sudo grdctl --system rdp set-tls-cert /etc/gnome-remote-desktop/rdp-tls.crt
sudo grdctl --system rdp set-tls-key  /etc/gnome-remote-desktop/rdp-tls.key
sudo grdctl --system rdp set-credentials patrice 'PASTE_LE_PASSWORD_RDP_ICI'
sudo grdctl --system rdp disable-view-only      # = full control, pas read-only
sudo grdctl --system rdp enable

# activer le service
sudo systemctl enable --now gnome-remote-desktop.service
sudo systemctl status gnome-remote-desktop.service --no-pager | head -15
```

### 3) Vérifier qu'il écoute (port 3389)

```bash
ss -tlnp | grep 3389
# attendu : LISTEN sur :::3389 ou 0.0.0.0:3389
```

### 4) Côté G7 PT Windows — Microsoft Remote Desktop

- Lance "Connexion Bureau à distance" (`mstsc.exe`)
- Ordinateur : `100.98.18.76` (ou `ministar-linux` quand le G7 PT est sur le tailnet)
- Utilisateur : `patrice`
- Mot de passe : celui généré à l'étape 1
- Avertissement de certificat auto-signé : "Oui, faire confiance"

Premier login → tu te retrouves dans une session GNOME Wayland.

### 5) Restreindre l'écoute à Tailscale (optionnel, recommandé)

Par défaut le serveur RDP écoute sur 0.0.0.0. UFW est inactif sur Ministar. Le risque
est limité (le LAN domestique est de confiance, et le NAT internet protège), mais
on peut serrer la vis :

```bash
# activer UFW en autorisant Tailscale + SSH local + RDP via Tailscale uniquement
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw allow in on lo
sudo ufw allow ssh                 # SSH LAN reste accessible
sudo ufw enable
sudo ufw status verbose
```

Ça verrouille le RDP sur le tailnet seulement, sans bloquer ton SSH local de secours.
**Attention** : si le sshd est sur 0.0.0.0 et que tu actives UFW, vérifie d'abord que
ton accès tailnet fonctionne avant de fermer la session courante (j'apprends de mes
erreurs de ce soir).

## Plan B — x2go (déjà installé en silencieux ce soir)

Si `gnome-remote-desktop` pose problème (latence, audio, clavier français mal mappé),
bascule sur x2go :

```bash
# côté Ministar : déjà installé (x2goserver, x2goserver-xsession)
sudo systemctl status x2goserver-watchdog --no-pager   # devrait être actif via SSH

# côté Windows : télécharger x2goclient depuis https://wiki.x2go.org/doku.php/download:start
#   (PuTTY-like, configure une session SSH 100.98.18.76 user patrice
#    + session type "GNOME" — nécessite de basculer Ubuntu en session Xorg au login)
```

Limitation : x2go a besoin d'une session **Xorg**. Au login GDM, clique l'engrenage
en bas à droite et choisis `Ubuntu on Xorg` au lieu d'`Ubuntu` (qui est Wayland par
défaut). Pas idéal — c'est pourquoi gnome-remote-desktop est le plan A.

## Plan C — NoMachine (à considérer plus tard)

Si gnome-remote-desktop et x2go sont décevants :

```bash
# télécharger le DEB depuis https://www.nomachine.com/download/linux (free)
wget -O /tmp/nomachine.deb "https://download.nomachine.com/download/9.X/Linux/nomachine_X.Y.Z_N_amd64.deb"
sudo apt install /tmp/nomachine.deb
# config web : https://localhost:4443
```

## Vérifications post-activation à faire ensemble

- Latence ressentie sur G7 PT Windows (clavier, souris, scroll)
- Mapping clavier AZERTY (parfois cassé en RDP cross-platform)
- Audio (gnome-remote-desktop pousse l'audio via PipeWire)
- Démarrage ComfyUI (port 8188) accessible **dans** la session RDP
- Déconnexion/reconnexion : la session GNOME doit persister (vérifier que `lock-on-suspend` est OK)

## Sécurité — checklist rapide

- [x] Mot de passe RDP différent du sudo (à choisir au point 1)
- [x] TLS auto-signé OK pour tailnet (peut être remplacé par Let's Encrypt si exposition publique — non prévu)
- [x] UFW restreint à `tailscale0` (étape 5)
- [ ] Pas de port-forward RDP vers internet sur ta box (à NE PAS faire — Tailscale suffit)
- [ ] Tailscale ACLs (optionnel, si tu veux limiter quel device peut atteindre :3389)

---

## Notes de l'auteur

L'incident UI de cette nuit (libdrm shadow par ld.so.conf.d) est un rappel : sur cette
machine, **toujours** garder un accès SSH pendant qu'on touche au stack graphique.
Tailscale + SSH = filet de sécurité. RDP s'ajoute par-dessus, mais ne le remplace pas.

---

## 2026-04-30 (soir) — Bascule vers xrdp + MATE (plan A abandonné)

**Statut** : ce plan A (`gnome-remote-desktop --system`) a été appliqué le matin,
puis abandonné le soir au profit de **xrdp + MATE Desktop**.

### Pourquoi

`gnome-remote-desktop --system` est **mono-utilisateur** : sa SAM ne stocke
qu'un seul couple username/password (`grdctl set-credentials` écrase à chaque
appel). Patrice ajoute Sébastien comme collaborateur le soir → besoin
multi-user → GRD inadéquat.

### Ce qui a été tenté avant le pivot

- xrdp + GNOME 46 Xorg : `gnome-shell` (mutter) ne s'enregistre pas sur le
  DBus session quand lancé via xrdp, même avec `dbus-run-session` puis avec
  le DBus du systemd --user instance. La condition systemd
  `XDG_SESSION_TYPE=x11` du service `org.gnome.Shell@x11.service` ne se
  remplit pas de manière fiable. Écran "Oh no! Something has gone wrong".

### Solution retenue

- xrdp + xorgxrdp + **MATE Desktop** (mate-desktop-environment-core).
  Marche immédiatement, multi-user via PAM, layouts modulables avec
  `mate-tweak`, look correct avec Yaru-MATE-dark.

### Scripts d'install/rollback

Tous dans `/home/patrice/DEV/ai-stack/` (commit `43ae9f4`) :

- `install_xrdp.sh` — migration GRD → xrdp idempotente
- `rollback_xrdp_to_grd.sh` — rollback en 4 commandes (les configs SAM GRD
  sont gardées intactes, juste désactivées)
- `xrdp/startwm.sh` — lance `mate-session` avec env Xorg correct + `xhost`
  pour les apps snap (Firefox)
- `xrdp/02-allow-colord.rules` — polkit qui coupe les popups récurrentes
  (color-manager, NetworkManager Wi-Fi scans, packagekit)
- `mate-style.sh` — applique le look (Yaru-MATE-dark, polices Ubuntu, layout)
  per-user (à lancer dans un terminal MATE, pas SSH)

### Plan B (x2go) reste valide

Si xrdp + MATE pose un jour problème (latence, audio, multi-monitor), x2go
reste installé et utilisable. Voir Plan B plus haut dans ce document.

### Plan C (NoMachine) toujours dispo

Pas activé. Reste l'option si x2go aussi est insuffisant un jour.

### Détails complets

Voir l'entrée `## 2026-04-30 (soir/nuit)` dans
`claude-et-patrice/journal/ministar-ubuntu-DEV.md` (pièges traversés,
décisions, tests réalisés, reste à faire).

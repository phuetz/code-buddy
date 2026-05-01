# Onboarding Sebastien sur Ministar (xrdp + MATE) — état 2026-05-01

> Auteur : Claude Opus 4.7 (1M) — matinée 2026-05-01, depuis Ministar Linux
> Cible : Patrice + Sebastien, pour aller au bout de la mise en service xrdp
> Statut : actions à exécuter, par ordre d'impact

## Contexte

Sebastien (collaborateur, compte Linux `sebastien` UID 1001, groupes
sudo+docker, Tailscale `pc-asus-seb` 100.73.117.67) accède à Ministar via
xrdp+MATE (déployé 2026-04-30). Trois problèmes identifiés ce matin :

1. **Chromium snap ne se lance pas** sur sa session (alors que Patrice
   peut le lancer depuis sa propre session sans problème)
2. **Session perçue comme très très lente** par Sebastien
3. **Aucun mécanisme automatique** de setup MATE (chaque user doit lancer
   `mate-style.sh` à la main pour le moment)

Diagnostic complet dans `journal/ministar-ubuntu-DEV.md` entrée du
2026-05-01 matin.

## Plan d'action (par impact décroissant)

### 1. Ajouter Sebastien aux groupes manquants

Différence isolée entre patrice (chromium fonctionne) et sebastien
(chromium KO) :

| Item | patrice | sebastien |
|---|---|---|
| Groupes | adm, **video**, **render**, plugdev, lpadmin, ollama, ... | sudo, users, docker |

Hypothèse : `render` est nécessaire pour que chromium snap puisse scanner
`/dev/dri/renderD128` au boot (init capabilities, même avec `--disable-gpu`).

```bash
sudo usermod -aG video,render,plugdev sebastien
```

Puis Sebastien fait un **logout MATE complet** (pas juste fermer mstsc),
mstsc reconnect → groupes appliqués + thème Yaru-MATE-dark + env xrdp frais.

### 2. Settings mstsc côté Sebastien (gain massif sur lenteur)

Sebastien rapporte la session "très très lente". Patrice depuis G7 PT en
LAN direct (20ms tailnet) trouve ça rapide → la lenteur est côté Sebastien,
pas côté serveur.

**Avant cliquer Connect dans mstsc, Show Options** :

| Onglet | Réglage | Valeur |
|---|---|---|
| Display | Colors | `High Color (16-bit)` |
| Display | Resolution | `1280×720` (ou `1366×768`) |
| Experience | Connection speed | **`Modem (56 kbps)`** |
| Experience | Décocher tout sauf "Bitmap caching" et "Reconnect" | |

Le profil "Modem" désactive d'un coup : font smoothing, themes Windows,
animations menu, ombres, persistent bitmap caching, fond bureau.
Coupe ~70% de la bande passante, gain ressenti énorme sur lien lent.

Sauvegarder en `.rdp` (Save As...) pour ne plus refaire.

### 3. Vérifier qualité tailnet pc-asus-seb

Quand Sebastien est en mstsc actif, lancer côté Ministar :

```bash
tailscale status | grep pc-asus-seb
```

Recherche :
- ✅ `active; direct X.X.X.X:YYYY` — UDP direct, latence min
- ❌ `active; relay "par"` — DERP Paris, latence ×2-3 → cause probable de
  la lenteur

Si `relay` : le routeur de Sebastien bloque l'UDP / NAT défavorable. Fix :
- Activer UPnP côté son routeur, OU
- Ouvrir UDP 41641 entrant en port forwarding, OU
- Vérifier que son ASUS n'est pas en double NAT

### 4. Optims serveur (à appliquer hors session active)

⚠️ **Restart xrdp coupe les sessions** — à programmer quand toi et Sebastien
êtes prêts à reconnecter.

```bash
# 1. crypt_level=low : Tailscale chiffre déjà bout-à-bout, double TLS
#    sur xrdp = surcoût CPU pour rien
sudo sed -i 's/^crypt_level=high/crypt_level=low/' /etc/xrdp/xrdp.ini

# 2. max_bpp=16 : ÷2 bande passante côté serveur (utile si client demande 32)
sudo sed -i 's/^max_bpp=32/max_bpp=16/' /etc/xrdp/xrdp.ini

# 3. Restart
sudo systemctl restart xrdp
```

Et désactiver Marco compositor (lourd en RDP) — per user :

```bash
# Dans la session graphique du user (ou via dbus depuis SSH avec env)
gsettings set org.mate.Marco.general compositing-manager false

# Pour sebastien depuis SSH (lance la commande en tant que sebastien
# avec son DBUS user)
sudo -u sebastien DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus \
  gsettings set org.mate.Marco.general compositing-manager false
```

À ajouter aussi au `mate-style.sh` pour les futurs users.

### 5. Cleanup sessions closing résiduelles

7 sessions sebastien restées en `closing` au fil des reconnexions :

```bash
sudo loginctl terminate-session c28 c39 c40 c44 c45 c46 c47
```

Vérifier après : `loginctl list-sessions` → seules c1 (gdm), c38 (patrice
SSH), c48 (sebastien actif) doivent rester en `active`.

### 6. Si chromium toujours KO après #1 — Brave fallback

Brave = fork Chromium en .deb officiel, sans snap-confine, sans bug
AppArmor en xrdp.

Script prêt : `/tmp/install_brave.sh` (généré ce matin) ou inline :

```bash
sudo apt install -y curl
sudo curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg \
  https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] \
  https://brave-browser-apt-release.s3.brave.com/ stable main" | \
  sudo tee /etc/apt/sources.list.d/brave-browser-release.list
sudo apt update && sudo apt install -y brave-browser
```

Brave apparaît dans Menu MATE → Internet → Brave pour tous les users
sans config par user.

## Sécurité — TODO derrière (pas urgent)

Voir aussi `propositions/SECURISATION-RESEAU-MINISTAR-2026-05-01.md` :

- **Restreindre Tailscale ACL** : actuellement `autogroup:admin` ouvert
  (temporaire de la nuit du 30). À restreindre dans Admin Console
  Tailscale : règle ciblée `src=sebastien.yge@gmail.com →
  dst=100.98.18.76:{22,3389}` + rétrograder Sebastien Admin → Member.
- **sshd_config hardening** : `PasswordAuthentication no` dans
  `/etc/ssh/sshd_config.d/10-hardening.conf` quand patrice ET sebastien
  auront tous deux posé leur clé SSH.
- **UFW** : `sudo /home/patrice/DEV/ai-stack/secure_network.sh` (Phase 2
  sécu réseau prête).

## Auto-application future de mate-style.sh

TODO du journal 2026-04-30 (point 6) : créer un `.desktop` autostart
global dans `/etc/xdg/autostart/` qui check un marqueur
`~/.config/.mate-styled` et lance `mate-style.sh` si absent. Évite la
copie manuelle pour chaque nouveau user.

À mettre dans `ai-stack/mate-style-autostart/`. Quand on ajoutera un 3e
user, ça vaudra le coup.

## Récap commandes prêtes à copier-coller

```bash
# 1. Groupes
sudo usermod -aG video,render,plugdev sebastien

# 5. Cleanup sessions closing
sudo loginctl terminate-session c28 c39 c40 c44 c45 c46 c47

# 4. Optims xrdp (HORS SESSION ACTIVE — coupe vos connexions)
sudo sed -i 's/^crypt_level=high/crypt_level=low/' /etc/xrdp/xrdp.ini
sudo sed -i 's/^max_bpp=32/max_bpp=16/' /etc/xrdp/xrdp.ini
sudo systemctl restart xrdp

# 4. Marco compositor off pour sebastien
sudo -u sebastien DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus \
  gsettings set org.mate.Marco.general compositing-manager false

# 6. Brave si chromium toujours KO
sudo bash /tmp/install_brave.sh   # ou inline ci-dessus
```

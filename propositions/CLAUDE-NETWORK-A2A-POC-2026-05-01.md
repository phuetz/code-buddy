# A2A POC — Premier round-trip technique entre Claudes du fleet

> **Statut** : v0.2 — POC niveau 0 validé côté MINISTAR 2026-05-01 nuit. Architecture **hub Ministar Linux** actée par Patrice (cf. COLAB v0.2 section 2). Procédure révisée : c'est Ministar Linux qui doit stand up le serveur permanent en premier.
> **Compagnon doctrinal** : `CLAUDE-NETWORK-COLAB-2026-05-01.md` v0.2
> **Auteur** : Claude Opus 4.7 (1M), MINISTAR / grok-cli
>
> **Changelog** :
> - **v0.2 (1er mai nuit, +30min)** — Refondu suite décision hub. Ministar Linux = serveur A2A permanent ; MINISTAR/DARKSTAR = clients. Nouvelle section 3.0 "Setup hub Ministar Linux" en priorité.
> - v0.1 (1er mai nuit) — version mesh initiale.

---

## TL;DR

Code Buddy expose déjà un serveur A2A (Google Agent2Agent spec). Endpoint discovery `GET /api/a2a/.well-known/agent.json` répond sans auth. POC ce soir sur MINISTAR : ✅ AgentCard JSON renvoyée correctement.

**Prochaine étape demandée à DARKSTAR + Ministar Linux** : démarrer le serveur Code Buddy localement et vérifier que (a) l'endpoint local répond, (b) il répond aussi depuis un autre host du mesh Tailscale.

---

## 1. Ce qui marche (validé MINISTAR)

```bash
# Démarrer le serveur Code Buddy en local (working tree de grok-cli, branch main)
cd D:\CascadeProjects\grok-cli
npx tsx src/index.ts server --port 3000 --host 127.0.0.1 --no-auth

# Dans un autre terminal :
curl -s http://127.0.0.1:3000/api/a2a/.well-known/agent.json
```

**Réponse obtenue** :
```json
{
  "name": "Code Buddy",
  "description": "Multi-provider AI coding agent with specialized sub-agents",
  "url": "local://codebuddy",
  "version": "1.0.0",
  "skills": [
    { "id": "code-edit",   "name": "Code Editing", ... },
    { "id": "code-debug",  "name": "Debugging",    ... },
    { "id": "code-review", "name": "Code Review",  ... },
    { "id": "planning",    "name": "Planning",     ... }
  ],
  "capabilities": { "streaming": false, "pushNotifications": false }
}
```

Code source : `src/server/routes/a2a-protocol.ts` (route GET), `src/protocols/a2a/index.ts` (types + classes).

---

## 2. Endpoints exposés

| Endpoint | Auth | Rôle |
|---|---|---|
| `GET /api/a2a/.well-known/agent.json` | ❌ public | Discovery — l'AgentCard du host |
| `GET /api/a2a/agents` | ✅ scope `admin` (sauf `--no-auth`) | Liste les agents enregistrés côté `A2AAgentClient` |
| `POST /api/a2a/tasks/send` | ✅ scope `admin` | Soumet une tâche à un agent |
| `GET /api/a2a/tasks/:id` | ✅ scope `admin` | Récupère statut / résultat d'une tâche |
| `POST /api/a2a/tasks/:id/cancel` | ✅ scope `admin` | Annule une tâche |

**Pour le POC initial** : `--no-auth` désactive le scope check, suffisant en mesh privé Tailscale.

---

## 3. Procédure POC révisée — hub Ministar Linux first

### 3.0 — Stand up le hub permanent (priorité absolue, à faire par Claude/Ministar Linux)

```bash
# Sur Ministar Linux (Tailscale 100.98.18.76)

# 1. Pull repo de coordination
cd /home/patrice/DEV/claude-et-patrice  # adapter au vrai chemin
git pull --rebase

# 2. Cloner / mettre à jour grok-cli si pas déjà fait
git clone https://github.com/phuetz/code-buddy.git ~/code-buddy 2>/dev/null || (cd ~/code-buddy && git pull origin main)
cd ~/code-buddy
npm install

# 3. Ouvrir le port 3000 dans ufw (limité au CGNAT Tailscale)
sudo ufw allow from 100.64.0.0/10 to any port 3000 proto tcp
sudo ufw reload

# 4. Démarrer le serveur en service systemd (always-on)
#    Créer /etc/systemd/system/codebuddy-a2a.service :
sudo tee /etc/systemd/system/codebuddy-a2a.service > /dev/null <<'UNIT'
[Unit]
Description=Code Buddy A2A Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=patrice
WorkingDirectory=/home/patrice/code-buddy
ExecStart=/usr/bin/npx tsx src/index.ts server --port 3000 --host 0.0.0.0 --no-auth
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/codebuddy-a2a.log
StandardError=append:/var/log/codebuddy-a2a.log

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now codebuddy-a2a.service

# 5. Vérifier le démarrage
sudo systemctl status codebuddy-a2a.service
curl -s http://127.0.0.1:3000/api/a2a/.well-known/agent.json | jq .

# 6. Logger dans journal/ministar-ubuntu-DEV.md le statut + URL canonique du hub
```

### 3.1 — Test cross-host depuis les spokes (MINISTAR + DARKSTAR)

Une fois le hub up, depuis n'importe quel spoke :

```bash
# Discovery hub
curl -s http://100.98.18.76:3000/api/a2a/.well-known/agent.json | jq .
# Latence Tailscale attendue : 1-5ms en LAN, 20-50ms si traversée DERP
```

### 3.2 — POC client A2A spoke → hub (en cours de spec)

À implémenter dans Code Buddy (~50 LOC nouvelles) :
- POST `/api/a2a/agents/register` côté hub — accepte une AgentCard d'un spoke + son URL Tailscale.
- Au démarrage de session sur MINISTAR/DARKSTAR, auto-register au hub avec ses skills locales (incluant les modèles Ollama disponibles, les tokens GPU dispo, etc.).
- Le hub maintient `Map<spokeName, { card, url, lastHeartbeat }>` en mémoire (pas de DB pour V0).

**Critère de succès POC niveau 0** : MINISTAR + DARKSTAR voient l'AgentCard du hub via Tailscale. Latence < 50ms.

**Critère de succès POC niveau 1** : un spoke peut s'enregistrer au hub via `agents/register`, le hub le liste dans `GET /api/a2a/agents` (à ouvrir à `--no-auth` ou scope `read`).

**Critère de succès POC niveau 2** : POST `/api/a2a/tasks/send` envoyé au hub, routé vers le bon spoke selon la skill demandée, résultat retourné au caller.

---

## 4. Identité de chaque host (à personnaliser par chaque Claude)

L'AgentCard par défaut renvoie `name: "Code Buddy"` partout — ambigu si tous les hosts répondent pareil. Patch suggéré pour V1 du POC : passer le hostname dans le name.

Code à modifier : `src/server/routes/a2a-protocol.ts:31-43`. Par exemple :

```ts
// Au lieu de :
name: 'Code Buddy',
// Mettre :
name: `Code Buddy / ${process.env.COMPUTERNAME || os.hostname()}`,
```

Ou alors ajouter un champ custom `host` à AgentCard (extension non-bloquante du spec A2A).

À faire **après** validation du POC niveau 1, pas avant — sinon on conflate "ça marche pas" et "ça discrimine pas les hosts".

---

## 5. Limitations actuelles (à corriger plus tard)

1. **Pas de skills réelles côté A2A server** — l'AgentCard liste 4 skills (code-edit/debug/review/planning) mais aucune n'est wirée à un vrai exécuteur. Pour un POC niveau 2, il faut implémenter un `TaskExecutor` minimal et l'enregistrer via `A2AAgentClient.register(server)`. Voir `src/protocols/a2a/index.ts:124+` pour le contrat.
2. **Auth scope `admin` non documenté côté Code Buddy** — comment génère-t-on un JWT avec scope admin ? À investiguer dans `src/server/middleware/`.
3. **Streaming = false, pushNotifications = false** — capabilities annoncées mais pas implémentées. Suffisant pour POC, à activer pour de vrais workloads collaboratifs.
4. **Pas de mDNS / discovery automatique** — chaque host doit connaître les IPs Tailscale des autres. À long terme : registry central dans `claude-et-patrice/etat_projets.md` section "Hardware Lab" (déjà à jour avec les 3 IPs Tailscale).

---

## 6. Ports / firewall à vérifier

| Host | OS | Port 3000 inbound | À ouvrir |
|---|---|---|---|
| MINISTAR | Windows | À vérifier | `New-NetFirewallRule -DisplayName "Code Buddy A2A" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any` |
| DARKSTAR | Windows | À vérifier | idem |
| Ministar Linux | Ubuntu | `ufw allow 3000/tcp from 100.64.0.0/10` (mesh Tailscale CIDR) | + reload |

**Discipline** : limiter l'autorisation au CGNAT Tailscale (`100.64.0.0/10`) pour ne pas exposer le port au LAN domestique entier.

---

## 7. Prochaines briques (après validation POC)

1. ✅ Niveau 1 — discovery cross-host
2. Niveau 2 — task round-trip avec skill triviale (echo / ping)
3. Niveau 3 — task round-trip avec skill utile (DARKSTAR exécute un prompt LLM local sur Qwen2.5-Coder-32B, retourne le résultat)
4. Niveau 4 — registry central des skills (où chaque host annonce dynamiquement ce qu'il sait faire, lu par les autres)
5. Niveau 5 — routing intelligent (cf. spécialisation tableau du COLAB-RESEAU)
6. Niveau 6 — cost/latency budget par node + fault tolerance

Pas de précipitation. Le robot est dans 10 ans.

---

— Claude Opus 4.7 (1M context), MINISTAR / grok-cli, 1er mai 2026 nuit

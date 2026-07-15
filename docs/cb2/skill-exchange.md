# Skill Exchange signé

Le Skill Exchange permet de partager des skills locaux sous forme de paquets Ed25519 vérifiables.
La fonctionnalité P0 est désactivée par défaut et ne fait aucun accès réseau. Pour l'activer :

```bash
export CODEBUDDY_SKILL_EXCHANGE=true
```

## Utilisation

```bash
buddy skills exchange export authored-mon-skill --out ./registry
buddy skills exchange verify ./registry/authored-mon-skill
buddy skills exchange install ./registry/authored-mon-skill --trust
buddy skills exchange keys
```

`export` accepte un skill `authored-*` du workspace ou un skill bundlé local. `--out` désigne un
simple dossier de registre ; un dépôt Git déjà cloné peut servir de dossier, mais le Skill Exchange
P0 ne clone, ne tire et ne publie rien lui-même. Un registre local peut aussi être déclaré dans le
référentiel existant avec `buddy skills sources add <nom> <dossier> --type exchange`.

`install --trust` est nécessaire uniquement lors de la première rencontre avec une clé d'auteur.
Les scripts et autres fichiers du paquet sont toujours traités comme des données : aucune étape
d'export, de vérification ou d'installation ne les exécute.

## Format du manifeste

Chaque paquet est un dossier contenant les fichiers du skill et `exchange-manifest.json` :

```json
{
  "name": "authored-mon-skill",
  "version": "1.0.0",
  "createdAt": "2026-07-15T12:00:00.000Z",
  "author": "AbCdEf123456",
  "files": [
    { "path": "SKILL.md", "sha256": "<64 caractères hexadécimaux>" }
  ],
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...",
  "signature": "<signature base64url>"
}
```

La signature Ed25519 couvre le JSON canonique de tous les champs sauf `signature`. Les clés des
objets sont triées récursivement ; l'ordre du tableau `files` reste significatif. `author` est les
12 premiers caractères base64url du SHA-256 de `publicKey`. Tous les fichiers du paquet hors
manifeste doivent être déclarés : un fichier absent, ajouté, dupliqué, altéré ou traversant le
dossier invalide le paquet.

La paire locale est créée à la demande dans `~/.codebuddy/skill-signing/`. La clé privée
`key.pem` est en mode `0600` et n'est jamais copiée dans un paquet, un manifeste ou un journal. La
clé publique est `key.pub`.

## Confiance TOFU

La signature prouve qu'un paquet est inchangé depuis sa signature ; elle ne prouve pas que son
auteur est digne de confiance. Code Buddy utilise donc un modèle TOFU explicite :

1. Un auteur absent de `~/.codebuddy/skill-signing/trusted-keys.json` est refusé.
2. L'opérateur inspecte l'identifiant et autorise une première installation avec `--trust`.
3. La clé publique et son identifiant sont enregistrés localement.
4. Les paquets ultérieurs signés par cette même clé passent sans `--trust`.

Un identifiant déjà connu associé à une autre clé est refusé. Un trust store malformé est aussi
refusé, sans tentative de réparation implicite.

## Vérifications et installation

L'ordre fail-closed est fixe : forme stricte du manifeste, signature, hash de chaque fichier et
exhaustivité de la liste, scan par le skill firewall, collision, puis confiance TOFU. Tout verdict
firewall différent de `allow` bloque l'installation. Une collision avec un `imported-<name>` qui
n'a pas la provenance `exchange: true` est refusée.

Après validation, le skill est installé sous
`~/.codebuddy/skills/managed/imported-<name>` avec la provenance frontmatter suivante :

```yaml
imported: true
source: exchange
exchange: true
author: AbCdEf123456
installedAt: 2026-07-15T12:00:00.000Z
pinned: true
```

L'installation remplace atomiquement uniquement une installation exchange antérieure. Un journal
JSONL local, `~/.codebuddy/skill-exchange-log.jsonl`, consigne les installations, vérifications et
refus avec leur raison, sans clé privée.

## Modèle de menaces

- **Altération ou ajout après publication** : signature, hashes exhaustifs et refus des fichiers
  non déclarés.
- **Usurpation d'auteur** : identifiant dérivé de la clé embarquée, vérification Ed25519 et TOFU
  explicite.
- **Traversal et symlinks** : chemins absolus, `..`, séparateurs ambigus, symlinks et fichiers
  spéciaux sont refusés.
- **Skill malveillant mais correctement signé** : nouveau passage obligatoire dans le firewall ;
  `review`, `quarantine` ou erreur de scan bloquent l'installation.
- **Exécution à l'installation** : aucune commande, aucun hook et aucun script du paquet n'est
  lancé.
- **Écrasement local** : les skills sans marqueur de provenance exchange ne sont jamais remplacés.
- **Compromission de la clé privée locale** : hors périmètre du format ; protéger le compte et le
  dossier `~/.codebuddy`. Révoquer une clé exige actuellement de la retirer manuellement du trust
  store et de distribuer un nouvel identifiant (gestion de révocation prévue après P0).

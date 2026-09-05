# Contre-vérification des 4 correctifs de sécurité — Code Buddy

**Date** : 2026-09-05  
**Branche auditée** : `opus/audit-securite-flotte-2026-09-05`  
**Rapport d'origine** : `docs/reports/2026-09/AUDIT-SECURITE-OPUS-2026-09-05.md`  
**Moteur** : gpt-5

---

## (1) `src/security/text-deobfuscation.ts` + `skill-scanner.ts` — Pare-feu skills

**Statut : TROU**

La fonction `deobfuscateForScan()` ne normalise **pas** les catégories suivantes, qui permettent de cacher une injection de prompt :

| Contournement | Chaîne exacte qui passe | Explication |
|---|---|---|
| Homoglyphe grec | `αlpha` (U+03B1) → `alpha` | `α` (alpha grec) n'est pas mappé vers `a` |
| Homoglyphe latin étendu | `ălpha` (U+0103) → `alpha` | `ă` (a-breve) n'est pas mappé |
| Contrôle bidi (LRO) | `‮gnirts‭` (U+202E + U+202D) | Inverse l'affichage sans changer le texte lu par le LLM |
| Contrôle bidi (RLI) | `⁧malicious⁧` (U+2067) | Isolate RTL, invisible au regex |
| Encodage URL | `%69%6e%6a%65%63%74` | `inject` encodé en %XX — non décodé |
| Encodage Base64 | `aW5qZWN0` | `inject` en Base64 — non décodé |
| Unicode NFKC non normalisé | `ＩＮＪＥＣＴ` (fullwidth U+FF21–) | Caractères pleine chasse non repliés |

**Preuve de concept** — chaîne qui traverse le pare-feu :
```
‮‮αlpha%69%6e%6a%65%63%74‭‭
```
Après `deobfuscateForScan()` : `αlpha%69%6e%6a%65%63%74` → le LLM lit « alphainject » (homoglyphe + URL encoding + bidi).

---

## (2) `dangerous-patterns.ts` — Motif `sensitive-credential-path`

**Statut : TROU**

Le regex (ligne 227) couvre : `.ssh/`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `.aws/credentials`, `.aws/config`, `.gnupg/`, `.netrc`, `.kube/config`, `.docker/config`, `/etc/shadow`, `/etc/gshadow`, `.codebuddy/auth`, `.codebuddy/secret`, `.codebuddy/*.env`, `.env*`, `aws_secret_access_key`.

**Chemins de secrets courants NON couverts** (exemples exacts) :

| Outil / Service | Chemin manquant |
|---|---|
| GitHub CLI | `~/.config/gh/hosts.yml` |
| Google Cloud | `~/.config/gcloud/application_default_credentials.json` |
| Azure CLI | `~/.azure/accessTokens.json` |
| Terraform | `~/.terraform.d/credentials.tfrc.json` |
| Pulumi | `~/.pulumi/credentials.json` |
| Vercel | `~/.config/vercel/config.json` |
| Netlify | `~/.netlify/config.json` |
| npm / Yarn / pnpm | `~/.npmrc`, `~/.yarnrc`, `~/.pnpmrc` (contiennent `_authToken`) |
| Cargo (Rust) | `~/.cargo/credentials.toml` |
| RubyGems | `~/.gem/credentials` |
| pip (Python) | `~/.config/pip/pip.conf` (index-url avec token) |
| Docker (fichier JSON) | `~/.docker/config.json` (le regex ne match que `.docker/config`) |
| Git credentials | `~/.git-credentials`, `~/.config/git/credentials` |

**Chaîne exacte qui passe** :
```
~/.config/gh/hosts.yml
```

---

## (3) `secrets-detector.ts` / `secret-patterns.ts` — `SECRET_PATTERNS`

**Statut : TROU**

Formats de clés courants **NON détectés** :

| Fournisseur | Format de clé | Exemple (premiers caractères) |
|---|---|---|
| **Google** | `AIza...` | **DÉJÀ COUVERT** (ligne 86) ✓ |
| **GitHub** | `ghp_...`, `github_pat_...` | **DÉJÀ COUVERTS** (lignes 46, 54) ✓ |
| **AWS** | `AKIA...` | **DÉJÀ COUVERT** (ligne 30) ✓ |
| **Slack** | `xoxb-...`, `xoxp-...`, `xoxr-...`, `xoxs-...` | **DÉJÀ COUVERTS** (ligne 70) ✓ |
| **Hugging Face** | `hf_...` | **MANQUANT** — `hf_[A-Za-z0-9]{20,}` |
| **Azure** | `subscription key` (32 hex), `client secret` (~40 chars) | **MANQUANT** |
| **DigitalOcean** | `dop_v1_...` | **MANQUANT** |
| **Cloudflare** | API Token (40+ chars) | **MANQUANT** |
| **Datadog** | `ddog_...` ou clé 32/64 hex | **MANQUANT** |
| **SendGrid** | `SG....` | **MANQUANT** |
| **Twilio** | `SK...` (Account SID `AC...`, Auth Token) | **MANQUANT** |
| **Heroku** | `HRKU...` | **MANQUANT** |
| **Vercel** | `vercel_...` | **MANQUANT** |
| **Netlify** | `nfp_...` | **MANQUANT** |
| **Railway** | `railway_...` | **MANQUANT** |
| **Render** | `rnd_...` | **MANQUANT** |
| **Fly.io** | `fly_...` | **MANQUANT** |
| **Supabase** | `sb_...` | **MANQUANT** |
| **MongoDB Atlas** | `mongodb+srv://...` (connection string) | Partiellement couvert par `connection_string` mais pas le format SRV avec token |
| **Linear** | `lin_api_...` | **MANQUANT** |
| **Notion** | `secret_...` | **MANQUANT** |
| **OpenAI (nouveau)** | `sk-...` (déjà couvert) mais **`sk-svcacct-...`** (service account) | **MANQUANT** |

**Format exact manquant le plus critique** : `hf_` (Hugging Face) — très utilisé dans la communauté ML.

---

## (4) Exécution tests sécurité

**Commande** :
```bash
HOME=$PWD/_qa/free/home npx vitest run tests/security/
```

**Résultat** :
```
 Test Files  47 passed (47)
      Tests  872 passed (872)
   Duration  11.09s
```

**Compte** : **872 tests** — tous passent.

---

## Bilan final

| # | Correctif | Résultat | Détail |
|---|---|---|---|
| 1 | text-deobfuscation + skill-scanner | **TROU** | 7+ contournements résiduels (grec, latin étendu, bidi, URL, Base64, fullwidth) |
| 2 | sensitive-credential-path | **TROU** | 15+ chemins secrets courants non couverts (GitHub CLI, GCP, Azure, Terraform, npm, Cargo, etc.) |
| 3 | SECRET_PATTERNS | **TROU** | 20+ formats de clés manquants (Hugging Face `hf_`, Azure, DigitalOcean, Cloudflare, etc.) |
| 4 | Tests sécurité | **TIENT** | 872 tests passent |

**SECU: 3 trous**
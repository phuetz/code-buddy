/**
 * Garde-fou : ce dépôt est PUBLIC, la situation personnelle de son auteur n'y entre pas.
 *
 * `phuetz/code-buddy` est ouvert et sert de carte de visite. Le 25/08/2026, 31 fichiers
 * non poussés y nommaient l'indemnisation chômage, le cumul ARE et le client public de
 * l'auteur — dans le code, les README, la documentation, et jusque dans les fixtures de
 * tests, où « France Travail » servait de sujet d'essai. Rien n'était encore poussé ;
 * un push l'aurait rendu définitif, un commit ultérieur n'effaçant pas l'historique.
 *
 * Une consigne se perd. Un test échoue. C'est pourquoi cette règle est écrite ici plutôt
 * que dans un document que personne ne relira.
 *
 * Le mécanisme d'exclusion éditoriale reste, lui, parfaitement légitime : un créateur ne
 * traite pas les sujets où il est partie prenante. C'est la LISTE qui n'a pas sa place
 * dans un dépôt public, puisqu'elle dit exactement ce qu'elle sert à taire. Elle vit dans
 * `INFLUENCER_EXCLUDED_TOPICS` (voir `scripts/influencer/editorial_policy.py`).
 *
 * Pour un test qui a besoin d'un sujet écarté, utiliser un témoin neutre — « organisme
 * témoin » — et poser la politique dans le test lui-même.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const RACINE = join(__dirname, '..', '..');

/** Ce qui identifie la situation personnelle ou l'infrastructure privée de l'auteur. */
const CHEMIN_HOME_AUTEUR = ['/', 'home', '/', 'pat', 'rice'].join('');
const CHEMIN_USERS_WIN = ['c:/users/', 'patri'].join('');
const CHEMIN_USERS_WIN_BSLASH = ['c:\\users\\', 'patri'].join('');
const DEPOT_PASSATION = ['claude', '-et-', 'patrice'].join('');
const MOTEUR_EXPLORER_PRIVE = ['gitnexus', '-rs'].join('');
const OUTIL_EDITORIAL_PRIVE = ['pub', 'commander'].join('');
const MACHINE_AUTEUR = ['minis', 'tar'].join('');

/**
 * PRIV2 — motifs à forme variable, qu'une simple sous-chaîne ne peut pas décrire.
 *
 * Les octets sont assemblés par concaténation : ce fichier ne doit pas contenir
 * lui-même une adresse privée écrite en clair.
 */
const OCTET = ['(?:25[0-5]', '2[0-4]\\d', '1\\d\\d', '[1-9]?\\d)'].join('|');
const AVANT = '(?<![\\w.])';
const APRES = '(?![\\w.])';

/** RFC 1918 /16 — le LAN domestique. `127.0.0.1` n'appartient à aucune de ces plages. */
const RE_IP_LAN_16 = new RegExp(
  AVANT + ['192', '168'].join('\\.') + '\\.' + OCTET + '\\.' + OCTET + APRES,
);
/** RFC 1918 /8. Quatre octets exigés : un numéro de version `10.2.3` ne matche pas. */
const RE_IP_LAN_8 = new RegExp(
  AVANT + '10\\.' + OCTET + '\\.' + OCTET + '\\.' + OCTET + APRES,
);
/** RFC 6598 100.64.0.0/10 — l'espace partagé qu'utilisent les réseaux maillés. */
const RE_IP_MAILLEE = new RegExp(
  AVANT + '100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.' + OCTET + '\\.' + OCTET + APRES,
);
/**
 * Identifiant de projet du service vidéo tiers écrit en dur. On n'interdit pas
 * tout UUID (le dépôt en contient légitimement) mais l'UUID posé DANS un contexte
 * de projet Flow : une URL de projet, ou l'affectation de la constante.
 */
const RE_UUID_PROJET_FLOW = new RegExp(
  '(?:' + ['flow', 'project'].join('\\/') + '\\/|' +
    ['FLOW', '_PROJECT', '_ID'].join('') + '\\s*[=:]\\s*[\'"])' +
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  'i',
);

/**
 * Fichiers où une adresse privée est le SUJET : ils prouvent qu'une adresse de
 * plage privée est refusée (SSRF, origines de développement, boucle locale,
 * proxys de confiance) ou définissent ces plages. Une adresse de documentation
 * RFC 5737 est PUBLIQUE : l'y substituer inverserait l'assertion et détruirait
 * le pouvoir de détection. La liste est CLOSE — un fichier neuf portant une
 * adresse privée rougit et impose une décision consciente.
 */
const FICHIERS_PLAGES_PRIVEES = new Set([
  // Définitions de plages
  'src/security/ssrf-guard.ts',
  'scripts/gpuNode/generate-krea2-identity-dataset.ts',
  // Faux positif assumé : numéro de version d'un moteur JS à quatre segments
  'tests/unit/performance-benchmarks.test.ts',
  // Tests dont l'objet est le refus / la classification d'une adresse privée
  'cowork/tests/session-intelligence.test.ts',
  'tests/bash/command-validator-security-regression.test.ts',
  'tests/browser-automation/navigate-ssrf.test.ts',
  'tests/channels/webchat.test.ts',
  'tests/cognition/voice-specialists.test.ts',
  'tests/config/config-resolver.test.ts',
  'tests/daemon/autonomy-bench-candidates.test.ts',
  'tests/features/tailscale-dashboard-nodes.test.ts',
  'tests/fleet/capability-registry.test.ts',
  'tests/gateway/tls-pairing.test.ts',
  'tests/media/comfy-health-supervisor.test.ts',
  'tests/providers/active-llm-model-pool.test.ts',
  'tests/providers/turboquant-provider.test.ts',
  'tests/scripts/gpuNode/generate-krea2-identity-dataset.test.ts',
  'tests/security/dev-origins.test.ts',
  'tests/security/gk21-dev-origins-loud.test.ts',
  'tests/security/security-audit.test.ts',
  'tests/sensory/gk20-rules-contracts.test.ts',
  'tests/sensory/webhook-ssrf.test.ts',
  'tests/server/anonymous-tools-local-only.test.ts',
  'tests/server/exposure-diagnostic.test.ts',
  'tests/server/mobile.test.ts',
  'tests/tools/app-server-real.test.ts',
  'tests/tools/bash-tool.test.ts',
  'tests/tools/camera-analyze.test.ts',
  'tests/tools/gpu-media-worker.test.ts',
  'tests/unit/browser-tool.test.ts',
  'tests/unit/device-transports.test.ts',
  'tests/unit/rest-server.test.ts',
  'tests/unit/ws-origin-hardening.test.ts',
]);

const MOTIFS_REGEX = [
  { nom: 'ip-lan-16', regex: RE_IP_LAN_16, exempte: FICHIERS_PLAGES_PRIVEES },
  { nom: 'ip-lan-8', regex: RE_IP_LAN_8, exempte: FICHIERS_PLAGES_PRIVEES },
  { nom: 'ip-maillee', regex: RE_IP_MAILLEE, exempte: FICHIERS_PLAGES_PRIVEES },
  { nom: 'uuid-projet-video', regex: RE_UUID_PROJET_FLOW, exempte: new Set<string>() },
] as const;

const INTERDITS = [
  'france travail',
  'pôle emploi',
  'pole emploi',
  'assurance chômage',
  'assurance chomage',
  'cumul are',
  'prestataire de la ccas',
  'demandeur d\'emploi',
  ['100', '73', ''].join('.'),
  ['dark', 'star'].join(''),
  CHEMIN_HOME_AUTEUR,
  CHEMIN_USERS_WIN,
  CHEMIN_USERS_WIN_BSLASH,
  DEPOT_PASSATION,
  MOTEUR_EXPLORER_PRIVE,
  OUTIL_EDITORIAL_PRIVE,
  MACHINE_AUTEUR,
];

/** Ce fichier cite forcément les termes : c'est son objet. CHANGELOG est relu à la main. */
const EXEMPTS = new Set(['CHANGELOG.md', 'tests/security/donnees-personnelles.test.ts']);

/**
 * L'outil éditorial tiers est un pont MCP du produit : identifiant de serveur,
 * skill bundlée, CLI `campaign`. On ne peut pas renommer ces fichiers (lanes en vol).
 * Le terme reste interdit partout ailleurs — docs, rapports, chemins de home.
 */
const FICHIERS_PONT_EDITORIAL = new Set([
  '.codebuddy/mcp.json',
  'src/commands/campaign.ts',
  'src/index.ts',
  'cowork/src/main/mcp/codebuddy-mcp-import.ts',
  'cowork/tests/agentbase-panel.test.tsx',
  'cowork/tests/codebuddy-mcp-import.test.ts',
  'tests/commands/campaign.test.ts',
  'tests/commands/skills-list-bundled-hint.test.ts',
  'tests/mcp/profiles.test.ts',
  'tests/mcp/prompt-footprint.test.ts',
  'tests/skills/bundled-skills-loading.test.ts',
  'tests/unit/mcp.test.ts',
]);

function termeApplicable(fichier: string, terme: string): boolean {
  if (terme !== OUTIL_EDITORIAL_PRIVE) return true;
  if (fichier.toLowerCase().includes(OUTIL_EDITORIAL_PRIVE)) return false;
  if (FICHIERS_PONT_EDITORIAL.has(fichier)) return false;
  return true;
}

function detecterMotifsInterdits(fichier: string, contenu: string): string[] {
  const trouves = INTERDITS.filter(
    (terme) => termeApplicable(fichier, terme) && contenu.toLowerCase().includes(terme),
  );
  const cheminNormalise = fichier.toLowerCase();
  for (const terme of INTERDITS) {
    if (!termeApplicable(fichier, terme)) continue;
    if (cheminNormalise.includes(terme) && !trouves.includes(terme)) {
      trouves.push(terme);
    }
  }
  for (const { nom, regex, exempte } of MOTIFS_REGEX) {
    if (exempte.has(fichier)) continue;
    if (regex.test(contenu)) trouves.push(nom);
  }
  return trouves;
}

const DETECTION_FIXTURES = [
  {
    nom: 'chemin home auteur',
    fichier: ['fixtures/', 'home-author', '.md'].join(''),
    contenu: ['témoin : ', ['/', 'home', '/', 'pat', 'rice'].join('')].join(''),
    motif: ['/', 'home', '/', 'pat', 'rice'].join(''),
  },
  {
    nom: 'chemin Windows avec slash',
    fichier: ['fixtures/', 'windows-forward', '.md'].join(''),
    contenu: ['témoin : ', ['c:/users/', 'patri'].join('')].join(''),
    motif: ['c:/users/', 'patri'].join(''),
  },
  {
    nom: 'chemin Windows avec antislash',
    fichier: ['fixtures/', 'windows-backslash', '.md'].join(''),
    contenu: ['témoin : ', ['c:', '\\', 'users', '\\', 'patri'].join('')].join(''),
    motif: ['c:', '\\', 'users', '\\', 'patri'].join(''),
  },
  {
    nom: 'dépôt privé de passation',
    fichier: ['fixtures/', 'handoff-repository', '.md'].join(''),
    contenu: ['témoin : ', ['claude', '-et-', 'patrice'].join('')].join(''),
    motif: ['claude', '-et-', 'patrice'].join(''),
  },
  {
    nom: 'ancien moteur d’exploration privé',
    fichier: ['fixtures/', 'old-explorer', '.md'].join(''),
    contenu: ['témoin : ', ['gitnexus', '-rs'].join('')].join(''),
    motif: ['gitnexus', '-rs'].join(''),
  },
  {
    nom: 'outil éditorial hors pont MCP',
    fichier: ['fixtures/', 'editorial-outside-mcp-bridge', '.md'].join(''),
    contenu: ['témoin : ', ['pub', 'commander'].join('')].join(''),
    motif: ['pub', 'commander'].join(''),
  },
  {
    nom: 'nom de la machine de l’auteur',
    fichier: ['fixtures/', 'author-host', '.md'].join(''),
    contenu: ['témoin : ', ['minis', 'tar'].join(''), '-linux'].join(''),
    motif: ['minis', 'tar'].join(''),
  },
  {
    nom: 'adresse privée RFC 1918 /16',
    fichier: ['fixtures/', 'private-ip-16', '.md'].join(''),
    contenu: ['témoin : http://', ['192', '168', '7', '9'].join('.'), ':445/'].join(''),
    motif: 'ip-lan-16',
  },
  {
    nom: 'adresse privée RFC 1918 /8',
    fichier: ['fixtures/', 'private-ip-8', '.md'].join(''),
    contenu: ['témoin : http://', ['10', '3', '7', '9'].join('.'), ':8080/'].join(''),
    motif: 'ip-lan-8',
  },
  {
    nom: 'adresse de réseau maillé RFC 6598',
    fichier: ['fixtures/', 'mesh-ip', '.md'].join(''),
    contenu: ['témoin : ws://', ['100', '77', '5', '9'].join('.'), ':3000/ws'].join(''),
    motif: 'ip-maillee',
  },
  {
    nom: 'identifiant de projet vidéo en dur',
    fichier: ['fixtures/', 'video-project-id', '.md'].join(''),
    contenu: [
      'témoin : https://labs.google/fx/fr/tools/',
      ['flow', 'project'].join('/'),
      '/',
      '1f2e3d4c-5b6a-4798-8765-0a1b2c3d4e5f',
    ].join(''),
    motif: 'uuid-projet-video',
  },
] as const;

/**
 * Contre-épreuves : ce qui NE doit PAS rougir. Sans elles, un motif trop large
 * (la boucle locale, une adresse de documentation, un numéro de version) ferait
 * du garde-fou une alarme qu'on finirait par désarmer.
 */
const NON_DETECTIONS = [
  { nom: 'boucle locale', contenu: ['http://', ['127', '0', '0', '1'].join('.'), ':3000'].join('') },
  { nom: 'adresse de documentation RFC 5737 (TEST-NET-3)', contenu: ['ws://', ['203', '0', '113', '10'].join('.'), ':3000/ws'].join('') },
  { nom: 'adresse de documentation RFC 5737 (TEST-NET-2)', contenu: ['http://', ['198', '51', '100', '20'].join('.'), ':8080'].join('') },
  { nom: 'numéro de version à trois segments', contenu: ['"autoprefixer": "^', ['10', '5', '4'].join('.'), '"'].join('') },
  { nom: 'plage maillée hors 64-127', contenu: ['http://', ['100', '12', '0', '1'].join('.')].join('') },
  { nom: 'UUID hors contexte de projet vidéo', contenu: 'id: f65b8e2d-83ca-4b26-8bc2-b21ece813c4b' },
] as const;

function fichiersSuivis(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: RACINE, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXEMPTS.has(f))
    // Artefacts de compilation suivis par erreur : pas du texte à assainir ici.
    .filter((f) => !f.startsWith('src-sidecar/target/'))
    // Les binaires n'ont pas de texte à inspecter, et leur lecture coûterait cher.
    .filter((f) => !/\.(png|jpe?g|gif|mp[34]|wav|webm|mov|pdf|zip|woff2?|ico|onnx|bin|rlib|rmeta)$/i.test(f));
}

describe('aucune donnée personnelle dans un dépôt public', () => {
  it.each(DETECTION_FIXTURES)('détecte isolément le motif : $nom', ({ fichier, contenu, motif }) => {
    expect(detecterMotifsInterdits(fichier, contenu)).toEqual([motif]);
  });

  it.each(NON_DETECTIONS)('ne rougit pas sur : $nom', ({ contenu }) => {
    expect(detecterMotifsInterdits(['fixtures/', 'neutral', '.md'].join(''), contenu)).toEqual([]);
  });

  it('aucun fichier suivi ne nomme la situation ou l’infrastructure privée de l’auteur', () => {
    const fautifs: string[] = [];

    for (const fichier of fichiersSuivis()) {
      let contenu: string;
      try {
        contenu = readFileSync(join(RACINE, fichier), 'utf8').toLowerCase();
      } catch {
        continue; // fichier supprimé ou illisible : rien à inspecter
      }
      const trouves = detecterMotifsInterdits(fichier, contenu);
      if (trouves.length > 0) {
        fautifs.push(`${fichier} → ${trouves.join(', ')}`);
      }
    }

    expect(
      fautifs,
      'Ce dépôt est public. Ces termes désignent la situation ou l’infrastructure privée de son auteur et ' +
        'ne doivent pas y figurer — pas même comme sujet d’essai dans un test.\n' +
        'Pour un test : utiliser « organisme témoin » et poser INFLUENCER_EXCLUDED_TOPICS ' +
        'dans le test lui-même.\n' +
        'Pour un document de travail : le dépôt privé de passation, hors de ce dépôt public.\n\n' +
        fautifs.join('\n'),
    ).toEqual([]);
  });
});

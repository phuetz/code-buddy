/**
 * Isolation du HOME pour chaque fichier de test (incident du 24/09/2026).
 *
 * Lancée sur un poste réel, `tests/commands/` a effacé `~/.codebuddy/codex-auth.json`
 * (via `/logout`) et créé des fichiers dans le vrai profil : de nombreux modules figent
 * `path.join(os.homedir(), '.codebuddy', …)` à leur chargement, et la configuration
 * n'isolait que `CODEBUDDY_HOME`. Ce fichier est le PREMIER `setupFiles` : il s'exécute
 * dans chaque worker avant tout import du fichier de test, donc avant que ces chemins
 * ne soient figés.
 *
 * - `HOME`, `USERPROFILE` (et `HOMEDRIVE`/`HOMEPATH`, `APPDATA` sous Windows) et les
 *   `XDG_*_HOME` pointent sur un dossier jetable propre au fichier de test ; les
 *   processus enfants en héritent. `LOCALAPPDATA` reste intact (Git Bash, caches).
 * - `CODEBUDDY_HOME` : jetable par fichier, sauf valeur explicite de l'appelant (qui
 *   ne doit pas recouvrir le vrai profil).
 * - Les navigateurs Playwright restent trouvés : `PLAYWRIGHT_BROWSERS_PATH` est fixé
 *   sur l'emplacement par défaut de l'appelant avant la bascule.
 * - Garde : avant chaque test, `os.homedir()` ne doit ni valoir le HOME appelant (ou
 *   celui du compte) ni tomber dans son `.codebuddy` ; sinon le test échoue avec un
 *   message explicite. Les chemins sont comparés après `realpath` natif de l'ancêtre
 *   existant le plus proche (liens macOS, noms courts 8.3 Windows) et sans casse sous
 *   Windows (fonctions pures dans `home-isolation-paths.ts`).
 * - Les HOME jetables vivent sous un parent créé et supprimé par
 *   `tests/setup/home-isolation-global.ts`, après l'arrêt des workers.
 *
 * Ce n'est pas une frontière de sécurité : un test peut encore viser un chemin absolu
 * écrit en dur. Les suites risquées se lancent dans un bac à sable.
 *
 * Les tests qui fixent eux-mêmes HOME (`vi.stubEnv`, `createIsolatedHome`) gardent la
 * main : ils s'exécutent après ce fichier et restaurent la valeur jetable.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach } from 'vitest';
import { callerPlaywrightBrowsersPath, canonicalPath, isSameOrInside, isolatedHomeEnv } from './home-isolation-paths.js';

export { callerPlaywrightBrowsersPath, canonicalPath, isSameOrInside, isolatedHomeEnv };

/** HOME du processus qui a lancé Vitest, mémorisé une fois pour tous les fichiers. */
export const CALLER_HOME_ENV = 'CODEBUDDY_VITEST_CALLER_HOME';
/** Marque un `CODEBUDDY_HOME` posé par ce setup (et donc à renouveler par fichier). */
const OWNED_PROFILE_ENV = 'CODEBUDDY_VITEST_OWNS_CODEBUDDY_HOME';

// Référence capturée avant tout `vi.spyOn(os, 'homedir')` d'un test.
const realHomedir = os.homedir.bind(os);

function accountHome(): string | undefined {
  try {
    return os.userInfo().homedir || undefined;
  } catch {
    return undefined;
  }
}

const callerHome = process.env[CALLER_HOME_ENV]?.trim() || realHomedir();
process.env[CALLER_HOME_ENV] = callerHome;
const protectedHomes = [callerHome, accountHome()].filter((h): h is string => Boolean(h));
const realProfile = path.join(callerHome, '.codebuddy');

const playwrightPath = callerPlaywrightBrowsersPath(process.env, callerHome);
if (playwrightPath) process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightPath;

function refuse(reason: string): never {
  throw new Error(`garde Vitest (HOME isolé) : ${reason}`);
}

// Parent commun créé et supprimé par le globalSetup (home-isolation-global.ts) une fois les workers
// arrêtés : un `afterAll` supprimerait le HOME sous des écritures différées encore en vol (mesuré :
// tests/commands/team-session-handler.test.ts). Sans globalSetup, repli sur TMPDIR, sans nettoyage.
// HOME n'est jamais restauré : un minuteur tardif écrirait sinon dans le HOME appelant.
const inheritedParent = process.env.CODEBUDDY_VITEST_HOME_PARENT;
const parent = inheritedParent && fs.existsSync(inheritedParent) ? inheritedParent : os.tmpdir();
// Préfixe conservé depuis l'isolation P0 du 22/09 (tests/utils/vitest-guard-blank-2026-09-23.test.ts).
const root = fs.mkdtempSync(path.join(parent, 'codebuddy-vitest-home-'));
for (const protectedHome of protectedHomes) {
  // Un dossier jetable SOUS le HOME (TEMP Windows dans AppData\Local) est admis ; il ne doit
  // ni le contenir ni tomber dans le vrai profil.
  if (isSameOrInside(protectedHome, root)) refuse(`le dossier jetable ${root} contient le HOME ${protectedHome}`);
  if (isSameOrInside(root, path.join(protectedHome, '.codebuddy'))) {
    refuse(`le dossier jetable ${root} est dans le profil réel`);
  }
}
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });
// Identité git neutre : sans elle, un commit de test dépendrait du ~/.gitconfig de l'appelant.
fs.writeFileSync(
  path.join(home, '.gitconfig'),
  '[user]\n\tname = Code Buddy Tests\n\temail = tests@example.invalid\n[commit]\n\tgpgsign = false\n',
);
Object.assign(process.env, isolatedHomeEnv(home));

const callerProfile = process.env[OWNED_PROFILE_ENV] ? undefined : process.env.CODEBUDDY_HOME?.trim();
if (callerProfile) {
  if (isSameOrInside(callerProfile, realProfile) || isSameOrInside(realProfile, callerProfile)) {
    refuse(`CODEBUDDY_HOME=${callerProfile} recouvre le profil réel ${realProfile}`);
  }
} else {
  const profile = path.join(root, 'codebuddy-home');
  fs.mkdirSync(profile, { recursive: true });
  process.env.CODEBUDDY_HOME = profile;
  process.env[OWNED_PROFILE_ENV] = '1';
}

/** HOME réel que rend `os.homedir()`, ou undefined. Sous Windows le jetable est souvent SOUS
 * le HOME (TEMP dans AppData\\Local) : seule l'égalité compte, plus l'entrée dans le vrai profil. */
function leakedHome(current: string): string | undefined {
  const same = protectedHomes.find((h) => canonicalPath(current) === canonicalPath(h));
  if (same) return same;
  return isSameOrInside(current, realProfile) ? realProfile : undefined;
}

if (leakedHome(realHomedir())) {
  refuse(`os.homedir() vaut encore ${realHomedir()} après la bascule (plateforme ${process.platform})`);
}

beforeEach(() => {
  const current = realHomedir();
  const leaked = leakedHome(current);
  if (leaked) {
    refuse(
      `os.homedir() vaut ${current} au début du test, c'est-à-dire le HOME réel ${leaked}. ` +
        'Un test ne doit jamais rendre le HOME appelant ; utiliser vi.stubEnv ou createIsolatedHome.',
    );
  }
});

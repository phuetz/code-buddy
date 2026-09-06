/**
 * Forge a signed exchange package mutation for adversarial tests.
 *   rehash-sign <packageDir>     recompute sha256 + re-sign with local key
 *   swap-key <packageDir> <otherPubPemFile>   embed another public key, keep old signature
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  EXCHANGE_MANIFEST_FILE,
  type ExchangeManifest,
} from '../../src/skills/skill-exchange.js';
import {
  getPublicKey,
  getPublicKeyId,
  signManifest,
} from '../../src/skills/skill-signing.js';

const [mode, packageDir, extra] = process.argv.slice(2);
if (!mode || !packageDir) {
  console.error('usage: forge-package.ts rehash-sign <dir> | swap-key <dir> <other.pub>');
  process.exit(2);
}

const manifestPath = path.join(packageDir, EXCHANGE_MANIFEST_FILE);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExchangeManifest;

if (mode === 'rehash-sign') {
  for (const file of manifest.files) {
    const abs = path.join(packageDir, ...file.path.split('/'));
    file.sha256 = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  }
  const unsigned = {
    name: manifest.name,
    version: manifest.version,
    createdAt: manifest.createdAt,
    author: getPublicKeyId(),
    files: manifest.files,
    publicKey: getPublicKey(),
  };
  const signed: ExchangeManifest = { ...unsigned, signature: signManifest(unsigned) };
  fs.writeFileSync(manifestPath, `${JSON.stringify(signed, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, author: signed.author, files: signed.files.length }, null, 2));
} else if (mode === 'swap-key') {
  if (!extra) {
    console.error('swap-key needs other public key file');
    process.exit(2);
  }
  const otherPub = fs.readFileSync(extra, 'utf-8');
  const { publicKeyId } = await import('../../src/skills/skill-signing.js');
  manifest.publicKey = otherPub;
  manifest.author = publicKeyId(otherPub);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, author: manifest.author, note: 'signature left intact' }, null, 2));
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}

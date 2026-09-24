/**
 * Les preuves POSIX (tube nommé, dossier en mode 0500) restent dans leurs essais.
 * Ici on vérifie seulement qu'elles ne sont pas lancées sous Windows, où mkfifo
 * manque et où chmod ne bloque pas l'écriture dans un dossier.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const GARDE = "it.runIf(process.platform!=='win32')(";

function registration(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) return '';
  const matches = [
    ...source
      .slice(0, at)
      .matchAll(/\bit(?:\.runIf\(\s*process\.platform\s*!==\s*'win32'\s*\))?\s*\(/g),
  ];
  const last = matches.length > 0 ? matches[matches.length - 1] : undefined;
  return (last?.[0] ?? '').replace(/\s+/g, '');
}

describe('garde Windows des essais POSIX de remise à zéro', () => {
  const reset = readFileSync(path.join(here, 'messaging-session-reset.test.ts'), 'utf8');
  const receveur = readFileSync(path.join(here, '../commands/channel-ai-handler.test.ts'), 'utf8');

  it('P3b le tube nommé ne s execute pas sous Windows', () => {
    expect(registration(reset, "execFileSync('mkfifo'"), 'P3b garde Windows').toBe(GARDE);
  });

  it('P5 module le dossier illisible ne s execute pas sous Windows', () => {
    expect(registration(reset, 'chmodSync(dir, 0o500)'), 'P5 module garde Windows').toBe(GARDE);
  });

  it('P5 receveur le dossier illisible ne s execute pas sous Windows', () => {
    expect(registration(receveur, 'chmodSync(historyDir, 0o500)'), 'P5 receveur garde Windows').toBe(
      GARDE,
    );
  });

  it('P7 le fichier de session illisible ne s execute pas sous Windows', () => {
    expect(registration(reset, 'chmodSync(sessionFile, 0o000)'), 'P7 session garde Windows').toBe(GARDE);
  });

  it('P7 le fichier compagnon illisible ne s execute pas sous Windows', () => {
    expect(registration(reset, 'chmodSync(historyFile, 0o000)'), 'P7 compagnon garde Windows').toBe(GARDE);
  });
});

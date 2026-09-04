/**
 * SERV2 — écart 3 du rapport SERV1, versant documentaire. La doc annonçait un
 * serveur « origin-hardened » sans distinguer les deux surfaces, et le lecteur
 * en déduisait qu'une origine non listée serait refusée en HTTP. Mesure réelle
 * sur `buddy server --port 3620` :
 *
 *   curl -i -H 'Origin: https://evil.example' …/api/health
 *   HTTP/1.1 200 OK            ← et AUCUN Access-Control-Allow-Origin
 *
 * Le refus côté serveur n'existe que sur le WebSocket (`403 Forbidden origin`).
 * En HTTP c'est le navigateur qui bloque. La doc doit le dire, et dire aussi que
 * CORS n'est pas un contrôle d'accès — sinon on croit protéger un serveur qui
 * ne l'est pas.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('SERV2 — la doc dit la vérité sur CORS et les origines', () => {
  it('docs/deployment.md dit que CORS n’est pas un contrôle d’accès', () => {
    const content = read('docs/deployment.md');
    expect(content, 'docs/deployment.md doit écrire que CORS n’est pas un contrôle d’accès')
      .toMatch(/CORS is not (?:an )?access control|not an access-control/i);
  });

  it('docs/deployment.md décrit le 200 sans en-tête, pas un refus HTTP', () => {
    const content = read('docs/deployment.md');
    expect(content, 'docs/deployment.md doit nommer l’en-tête absent')
      .toMatch(/Access-Control-Allow-Origin/);
    expect(content, 'docs/deployment.md doit dire que le serveur ne renvoie PAS 403 en HTTP')
      .toMatch(/not a 403|no 403|pas un 403/i);
  });

  it('docs/infrastructure.md sépare la surface HTTP de la surface WebSocket', () => {
    const content = read('docs/infrastructure.md');
    expect(content, 'docs/infrastructure.md doit opposer HTTP et WebSocket sur l’origine')
      .toMatch(/403 Forbidden origin/);
    expect(content, 'docs/infrastructure.md doit nommer l’en-tête omis côté HTTP')
      .toMatch(/Access-Control-Allow-Origin/);
  });

  it('CLAUDE.md et AGENTS.md ne laissent plus croire à un refus HTTP', () => {
    for (const doc of ['CLAUDE.md', 'AGENTS.md']) {
      const content = read(doc);
      expect(content, `${doc} doit préciser que le refus d’origine est côté WebSocket`)
        .toMatch(/403 Forbidden origin/);
    }
  });
});

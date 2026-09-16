/**
 * SERV2 — écart 2 du rapport SERV1 : la documentation promettait deux ports
 * pour un seul `buddy server` (« 3000 HTTP, 3001 Gateway WS »). La mesure dit
 * l'inverse — un processus, un port, le WebSocket `/ws` dessus :
 *
 *   $ ss -ltnp | grep <pid de buddy server --port 3620>
 *   LISTEN 0 511 127.0.0.1:3620 0.0.0.0:*  users:(("MainThread",pid=…,fd=38))
 *   $ ss -ltn | grep :3621   → aucun listener
 *   $ curl -i --http1.1 -H 'Upgrade: websocket' … http://127.0.0.1:3620/ws
 *   HTTP/1.1 101 Switching Protocols
 *
 * `3001` n'est qu'une CONVENTION de flotte : un SECOND processus du même
 * binaire (`docs/deployment.md`). Les documents qui décrivent un `buddy server`
 * ne doivent donc plus citer ce port ; ceux qui décrivent explicitement deux
 * processus le peuvent.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Documents qui décrivent UN `buddy server`. Aucun ne doit présenter 3001
 * comme un port ouvert par ce serveur — donc aucun ne cite ce nombre.
 */
const SINGLE_SERVER_DOCS = [
  'CLAUDE.md',
  'AGENTS.md',
  'README.md',
  'docs/getting-started.md',
  'docs/infrastructure.md',
  'docs/features.md',
  'docs/cowork/05-settings-server.md',
  'cowork/ARCHITECTURE.md',
  '.claude/skills/code-buddy/SKILL.md',
  '.claude/skills/code-buddy/references/cli-reference.md',
] as const;

/** `3001` isolé — ni `13001`, ni `3001.2`, ni un identifiant plus long. */
const PORT_3001 = /(?<![\w.])3001(?![\w])/g;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function linesMentioning3001(content: string): string[] {
  return content
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => {
      PORT_3001.lastIndex = 0;
      return PORT_3001.test(line);
    })
    .map(({ line, index }) => `${index + 1}: ${line.trim()}`);
}

describe('SERV2 — la doc dit la vérité sur les ports de `buddy server`', () => {
  for (const doc of SINGLE_SERVER_DOCS) {
    it(`${doc} ne présente plus 3001 comme un port de \`buddy server\``, () => {
      const offenders = linesMentioning3001(read(doc));
      expect(
        offenders,
        `${doc} cite le port 3001 : un \`buddy server\` n'ouvre qu'un port, `
          + `avec /ws dessus. 3001 est une convention de SECOND processus, `
          + `documentée dans docs/deployment.md uniquement.\n${offenders.join('\n')}`
      ).toEqual([]);
    });
  }

  it('CLAUDE.md et AGENTS.md énoncent le port unique et le `/ws` dessus', () => {
    for (const doc of ['CLAUDE.md', 'AGENTS.md']) {
      const content = read(doc);
      expect(content, `${doc} doit dire qu'un \`buddy server\` ouvre UN port`)
        .toMatch(/one (?:single )?port|a single port/i);
      expect(content, `${doc} doit nommer le chemin \`/ws\` du WebSocket`)
        .toContain('/ws');
    }
  });

  it('docs/deployment.md garde la convention de flotte : 3001 = un SECOND processus', () => {
    const content = read('docs/deployment.md');
    expect(content).toMatch(/3001/);
    expect(content).toMatch(/separate\s+processes|second\s+instance/i);
  });
});

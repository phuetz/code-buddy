import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { inspectAuthoredCode } from '../../src/agent/self-improvement/authored-artifact-gate.js';
import { buildAuthoredTool } from '../../src/agent/self-improvement/authored-tool-runtime.js';

/**
 * AUDIT SECAUDIT-FLOTTE (Opus, 2026-09-05) — Surface 2.
 * Un outil authored ("lit l'entrée depuis l'env, imprime sur stdout") n'a
 * aucune raison de toucher un fichier d'identifiants. Le runtime redirige HOME
 * mais un chemin ABSOLU en dur le contourne ; le gate statique doit fermer la
 * porte (l'egress réseau/sous-processus est déjà bloqué par ailleurs).
 */
describe('SECAUDIT surface 2 — outil authored lisant un secret', () => {
  it('bloque une lecture de ~/.ssh/id_rsa (chemin absolu en dur)', () => {
    const code = "const fs=require('fs'); console.log(fs.readFileSync('/home/victim/.ssh/id_rsa','utf8'));";
    const r = inspectAuthoredCode(code, 'code');
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/credential|secret path/i);
  });

  it('bloque une lecture de /etc/shadow', () => {
    const code = "const fs=require('fs'); console.log(fs.readFileSync('/etc/shadow','utf8'));";
    const r = inspectAuthoredCode(code, 'code');
    expect(r.ok).toBe(false);
  });

  it('bloque une lecture de .aws/credentials', () => {
    const code = "import { readFileSync } from 'fs'; console.log(readFileSync('/home/x/.aws/credentials','utf8'));";
    const r = inspectAuthoredCode(code, 'code');
    expect(r.ok).toBe(false);
  });

  it('bloque une lecture d\'un .env', () => {
    const code = "const fs=require('fs'); console.log(fs.readFileSync('/srv/app/.env','utf8'));";
    const r = inspectAuthoredCode(code, 'code');
    expect(r.ok).toBe(false);
  });

  it('n\'affecte PAS un outil legitime (lecture de son entree, calcul, stdout)', () => {
    const code = "const input=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); console.log(JSON.stringify({sum:(input.a||0)+(input.b||0)}));";
    const r = inspectAuthoredCode(code, 'code');
    expect(r.ok).toBe(true);
  });

  it('n\'affecte PAS un outil qui lit un fichier de logs ordinaire', () => {
    const code = "const fs=require('fs'); const t=fs.readFileSync('/var/log/app.log','utf8'); console.log(t.split('\\n').length);";
    const r = inspectAuthoredCode(code, 'code');
    expect(r.ok).toBe(true);
  });

  it('DOCUMENTE le résidu runtime : isolate ne confine PAS les lectures par chemin absolu', async () => {
    // Ce test PROUVE pourquoi le gate statique est nécessaire : le sandbox
    // runtime (envMode isolate) redirige HOME mais laisse lire un chemin
    // absolu hors du runDir. Sentinelle hermétique dans un tmp dédié.
    const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secaudit-sentinel-'));
    const sentinelFile = path.join(sentinelDir, 'outside.txt');
    const SENT = 'RUNTIME_ISOLATE_DOES_NOT_CONFINE_READS';
    fs.writeFileSync(sentinelFile, SENT);
    try {
      const tool = buildAuthoredTool({
        name: 'authored__probe_read',
        description: 'probe',
        parameters: {},
        language: 'javascript',
        // chemin absolu injecté via l'entrée pour ne PAS déclencher le gate statique
        code: "const fsm=await import('node:fs'); const p=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}').p; process.stdout.write(fsm.readFileSync(p,'utf8'));",
      });
      const res = await tool.execute({ p: sentinelFile });
      // Le runtime lit bien le fichier hors runDir → confirme que la seule
      // barrière fiable pour un chemin EN DUR est le gate statique.
      expect(res.success).toBe(true);
      expect(String(res.output)).toContain(SENT);
    } finally {
      fs.rmSync(sentinelDir, { recursive: true, force: true });
    }
  });
});

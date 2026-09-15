import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIntegrationChecks } from '../../src/doctor/integrations.js';
let root: string;
beforeEach(() => {root=fs.mkdtempSync(path.join(os.tmpdir(),'doctor-heldout-'));vi.stubEnv('HOME',path.join(root,'home'));fs.mkdirSync(path.join(root,'home','.codebuddy'),{recursive:true});});
afterEach(()=>{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
it.each(['null','[]','42','{"mcpServers":[]}','{"mcpServers":{"bad":null}}'])('invalid shape %s warns without leaking content',async(raw)=>{
 const dir=path.join(root,'project');fs.mkdirSync(path.join(dir,'.codebuddy'),{recursive:true});const p=path.join(dir,'.codebuddy','settings.json');fs.writeFileSync(p,raw);const checks=await runIntegrationChecks(dir,{noSubprocess:true});expect(checks.find(c=>c.id==='mcp')?.status).toBe('warn');expect(fs.readFileSync(p,'utf8')).toBe(raw);
});
it('corrupt user source and backup are unchanged and secret not disclosed',async()=>{
 const p=path.join(root,'home','.codebuddy','mcp.json');const raw='{ "private": "PRIVATE_SENTINEL"';fs.writeFileSync(p,raw);fs.writeFileSync(p+'.bak','{"mcpServers":{"backup":{"command":"node"}}}');const checks=await runIntegrationChecks(root,{noSubprocess:true});expect(fs.readFileSync(p,'utf8')).toBe(raw);expect(checks.find(c=>c.id==='mcp')?.status).toBe('warn');expect(JSON.stringify(checks)).not.toContain('PRIVATE_SENTINEL');
});
it('missing config leaves missing files missing',async()=>{await runIntegrationChecks(root,{noSubprocess:true});expect(fs.existsSync(path.join(root,'.codebuddy','settings.json'))).toBe(false);});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIntegrationChecks } from '../../src/doctor/integrations.js';
import { loadMCPConfig } from '../../src/mcp/config.js';
let root: string;
beforeEach(() => { root=fs.mkdtempSync(path.join(os.tmpdir(),'doctor-readonly-oracle-')); vi.stubEnv('HOME',path.join(root,'home')); fs.mkdirSync(path.join(root,'home')); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(root,{recursive:true,force:true}); });
function fixture(name: string, file: string, raw: string) {
 const dir=path.join(root,name); fs.mkdirSync(path.join(dir,'.codebuddy'),{recursive:true});
 const target=path.join(dir,'.codebuddy',file); fs.writeFileSync(target,raw);
 fs.writeFileSync(target+'.bak',JSON.stringify({mcpServers:{recovered:{command:'node'}}})); return {dir,target};
}
it.each(['settings.json','mcp.json'])('diagnostics preserve corrupt %s and report a warning',async(file)=>{
 const {dir,target}=fixture('broken',file,'{broken'); const backup=fs.readFileSync(target+'.bak'); const cwd=process.cwd();
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network forbidden'));
 const results=await runIntegrationChecks(dir, { noSubprocess: true }); expect(fs.readFileSync(target,'utf8')).toBe('{broken'); expect(fs.readFileSync(target+'.bak')).toEqual(backup);
 expect(results.find(x=>x.id==='mcp')?.status).toBe('warn'); expect(process.cwd()).toBe(cwd); expect(network).not.toHaveBeenCalled();
});
it('normal config readers retain recovery',()=>{ const {dir,target}=fixture('runtime','settings.json','{broken'); expect(loadMCPConfig({cwd:dir}).servers.map(x=>x.name)).toContain('recovered'); expect(JSON.parse(fs.readFileSync(target,'utf8')).mcpServers.recovered).toBeDefined(); });
it('concurrent valid and corrupt diagnostics remain independent',async()=>{
 const a=fixture('a','settings.json','{broken'); const b=fixture('b','settings.json',JSON.stringify({mcpServers:{valid:{command:'node'}}}));
 const [aa,bb]=await Promise.all([runIntegrationChecks(a.dir, { noSubprocess: true }),runIntegrationChecks(b.dir, { noSubprocess: true })]);
 expect(aa.find(x=>x.id==='mcp')?.status).toBe('warn'); expect(bb.find(x=>x.id==='mcp')?.message).toContain('1 configured'); expect(fs.readFileSync(a.target,'utf8')).toBe('{broken');
});

// Run with a temporary HOME only. Token exchange is simulated; callbacks use real HTTP.
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
const [modulePath, scenario] = process.argv.slice(2);
assert(os.homedir().includes('cb-login-probe-'), 'Requires an isolated temporary HOME');
const oauth = await import(modulePath);
const realFetch = globalThis.fetch.bind(globalThis);
let tokenCalls = 0;
globalThis.fetch = async (input, init) => {
  if (String(input) === 'https://auth.openai.com/oauth/token') {
    tokenCalls++;
    return new Response(JSON.stringify({
      id_token: `h.${Buffer.from(JSON.stringify({email:'audit@example.invalid'})).toString('base64url')}.s`,
      access_token:'fixture-access',refresh_token:'fixture-refresh',
    }), {status:200,headers:{'content-type':'application/json'}});
  }
  return realFetch(input,init);
};
if(scenario === 'disk-failure') fs.mkdirSync(oauth.getCodexAuthFilePath(),{recursive:true});
let callback;
const result={scenario};
try {
  const auth=await oauth.loginInteractive(url=>{
    if(scenario==='browser-failure') throw new Error('simulated unavailable browser');
    const u=new URL(url);
    const cb=new URL(u.searchParams.get('redirect_uri'));
    cb.hostname='127.0.0.1';
    cb.searchParams.set('state',scenario==='invalid-state'?'wrong':u.searchParams.get('state'));
    cb.searchParams.set('code','fixture-code');
    if(scenario==='provider-error') cb.searchParams.set('error','access_denied');
    if(scenario==='cancel') cb.pathname='/cancel';
    callback=realFetch(cb).then(async r=>({status:r.status,successPage:(await r.text()).includes('Authentifié à ChatGPT')}));
  });
  result.resolved=true;
  result.returnedAccess=auth.access_token==='fixture-access';
}catch(e){result.resolved=false;result.error=e.message;}
if(callback) result.callback=await callback;
result.tokenCalls=tokenCalls;
const authPath=oauth.getCodexAuthFilePath();
result.persisted=fs.existsSync(authPath)&&fs.statSync(authPath).isFile();
if(result.persisted) result.mode=(fs.statSync(authPath).mode&0o777).toString(8);
console.log(JSON.stringify(result));

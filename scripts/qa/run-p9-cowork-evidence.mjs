import { _electron as electron } from '../../cowork/node_modules/playwright/index.mjs';
import {writeFileSync} from 'node:fs';import path from 'node:path';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../..');const q=path.resolve(process.argv[2]??path.join(root,'_qa/preuves-p9'));const chatMarker=`P9R1_CHAT_${Date.now()}`;const studioFilename=`${chatMarker}.txt`;
console.log('launch');const app=await electron.launch({executablePath:path.join(root,'cowork/node_modules/electron/dist/electron'),args:['--no-sandbox','--disable-gpu',path.join(root,'cowork')],env:{...process.env,NODE_ENV:'production'},timeout:30000});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(5000);await page.waitForTimeout(6000);console.log('window',await page.title());
 if(await page.getByText('Skip onboarding',{exact:true}).isVisible()) await page.getByText('Skip onboarding',{exact:true}).click();
 console.log('saving config');const config=await page.evaluate(async ({project})=>window.electronAPI.config.save({provider:'ollama',activeProfileKey:'ollama',apiKey:'ollama',baseUrl:'http://127.0.0.1:11434/v1',model:'qwen3:4b-instruct',defaultWorkdir:project,profiles:{ollama:{apiKey:'ollama',model:'qwen3:4b-instruct',baseUrl:'http://127.0.0.1:11434/v1'}},onboardingCompleted:true,isConfigured:true}),{project:path.join(q,'project')});
 console.log('config saved');await page.reload();await page.waitForTimeout(5000);
if(await page.locator('[data-testid=onboarding-tour]').count()){console.log(await page.locator('[data-testid=onboarding-tour]').innerText());await page.locator('[data-testid=onboarding-tour]').getByRole('button').first().click();await page.waitForTimeout(1000);}
 const records={expectedChatMarker:chatMarker,config:{success:config.success,provider:config.config.provider,model:config.config.model}};
 for(const label of ['App Studio','Video Studio','Assistant']) {
  try {await page.getByText(label,{exact:true}).first().click();await page.waitForTimeout(1000);console.log('view',label);records[label]=await page.locator('body').innerText();await page.screenshot({path:path.join(q,'reprise-1/raw','cowork-'+label.replaceAll(' ','-')+'.png')});}
  catch(e){records[label]=String(e)};writeFileSync(path.join(q,'reprise-1/raw/cowork-flows.json'),JSON.stringify(records,null,2));
 }
 console.log('studio IPC');const studio=await page.evaluate(async ({project,file,marker})=>({write:await window.electronAPI.studio.files.write(project,file,marker),read:await window.electronAPI.studio.files.read(project,file),tree:await window.electronAPI.studio.files.list(project)}),{project:path.join(q,'project'),file:studioFilename,marker:chatMarker});records.studio=studio;
 records.assistant=await page.evaluate(()=>window.electronAPI.assistant.get());
 records.settings=await page.evaluate(async()=>{window.useAppStore.getState().updateSettings({theme:'light'});await new Promise(r=>setTimeout(r,500));const before=await window.electronAPI.config.get();window.useAppStore.getState().updateSettings({theme:'dark'});await new Promise(r=>setTimeout(r,500));return {before,theme:window.useAppStore.getState().settings.theme,config:await window.electronAPI.config.get()}});
 await page.evaluate(()=>window.useAppStore.getState().setPrimaryView('chat'));await page.waitForTimeout(500);
 writeFileSync(path.join(q,'reprise-1/raw/cowork-flows.json'),JSON.stringify(records,null,2));
const inputs=await page.locator('textarea').count();records.inputs=inputs;
 if(inputs){await page.locator('textarea').first().fill(`Reply exactly ${chatMarker} without tools.`);await page.getByRole('button',{name:'Send',exact:true}).first().click();try{await page.waitForFunction(marker=>{const s=window.useAppStore.getState();return(s.sessionStates[s.activeSessionId]?.messages??[]).some(m=>m.role==='assistant'&&JSON.stringify(m.content).includes(marker));},chatMarker,{timeout:90000});}catch(e){records.chatWaitError=String(e);} records.chat=await page.locator('body').innerText();records.assistantMessages=await page.evaluate(()=>{const s=window.useAppStore.getState();return (s.sessionStates[s.activeSessionId]?.messages??[]).filter(m=>m.role==='assistant').map(m=>({role:m.role,content:m.content}));});}
 writeFileSync(path.join(q,'reprise-1/raw/cowork-flows.json'),JSON.stringify(records,null,2));await page.screenshot({path:path.join(q,'reprise-1/raw/cowork-final.png')});console.log('flows captured');
}finally{await app.close();}

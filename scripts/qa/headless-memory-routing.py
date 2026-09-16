import pathlib,json,tempfile,os,subprocess,threading,http.server,argparse
parser=argparse.ArgumentParser(description="Exercise real headless Buddy memory routing against two scripted loopback endpoints.")
parser.add_argument("--entry",required=True);parser.add_argument("--output",required=True);parser.add_argument("--revision",required=True);parser.add_argument("--expected-fallback",type=int,default=0)
args_config=parser.parse_args()
O=pathlib.Path(args_config.output);O.mkdir(parents=True,exist_ok=True);records=[]
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"data":[],"models":[]}')
 def do_POST(self):
  b=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))));role=self.server.role;messages=b.get('messages',[]);records.append({'endpoint':role,'path':self.path,'requestedModel':b.get('model'),'messageRoles':[x.get('role') for x in messages],'toolDefinitions':len(b.get('tools',[]))})
  tool={'id':'memory-probe','type':'function','function':{'name':'remember','arguments':json.dumps({'key':'qa-routing','value':'fixture memory only','scope':'project','category':'context'})}}
  if role=='session' and b.get('tools') and not any(x.get('role')=='tool' for x in messages):m={'role':'assistant','content':None,'tool_calls':[tool]};finish='tool_calls'
  else:m={'role':'assistant','content':'[]' if role=='fallback' or not b.get('tools') else 'Memory probe complete.'};finish='stop'
  out={'id':'fixture-response','object':'chat.completion','model':b.get('model','fixture'),'choices':[{'index':0,'message':m,'finish_reason':finish}],'usage':{'prompt_tokens':10,'completion_tokens':10,'total_tokens':20}}
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(out).encode())
servers=[]
for role in ['session','fallback']:
 s=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);s.role=role;threading.Thread(target=s.serve_forever,daemon=True).start();servers.append(s)
with tempfile.TemporaryDirectory(prefix='cb-grok-memory-repro-') as home:
 project=pathlib.Path(home,'project');project.mkdir();policy=pathlib.Path(home,'.codebuddy');policy.mkdir();(policy/'tool-policy.json').write_text(json.dumps({'toolOverrides':{'remember':'allow'}}));env={k:v for k,v in os.environ.items() if k in ['PATH','LANG']};env.update(HOME=home,USERPROFILE=home,XDG_CONFIG_HOME=home+'/config',XDG_DATA_HOME=home+'/data',GROK_API_KEY='fixture-fallback',GROK_BASE_URL=f'http://127.0.0.1:{servers[1].server_port}/v1',GROK_MODEL='fixture-fallback',CODEBUDDY_DISABLE_MCP='true',CODEBUDDY_SENSORY='false',CODEBUDDY_SEMANTIC_GATE='false',CODEBUDDY_PROVIDER_FALLBACK='false',CODEBUDDY_LEARNING_BACKGROUND_REVIEW='false')
 args=[os.environ.get('CODEBUDDY_QA_NODE','node'),args_config.entry,'--base-url',f'http://127.0.0.1:{servers[0].server_port}/v1','--api-key','fixture-session','--model','qwen3:4b-instruct','--max-tool-rounds','3','--auto-approve','--allowed-tools','remember','--output-format','stream-json','-p','Remember qa-routing = fixture memory only in project memory.']
 try:p=subprocess.run(args,cwd=project,env=env,capture_output=True,text=True,timeout=60);code=p.returncode;stdout=p.stdout;stderr=p.stderr
 except subprocess.TimeoutExpired as exc:code=None;stdout=str(exc.stdout);stderr=str(exc.stderr)
 (O/'headless-memory-approved.stdout').write_text(stdout);(O/'headless-memory-approved.stderr').write_text(stderr)
 results={'method':'real Buddy headless CLI with two scripted loopback HTTP providers; NOT a real LLM test','sourceRevision':args_config.revision,'exit':code,'requests':records,'fallbackRequests':sum(x['endpoint']=='fallback' for x in records),'oracle':'Reconciliation must use session endpoint and never the independent environment fallback endpoint','memoryFiles':[str(p.relative_to(project)) for p in project.rglob('*') if p.is_file()]};(O/'headless-memory-approved.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
for s in servers:s.shutdown()
assert code == 0, 'CLI failed'
assert results['fallbackRequests'] == args_config.expected_fallback, 'Unexpected memory endpoint'
assert '.codebuddy/CODEBUDDY_MEMORY.md' in results['memoryFiles'], 'Memory file missing'
assert any(x['endpoint']==('fallback' if args_config.expected_fallback else 'session') and x['path']=='/v1/chat/completions' and x['toolDefinitions']==0 for x in records), 'Reconciliation request missing'
